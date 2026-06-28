import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 5 Task 1 — previewRelocateRoot 预检
 *
 * 跨机迁移：用户把 DB 与文件一起搬到新机器，库的路径前缀变了
 * （如 N:\hk\yande_download\* → D:\art\*）。previewRelocateRoot 在不写库的前提下
 * 统计每个 (table, column) 会被改写多少行，并检测改写后是否撞上 UNIQUE 既有行。
 *
 * 真实 :memory: sqlite + PRAGMA foreign_keys=ON；只 mock 掉 database.js 的 getDatabase，
 * 保留真实 run/get/all（与 changeFolderPath.test.ts 一致）。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return {
    ...actual,
    getDatabase: vi.fn(async () => h.db),
  };
});

import { run, get, all } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { previewRelocateRoot } from '../../../src/main/services/galleryRelocateService';

/** 建迁移涉及的 5 张表（含各自 UNIQUE 约束），与 database.ts schema 对齐。 */
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
      createdAt TEXT NOT NULL DEFAULT '2024-01-01',
      updatedAt TEXT NOT NULL DEFAULT '2024-01-01'
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

async function addGallery(folderPath: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (folderPath, name, createdAt, updatedAt) VALUES (?, 'g', '2024-01-01', '2024-01-01')`,
    [folderPath]
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

async function addIgnoredFolder(folderPath: string): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_ignored_folders (folderPath, note, createdAt, updatedAt) VALUES (?, '', '2024-01-01', '2024-01-01')`,
    [folderPath]
  );
}

