import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 6B Task 4 — 去重检查改查 gallery_folders（绑定表才是「文件夹被占用」的真相）
 *
 * createGallery 的重复检查从旧 `SELECT id FROM galleries WHERE folderPath=?`
 * 改为查真实绑定 `SELECT galleryId FROM gallery_folders WHERE folderPath=?`：
 * 一个文件夹「被占用」当且仅当它已被某图集绑定（gallery_folders 有行）。
 *
 * 断言两点（针对 gallery_folders 决策本身）：
 *   1. 文件夹已在 gallery_folders → createGallery 以「已存在」短路拒绝；
 *   2. 文件夹仅作为「陈旧的 galleries.folderPath」存在（无 gallery_folders 行）→
 *      不再被去重检查短路拒绝（决策放行）。为隔离该决策、避开 galleries.folderPath UNIQUE
 *      兜底，本用例的测试 schema 不给 galleries.folderPath 加 UNIQUE。
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

/**
 * 测试 schema：galleries.folderPath **不带 UNIQUE**，以便隔离「去重检查」决策本身
 * （否则陈旧 galleries.folderPath 会被 UNIQUE 兜底，掩盖决策是否短路）。
 * gallery_folders.folderPath 仍带 UNIQUE（与真实一致，绑定全局唯一）。
 */
async function setupSchemaNoGalleryUnique(): Promise<void> {
  await run(h.db, `
    CREATE TABLE galleries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, folderPath TEXT NOT NULL, name TEXT NOT NULL,
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
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchemaNoGalleryUnique();
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('createGallery 去重检查改查 gallery_folders', () => {
  it('文件夹已在 gallery_folders 绑定时拒绝创建（即使无对应 galleries 旧行）', async () => {
    const folder = normalizePath(path.join('M:', 'boundFolder'));

    // 预置一个图集 + 把 folder 绑定给它（gallery_folders 有行），但故意不让 galleries.folderPath = folder
    await run(
      h.db,
      `INSERT INTO galleries (folderPath, name, isWatching, recursive, extensions, createdAt, updatedAt)
       VALUES (?, 'owner', 1, 1, ?, '2024-01-01', '2024-01-01')`,
      [normalizePath(path.join('M:', 'ownerRoot')), JSON.stringify(['.jpg'])]
    );
    const owner = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
    await run(
      h.db,
      `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
       VALUES (?, ?, 1, ?, '2024-01-01', '2024-01-01')`,
      [owner!.id, folder, JSON.stringify(['.jpg'])]
    );

    const result = await createGallery({ folderPath: folder, name: 'newGallery' });

    // 决策：folder 已被绑定 → 以「去重检查短路」拒绝（而非走到 gallery_folders UNIQUE INSERT 才回滚）。
    // 断言具体短路消息以区分两种拒绝来源：短路返回固定文案，UNIQUE 回滚返回 SQLite 约束错误文案。
    expect(result.success).toBe(false);
    expect(result.error).toBe('Gallery already exists for this folder');

    // 没有为新图集写任何 gallery_folders 行（仍只有 owner 的那条）
    const rows = await all<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_folders WHERE folderPath = ?', [folder]);
    expect(rows.map((r) => r.galleryId)).toEqual([owner!.id]);
  });

  it('文件夹仅为陈旧 galleries.folderPath（无 gallery_folders 行）时不被去重短路，放行创建', async () => {
    const folder = normalizePath(path.join('M:', 'staleFolder'));

    // 预置一条陈旧 galleries 行，其 folderPath = folder，但 gallery_folders 无对应绑定行
    await run(
      h.db,
      `INSERT INTO galleries (folderPath, name, isWatching, recursive, extensions, createdAt, updatedAt)
       VALUES (?, 'stale', 1, 1, ?, '2024-01-01', '2024-01-01')`,
      [folder, JSON.stringify(['.jpg'])]
    );

    const result = await createGallery({ folderPath: folder, name: 'freshGallery', extensions: ['.jpg'] });

    // 去重决策放行（不再因陈旧 galleries.folderPath 而短路拒绝）
    expect(result.success).toBe(true);
    expect(result.data).toBeTruthy();

    // 新建走双写，gallery_folders 现在出现该 folder 的绑定行（之前没有）
    const binding = await get<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_folders WHERE folderPath = ?', [folder]);
    expect(binding).toBeTruthy();
    expect(binding!.galleryId).toBe(result.data);
  });
});
