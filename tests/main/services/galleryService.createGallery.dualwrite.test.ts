import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 2A — createGallery 双写 gallery_folders
 *
 * createGallery 在 runInTransaction 内同时写入：
 *   - galleries 旧行（folderPath/isWatching/recursive/extensions，过渡期保留）
 *   - gallery_folders 绑定行（galleryId/folderPath/recursive/extensions）
 * 两者 folderPath/recursive/extensions 一致。
 *
 * 真实 :memory: sqlite 验证双写结果；只 mock 掉 fs.access（文件夹存在检查）
 * 与事件/登记表副作用。
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

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryGalleriesChanged: vi.fn(),
  emitGalleryIgnoredFoldersChanged: vi.fn(),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));

vi.mock('../../../src/main/services/galleryRootRegistry.js', () => ({
  addGalleryRoot: vi.fn(),
  removeGalleryRoot: vi.fn(),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    default: { ...actual, access: vi.fn(async () => undefined) },
    access: vi.fn(async () => undefined),
  };
});

import { run, get, all } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { createGallery } from '../../../src/main/services/galleryService';

async function setupSchema(): Promise<void> {
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
}

beforeEach(async () => {
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

describe('createGallery 双写 gallery_folders', () => {
  it('成功创建后 gallery_folders 有匹配的绑定行（folderPath/recursive/extensions）', async () => {
    const folder = normalizePath(path.join('M:', 'galX'));
    const result = await createGallery({
      folderPath: folder,
      name: 'galX',
      recursive: true,
      extensions: ['.png', '.webp'],
    });

    expect(result.success).toBe(true);
    const galleryId = result.data!;

    const binding = await get<{ galleryId: number; folderPath: string; recursive: number; extensions: string }>(
      h.db,
      'SELECT galleryId, folderPath, recursive, extensions FROM gallery_folders WHERE folderPath = ?',
      [folder]
    );
    expect(binding).toBeTruthy();
    expect(binding!.galleryId).toBe(galleryId);
    expect(binding!.folderPath).toBe(folder);
    expect(binding!.recursive).toBe(1);
    expect(JSON.parse(binding!.extensions)).toEqual(['.png', '.webp']);
  });

  it('非递归图集双写时 gallery_folders.recursive=0', async () => {
    const folder = normalizePath(path.join('M:', 'galY'));
    const result = await createGallery({ folderPath: folder, name: 'galY', recursive: false });
    expect(result.success).toBe(true);

    const binding = await get<{ recursive: number }>(
      h.db,
      'SELECT recursive FROM gallery_folders WHERE folderPath = ?',
      [folder]
    );
    expect(binding!.recursive).toBe(0);
  });

  it('galleries 行与 gallery_folders 行各写一条', async () => {
    const folder = normalizePath(path.join('M:', 'galZ'));
    await createGallery({ folderPath: folder, name: 'galZ' });

    const galleries = await all(h.db, 'SELECT * FROM galleries WHERE folderPath = ?', [folder]);
    const folders = await all(h.db, 'SELECT * FROM gallery_folders WHERE folderPath = ?', [folder]);
    expect(galleries).toHaveLength(1);
    expect(folders).toHaveLength(1);
  });

  it('文件夹重复时返回 success:false 且不写 gallery_folders', async () => {
    const folder = normalizePath(path.join('M:', 'dup'));
    const first = await createGallery({ folderPath: folder, name: 'dup' });
    expect(first.success).toBe(true);

    const second = await createGallery({ folderPath: folder, name: 'dup2' });
    expect(second.success).toBe(false);

    // 仍只有第一次写入的一条绑定
    const folders = await all(h.db, 'SELECT * FROM gallery_folders WHERE folderPath = ?', [folder]);
    expect(folders).toHaveLength(1);
  });
});
