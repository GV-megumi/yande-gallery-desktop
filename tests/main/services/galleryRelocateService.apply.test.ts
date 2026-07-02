import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 5 Task 2 — applyRelocateRoot 应用（单事务无损路径重写）
 *
 * - 改写前先跑 preview，任一 UNIQUE 冲突 → 整体中止、零写入；
 * - 否则在单个 runInTransaction 内改写全部 5 个 (表, 列)，按主键逐行 UPDATE；
 * - 提交后用 getAllGalleryFolderPaths 重新装载 app:// 白名单（galleryRootRegistry）；
 * - 幂等：对同一映射重跑（已无行在 oldPrefix 下）→ 0 affected、不报错；
 * - 无损：图片身份（images.id / gallery_images / image_tags / 封面）不变，只改路径字符串。
 *
 * 真实 :memory: sqlite + PRAGMA foreign_keys=ON；只 mock getDatabase，保留真实
 * run/get/all/runInTransaction。galleryRootRegistry 用真实单例，便于 getGalleryRootsSnapshot 断言
 * （与 backupService.test.ts 的做法一致）。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return {
    ...actual,
    getDatabase: vi.fn(async () => h.db),
    // all 默认透传真实实现；包成 vi.fn 供 TOCTOU 用例注入"扫描期看不到某行"的模拟
    all: vi.fn(actual.all),
  };
});

import { run, get, all } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { getGalleryRootsSnapshot, loadGalleryRoots } from '../../../src/main/services/galleryRootRegistry';
import { applyRelocateRoot, previewRelocateRoot } from '../../../src/main/services/galleryRelocateService';

async function setupSchema(): Promise<void> {
  await run(h.db, `
    CREATE TABLE images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL UNIQUE,
      fileSize INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      format TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE galleries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folderPath TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      coverImageId INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (coverImageId) REFERENCES images (id) ON DELETE SET NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE gallery_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      galleryId INTEGER NOT NULL,
      folderPath TEXT NOT NULL UNIQUE,
      recursive INTEGER NOT NULL DEFAULT 1,
      extensions TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE
    )
  `);
  await run(h.db, `
    CREATE TABLE gallery_images (
      galleryId INTEGER NOT NULL,
      imageId INTEGER NOT NULL,
      addedAt TEXT NOT NULL,
      PRIMARY KEY (galleryId, imageId),
      FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE,
      FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE
    )
  `);
  await run(h.db, `
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT,
      createdAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE image_tags (
      imageId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      PRIMARY KEY (imageId, tagId),
      FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES tags (id) ON DELETE CASCADE
    )
  `);
  await run(h.db, `
    CREATE TABLE gallery_ignored_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folderPath TEXT NOT NULL UNIQUE,
      note TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE booru_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      siteId INTEGER NOT NULL DEFAULT 1,
      postId INTEGER NOT NULL,
      fileUrl TEXT NOT NULL DEFAULT '',
      downloaded INTEGER DEFAULT 0,
      localPath TEXT,
      localImageId INTEGER,
      createdAt TEXT NOT NULL DEFAULT '2024-01-01',
      updatedAt TEXT NOT NULL DEFAULT '2024-01-01',
      FOREIGN KEY (localImageId) REFERENCES images (id) ON DELETE SET NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE booru_favorite_tag_download_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      favoriteTagId INTEGER NOT NULL UNIQUE,
      galleryId INTEGER,
      downloadPath TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
}

async function addImage(filepath: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO images (filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
     VALUES (?, ?, 0, 0, 0, 'jpg', '2024-01-01', '2024-01-01')`,
    [path.basename(filepath), filepath]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function addGallery(folderPath: string, coverImageId: number | null = null): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (folderPath, name, coverImageId, createdAt, updatedAt)
     VALUES (?, 'g', ?, '2024-01-01', '2024-01-01')`,
    [folderPath, coverImageId]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function addFolderBinding(galleryId: number, folderPath: string): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, 1, ?, '2024-01-01', '2024-01-01')`,
    [galleryId, folderPath, JSON.stringify(['.jpg'])]
  );
}