async function addBooruPost(postId: number, localPath: string | null): Promise<void> {
  await run(
    h.db,
    `INSERT INTO booru_posts (postId, localPath) VALUES (?, ?)`,
    [postId, localPath]
  );
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

beforeEach(async () => {
  bindingSeq = 0;
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

function countFor(
  affected: Array<{ table: string; column: string; count: number }>,
  table: string,
  column: string
): number {
  return affected.find((a) => a.table === table && a.column === column)?.count ?? 0;
}

describe('previewRelocateRoot — 计数', () => {
  it('跨 5 个 (table, column) 计数正确，后缀保留', async () => {
    const oldPrefix = normalizePath(path.join('N:', 'hk', 'yande_download'));
    const newPrefix = normalizePath(path.join('D:', 'art'));

    // images.filepath：2 命中 + 1 不命中
    await addImage(normalizePath(path.join('N:', 'hk', 'yande_download', 'a', '1.jpg')));
    await addImage(normalizePath(path.join('N:', 'hk', 'yande_download', 'b', '2.jpg')));
    await addImage(normalizePath(path.join('M:', 'other', '3.jpg')));

    // gallery_folders.folderPath：2 命中
    const g1 = await addGallery(normalizePath(path.join('N:', 'hk', 'yande_download', 'a')));
    await addFolderBinding(g1, normalizePath(path.join('N:', 'hk', 'yande_download', 'a')));
    const g2 = await addGallery(normalizePath(path.join('N:', 'hk', 'yande_download', 'b')));
    await addFolderBinding(g2, normalizePath(path.join('N:', 'hk', 'yande_download', 'b')));

    // gallery_ignored_folders.folderPath：1 命中 + 1 不命中
    await addIgnoredFolder(normalizePath(path.join('N:', 'hk', 'yande_download', 'skip')));
    await addIgnoredFolder(normalizePath(path.join('Z:', 'elsewhere')));

    // booru_posts.localPath：1 命中 + 1 NULL（不命中）
    await addBooruPost(100, normalizePath(path.join('N:', 'hk', 'yande_download', 'a', '1.jpg')));
    await addBooruPost(101, null);

    // booru_favorite_tag_download_bindings.downloadPath：1 命中
    await addBinding(normalizePath(path.join('N:', 'hk', 'yande_download', 'a')));

    const result = await previewRelocateRoot([{ oldPrefix, newPrefix }]);

    expect(result.success).toBe(true);
    const affected = result.data!.affected;
    expect(countFor(affected, 'images', 'filepath')).toBe(2);
    expect(countFor(affected, 'gallery_folders', 'folderPath')).toBe(2);
    expect(countFor(affected, 'gallery_ignored_folders', 'folderPath')).toBe(1);
    expect(countFor(affected, 'booru_posts', 'localPath')).toBe(1);
    expect(countFor(affected, 'booru_favorite_tag_download_bindings', 'downloadPath')).toBe(1);

    // 无冲突
    expect(result.data!.collisions).toEqual([]);
  });

  it('边界感知：M:\\art 不匹配 M:\\artists\\x（前缀不是目录边界）', async () => {
    const oldPrefix = normalizePath(path.join('M:', 'art'));
    const newPrefix = normalizePath(path.join('D:', 'moved'));

    // 兄弟目录 artists 不应被当作 art 的子路径
    await addImage(normalizePath(path.join('M:', 'artists', 'x', '1.jpg')));
    // 恰好等于 oldPrefix 自身的路径应命中
    await addImage(normalizePath(path.join('M:', 'art')));
    // oldPrefix 下真正的子路径应命中
    await addImage(normalizePath(path.join('M:', 'art', 'deep', '2.jpg')));

    const result = await previewRelocateRoot([{ oldPrefix, newPrefix }]);

    expect(result.success).toBe(true);
    // 只有 2 张（== oldPrefix 自身 + 子路径），artists 那张不算
    expect(countFor(result.data!.affected, 'images', 'filepath')).toBe(2);
  });
});

describe('previewRelocateRoot — 冲突检测', () => {
  it('改写后的 filepath 撞上既有的、不在被改写集合内的行 → 报告冲突', async () => {
    const oldPrefix = normalizePath(path.join('N:', 'src'));
    const newPrefix = normalizePath(path.join('N:', 'dst'));

    // 会被改写：N:\src\dup.jpg → N:\dst\dup.jpg
    await addImage(normalizePath(path.join('N:', 'src', 'dup.jpg')));
    // 既有占位：N:\dst\dup.jpg（不在被改写集合内，因为它不在 oldPrefix 下）
    await addImage(normalizePath(path.join('N:', 'dst', 'dup.jpg')));

    const result = await previewRelocateRoot([{ oldPrefix, newPrefix }]);

    expect(result.success).toBe(true);
    const collisions = result.data!.collisions;
    expect(collisions.length).toBe(1);
    expect(collisions[0]).toMatchObject({
      table: 'images',
      column: 'filepath',
      path: normalizePath(path.join('N:', 'dst', 'dup.jpg')),
    });
  });

  it('两个被改写的行映射到同一新路径（多源→单目标）→ 报告冲突', async () => {
    // src1\dup 与 src2\dup 都改写为 D:\dst\dup —— 两行都在被改写集合内，
    // 旧的"撞既有非改写行"逻辑漏掉这种批内目标重复，需在预检阶段拦截，
    // 否则 apply 期才在事务里撞 SQLITE_CONSTRAINT（虽安全回滚但是"clean 预检后突然失败"）。
    const m1 = { oldPrefix: normalizePath(path.join('N:', 'src1')), newPrefix: normalizePath(path.join('D:', 'dst')) };
    const m2 = { oldPrefix: normalizePath(path.join('N:', 'src2')), newPrefix: normalizePath(path.join('D:', 'dst')) };

    // 用 UNIQUE 列 gallery_folders.folderPath 才是真实约束风险
    const ga = await addGallery(normalizePath(path.join('N:', 'src1', 'dup')));
    await addFolderBinding(ga, normalizePath(path.join('N:', 'src1', 'dup')));
    const gb = await addGallery(normalizePath(path.join('N:', 'src2', 'dup')));
    await addFolderBinding(gb, normalizePath(path.join('N:', 'src2', 'dup')));

    const result = await previewRelocateRoot([m1, m2]);

    expect(result.success).toBe(true);
    const folderCollisions = result.data!.collisions.filter(
      (c) => c.table === 'gallery_folders' && c.column === 'folderPath'
    );
    // 第二个映射到 D:\dst\dup 的行被标记为冲突
    expect(folderCollisions.length).toBe(1);
    expect(folderCollisions[0].path).toBe(normalizePath(path.join('D:', 'dst', 'dup')));
  });
});
