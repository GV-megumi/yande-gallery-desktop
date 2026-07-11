import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 4 — gallery_folders 读取辅助
 *
 * getAllGalleryFolderPaths()：返回全部相册绑定文件夹（去重、非空），
 *   供 app:// 白名单装载。必须包含 bindFolder 追加的文件夹，而不仅是 galleries.folderPath。
 * getGalleryFolderPaths(galleryId)：返回某相册的全部绑定文件夹，供 booru 下载路径校验。
 *
 * 真实 :memory: sqlite 验证读取；只 mock 扫描磁盘与事件副作用，bindFolder 用真实逻辑写绑定行。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  scanResult: { success: true, data: { imported: 0, skipped: 0 } } as any,
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return { ...actual, getDatabase: vi.fn(async () => h.db) };
});

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(async () => h.scanResult),
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

import { run, get } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import {
  bindFolder,
  getAllGalleryFolderPaths,
  getGalleryFolderPaths,
} from '../../../src/main/services/galleryService';

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

/** 直接写一行 galleries + 对应 gallery_folders（模拟 createGallery 的双写） */
async function addGalleryWithBinding(folderPath: string, recursive: number): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (folderPath, name, isWatching, recursive, extensions, createdAt, updatedAt)
     VALUES (?, 'g', 1, ?, ?, '2024-01-01', '2024-01-01')`,
    [folderPath, recursive, JSON.stringify(['.jpg'])]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  const galleryId = row!.id;
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, '2024-01-01', '2024-01-01')`,
    [galleryId, folderPath, recursive, JSON.stringify(['.jpg'])]
  );
  return galleryId;
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  h.scanResult = { success: true, data: { imported: 0, skipped: 0 } };
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('getAllGalleryFolderPaths', () => {
  it('返回全部相册绑定文件夹，含 bindFolder 追加的文件夹（不止 galleries.folderPath）', async () => {
    const baseA = normalizePath(path.join('M:', 'galA'));
    const baseB = normalizePath(path.join('M:', 'galB'));
    const galleryA = await addGalleryWithBinding(baseA, 1);
    await addGalleryWithBinding(baseB, 1);

    // 给 galleryA 追加一个绑定文件夹（仅写 gallery_folders，不动 galleries.folderPath）
    const extra = normalizePath(path.join('M:', 'extra'));
    const bindResult = await bindFolder(galleryA, extra, true, ['.jpg']);
    expect(bindResult.success).toBe(true);

    const paths = await getAllGalleryFolderPaths();
    expect(paths.sort()).toEqual([baseA, baseB, extra].sort());
  });

  it('去重：同一文件夹只返回一次；空 DB 返回空数组', async () => {
    expect(await getAllGalleryFolderPaths()).toEqual([]);

    const base = normalizePath(path.join('M:', 'one'));
    await addGalleryWithBinding(base, 1);
    const paths = await getAllGalleryFolderPaths();
    expect(paths).toEqual([base]);
  });
});

describe('getGalleryFolderPaths', () => {
  it('只返回指定相册的绑定文件夹', async () => {
    const baseA = normalizePath(path.join('M:', 'galA'));
    const baseB = normalizePath(path.join('M:', 'galB'));
    const galleryA = await addGalleryWithBinding(baseA, 1);
    const galleryB = await addGalleryWithBinding(baseB, 1);

    const extra = normalizePath(path.join('M:', 'extraA'));
    await bindFolder(galleryA, extra, true, ['.jpg']);

    expect((await getGalleryFolderPaths(galleryA)).sort()).toEqual([baseA, extra].sort());
    expect(await getGalleryFolderPaths(galleryB)).toEqual([baseB]);
  });

  it('未知相册返回空数组', async () => {
    expect(await getGalleryFolderPaths(9999)).toEqual([]);
  });
});
