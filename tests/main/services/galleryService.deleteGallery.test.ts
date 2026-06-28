import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * deleteGallery —— Phase 3：按成员删除 + 孤儿回收（替代旧的 folderPath 前缀级联）
 *
 * 公开契约（必须保持不变）：
 *   - 返回 { success, error? }；图集不存在时 success:false + error，且不触清理；
 *   - 删除后：图集行消失、其成员图片（仅本图集独占的）被删、缩略图被清、
 *     booru_posts 对应行 downloaded=0/localPath=NULL 重置；
 *   - 每个绑定文件夹写入 gallery_ignored_folders（拉黑，下次扫描不重建）；
 *   - 事件 gallery:galleries-changed{action:'deleted'} + gallery:ignored-folders-changed{action:'created'}；
 *   - 原图文件不删（本测试在 :memory: 中不涉及真实磁盘）。
 *
 * 关键修复（多归属）：被另一图集同时引用的图片，删除本图集时不应被删。
 *
 * 实现方式从"SQL 文本断言（mock db）"升级为"真实 :memory: sqlite + 端到端结果断言"，
 * 这样可验证 FK CASCADE 与多归属保护——比旧的 SQL 文本匹配覆盖更强。
 * 仅把磁盘 IO（deleteThumbnail）与磁盘扫描（scanAndImportFolder）mock 掉。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  deleteThumbnailCalls: [] as string[],
  galleriesChanged: [] as any[],
  ignoredChanged: [] as any[],
  removeRootCalls: [] as string[],
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return {
    ...actual,
    getDatabase: vi.fn(async () => h.db),
  };
});

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(async () => ({ success: true, data: { imported: 0, skipped: 0 } })),
}));

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  deleteThumbnail: vi.fn(async (filepath: string) => {
    h.deleteThumbnailCalls.push(filepath);
    return { success: true };
  }),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryGalleriesChanged: vi.fn((p: any) => { h.galleriesChanged.push(p); }),
  emitGalleryIgnoredFoldersChanged: vi.fn((p: any) => { h.ignoredChanged.push(p); }),
}));

vi.mock('../../../src/main/services/galleryRootRegistry.js', () => ({
  addGalleryRoot: vi.fn(),
  removeGalleryRoot: vi.fn((p: string) => { h.removeRootCalls.push(p); }),
}));

import { run, get, all } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { deleteGallery } from '../../../src/main/services/galleryService';

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
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT,
      createdAt TEXT NOT NULL DEFAULT '2024-01-01'
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
    CREATE TABLE galleries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folderPath TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      coverImageId INTEGER,
      imageCount INTEGER DEFAULT 0,
      lastScannedAt TEXT,
      isWatching INTEGER DEFAULT 1,
      recursive INTEGER DEFAULT 1,
      extensions TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
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
    CREATE TABLE gallery_ignored_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folderPath TEXT NOT NULL UNIQUE,
      note TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE booru_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT '2024-01-01',
      updatedAt TEXT NOT NULL DEFAULT '2024-01-01'
    )
  `);
  await run(h.db, `
    CREATE TABLE booru_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      siteId INTEGER NOT NULL,
      postId INTEGER NOT NULL,
      fileUrl TEXT NOT NULL,
      downloaded INTEGER DEFAULT 0,
      localPath TEXT,
      localImageId INTEGER,
      createdAt TEXT NOT NULL DEFAULT '2024-01-01',
      updatedAt TEXT NOT NULL DEFAULT '2024-01-01',
      FOREIGN KEY (localImageId) REFERENCES images(id) ON DELETE SET NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE invalid_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      originalImageId INTEGER NOT NULL,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      detectedAt TEXT NOT NULL DEFAULT '2024-01-01',
      galleryId INTEGER,
      FOREIGN KEY (galleryId) REFERENCES galleries(id) ON DELETE SET NULL
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

async function addGallery(folderPath: string, recursive: number): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (folderPath, name, isWatching, recursive, extensions, createdAt, updatedAt)
     VALUES (?, 'g', 1, ?, ?, '2024-01-01', '2024-01-01')`,
    [folderPath, recursive, JSON.stringify(['.jpg'])]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function addFolderBinding(galleryId: number, folderPath: string, recursive: number): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, '2024-01-01', '2024-01-01')`,
    [galleryId, folderPath, recursive, JSON.stringify(['.jpg'])]
  );
}