async function addMembership(galleryId: number, imageId: number): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, '2024-01-01')`,
    [galleryId, imageId]
  );
}

async function addIgnoredFolder(folderPath: string): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_ignored_folders (folderPath, note, createdAt, updatedAt) VALUES (?, '', '2024-01-01', '2024-01-01')`,
    [folderPath]
  );
}

async function addBooruPost(postId: number, localPath: string | null, localImageId: number | null = null): Promise<number> {
  await run(
    h.db,
    `INSERT INTO booru_posts (postId, localPath, localImageId) VALUES (?, ?, ?)`,
    [postId, localPath, localImageId]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

let bindingSeq = 0;
async function addBinding(downloadPath: string): Promise<void> {
  bindingSeq += 1;
  await run(
    h.db,
    `INSERT INTO booru_favorite_tag_download_bindings (favoriteTagId, downloadPath, createdAt, updatedAt)
     VALUES (?, ?, '2024-01-01', '2024-01-01')`,
    [bindingSeq, downloadPath]
  );
}

async function getFilepath(id: number): Promise<string | undefined> {
  const row = await get<{ filepath: string }>(h.db, 'SELECT filepath FROM images WHERE id = ?', [id]);
  return row?.filepath;
}

beforeEach(async () => {
  bindingSeq = 0;
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  loadGalleryRoots([]); // 复位单例，避免跨用例污染
  vi.clearAllMocks();
});

afterEach(async () => {
  loadGalleryRoots([]); // 用例自理：复位登记表
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

function countFor(
  affected: Array<{ table: string; column: string; count: number }>,
  table: string,
  column: string
): number {
  return affected.find((a) => a.table === table && a.column === column)?.count ?? 0;
}

describe('applyRelocateRoot — 全量改写', () => {
  it('5 个 (表, 列) 全部改写，后缀保留，非命中行不动', async () => {
    const oldPrefix = normalizePath(path.join('N:', 'hk', 'yande_download'));
    const newPrefix = normalizePath(path.join('D:', 'art'));

    const imgHit = await addImage(normalizePath(path.join('N:', 'hk', 'yande_download', 'a', '1.jpg')));
    const imgMiss = await addImage(normalizePath(path.join('M:', 'other', '3.jpg')));

    const g = await addGallery(normalizePath(path.join('N:', 'hk', 'yande_download', 'a')));
    await addFolderBinding(g, normalizePath(path.join('N:', 'hk', 'yande_download', 'a')));

    await addIgnoredFolder(normalizePath(path.join('N:', 'hk', 'yande_download', 'skip')));
    await addBooruPost(100, normalizePath(path.join('N:', 'hk', 'yande_download', 'a', '1.jpg')));
    await addBinding(normalizePath(path.join('N:', 'hk', 'yande_download', 'a')));

    const result = await applyRelocateRoot([{ oldPrefix, newPrefix }]);

    expect(result.success).toBe(true);
    const affected = result.data!.affected;
    expect(countFor(affected, 'images', 'filepath')).toBe(1);
    expect(countFor(affected, 'gallery_folders', 'folderPath')).toBe(1);
    expect(countFor(affected, 'gallery_ignored_folders', 'folderPath')).toBe(1);
    expect(countFor(affected, 'booru_posts', 'localPath')).toBe(1);
    expect(countFor(affected, 'booru_favorite_tag_download_bindings', 'downloadPath')).toBe(1);

    // 命中行：前缀已改、后缀保留
    expect(await getFilepath(imgHit)).toBe(normalizePath(path.join('D:', 'art', 'a', '1.jpg')));
    // 非命中行：原样不动
    expect(await getFilepath(imgMiss)).toBe(normalizePath(path.join('M:', 'other', '3.jpg')));

    const folder = await get<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders WHERE galleryId = ?', [g]);
    expect(folder?.folderPath).toBe(normalizePath(path.join('D:', 'art', 'a')));
    const ignored = await get<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_ignored_folders LIMIT 1');
    expect(ignored?.folderPath).toBe(normalizePath(path.join('D:', 'art', 'skip')));
    const post = await get<{ localPath: string }>(h.db, 'SELECT localPath FROM booru_posts WHERE postId = 100');
    expect(post?.localPath).toBe(normalizePath(path.join('D:', 'art', 'a', '1.jpg')));
    const binding = await get<{ downloadPath: string }>(h.db, 'SELECT downloadPath FROM booru_favorite_tag_download_bindings LIMIT 1');
    expect(binding?.downloadPath).toBe(normalizePath(path.join('D:', 'art', 'a')));
  });

  it('提交后刷新 app:// 白名单（getGalleryRootsSnapshot 反映改写后的 folderPath）', async () => {
    const oldPrefix = normalizePath(path.join('N:', 'hk', 'yande_download'));
    const newPrefix = normalizePath(path.join('D:', 'art'));
    const g = await addGallery(normalizePath(path.join('N:', 'hk', 'yande_download', 'a')));
    await addFolderBinding(g, normalizePath(path.join('N:', 'hk', 'yande_download', 'a')));

    loadGalleryRoots([normalizePath(path.join('N:', 'hk', 'yande_download', 'a'))]); // 旧白名单

    await applyRelocateRoot([{ oldPrefix, newPrefix }]);

    expect(getGalleryRootsSnapshot()).toEqual([normalizePath(path.join('D:', 'art', 'a'))]);
  });
});

describe('applyRelocateRoot — 冲突中止（零写入）', () => {
  it('存在 UNIQUE 冲突 → 整体中止，所有行保持原值、白名单不变', async () => {
    const oldPrefix = normalizePath(path.join('N:', 'src'));
    const newPrefix = normalizePath(path.join('N:', 'dst'));

    const srcImg = await addImage(normalizePath(path.join('N:', 'src', 'dup.jpg')));
    const dstImg = await addImage(normalizePath(path.join('N:', 'dst', 'dup.jpg'))); // 既有占位 → 冲突
    // 同时给一个本可成功改写的 booru_posts，确认它也没被写
    await addBooruPost(200, normalizePath(path.join('N:', 'src', 'keep.jpg')));

    loadGalleryRoots(['SENTINEL']); // 用哨兵确认白名单未被刷新

    const result = await applyRelocateRoot([{ oldPrefix, newPrefix }]);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();

    // 全部原值（零写入）
    expect(await getFilepath(srcImg)).toBe(normalizePath(path.join('N:', 'src', 'dup.jpg')));
    expect(await getFilepath(dstImg)).toBe(normalizePath(path.join('N:', 'dst', 'dup.jpg')));
    const post = await get<{ localPath: string }>(h.db, 'SELECT localPath FROM booru_posts WHERE postId = 200');
    expect(post?.localPath).toBe(normalizePath(path.join('N:', 'src', 'keep.jpg')));

    // 白名单未被刷新（仍是哨兵）
    expect(getGalleryRootsSnapshot()).toEqual(['SENTINEL']);
  });

  it('多源映射到同一新路径 → 预检即中止，零写入、白名单不变', async () => {
    // src1\dup 与 src2\dup 都改写到 D:\dst\dup（UNIQUE 列），应被预检拦截而非进事务才撞约束
    const m1 = { oldPrefix: normalizePath(path.join('N:', 'src1')), newPrefix: normalizePath(path.join('D:', 'dst')) };
    const m2 = { oldPrefix: normalizePath(path.join('N:', 'src2')), newPrefix: normalizePath(path.join('D:', 'dst')) };

    const ga = await addGallery(normalizePath(path.join('N:', 'src1', 'dup')));
    await addFolderBinding(ga, normalizePath(path.join('N:', 'src1', 'dup')));
    const gb = await addGallery(normalizePath(path.join('N:', 'src2', 'dup')));
    await addFolderBinding(gb, normalizePath(path.join('N:', 'src2', 'dup')));

    loadGalleryRoots(['SENTINEL']);

    const result = await applyRelocateRoot([m1, m2]);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();

    // 两条 folder 绑定均保持原值（零写入）
    const fa = await get<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders WHERE galleryId = ?', [ga]);
    const fb = await get<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders WHERE galleryId = ?', [gb]);
    expect(fa?.folderPath).toBe(normalizePath(path.join('N:', 'src1', 'dup')));
    expect(fb?.folderPath).toBe(normalizePath(path.join('N:', 'src2', 'dup')));

    // 白名单未刷新
    expect(getGalleryRootsSnapshot()).toEqual(['SENTINEL']);
  });
});

describe('applyRelocateRoot — 幂等', () => {
  it('重跑同一映射（已无行在 oldPrefix 下）→ 0 affected、不报错', async () => {
    const oldPrefix = normalizePath(path.join('N:', 'hk', 'yande_download'));
    const newPrefix = normalizePath(path.join('D:', 'art'));
    const g = await addGallery(normalizePath(path.join('N:', 'hk', 'yande_download', 'a')));
    await addFolderBinding(g, normalizePath(path.join('N:', 'hk', 'yande_download', 'a')));
    await addImage(normalizePath(path.join('N:', 'hk', 'yande_download', 'a', '1.jpg')));

    const first = await applyRelocateRoot([{ oldPrefix, newPrefix }]);
    expect(first.success).toBe(true);

    const second = await applyRelocateRoot([{ oldPrefix, newPrefix }]);
    expect(second.success).toBe(true);
    const affected = second.data!.affected;
    expect(countFor(affected, 'images', 'filepath')).toBe(0);
    expect(countFor(affected, 'gallery_folders', 'folderPath')).toBe(0);
  });
});

describe('applyRelocateRoot — 多映射', () => {
  it('一次调用两个前缀 → 各自改写到各自目标', async () => {
    const m1 = { oldPrefix: normalizePath(path.join('N:', 'src1')), newPrefix: normalizePath(path.join('D:', 'dst1')) };
    const m2 = { oldPrefix: normalizePath(path.join('N:', 'src2')), newPrefix: normalizePath(path.join('E:', 'dst2')) };

    const a = await addImage(normalizePath(path.join('N:', 'src1', 'a.jpg')));
    const b = await addImage(normalizePath(path.join('N:', 'src2', 'b.jpg')));
    const c = await addImage(normalizePath(path.join('N:', 'src3', 'c.jpg'))); // 不命中任何映射

    const result = await applyRelocateRoot([m1, m2]);
    expect(result.success).toBe(true);

    expect(await getFilepath(a)).toBe(normalizePath(path.join('D:', 'dst1', 'a.jpg')));
    expect(await getFilepath(b)).toBe(normalizePath(path.join('E:', 'dst2', 'b.jpg')));
    expect(await getFilepath(c)).toBe(normalizePath(path.join('N:', 'src3', 'c.jpg')));
  });
});

describe('applyRelocateRoot — 图片身份无损', () => {
  it('只改路径字符串：images.id / gallery_images / image_tags / 封面 全部不变', async () => {
    const oldPrefix = normalizePath(path.join('N:', 'lib'));
    const newPrefix = normalizePath(path.join('D:', 'lib2'));

    const imgId = await addImage(normalizePath(path.join('N:', 'lib', 'pic.jpg')));
    const g = await addGallery(normalizePath(path.join('N:', 'lib')), imgId); // 封面 = imgId
    await addFolderBinding(g, normalizePath(path.join('N:', 'lib')));
    await addMembership(g, imgId);
    await run(h.db, `INSERT INTO tags (name, category, createdAt) VALUES ('t1', 'general', '2024-01-01')`);
    const tag = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
    await run(h.db, `INSERT INTO image_tags (imageId, tagId) VALUES (?, ?)`, [imgId, tag!.id]);

    const result = await applyRelocateRoot([{ oldPrefix, newPrefix }]);
    expect(result.success).toBe(true);

    // 图片 id 不变，仅路径改了
    const img = await get<{ id: number; filepath: string }>(h.db, 'SELECT id, filepath FROM images WHERE id = ?', [imgId]);
    expect(img?.id).toBe(imgId);
    expect(img?.filepath).toBe(normalizePath(path.join('D:', 'lib2', 'pic.jpg')));

    // 成员表 / 标签关联 / 封面引用 全部按 imageId 不变
    const member = await get<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [g]);
    expect(member?.imageId).toBe(imgId);
    const it = await get<{ imageId: number; tagId: number }>(h.db, 'SELECT imageId, tagId FROM image_tags WHERE imageId = ?', [imgId]);
    expect(it).toMatchObject({ imageId: imgId, tagId: tag!.id });
    const cover = await get<{ coverImageId: number }>(h.db, 'SELECT coverImageId FROM galleries WHERE id = ?', [g]);
    expect(cover?.coverImageId).toBe(imgId);
  });
});

describe('applyRelocateRoot — 链式/互换/自包含映射（两阶段改写消除瞬时 UNIQUE 碰撞）', () => {
  // 这些映射的终态均无重复（preview 也放行），但"某行的改写目标 = 另一待改写行的当前路径"，
  // 单遍逐行 UPDATE 会在中间状态误撞 SQLITE_CONSTRAINT。两阶段改写后必须全部可应用。

  it('链式映射 [A→B, B→C]：preview 放行且 apply 成功，终态路径正确', async () => {
    const mappings = [
      { oldPrefix: normalizePath(path.join('X:', 'a')), newPrefix: normalizePath(path.join('X:', 'b')) },
      { oldPrefix: normalizePath(path.join('X:', 'b')), newPrefix: normalizePath(path.join('X:', 'c')) },
    ];
    const img1 = await addImage(normalizePath(path.join('X:', 'a', '1.jpg')));
    const img2 = await addImage(normalizePath(path.join('X:', 'b', '1.jpg')));

    // 终态 X:\b\1.jpg / X:\c\1.jpg 无重复 → preview 判无冲突（该判定本身正确，作为契约锁定）
    const preview = await previewRelocateRoot(mappings);
    expect(preview.success).toBe(true);
    expect(preview.data!.collisions).toEqual([]);

    // preview 放行的批次 apply 必须成功（img1 的目标是 img2 的当前路径，单遍直写会瞬时撞 UNIQUE）
    const result = await applyRelocateRoot(mappings);
    expect(result.success).toBe(true);
    expect(countFor(result.data!.affected, 'images', 'filepath')).toBe(2);
    expect(await getFilepath(img1)).toBe(normalizePath(path.join('X:', 'b', '1.jpg')));
    expect(await getFilepath(img2)).toBe(normalizePath(path.join('X:', 'c', '1.jpg')));
  });

  it('互换映射 [A→B, B→A]：images 与 gallery_folders 两个 UNIQUE 站点均成功互换', async () => {
    const mappings = [
      { oldPrefix: normalizePath(path.join('X:', 'a')), newPrefix: normalizePath(path.join('X:', 'b')) },
      { oldPrefix: normalizePath(path.join('X:', 'b')), newPrefix: normalizePath(path.join('X:', 'a')) },
    ];
    const img1 = await addImage(normalizePath(path.join('X:', 'a', '1.jpg')));
    const img2 = await addImage(normalizePath(path.join('X:', 'b', '1.jpg')));
    const ga = await addGallery(normalizePath(path.join('X:', 'a')));
    await addFolderBinding(ga, normalizePath(path.join('X:', 'a')));
    const gb = await addGallery(normalizePath(path.join('X:', 'b')));
    await addFolderBinding(gb, normalizePath(path.join('X:', 'b')));

    const preview = await previewRelocateRoot(mappings);
    expect(preview.success).toBe(true);
    expect(preview.data!.collisions).toEqual([]);

    // 互换任何改写顺序在单遍直写下都必然瞬时撞 UNIQUE，两阶段后必须成功
    const result = await applyRelocateRoot(mappings);
    expect(result.success).toBe(true);
    expect(countFor(result.data!.affected, 'images', 'filepath')).toBe(2);
    expect(countFor(result.data!.affected, 'gallery_folders', 'folderPath')).toBe(2);

    expect(await getFilepath(img1)).toBe(normalizePath(path.join('X:', 'b', '1.jpg')));
    expect(await getFilepath(img2)).toBe(normalizePath(path.join('X:', 'a', '1.jpg')));
    const fa = await get<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders WHERE galleryId = ?', [ga]);
    const fb = await get<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders WHERE galleryId = ?', [gb]);
    expect(fa?.folderPath).toBe(normalizePath(path.join('X:', 'b')));
    expect(fb?.folderPath).toBe(normalizePath(path.join('X:', 'a')));
  });

  it('自包含映射 old=X:\\gal → new=X:\\gal\\sub：源与目标同时在库时也能成功', async () => {
    const mappings = [
      { oldPrefix: normalizePath(path.join('X:', 'gal')), newPrefix: normalizePath(path.join('X:', 'gal', 'sub')) },
    ];
    // img1 的目标恰是 img2 的当前路径；img2 自身也被改写走 → 终态无重复
    const img1 = await addImage(normalizePath(path.join('X:', 'gal', 'a.jpg')));
    const img2 = await addImage(normalizePath(path.join('X:', 'gal', 'sub', 'a.jpg')));

    const preview = await previewRelocateRoot(mappings);
    expect(preview.success).toBe(true);
    expect(preview.data!.collisions).toEqual([]);

    const result = await applyRelocateRoot(mappings);
    expect(result.success).toBe(true);
    expect(countFor(result.data!.affected, 'images', 'filepath')).toBe(2);
    expect(await getFilepath(img1)).toBe(normalizePath(path.join('X:', 'gal', 'sub', 'a.jpg')));
    expect(await getFilepath(img2)).toBe(normalizePath(path.join('X:', 'gal', 'sub', 'sub', 'a.jpg')));
  });

  it('真终态冲突（扫描期看不到的既有占位行，模拟 TOCTOU 并发插入）→ 事务内撞 UNIQUE 整体回滚，零写入且无临时占位残留', async () => {
    const actualDb = await vi.importActual<typeof import('../../../src/main/services/database.js')>(
      '../../../src/main/services/database.js'
    );
    const oldPrefix = normalizePath(path.join('N:', 'src'));
    const newPrefix = normalizePath(path.join('N:', 'dst'));

    const srcImg = await addImage(normalizePath(path.join('N:', 'src', 'dup.jpg')));
    // 真占位行：目标路径已被既有行占用，但对扫描隐藏（等价于 preview/apply 扫描后才并发插入）
    const hiddenImg = await addImage(normalizePath(path.join('N:', 'dst', 'dup.jpg')));
    // 排在 images 之前的站点（gallery_folders）会先被两阶段改写成功，必须一并回滚
    const g = await addGallery(normalizePath(path.join('N:', 'src', 'gal')));
    await addFolderBinding(g, normalizePath(path.join('N:', 'src', 'gal')));

    loadGalleryRoots(['SENTINEL']);

    const hiddenKey = normalizePath(path.join('N:', 'dst', 'dup.jpg'));
    const allMock = all as unknown as Mock;
    try {
      // 让 scanSite 看不到 hiddenImg → 预检判无冲突 → 进事务 → 第二阶段写最终路径时撞真实 UNIQUE
      allMock.mockImplementation(async (db: sqlite3.Database, sql: string, params?: any[]) => {
        const rows = await actualDb.all<{ id: number; value?: string }>(db, sql, params ?? []);
        return rows.filter((r) => r?.value !== hiddenKey);
      });
      const result = await applyRelocateRoot([{ oldPrefix, newPrefix }]);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/UNIQUE/i);
    } finally {
      allMock.mockImplementation(actualDb.all);
    }

    // 整体回滚：所有行保持原值（含已先行改写成功的 gallery_folders）
    expect(await getFilepath(srcImg)).toBe(normalizePath(path.join('N:', 'src', 'dup.jpg')));
    expect(await getFilepath(hiddenImg)).toBe(normalizePath(path.join('N:', 'dst', 'dup.jpg')));
    const folder = await get<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders WHERE galleryId = ?', [g]);
    expect(folder?.folderPath).toBe(normalizePath(path.join('N:', 'src', 'gal')));

    // 两阶段的第一遍占位值也必须随回滚消失（临时值含 'relocate' 标记，可据此检漏）
    const tmpImages = await get<{ c: number }>(h.db, "SELECT COUNT(*) AS c FROM images WHERE filepath LIKE '%relocate%'");
    const tmpFolders = await get<{ c: number }>(h.db, "SELECT COUNT(*) AS c FROM gallery_folders WHERE folderPath LIKE '%relocate%'");
    expect(tmpImages?.c).toBe(0);
    expect(tmpFolders?.c).toBe(0);

    // 白名单未刷新（仍是哨兵）
    expect(getGalleryRootsSnapshot()).toEqual(['SENTINEL']);
  });
});
