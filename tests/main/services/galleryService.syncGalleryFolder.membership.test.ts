import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 4 — syncGalleryFolder 扫描图集全部绑定文件夹（gallery_folders）
 *
 * 扫描源从 galleries 旧列 folderPath 切到 gallery_folders 的全部绑定行：
 *   - 多文件夹图集：同步从所有绑定文件夹导入，成员/imageCount 反映并集；
 *   - 单文件夹图集：行为不变；
 *   - 无文件夹图集：no-op，返回零导入 + 当前 imageCount，不报错。
 * 公开返回形状保持不变：{ imported, skipped, imageCount, lastScannedAt }。
 *
 * 真实 :memory: sqlite 验证成员写入；scanAndImportFolder（磁盘扫描）按 folderPath 提供每次结果。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  // 按 folderPath 返回扫描结果；默认全 0。测试按需写入具体文件夹的结果。
  scanByFolder: new Map<string, any>(),
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return { ...actual, getDatabase: vi.fn(async () => h.db) };
});

vi.mock('../../../src/main/services/imageService.js', () => ({
  // scanAndImportFolder(folderPath, extensions, recursive) —— 按 folderPath 取预置结果
  scanAndImportFolder: vi.fn(async (folderPath: string) =>
    h.scanByFolder.get(folderPath) ?? { success: true, data: { imported: 0, skipped: 0 } }
  ),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryGalleriesChanged: vi.fn(),
  emitGalleryIgnoredFoldersChanged: vi.fn(),
}));

vi.mock('../../../src/main/services/galleryRootRegistry.js', () => ({
  addGalleryRoot: vi.fn(),
  removeGalleryRoot: vi.fn(),
}));

import { run, get, all } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { syncGalleryFolder } from '../../../src/main/services/galleryService';

async function setupSchema(): Promise<void> {
  await run(h.db, `
    CREATE TABLE images (
      id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, filepath TEXT NOT NULL UNIQUE,
      fileSize INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, format TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE galleries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, folderPath TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      coverImageId INTEGER, imageCount INTEGER DEFAULT 0, lastScannedAt TEXT, isWatching INTEGER DEFAULT 1,
      recursive INTEGER DEFAULT 1, extensions TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE gallery_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, galleryId INTEGER NOT NULL, folderPath TEXT NOT NULL UNIQUE,
      recursive INTEGER NOT NULL DEFAULT 1, extensions TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE
    )
  `);
  await run(h.db, `
    CREATE TABLE gallery_images (
      galleryId INTEGER NOT NULL, imageId INTEGER NOT NULL, addedAt TEXT NOT NULL,
      PRIMARY KEY (galleryId, imageId),
      FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE,
      FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE
    )
  `);
  // 与 database.ts 真实定义一致：scanFolderIntoGallery 会读忽略名单做整棵子树排除
  await run(h.db, `
    CREATE TABLE gallery_ignored_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folderPath TEXT NOT NULL UNIQUE,
      note TEXT,
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

/** 写 galleries 行（不写绑定行）。folderPath 仍是旧列，但同步不再读它。 */
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

/** 给图集追加一条 gallery_folders 绑定行 */
async function addBinding(galleryId: number, folderPath: string, recursive: number): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, '2024-01-01', '2024-01-01')`,
    [galleryId, folderPath, recursive, JSON.stringify(['.jpg'])]
  );
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  h.scanByFolder = new Map();
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('syncGalleryFolder 扫描图集全部绑定文件夹', () => {
  it('单文件夹递归图集：写入直接+嵌套成员，返回形状保留 lastScannedAt', async () => {
    const folder = normalizePath(path.join('M:', 'galA'));
    const galleryId = await addGallery(folder, 1);
    await addBinding(galleryId, folder, 1);
    const direct = await addImage(normalizePath(path.join('M:', 'galA', 'a.jpg')));
    const nested = await addImage(normalizePath(path.join('M:', 'galA', 'sub', 'b.jpg')));
    h.scanByFolder.set(folder, { success: true, data: { imported: 2, skipped: 0 } });

    const result = await syncGalleryFolder(galleryId);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({ imported: 2, skipped: 0, imageCount: 2 }));
    expect(result.data?.lastScannedAt).toBeTruthy();

    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ? ORDER BY imageId', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toEqual([direct, nested].sort((x, y) => x - y));
  });

  it('单文件夹非递归图集：只写直接子文件成员', async () => {
    const folder = normalizePath(path.join('M:', 'galB'));
    const galleryId = await addGallery(folder, 0);
    await addBinding(galleryId, folder, 0);
    const direct = await addImage(normalizePath(path.join('M:', 'galB', 'c.jpg')));
    const nested = await addImage(normalizePath(path.join('M:', 'galB', 'sub', 'd.jpg')));
    h.scanByFolder.set(folder, { success: true, data: { imported: 2, skipped: 0 } });

    const result = await syncGalleryFolder(galleryId);

    expect(result.success).toBe(true);
    expect(result.data?.imageCount).toBe(1);
    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toContain(direct);
    expect(members).not.toContain(nested);
  });

  it('多文件夹图集：从所有绑定文件夹导入，成员/imageCount 反映并集，imported/skipped 累加', async () => {
    const galleryFolder = normalizePath(path.join('M:', 'multi'));
    const galleryId = await addGallery(galleryFolder, 1);
    // 两个不同的绑定文件夹（含原始文件夹 + 追加文件夹）
    const folder1 = galleryFolder;
    const folder2 = normalizePath(path.join('M:', 'extra'));
    await addBinding(galleryId, folder1, 1);
    await addBinding(galleryId, folder2, 1);

    const i1 = await addImage(normalizePath(path.join('M:', 'multi', 'a.jpg')));
    const i2 = await addImage(normalizePath(path.join('M:', 'extra', 'b.jpg')));
    const i3 = await addImage(normalizePath(path.join('M:', 'extra', 'sub', 'c.jpg')));

    h.scanByFolder.set(folder1, { success: true, data: { imported: 1, skipped: 2 } });
    h.scanByFolder.set(folder2, { success: true, data: { imported: 2, skipped: 3 } });

    const result = await syncGalleryFolder(galleryId);

    expect(result.success).toBe(true);
    // imported/skipped 跨文件夹累加
    expect(result.data?.imported).toBe(3);
    expect(result.data?.skipped).toBe(5);
    // imageCount 为成员并集
    expect(result.data?.imageCount).toBe(3);

    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ? ORDER BY imageId', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toEqual([i1, i2, i3].sort((x, y) => x - y));
  });

  it('无文件夹图集：no-op，返回零导入 + 当前 imageCount，不报错', async () => {
    const folder = normalizePath(path.join('M:', 'folderless'));
    const galleryId = await addGallery(folder, 1);
    // 不写任何 gallery_folders 绑定行；但预置一个成员，验证 imageCount 取当前值
    const existing = await addImage(normalizePath(path.join('M:', 'folderless', 'keep.jpg')));
    await run(h.db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, '2024-01-01')`, [galleryId, existing]);

    const result = await syncGalleryFolder(galleryId);

    expect(result.success).toBe(true);
    expect(result.data?.imported).toBe(0);
    expect(result.data?.skipped).toBe(0);
    expect(result.data?.imageCount).toBe(1);
    expect(result.data?.lastScannedAt).toBeTruthy();
  });

  it('图集不存在时返回错误', async () => {
    const result = await syncGalleryFolder(9999);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
