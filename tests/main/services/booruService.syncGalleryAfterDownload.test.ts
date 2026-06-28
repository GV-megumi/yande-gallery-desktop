import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 2A — booru 下载后同步走 scanFolderIntoGallery 写成员
 *
 * syncGalleryAfterDownload 改为：getGallery 取 recursive/extensions →
 * scanFolderIntoGallery(galleryId, downloadPath, recursive, extensions)，
 * 从而在 booru 下载完成后也写入 gallery_images 成员。
 *
 * 用真实 :memory: sqlite + 真实 galleryService（不 mock），只 mock 文件系统
 * 扫描步骤（imageService.scanAndImportFolder）与各类事件副作用，验证成员落库。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  scanResult: { success: true, data: { imported: 0, skipped: 0 } } as any,
}));

// 真实 database：仅覆盖 getDatabase 返回测试 db。
vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return { ...actual, getDatabase: vi.fn(async () => h.db) };
});

// 只 mock 扫描磁盘步骤（scanFolderIntoGallery 内部会调用它）。
vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(async () => h.scanResult),
}));

// galleryService 的事件 / 登记表副作用 mock 掉，保留其真实业务逻辑。
vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));
vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryGalleriesChanged: vi.fn(),
  emitGalleryIgnoredFoldersChanged: vi.fn(),
  emitBooruBlacklistTagsChanged: vi.fn(),
  emitBooruFavoriteGroupsChanged: vi.fn(),
  emitBooruPostDownloadStateChanged: vi.fn(),
  emitBooruPostFavoriteChanged: vi.fn(),
  emitBooruPostServerFavoriteChanged: vi.fn(),
  emitBooruPostVoteChanged: vi.fn(),
  emitBooruSavedSearchesChanged: vi.fn(),
  emitBooruSearchHistoryChanged: vi.fn(),
  emitBooruSitesChanged: vi.fn(),
}));
vi.mock('../../../src/main/services/galleryRootRegistry.js', () => ({
  addGalleryRoot: vi.fn(),
  removeGalleryRoot: vi.fn(),
}));

// booruService 模块加载所需的其它外部依赖。
vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: vi.fn(() => ({ downloads: { path: '/tmp' }, app: { autoScan: false } })),
  getDownloadsPath: vi.fn(() => '/tmp'),
  resolveConfigPath: vi.fn((p: string) => p),
}));
vi.mock('../../../src/main/services/booruClientFactory.js', () => ({
  createBooruClient: vi.fn(),
}));
vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
}));

import { run, get, all } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { syncGalleryAfterDownload } from '../../../src/main/services/booruService';

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
    CREATE TABLE gallery_images (
      galleryId INTEGER NOT NULL, imageId INTEGER NOT NULL, addedAt TEXT NOT NULL,
      PRIMARY KEY (galleryId, imageId)
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

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  h.scanResult = { success: true, data: { imported: 1, skipped: 0 } };
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('booruService.syncGalleryAfterDownload 写 gallery_images 成员', () => {
  it('下载完成后递归图集写入直接+嵌套成员并更新统计', async () => {
    const folder = normalizePath(path.join('M:', 'dl'));
    const galleryId = await addGallery(folder, 1);
    const direct = await addImage(normalizePath(path.join('M:', 'dl', 'a.jpg')));
    const nested = await addImage(normalizePath(path.join('M:', 'dl', 'sub', 'b.jpg')));

    await syncGalleryAfterDownload(galleryId, folder);

    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ? ORDER BY imageId', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toEqual([direct, nested].sort((x, y) => x - y));

    const g = await get<{ imageCount: number }>(h.db, 'SELECT imageCount FROM galleries WHERE id = ?', [galleryId]);
    expect(g?.imageCount).toBe(2);
  });

  it('非递归图集只写直接子文件成员', async () => {
    const folder = normalizePath(path.join('M:', 'dl2'));
    const galleryId = await addGallery(folder, 0);
    const direct = await addImage(normalizePath(path.join('M:', 'dl2', 'a.jpg')));
    const nested = await addImage(normalizePath(path.join('M:', 'dl2', 'sub', 'b.jpg')));

    await syncGalleryAfterDownload(galleryId, folder);

    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toContain(direct);
    expect(members).not.toContain(nested);
  });

  it('图集不存在时抛错（getGallery 失败）', async () => {
    await expect(syncGalleryAfterDownload(99999, normalizePath(path.join('M:', 'nope')))).rejects.toThrow();
  });
});
