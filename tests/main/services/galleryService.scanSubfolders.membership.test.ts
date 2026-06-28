import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 2A — scanSubfoldersAndCreateGalleries 写 gallery_images 成员
 *
 * 每个被创建的子文件夹图集（recursive=false）都应通过 scanFolderIntoGallery
 * 写入 gallery_images 成员行。本测试用真实 :memory: sqlite 验证成员落库，
 * 只 mock 文件系统遍历（readdir/access）与扫描磁盘步骤（scanAndImportFolder）。
 *
 * 注意：本任务不改扫描深度（仍逐层 recursive=false + 全树 walk），只补成员写入。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  tree: {} as Record<string, Array<{ name: string; dir: boolean }>>,
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

// fs/promises：用 h.tree 提供假目录结构。readdir 返回 Dirent-like；access 永远通过。
const readdirImpl = async (dir: string) => {
  const entries = h.tree[dir] ?? [];
  return entries.map((e) => ({
    name: e.name,
    isDirectory: () => e.dir,
    isFile: () => !e.dir,
  }));
};
vi.mock('fs/promises', () => ({
  default: {
    readdir: (...a: any[]) => readdirImpl(a[0]),
    access: async () => undefined,
  },
  readdir: (...a: any[]) => readdirImpl(a[0]),
  access: async () => undefined,
}));

import { run, get, all } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { scanSubfoldersAndCreateGalleries } from '../../../src/main/services/galleryService';

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
    CREATE TABLE gallery_ignored_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, folderPath TEXT NOT NULL UNIQUE, note TEXT,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
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

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  h.tree = {};
  h.scanResult = { success: true, data: { imported: 1, skipped: 0 } };
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('scanSubfoldersAndCreateGalleries 写 gallery_images 成员', () => {
  it('为含图片的子文件夹创建图集并写入直接子文件成员', async () => {
    const root = normalizePath(path.join('M:', 'root'));
    const sub = normalizePath(path.join('M:', 'root', 'sub'));

    // 目录树：root 下有 sub 目录；sub 下有一张 a.jpg
    h.tree[root] = [{ name: 'sub', dir: true }];
    h.tree[sub] = [{ name: 'a.jpg', dir: false }];

    // 预置 images（mock 的 scanAndImportFolder 不会真写 images），
    // 让 ensureMembershipForFolder 的 SELECT 能命中
    const imgId = await addImage(path.join(sub, 'a.jpg'));

    const result = await scanSubfoldersAndCreateGalleries(root, ['.jpg']);

    expect(result.success).toBe(true);
    expect(result.data?.created).toBe(1);
    expect(result.data?.imported).toBe(1);

    // 子文件夹图集行
    const gallery = await get<{ id: number }>(h.db, 'SELECT id FROM galleries WHERE folderPath = ?', [sub]);
    expect(gallery).toBeTruthy();

    // 成员行写入（该子文件夹下直接子文件）
    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [gallery!.id])
    ).map((r) => r.imageId);
    expect(members).toEqual([imgId]);

    // 双写绑定也在（createGallery 负责）
    const binding = await get(h.db, 'SELECT * FROM gallery_folders WHERE folderPath = ?', [sub]);
    expect(binding).toBeTruthy();
  });

  it('子文件夹图集为非递归：嵌套更深的文件不写入成员', async () => {
    const root = normalizePath(path.join('M:', 'r2'));
    const sub = normalizePath(path.join('M:', 'r2', 's'));

    h.tree[root] = [{ name: 's', dir: true }];
    // s 下含一张直接图片（让 checkFolderHasImages 命中），深层目录交给递归 walk
    h.tree[sub] = [{ name: 'direct.jpg', dir: false }, { name: 'deep', dir: true }];
    h.tree[normalizePath(path.join(sub, 'deep'))] = [{ name: 'nested.jpg', dir: false }];

    const direct = await addImage(path.join(sub, 'direct.jpg'));
    const nested = await addImage(path.join(sub, 'deep', 'nested.jpg'));

    const result = await scanSubfoldersAndCreateGalleries(root, ['.jpg']);
    expect(result.success).toBe(true);

    const gallery = await get<{ id: number }>(h.db, 'SELECT id FROM galleries WHERE folderPath = ?', [sub]);
    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [gallery!.id])
    ).map((r) => r.imageId);
    // 非递归：只含 direct，不含 deep/nested
    expect(members).toContain(direct);
    expect(members).not.toContain(nested);
  });
});
