import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

/**
 * Phase 6B — planScanFolder（只读规划：一级子文件夹 + 同名碰撞分类）
 *
 * planScanFolder 是「扫描入库」两步式 API 的第一步（plan）：只读、不建图集、不写库。
 * 候选 = rootPath 的一级子目录（fs.readdir withFileTypes，仅目录）+ rootPath 本身，不深递归。
 * 每个候选先用 checkFolderHasImages（仅直接图片）过滤；含图片的候选再分类：
 *   - normalize(F) 已在 gallery_folders.folderPath → skipped: alreadyBound
 *   - 否则 normalize(F) 在 gallery_ignored_folders.folderPath → skipped: ignored
 *   - 否则存在 name == basename(F) 的图集 → collisions（带其 id+name）
 *   - 否则 → newFolders
 *
 * 用真实临时目录提供文件系统结构（验证「仅一级」深度正确），真实 :memory: sqlite 提供分类数据。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return { ...actual, getDatabase: vi.fn(async () => h.db) };
});

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(async () => ({ success: true, data: { imported: 0, skipped: 0 } })),
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
import { planScanFolder } from '../../../src/main/services/galleryService';

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
  await run(h.db, `
    CREATE TABLE gallery_ignored_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, folderPath TEXT NOT NULL UNIQUE, note TEXT,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )
  `);
}

async function addGallery(folderPath: string, name: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (folderPath, name, isWatching, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, 1, 1, ?, '2024-01-01', '2024-01-01')`,
    [folderPath, name, JSON.stringify(['.jpg'])]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function bindGalleryFolder(galleryId: number, folderPath: string): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, 1, ?, '2024-01-01', '2024-01-01')`,
    [galleryId, normalizePath(folderPath), JSON.stringify(['.jpg'])]
  );
}

async function addIgnored(folderPath: string): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_ignored_folders (folderPath, note, createdAt, updatedAt)
     VALUES (?, NULL, '2024-01-01', '2024-01-01')`,
    [normalizePath(folderPath)]
  );
}

// 真实临时目录根：每个测试单独建一棵，afterEach 清理
let tmpRoot = '';

async function touchImage(dir: string, name: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), 'x');
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-scan-'));
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = '';
  }
});

describe('planScanFolder', () => {
  it('对一级子文件夹按 new/alreadyBound/ignored/collision/noImages 正确分类，且不深递归', async () => {
    // 临时目录结构：
    //   root/A/a.jpg            → 新（含直接图片）
    //   root/A/sub/deep.jpg     → 更深一层，不应成为独立候选（仅一级）
    //   root/B/b.jpg            → alreadyBound（预置 gallery_folders）
    //   root/C/c.jpg            → ignored（预置 gallery_ignored_folders）
    //   root/D/d.jpg            → 同名碰撞（预置一个 name='D' 的图集，路径不同）
    //   root/E/                 → 无图片（仅子目录，无直接图片）
    //   root/E/onlysub/x.jpg    → E 的更深图片不算 E 的直接图片
    const folderA = path.join(tmpRoot, 'A');
    const folderB = path.join(tmpRoot, 'B');
    const folderC = path.join(tmpRoot, 'C');
    const folderD = path.join(tmpRoot, 'D');
    const folderE = path.join(tmpRoot, 'E');

    await touchImage(folderA, 'a.jpg');
    await touchImage(path.join(folderA, 'sub'), 'deep.jpg');
    await touchImage(folderB, 'b.jpg');
    await touchImage(folderC, 'c.jpg');
    await touchImage(folderD, 'd.jpg');
    await fs.mkdir(folderE, { recursive: true });
    await touchImage(path.join(folderE, 'onlysub'), 'x.jpg');

    // B 已绑定到某图集
    const galB = await addGallery(normalizePath(path.join('M:', 'someGalB')), 'galB-name');
    await bindGalleryFolder(galB, folderB);

    // C 在忽略名单
    await addIgnored(folderC);

    // 同名碰撞：存在 name == 'D' 的图集（其路径与 root/D 不同）
    const galDExisting = await addGallery(normalizePath(path.join('M:', 'elsewhereD')), 'D');

    const result = await planScanFolder(tmpRoot, ['.jpg']);

    expect(result.success).toBe(true);
    const data = result.data!;

    const newPaths = data.newFolders.map((f) => f.folderPath);
    // A 是新（含直接图片）
    expect(newPaths).toContain(normalizePath(folderA));
    // A 的 name = 'A'
    const aEntry = data.newFolders.find((f) => f.folderPath === normalizePath(folderA));
    expect(aEntry?.name).toBe('A');

    // 仅一级：A/sub 不应作为独立候选（既不在 new 也不在任何分类里）
    const allListedPaths = [
      ...data.newFolders.map((f) => f.folderPath),
      ...data.collisions.map((f) => f.folderPath),
      ...data.skipped.map((f) => f.folderPath),
    ];
    expect(allListedPaths).not.toContain(normalizePath(path.join(folderA, 'sub')));

    // B → alreadyBound
    expect(
      data.skipped.some((s) => s.folderPath === normalizePath(folderB) && s.reason === 'alreadyBound')
    ).toBe(true);

    // C → ignored
    expect(
      data.skipped.some((s) => s.folderPath === normalizePath(folderC) && s.reason === 'ignored')
    ).toBe(true);

    // D → 同名碰撞，带现有图集 id + name
    const dCollision = data.collisions.find((c) => c.folderPath === normalizePath(folderD));
    expect(dCollision).toBeTruthy();
    expect(dCollision!.name).toBe('D');
    expect(dCollision!.existingGalleryId).toBe(galDExisting);
    expect(dCollision!.existingGalleryName).toBe('D');

    // E → 无直接图片，不出现在 new/collisions 中（noImages：可省略或列出，至少不建图集）
    expect(newPaths).not.toContain(normalizePath(folderE));
    expect(data.collisions.map((c) => c.folderPath)).not.toContain(normalizePath(folderE));
  });

  it('rootPath 自身含直接图片时也作为候选纳入分类', async () => {
    // root 自身直接含图片 → root 应作为候选（无冲突时进 newFolders）
    await touchImage(tmpRoot, 'root.jpg');

    const result = await planScanFolder(tmpRoot, ['.jpg']);
    expect(result.success).toBe(true);
    const newPaths = result.data!.newFolders.map((f) => f.folderPath);
    expect(newPaths).toContain(normalizePath(tmpRoot));
  });

  it('不写任何库（只读）：调用后 galleries / gallery_folders 行数不变', async () => {
    await touchImage(path.join(tmpRoot, 'A'), 'a.jpg');

    const galleriesBefore = (await all(h.db, 'SELECT * FROM galleries')).length;
    const foldersBefore = (await all(h.db, 'SELECT * FROM gallery_folders')).length;

    await planScanFolder(tmpRoot, ['.jpg']);

    const galleriesAfter = (await all(h.db, 'SELECT * FROM galleries')).length;
    const foldersAfter = (await all(h.db, 'SELECT * FROM gallery_folders')).length;
    expect(galleriesAfter).toBe(galleriesBefore);
    expect(foldersAfter).toBe(foldersBefore);
  });

  it('根文件夹不存在时返回 success:false', async () => {
    const result = await planScanFolder(path.join(tmpRoot, 'does-not-exist'), ['.jpg']);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
