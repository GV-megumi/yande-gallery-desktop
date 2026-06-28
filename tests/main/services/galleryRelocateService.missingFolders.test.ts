import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 5 Task 3 — getMissingGalleryFolders（绑定文件夹存在性检测）
 *
 * 对每条 gallery_folders 行用 fs.access 检测 folderPath 是否在磁盘上存在，
 * 返回不存在的那些行。只读，不改库。
 *
 * 真实 :memory: sqlite + 只 mock getDatabase；mock fs/promises 的 access
 * （存在 → resolve；不存在 → reject，模拟 ENOENT）。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  /** 视为"存在"的路径集合（compare 时用归一化后的字符串）。 */
  existing: new Set<string>(),
}));

vi.mock('fs/promises', () => {
  const access = vi.fn(async (p: string) => {
    if (h.existing.has(p)) {
      return undefined;
    }
    const err: NodeJS.ErrnoException = new Error('ENOENT: no such file or directory');
    err.code = 'ENOENT';
    throw err;
  });
  return { default: { access }, access };
});

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return {
    ...actual,
    getDatabase: vi.fn(async () => h.db),
  };
});

import { run, get } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { getMissingGalleryFolders } from '../../../src/main/services/galleryRelocateService';

async function setupSchema(): Promise<void> {
  await run(h.db, `
    CREATE TABLE galleries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
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
      updatedAt TEXT NOT NULL
    )
  `);
}

async function addGallery(): Promise<number> {
  await run(h.db, `INSERT INTO galleries (name, createdAt, updatedAt) VALUES ('g', '2024-01-01', '2024-01-01')`);
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function addFolderBinding(galleryId: number, folderPath: string): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, 1, ?, '2024-01-01', '2024-01-01')`,
    [galleryId, folderPath, JSON.stringify(['.jpg'])]
  );
}

beforeEach(async () => {
  h.existing = new Set<string>();
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

describe('getMissingGalleryFolders', () => {
  it('混合存在/缺失：只返回磁盘上不存在的绑定文件夹', async () => {
    const g = await addGallery();
    const present = normalizePath(path.join('M:', 'present'));
    const missing1 = normalizePath(path.join('N:', 'gone1'));
    const missing2 = normalizePath(path.join('N:', 'gone2'));
    await addFolderBinding(g, present);
    await addFolderBinding(g, missing1);
    await addFolderBinding(g, missing2);

    h.existing.add(present); // 仅这个"存在"

    const result = await getMissingGalleryFolders();

    expect(result).toHaveLength(2);
    const paths = result.map((r) => r.folderPath).sort();
    expect(paths).toEqual([missing1, missing2].sort());
    // 每行带 galleryId
    expect(result.every((r) => r.galleryId === g)).toBe(true);
    // 存在的那个没被返回
    expect(paths).not.toContain(present);
  });

  it('全部存在 → 返回空数组', async () => {
    const g = await addGallery();
    const a = normalizePath(path.join('M:', 'a'));
    const b = normalizePath(path.join('M:', 'b'));
    await addFolderBinding(g, a);
    await addFolderBinding(g, b);
    h.existing.add(a);
    h.existing.add(b);

    const result = await getMissingGalleryFolders();
    expect(result).toEqual([]);
  });

  it('空表 → 返回空数组', async () => {
    const result = await getMissingGalleryFolders();
    expect(result).toEqual([]);
  });
});
