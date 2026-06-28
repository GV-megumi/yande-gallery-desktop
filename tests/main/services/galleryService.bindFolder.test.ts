import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 3 — bindFolder
 *
 * 给已存在图集加绑一个文件夹并扫描入成员：
 *   - 归一化 folderPath；
 *   - 若该 folderPath 已存在于 gallery_folders（全局 UNIQUE）→ 拒绝并给出清晰 error；
 *   - 事务内：插入 gallery_folders 行 → scanFolderIntoGallery（导入 + 写成员 + 更新统计）；
 *   - addGalleryRoot(folderPath)；emit gallery:galleries-changed{action:'updated'}。
 *
 * 真实 :memory: sqlite + PRAGMA foreign_keys=ON；只 mock 掉 scanAndImportFolder（磁盘扫描）。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  scanResult: { success: true, data: { imported: 0, skipped: 0 } } as any,
  addRootCalls: [] as string[],
  galleriesChanged: [] as any[],
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

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryGalleriesChanged: vi.fn((p: any) => { h.galleriesChanged.push(p); }),
  emitGalleryIgnoredFoldersChanged: vi.fn(),
}));

vi.mock('../../../src/main/services/galleryRootRegistry.js', () => ({
  addGalleryRoot: vi.fn((p: string) => { h.addRootCalls.push(p); }),
  removeGalleryRoot: vi.fn(),
}));

import { run, get, all } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { bindFolder } from '../../../src/main/services/galleryService';

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
  h.addRootCalls = [];
  h.galleriesChanged = [];
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('bindFolder', () => {
  it('为图集绑定新文件夹：写 gallery_folders 行 + 写成员 + 登记根 + emit updated', async () => {
    const baseFolder = normalizePath(path.join('M:', 'galA'));
    const galleryId = await addGallery(baseFolder, 1);

    const extraFolder = normalizePath(path.join('M:', 'extra'));
    const i1 = await addImage(normalizePath(path.join('M:', 'extra', 'a.jpg')));
    const i2 = await addImage(normalizePath(path.join('M:', 'extra', 'sub', 'b.jpg')));
    h.scanResult = { success: true, data: { imported: 2, skipped: 0 } };

    const result = await bindFolder(galleryId, extraFolder, true, ['.jpg']);

    expect(result.success).toBe(true);

    // gallery_folders 行存在
    const folderRow = await get<{ galleryId: number; folderPath: string; recursive: number }>(
      h.db,
      'SELECT galleryId, folderPath, recursive FROM gallery_folders WHERE folderPath = ?',
      [extraFolder]
    );
    expect(folderRow).toMatchObject({ galleryId, folderPath: extraFolder, recursive: 1 });

    // 成员行写入（递归含嵌套）
    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ? ORDER BY imageId', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toEqual([i1, i2].sort((x, y) => x - y));

    // 登记根 + 事件
    expect(h.addRootCalls).toContain(extraFolder);
    expect(h.galleriesChanged.some((p) => p.galleryId === galleryId && p.action === 'updated')).toBe(true);
  });

  it('文件夹已被别处绑定时应拒绝并给出清晰 error，不写任何成员', async () => {
    const folderA = normalizePath(path.join('M:', 'galA'));
    const folderShared = normalizePath(path.join('M:', 'shared'));
    const galleryA = await addGallery(folderA, 1);
    const galleryB = await addGallery(normalizePath(path.join('M:', 'galB')), 1);

    // folderShared 已绑定到 galleryA
    await run(
      h.db,
      `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
       VALUES (?, ?, 1, ?, '2024-01-01', '2024-01-01')`,
      [galleryA, folderShared, JSON.stringify(['.jpg'])]
    );

    const result = await bindFolder(galleryB, folderShared, true, ['.jpg']);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // gallery_folders 中 folderShared 仍只属于 galleryA
    const rows = await all<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_folders WHERE folderPath = ?', [folderShared]);
    expect(rows.map((r) => r.galleryId)).toEqual([galleryA]);
    // 没有为 galleryB 写任何成员
    const members = await all(h.db, 'SELECT * FROM gallery_images WHERE galleryId = ?', [galleryB]);
    expect(members).toHaveLength(0);
  });

  it('未传 extensions 时使用默认扩展名（仍能绑定成功）', async () => {
    const baseFolder = normalizePath(path.join('M:', 'galA'));
    const galleryId = await addGallery(baseFolder, 1);
    const extra = normalizePath(path.join('M:', 'extra2'));

    const result = await bindFolder(galleryId, extra);

    expect(result.success).toBe(true);
    const folderRow = await get<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders WHERE folderPath = ?', [extra]);
    expect(folderRow?.folderPath).toBe(extra);
  });
});
