import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 2A — scanFolderIntoGallery
 *
 * 组合：scanAndImportFolder（扫描导入，filesystem，已在此 mock 掉）
 *      → ensureMembershipForFolder（写 gallery_images 成员）
 *      → COUNT(*) gallery_images → updateGalleryStats（更新 galleries 统计）
 *      → emit gallery:images-imported（与 syncGalleryFolder 一致）。
 *
 * 用真实 :memory: sqlite 验证成员写入 + 统计更新的接线；
 * 仅把"扫描磁盘"这一步 mock 成固定结果，避免依赖真实文件系统。
 */

// 通过 vi.hoisted 共享一个可变 ref，让 hoisted 的 vi.mock 工厂能拿到测试里建好的 db。
const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  scanResult: { success: true, data: { imported: 0, skipped: 0 } } as any,
  emitted: [] as any[],
}));

// 只覆盖 getDatabase（返回测试 db），其余 run/get/all/runWithChanges/runInTransaction 用真实实现。
vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return {
    ...actual,
    getDatabase: vi.fn(async () => h.db),
  };
});

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(async () => h.scanResult),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn((e: any) => { h.emitted.push(e); }),
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
import { scanFolderIntoGallery } from '../../../src/main/services/galleryService';
import { scanAndImportFolder } from '../../../src/main/services/imageService';

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
    CREATE TABLE gallery_images (
      galleryId INTEGER NOT NULL,
      imageId INTEGER NOT NULL,
      addedAt TEXT NOT NULL,
      PRIMARY KEY (galleryId, imageId)
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

async function addIgnoredFolder(folderPath: string): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_ignored_folders (folderPath, note, createdAt, updatedAt)
     VALUES (?, '删除相册自动忽略', '2024-01-01', '2024-01-01')`,
    [folderPath]
  );
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

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  h.scanResult = { success: true, data: { imported: 0, skipped: 0 } };
  h.emitted = [];
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('scanFolderIntoGallery', () => {
  it('扫描后为相册写入成员行并把 imageCount 写回 galleries 统计', async () => {
    const folder = normalizePath(path.join('M:', 'galA'));
    const galleryId = await addGallery(folder, 1);
    const direct = await addImage(normalizePath(path.join('M:', 'galA', 'a.jpg')));
    const nested = await addImage(normalizePath(path.join('M:', 'galA', 'sub', 'b.jpg')));
    h.scanResult = { success: true, data: { imported: 2, skipped: 0 } };

    const result = await scanFolderIntoGallery(galleryId, folder, true, ['.jpg']);

    expect(result.success).toBe(true);
    expect(result.data?.imported).toBe(2);
    expect(result.data?.skipped).toBe(0);
    expect(result.data?.imageCount).toBe(2);

    // 成员表写入（递归含嵌套）
    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ? ORDER BY imageId', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toEqual([direct, nested].sort((x, y) => x - y));

    // 统计写回 galleries.imageCount
    const g = await get<{ imageCount: number; lastScannedAt: string }>(h.db, 'SELECT imageCount, lastScannedAt FROM galleries WHERE id = ?', [galleryId]);
    expect(g?.imageCount).toBe(2);
    expect(g?.lastScannedAt).toBeTruthy();
  });

  it('非递归相册只写直接子文件成员，imageCount 不含嵌套', async () => {
    const folder = normalizePath(path.join('M:', 'galB'));
    const galleryId = await addGallery(folder, 0);
    const direct = await addImage(normalizePath(path.join('M:', 'galB', 'c.jpg')));
    const nested = await addImage(normalizePath(path.join('M:', 'galB', 'sub', 'd.jpg')));
    h.scanResult = { success: true, data: { imported: 2, skipped: 0 } };

    const result = await scanFolderIntoGallery(galleryId, folder, false, ['.jpg']);

    expect(result.success).toBe(true);
    expect(result.data?.imageCount).toBe(1);
    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toContain(direct);
    expect(members).not.toContain(nested);
  });

  it('imported>0 时发出 gallery:images-imported 事件', async () => {
    const folder = normalizePath(path.join('M:', 'galC'));
    const galleryId = await addGallery(folder, 1);
    await addImage(normalizePath(path.join('M:', 'galC', 'a.jpg')));
    h.scanResult = { success: true, data: { imported: 1, skipped: 0 } };

    await scanFolderIntoGallery(galleryId, folder, true, ['.jpg']);

    const importedEvents = h.emitted.filter((e) => e.type === 'gallery:images-imported');
    expect(importedEvents.length).toBe(1);
    expect(importedEvents[0].payload).toMatchObject({ galleryId, imported: 1, imageCount: 1 });
  });

  /**
   * 黑名单整棵子树跳过（修复轮 U05）：忽略名单中严格位于目标文件夹内部的条目（后代），
   * 扫描与成员收编都要整棵排除——否则「删除相册自动拉黑」的子树会在父级重扫时整棵复活。
   */
  it('忽略名单后代子树整棵排除：排除目录传给磁盘扫描，库中已有的子树图片不被收编', async () => {
    const folder = normalizePath(path.join('M:', 'top', 'R'));
    const blacklisted = normalizePath(path.join('M:', 'top', 'R', 'C'));
    await addIgnoredFolder(blacklisted);
    const galleryId = await addGallery(folder, 1);
    const own = await addImage(normalizePath(path.join('M:', 'top', 'R', 'a.jpg')));
    const inBlack = await addImage(normalizePath(path.join('M:', 'top', 'R', 'C', 'b.jpg')));
    const inBlackNested = await addImage(normalizePath(path.join('M:', 'top', 'R', 'C', 'deep', 'c.jpg')));
    h.scanResult = { success: true, data: { imported: 1, skipped: 0 } };

    const result = await scanFolderIntoGallery(galleryId, folder, true, ['.jpg']);

    expect(result.success).toBe(true);
    // 排除目录组传给了磁盘扫描（scanAndImportFolder 第 4 参，整棵剪枝）
    expect(vi.mocked(scanAndImportFolder)).toHaveBeenCalledWith(folder, ['.jpg'], true, [blacklisted]);
    // 库中已存在的黑名单子树图片不被按前缀收编为成员
    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toContain(own);
    expect(members).not.toContain(inBlack);
    expect(members).not.toContain(inBlackNested);
    expect(result.data?.imageCount).toBe(1);
  });

  it('忽略名单命中目标自身或目标外部时不参与剪枝（显式扫描该文件夹的意图优先）', async () => {
    const folder = normalizePath(path.join('M:', 'top', 'S'));
    // 目标自身被拉黑：显式扫描/绑定该路径时意图优先，不能因此拦截（精确跳过由 planScanFolder 负责）
    await addIgnoredFolder(folder);
    // 目标外部的无关条目：与本次扫描无关
    await addIgnoredFolder(normalizePath(path.join('M:', 'other')));
    const galleryId = await addGallery(folder, 1);
    const own = await addImage(normalizePath(path.join('M:', 'top', 'S', 'a.jpg')));
    h.scanResult = { success: true, data: { imported: 1, skipped: 0 } };

    const result = await scanFolderIntoGallery(galleryId, folder, true, ['.jpg']);

    expect(result.success).toBe(true);
    expect(vi.mocked(scanAndImportFolder)).toHaveBeenCalledWith(folder, ['.jpg'], true, []);
    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toContain(own);
  });

  it('扫描失败时返回 success:false 且不写成员/不更新统计', async () => {
    const folder = normalizePath(path.join('M:', 'galD'));
    const galleryId = await addGallery(folder, 1);
    await addImage(normalizePath(path.join('M:', 'galD', 'a.jpg')));
    h.scanResult = { success: false, error: '目录不存在' };

    const result = await scanFolderIntoGallery(galleryId, folder, true, ['.jpg']);

    expect(result.success).toBe(false);
    expect(result.error).toBe('目录不存在');
    const members = await all(h.db, 'SELECT * FROM gallery_images WHERE galleryId = ?', [galleryId]);
    expect(members).toHaveLength(0);
    const g = await get<{ imageCount: number }>(h.db, 'SELECT imageCount FROM galleries WHERE id = ?', [galleryId]);
    expect(g?.imageCount).toBe(0);
  });
});
