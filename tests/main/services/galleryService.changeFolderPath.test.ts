import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 3 — changeFolderPath = unbindFolder(old) + bindFolder(new)
 *
 * - 图集把旧文件夹换成新文件夹：旧绑定解绑（成员重算 + 回收），新绑定扫描入成员；
 * - 图集记录与 id 保持不变；
 * - bind 失败时透传错误（旧文件夹已解绑——可接受，但要清晰报错）。
 *
 * 真实 :memory: sqlite + PRAGMA foreign_keys=ON；mock 掉 scanAndImportFolder 与 deleteThumbnail。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  scanResult: { success: true, data: { imported: 0, skipped: 0 } } as any,
}));

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

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  deleteThumbnail: vi.fn(async () => ({ success: true })),
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
import { changeFolderPath } from '../../../src/main/services/galleryService';

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
      FOREIGN KEY (localImageId) REFERENCES images(id) ON DELETE SET NULL
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
  h.scanResult = { success: true, data: { imported: 0, skipped: 0 } };
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('changeFolderPath', () => {
  it('图集把旧文件夹改成新文件夹：成员反映新路径，图集记录与 id 不变', async () => {
    const oldFolder = normalizePath(path.join('M:', 'old'));
    const newFolder = normalizePath(path.join('M:', 'new'));
    const galleryId = await addGallery(oldFolder, 1);
    await addFolderBinding(galleryId, oldFolder, 1);

    // 旧文件夹下有 oldImg（当前成员）
    const oldImg = await addImage(normalizePath(path.join('M:', 'old', 'o.jpg')));
    await addMembership(galleryId, oldImg);
    // 新文件夹下有 newImg（changeFolderPath 后应成为成员）
    const newImg = await addImage(normalizePath(path.join('M:', 'new', 'n.jpg')));
    h.scanResult = { success: true, data: { imported: 1, skipped: 0 } };

    const result = await changeFolderPath(galleryId, oldFolder, newFolder, true, ['.jpg']);

    expect(result.success).toBe(true);

    // gallery_folders 只剩 newFolder
    const folders = (await all<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders WHERE galleryId = ?', [galleryId])).map((r) => r.folderPath);
    expect(folders).toEqual([newFolder]);

    // 成员现在是 newImg，oldImg 已移除
    const members = (await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])).map((r) => r.imageId);
    expect(members).toEqual([newImg]);

    // oldImg 被回收（孤儿）；newImg 仍在
    const imgIds = (await all<{ id: number }>(h.db, 'SELECT id FROM images ORDER BY id')).map((r) => r.id);
    expect(imgIds).toEqual([newImg]);

    // 图集记录与 id 不变
    const g = await get<{ id: number; name: string }>(h.db, 'SELECT id, name FROM galleries WHERE id = ?', [galleryId]);
    expect(g?.id).toBe(galleryId);
    expect(g?.name).toBe('g');
  });

  it('bind 失败时透传错误（新文件夹已被别处绑定）', async () => {
    const oldFolder = normalizePath(path.join('M:', 'old'));
    const takenFolder = normalizePath(path.join('M:', 'taken'));
    const galleryId = await addGallery(oldFolder, 1);
    await addFolderBinding(galleryId, oldFolder, 1);

    // takenFolder 已绑定到另一个图集
    const otherGallery = await addGallery(normalizePath(path.join('M:', 'other')), 1);
    await addFolderBinding(otherGallery, takenFolder, 1);

    const result = await changeFolderPath(galleryId, oldFolder, takenFolder, true, ['.jpg']);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // takenFolder 仍只属于 otherGallery（未被错误改写）
    const rows = await all<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_folders WHERE folderPath = ?', [takenFolder]);
    expect(rows.map((r) => r.galleryId)).toEqual([otherGallery]);
  });
});
