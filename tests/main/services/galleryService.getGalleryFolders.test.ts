import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 7B — getGalleryFolders
 *
 * 读取某图集的全部绑定文件夹（含 recursive / extensions），供「图集信息」多文件夹
 * 管理对话框渲染。与 getGalleryFolderPaths（只返回 folderPath 字符串数组）不同，
 * 本函数返回 { folderPath, recursive(boolean), extensions(string[]) } 列表，按 folderPath 排序。
 *
 * 真实 :memory: sqlite 验证读取；直接写 gallery_folders 行模拟绑定状态。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return { ...actual, getDatabase: vi.fn(async () => h.db) };
});

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(),
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
import { getGalleryFolders } from '../../../src/main/services/galleryService';

async function setupSchema(): Promise<void> {
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
}

async function addGallery(folderPath: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (folderPath, name, isWatching, recursive, extensions, createdAt, updatedAt)
     VALUES (?, 'g', 1, 1, ?, '2024-01-01', '2024-01-01')`,
    [folderPath, JSON.stringify(['.jpg'])]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function addBinding(
  galleryId: number,
  folderPath: string,
  recursive: number,
  extensions: string | null
): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, '2024-01-01', '2024-01-01')`,
    [galleryId, folderPath, recursive, extensions]
  );
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

describe('getGalleryFolders', () => {
  it('返回该图集全部绑定文件夹，recursive 映射为 boolean、extensions JSON.parse，按 folderPath 排序', async () => {
    const baseA = normalizePath(path.join('M:', 'galA', 'z-last'));
    const baseB = normalizePath(path.join('M:', 'galA', 'a-first'));
    const galleryId = await addGallery(normalizePath(path.join('M:', 'galA')));
    // 故意乱序插入，验证 ORDER BY folderPath
    await addBinding(galleryId, baseA, 1, JSON.stringify(['.png', '.gif']));
    await addBinding(galleryId, baseB, 0, JSON.stringify(['.jpg']));

    const result = await getGalleryFolders(galleryId);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { folderPath: baseB, recursive: false, extensions: ['.jpg'] },
      { folderPath: baseA, recursive: true, extensions: ['.png', '.gif'] },
    ]);
  });

  it('extensions 为 NULL 或损坏 JSON 时回退为空数组', async () => {
    const galleryId = await addGallery(normalizePath(path.join('M:', 'galB')));
    const f1 = normalizePath(path.join('M:', 'galB', 'nullext'));
    const f2 = normalizePath(path.join('M:', 'galB', 'broken'));
    await addBinding(galleryId, f1, 1, null);
    await addBinding(galleryId, f2, 1, 'not-json');

    const result = await getGalleryFolders(galleryId);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { folderPath: f2, recursive: true, extensions: [] },
      { folderPath: f1, recursive: true, extensions: [] },
    ]);
  });

  it('图集无绑定文件夹时返回空数组（不报错）', async () => {
    const galleryId = await addGallery(normalizePath(path.join('M:', 'empty')));
    const result = await getGalleryFolders(galleryId);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('只返回指定图集的绑定文件夹', async () => {
    const galleryA = await addGallery(normalizePath(path.join('M:', 'A')));
    const galleryB = await addGallery(normalizePath(path.join('M:', 'B')));
    await addBinding(galleryA, normalizePath(path.join('M:', 'A', 'x')), 1, JSON.stringify(['.jpg']));
    await addBinding(galleryB, normalizePath(path.join('M:', 'B', 'y')), 1, JSON.stringify(['.png']));

    const resultB = await getGalleryFolders(galleryB);
    expect(resultB.success).toBe(true);
    expect(resultB.data).toEqual([
      { folderPath: normalizePath(path.join('M:', 'B', 'y')), recursive: true, extensions: ['.png'] },
    ]);
  });
});