async function addMembership(galleryId: number, imageId: number): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, '2024-01-01')`,
    [galleryId, imageId]
  );
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  h.deleteThumbnailCalls = [];
  h.galleriesChanged = [];
  h.ignoredChanged = [];
  h.removeRootCalls = [];
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('deleteGallery — 按成员删除 + 孤儿回收', () => {
  it('单文件夹图集：删除后图集消失、独占图片被删、缩略图清、booru 重置、文件夹拉黑、事件齐全', async () => {
    const folder = normalizePath(path.join('M:', 'pics'));
    const galleryId = await addGallery(folder, 1);
    await addFolderBinding(galleryId, folder, 1);

    const fa = normalizePath(path.join('M:', 'pics', 'a.jpg'));
    const fb = normalizePath(path.join('M:', 'pics', 'b.jpg'));
    const ia = await addImage(fa);
    const ib = await addImage(fb);
    await addMembership(galleryId, ia);
    await addMembership(galleryId, ib);

    // image_tags 关联（验证 FK CASCADE）
    await run(h.db, `INSERT INTO tags (name) VALUES ('t')`);
    const tagRow = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
    await run(h.db, `INSERT INTO image_tags (imageId, tagId) VALUES (?, ?)`, [ia, tagRow!.id]);

    // booru_post 落地在该图集目录（localImageId + localPath 命中）
    await run(h.db, `INSERT INTO booru_sites (name, url, type) VALUES ('S','https://s','moebooru')`);
    const siteRow = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
    await run(
      h.db,
      `INSERT INTO booru_posts (siteId, postId, fileUrl, downloaded, localPath, localImageId)
       VALUES (?, 1, 'https://f', 1, ?, ?)`,
      [siteRow!.id, fa, ia]
    );

    // invalid_images 关联本图集（删除时应被清，避免累积孤儿行）
    await run(
      h.db,
      `INSERT INTO invalid_images (originalImageId, filename, filepath, galleryId)
       VALUES (?, 'bad.jpg', ?, ?)`,
      [ia, fa, galleryId]
    );

    const result = await deleteGallery(galleryId);

    expect(result.success).toBe(true);

    // 图集行消失（FK CASCADE 连带 gallery_folders / gallery_images）
    expect(await all(h.db, 'SELECT * FROM galleries WHERE id = ?', [galleryId])).toHaveLength(0);
    expect(await all(h.db, 'SELECT * FROM gallery_folders WHERE galleryId = ?', [galleryId])).toHaveLength(0);
    expect(await all(h.db, 'SELECT * FROM gallery_images WHERE galleryId = ?', [galleryId])).toHaveLength(0);

    // 独占成员图片被删 + image_tags 经 CASCADE 清空
    expect(await all(h.db, 'SELECT id FROM images')).toHaveLength(0);
    expect(await all(h.db, 'SELECT * FROM image_tags')).toHaveLength(0);

    // 缩略图逐个清
    expect(h.deleteThumbnailCalls.sort()).toEqual([fa, fb].sort());

    // booru 重置
    const post = await get<{ downloaded: number; localPath: string | null }>(h.db, 'SELECT downloaded, localPath FROM booru_posts WHERE postId = 1');
    expect(post?.downloaded).toBe(0);
    expect(post?.localPath).toBeNull();

    // 文件夹拉黑（gallery_ignored_folders 写入 normalized 路径）
    const ignored = await all<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_ignored_folders');
    expect(ignored.map((r) => r.folderPath)).toContain(folder);

    // invalid_images 本图集记录被清
    expect(await all(h.db, 'SELECT * FROM invalid_images')).toHaveLength(0);

    // 事件齐全
    expect(h.galleriesChanged.some((p) => p.galleryId === galleryId && p.action === 'deleted')).toBe(true);
    expect(h.ignoredChanged.some((p) => p.action === 'created' && p.folderPath === folder)).toBe(true);
    // 根登记移除
    expect(h.removeRootCalls).toContain(folder);
  });

  it('图集不存在时返回 success:false 且不触任何清理', async () => {
    const result = await deleteGallery(999);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(h.deleteThumbnailCalls).toEqual([]);
    expect(await all(h.db, 'SELECT * FROM gallery_ignored_folders')).toHaveLength(0);
    expect(h.galleriesChanged).toEqual([]);
    expect(h.ignoredChanged).toEqual([]);
  });

  it('图集无图片时不调 deleteThumbnail，但仍删图集行 + 拉黑文件夹', async () => {
    const folder = normalizePath(path.join('M:', 'empty'));
    const galleryId = await addGallery(folder, 1);
    await addFolderBinding(galleryId, folder, 1);

    const result = await deleteGallery(galleryId);

    expect(result.success).toBe(true);
    expect(h.deleteThumbnailCalls).toEqual([]);
    expect(await all(h.db, 'SELECT * FROM galleries WHERE id = ?', [galleryId])).toHaveLength(0);
    const ignored = await all<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_ignored_folders');
    expect(ignored.map((r) => r.folderPath)).toContain(folder);
  });

  it('deleteThumbnail 抛错应被吞（best-effort），其余清理仍完成', async () => {
    const folder = normalizePath(path.join('M:', 'x'));
    const galleryId = await addGallery(folder, 1);
    await addFolderBinding(galleryId, folder, 1);
    const img = await addImage(normalizePath(path.join('M:', 'x', 'a.jpg')));
    await addMembership(galleryId, img);

    const { deleteThumbnail } = await import('../../../src/main/services/thumbnailService.js');
    (deleteThumbnail as any).mockRejectedValueOnce(new Error('fs EACCES'));

    const result = await deleteGallery(galleryId);

    expect(result.success).toBe(true);
    expect(await all(h.db, 'SELECT * FROM galleries WHERE id = ?', [galleryId])).toHaveLength(0);
    expect(await all(h.db, 'SELECT id FROM images')).toHaveLength(0);
  });

  /**
   * 多归属修复证明：一张图片同时归属图集 A 与图集 B；删除 A 时该图片不应被删，
   * 因为它仍是 B 的成员。旧的 folderPath 前缀级联会把它一起删掉（数据丢失）。
   */
  it('共享图片同时归属另一图集时，删除本图集不删除该共享图（多归属修复）', async () => {
    const folderA = normalizePath(path.join('M:', 'A'));
    const folderB = normalizePath(path.join('M:', 'B'));
    const galleryA = await addGallery(folderA, 1);
    const galleryB = await addGallery(folderB, 1);
    await addFolderBinding(galleryA, folderA, 1);
    await addFolderBinding(galleryB, folderB, 1);

    // shared 图片在 A 与 B 都是成员（多归属，复合主键允许）
    const shared = await addImage(normalizePath(path.join('M:', 'A', 'shared.jpg')));
    const aOnly = await addImage(normalizePath(path.join('M:', 'A', 'aonly.jpg')));
    await addMembership(galleryA, shared);
    await addMembership(galleryB, shared);
    await addMembership(galleryA, aOnly);

    const result = await deleteGallery(galleryA);

    expect(result.success).toBe(true);

    // A 消失
    expect(await all(h.db, 'SELECT * FROM galleries WHERE id = ?', [galleryA])).toHaveLength(0);
    // shared 图片仍在（B 还引用它），aOnly 被回收
    const imgIds = (await all<{ id: number }>(h.db, 'SELECT id FROM images ORDER BY id')).map((r) => r.id);
    expect(imgIds).toEqual([shared]);
    // B 的成员行仍在
    const bMembers = (await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryB])).map((r) => r.imageId);
    expect(bMembers).toEqual([shared]);
    // 仅 aOnly 的缩略图被清，shared 未被清
    expect(h.deleteThumbnailCalls).toEqual([normalizePath(path.join('M:', 'A', 'aonly.jpg'))]);
  });

  /**
   * 多文件夹图集：删除时每个绑定文件夹都应被拉黑（不仅是 galleries.folderPath）。
   */
  it('多文件夹图集：删除时每个绑定文件夹都写入忽略名单', async () => {
    const folder1 = normalizePath(path.join('M:', 'multi1'));
    const folder2 = normalizePath(path.join('M:', 'multi2'));
    const galleryId = await addGallery(folder1, 1);
    await addFolderBinding(galleryId, folder1, 1);
    await addFolderBinding(galleryId, folder2, 1);

    const result = await deleteGallery(galleryId);

    expect(result.success).toBe(true);
    const ignored = (await all<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_ignored_folders ORDER BY folderPath')).map((r) => r.folderPath);
    expect(ignored).toContain(folder1);
    expect(ignored).toContain(folder2);
    // 两个文件夹的根登记都被移除
    expect(h.removeRootCalls).toContain(folder1);
    expect(h.removeRootCalls).toContain(folder2);
    // 两个忽略事件
    expect(h.ignoredChanged.filter((p) => p.action === 'created').map((p) => p.folderPath).sort()).toEqual([folder1, folder2].sort());
  });

  /**
   * 事务回滚：deleteGallery 第一个事务内某条写失败（这里令 gallery_ignored_folders
   * 写入失败——删表使 INSERT 抛错）→ 整个事务回滚：图集行仍在、成员/图片完好；
   * 且 cleanupOrphanImages（第二个事务）从不执行（无缩略图清理）。
   */
  it('删图集事务内写失败时应整体回滚：图集与成员图片均保留', async () => {
    const folder = normalizePath(path.join('M:', 'rollback'));
    const galleryId = await addGallery(folder, 1);
    await addFolderBinding(galleryId, folder, 1);
    const img = await addImage(normalizePath(path.join('M:', 'rollback', 'a.jpg')));
    await addMembership(galleryId, img);

    // 删掉 gallery_ignored_folders 表 → 事务内 INSERT OR REPLACE 抛错 → 触发 ROLLBACK
    await run(h.db, 'DROP TABLE gallery_ignored_folders');

    const result = await deleteGallery(galleryId);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();

    // 事务-1 回滚：图集行仍在
    expect(await all(h.db, 'SELECT * FROM galleries WHERE id = ?', [galleryId])).toHaveLength(1);
    // gallery_folders / gallery_images 也应回滚保留
    expect(await all(h.db, 'SELECT * FROM gallery_folders WHERE galleryId = ?', [galleryId])).toHaveLength(1);
    expect(await all(h.db, 'SELECT * FROM gallery_images WHERE galleryId = ?', [galleryId])).toHaveLength(1);
    // 图片完好（cleanupOrphanImages 第二事务从未执行）
    expect((await all<{ id: number }>(h.db, 'SELECT id FROM images')).map((r) => r.id)).toEqual([img]);
    // 不应清缩略图、不应发 deleted 事件
    expect(h.deleteThumbnailCalls).toEqual([]);
    expect(h.galleriesChanged.some((p) => p.action === 'deleted')).toBe(false);
  });

  /**
   * 拉黑名单 createdAt 保留：删除图集时若该文件夹已在忽略名单（带旧 createdAt），
   * INSERT OR REPLACE 的 COALESCE 应保留原 createdAt，仅刷新 updatedAt。
   */
  it('删图集写忽略名单时应保留已有 createdAt，仅刷新 updatedAt', async () => {
    const folder = normalizePath(path.join('M:', 'preserve'));
    const galleryId = await addGallery(folder, 1);
    await addFolderBinding(galleryId, folder, 1);

    // 预置忽略名单：旧 createdAt / 旧 updatedAt
    const oldCreatedAt = '2020-01-01T00:00:00.000Z';
    const oldUpdatedAt = '2020-01-01T00:00:00.000Z';
    await run(
      h.db,
      `INSERT INTO gallery_ignored_folders (folderPath, note, createdAt, updatedAt) VALUES (?, '旧备注', ?, ?)`,
      [folder, oldCreatedAt, oldUpdatedAt]
    );

    const result = await deleteGallery(galleryId);

    expect(result.success).toBe(true);
    const row = await get<{ createdAt: string; updatedAt: string }>(
      h.db,
      'SELECT createdAt, updatedAt FROM gallery_ignored_folders WHERE folderPath = ?',
      [folder]
    );
    // createdAt 不变（COALESCE 路径）
    expect(row?.createdAt).toBe(oldCreatedAt);
    // updatedAt 被刷新（不再是旧值）
    expect(row?.updatedAt).not.toBe(oldUpdatedAt);
    expect(row?.updatedAt).toBeTruthy();
  });
});
