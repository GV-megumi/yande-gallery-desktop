import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 8A — 去重检查以 gallery_folders 为准（绑定表是「文件夹被占用」的唯一真相）
 *
 * createGallery 的重复检查查真实绑定 `SELECT galleryId FROM gallery_folders WHERE folderPath=?`：
 * 一个文件夹「被占用」当且仅当它已被某相册绑定（gallery_folders 有行）。Phase 8A 后 galleries
 * 不再有 folderPath 列，绑定表是唯一来源。
 *
 * 断言两点：
 *   1. 文件夹已在 gallery_folders → createGallery 以「已存在」短路拒绝；
 *   2. 文件夹无任何 gallery_folders 行 → 放行创建，并新写一条绑定。
 *
 * 真实 :memory: sqlite；mock fs.access 让文件夹存在校验通过；mock 事件/登记副作用。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return { ...actual, getDatabase: vi.fn(async () => h.db) };
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

// fs.access 永远通过（文件夹存在校验不阻塞去重逻辑断言）
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

// Phase 8A 新结构：galleries 无 folderPath/isWatching/recursive/extensions；
// gallery_folders.folderPath 仍带 UNIQUE（绑定全局唯一），是「文件夹被占用」的唯一真相。
async function setupSchema(): Promise<void> {
  await run(h.db, `
    CREATE TABLE galleries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      coverImageId INTEGER, imageCount INTEGER DEFAULT 0, lastScannedAt TEXT,
      autoScan INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE gallery_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, galleryId INTEGER NOT NULL, folderPath TEXT NOT NULL UNIQUE,
      recursive INTEGER NOT NULL DEFAULT 1, extensions TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
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

describe('createGallery 去重检查改查 gallery_folders', () => {
  it('文件夹已在 gallery_folders 绑定时拒绝创建', async () => {
    const folder = normalizePath(path.join('M:', 'boundFolder'));

    // 预置一个相册 + 把 folder 绑定给它（gallery_folders 有行）
    await run(
      h.db,
      `INSERT INTO galleries (name, autoScan, createdAt, updatedAt)
       VALUES ('owner', 1, '2024-01-01', '2024-01-01')`
    );
    const owner = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
    await run(
      h.db,
      `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
       VALUES (?, ?, 1, ?, '2024-01-01', '2024-01-01')`,
      [owner!.id, folder, JSON.stringify(['.jpg'])]
    );

    const result = await createGallery({ folderPath: folder, name: 'newGallery' });

    // 决策：folder 已被绑定 → 以「去重检查短路」拒绝（固定文案，区别于 UNIQUE 回滚的 SQLite 约束错误）。
    expect(result.success).toBe(false);
    expect(result.error).toBe('Gallery already exists for this folder');

    // 没有为新相册写任何 gallery_folders 行（仍只有 owner 的那条）
    const rows = await all<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_folders WHERE folderPath = ?', [folder]);
    expect(rows.map((r) => r.galleryId)).toEqual([owner!.id]);
  });

  it('文件夹无任何 gallery_folders 绑定时放行创建，并新写一条绑定', async () => {
    const folder = normalizePath(path.join('M:', 'freshFolder'));

    // 库内有一个不相关相册（其绑定文件夹不同），不应影响本 folder 的去重决策
    await run(
      h.db,
      `INSERT INTO galleries (name, autoScan, createdAt, updatedAt)
       VALUES ('other', 1, '2024-01-01', '2024-01-01')`
    );
    const other = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
    await run(
      h.db,
      `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
       VALUES (?, ?, 1, ?, '2024-01-01', '2024-01-01')`,
      [other!.id, normalizePath(path.join('M:', 'otherFolder')), JSON.stringify(['.jpg'])]
    );

    const result = await createGallery({ folderPath: folder, name: 'freshGallery', extensions: ['.jpg'] });

    // 去重决策放行（folder 无绑定行）
    expect(result.success).toBe(true);
    expect(result.data).toBeTruthy();

    // 新建写入该 folder 的绑定行（之前没有）
    const binding = await get<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_folders WHERE folderPath = ?', [folder]);
    expect(binding).toBeTruthy();
    expect(binding!.galleryId).toBe(result.data);
  });
});
