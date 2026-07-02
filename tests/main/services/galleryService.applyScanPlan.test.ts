import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';
import os from 'os';
import fsp from 'fs/promises';

/**
 * Phase 6B — applyScanPlan（按用户决议新建图集 / 合并到现有图集）
 *
 * applyScanPlan 是 plan→apply 两步式 API 的第二步：
 *   - resolution.create：逐项 createGallery({folderPath,name,isWatching:true,recursive:true,extensions})
 *     → scanFolderIntoGallery(newId, folderPath, true, extensions)，累加 created + imported/skipped；
 *   - resolution.merge：逐项 bindFolder(galleryId, folderPath, true, extensions)（加绑文件夹并扫描入成员），
 *     累加 merged + imported/skipped；
 *   - 单项失败收集并继续（不因一个坏文件夹中止整批）。
 *
 * 用真实临时目录满足 createGallery 的 fs.access 文件夹存在校验；真实 :memory: sqlite 落库；
 * 只 mock 磁盘扫描 scanAndImportFolder（用预置 images + 受控 imported 计数驱动成员写入与计数累加）。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  // scanAndImportFolder 默认返回；按文件夹路径覆盖 imported（精确累加断言）
  importByFolder: {} as Record<string, { imported: number; skipped: number }>,
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return { ...actual, getDatabase: vi.fn(async () => h.db) };
});

// scanAndImportFolder：按归一化文件夹路径返回受控计数（不真正写 images，images 由测试预置）
vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(async (folderPath: string) => {
    const norm = folderPath; // applyScanPlan/bindFolder 传入的已是归一化路径
    const counts = h.importByFolder[norm] ?? { imported: 0, skipped: 0 };
    return { success: true, data: counts };
  }),
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
import { applyScanPlan } from '../../../src/main/services/galleryService';

async function setupSchema(): Promise<void> {
  await run(h.db, `
    CREATE TABLE images (
      id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, filepath TEXT NOT NULL UNIQUE,
      fileSize INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, format TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )
  `);
  // Phase 8A 新结构：galleries 无 folderPath/isWatching/recursive/extensions（归 gallery_folders）
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

// 新结构：galleries 行只存元数据 + autoScan；绑定文件夹写到 gallery_folders。
async function addGallery(folderPath: string, name: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (name, autoScan, createdAt, updatedAt)
     VALUES (?, 1, '2024-01-01', '2024-01-01')`,
    [name]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  const galleryId = row!.id;
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, 1, ?, '2024-01-01', '2024-01-01')`,
    [galleryId, folderPath, JSON.stringify(['.jpg'])]
  );
  return galleryId;
}

let tmpRoot = '';

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'apply-scan-'));
  h.importByFolder = {};
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
  if (tmpRoot) {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = '';
  }
});

describe('applyScanPlan', () => {
  it('create：为每个候选新建图集（recursive=true）并写入成员', async () => {
    const folderA = path.join(tmpRoot, 'A');
    await fsp.mkdir(folderA, { recursive: true });
    const normA = normalizePath(folderA);

    // 预置 A 下两张图片（含一张嵌套，验证 recursive=true 把嵌套也纳入成员）
    const i1 = await addImage(normalizePath(path.join(folderA, 'a.jpg')));
    const i2 = await addImage(normalizePath(path.join(folderA, 'sub', 'b.jpg')));
    h.importByFolder[normA] = { imported: 2, skipped: 0 };

    const result = await applyScanPlan({
      create: [{ folderPath: normA, name: 'A' }],
      merge: [],
      extensions: ['.jpg'],
    });

    expect(result.success).toBe(true);
    expect(result.data!.created).toBe(1);
    expect(result.data!.imported).toBe(2);

    // 新图集存在且其绑定 recursive=1（recursive 现在归 gallery_folders）
    const gallery = await get<{ id: number; recursive: number }>(
      h.db,
      `SELECT g.id, gf.recursive
         FROM galleries g JOIN gallery_folders gf ON gf.galleryId = g.id
        WHERE gf.folderPath = ?`,
      [normA]
    );
    expect(gallery).toBeTruthy();
    expect(gallery!.recursive).toBe(1);

    // gallery_folders 绑定 recursive=1
    const binding = await get<{ recursive: number }>(
      h.db,
      'SELECT recursive FROM gallery_folders WHERE folderPath = ?',
      [normA]
    );
    expect(binding!.recursive).toBe(1);

    // 成员含直接 + 嵌套（recursive=true）
    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ? ORDER BY imageId', [gallery!.id])
    ).map((r) => r.imageId);
    expect(members).toEqual([i1, i2].sort((x, y) => x - y));
  });

  it('merge：把文件夹加绑到现有图集并写入其成员', async () => {
    const existingFolder = normalizePath(path.join('M:', 'existingGal'));
    const galleryId = await addGallery(existingFolder, 'Existing');

    const mergeFolder = path.join(tmpRoot, 'M');
    await fsp.mkdir(mergeFolder, { recursive: true });
    const normMerge = normalizePath(mergeFolder);

    const m1 = await addImage(normalizePath(path.join(mergeFolder, 'm.jpg')));
    h.importByFolder[normMerge] = { imported: 1, skipped: 0 };

    const result = await applyScanPlan({
      create: [],
      merge: [{ folderPath: normMerge, galleryId }],
      extensions: ['.jpg'],
    });

    expect(result.success).toBe(true);
    expect(result.data!.merged).toBe(1);
    expect(result.data!.imported).toBe(1);

    // 现有图集获得了 mergeFolder 的绑定
    const binding = await get<{ galleryId: number }>(
      h.db,
      'SELECT galleryId FROM gallery_folders WHERE folderPath = ?',
      [normMerge]
    );
    expect(binding!.galleryId).toBe(galleryId);

    // mergeFolder 的图片成为该图集成员
    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toContain(m1);
  });

  it('混合批：create + merge 一起执行，计数分别累加', async () => {
    // create 目标
    const folderC = path.join(tmpRoot, 'C');
    await fsp.mkdir(folderC, { recursive: true });
    const normC = normalizePath(folderC);
    const ci = await addImage(normalizePath(path.join(folderC, 'c.jpg')));
    h.importByFolder[normC] = { imported: 1, skipped: 0 };

    // merge 目标
    const existingFolder = normalizePath(path.join('M:', 'existGal2'));
    const galleryId = await addGallery(existingFolder, 'Exist2');
    const folderD = path.join(tmpRoot, 'D');
    await fsp.mkdir(folderD, { recursive: true });
    const normD = normalizePath(folderD);
    const di = await addImage(normalizePath(path.join(folderD, 'd.jpg')));
    h.importByFolder[normD] = { imported: 1, skipped: 0 };

    const result = await applyScanPlan({
      create: [{ folderPath: normC, name: 'C' }],
      merge: [{ folderPath: normD, galleryId }],
      extensions: ['.jpg'],
    });

    expect(result.success).toBe(true);
    expect(result.data!.created).toBe(1);
    expect(result.data!.merged).toBe(1);
    expect(result.data!.imported).toBe(2);

    // create 产生新图集且含成员（按 gallery_folders 绑定定位新图集 id）
    const newGallery = await get<{ id: number }>(
      h.db,
      'SELECT galleryId AS id FROM gallery_folders WHERE folderPath = ?',
      [normC]
    );
    expect(newGallery).toBeTruthy();
    const newMembers = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [newGallery!.id])
    ).map((r) => r.imageId);
    expect(newMembers).toContain(ci);

    // merge 把 D 绑到现有图集且含成员
    const dMembers = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])
    ).map((r) => r.imageId);
    expect(dMembers).toContain(di);
  });

  it('create 同名去重：与现有图集重名时按规则追加 " (2)" 后缀，原图集不受影响', async () => {
    // 预置一个名为 D 的图集（模拟碰撞决议里用户选了「新建独立图集」并携带原名 D）
    await addGallery(normalizePath(path.join('M:', 'existingD')), 'D');

    const folderD = path.join(tmpRoot, 'D');
    await fsp.mkdir(folderD, { recursive: true });
    const normD = normalizePath(folderD);
    h.importByFolder[normD] = { imported: 0, skipped: 0 };

    const result = await applyScanPlan({
      create: [{ folderPath: normD, name: 'D' }],
      merge: [],
      extensions: ['.jpg'],
    });

    expect(result.success).toBe(true);
    expect(result.data!.created).toBe(1);

    // 新图集名应为 "D (2)"（galleries.name 无 UNIQUE，靠服务层去重避免两个不可区分的「D」）
    const newRow = await get<{ name: string }>(
      h.db,
      `SELECT g.name FROM galleries g JOIN gallery_folders gf ON gf.galleryId = g.id WHERE gf.folderPath = ?`,
      [normD]
    );
    expect(newRow!.name).toBe('D (2)');

    // 全库不存在重名
    const names = (await all<{ name: string }>(h.db, 'SELECT name FROM galleries ORDER BY id')).map((r) => r.name);
    expect(names).toEqual(['D', 'D (2)']);
  });

  it('create 同批内重名也去重：同批两个同名项 + 已有同名图集 → 依次取 "(2)"、"(3)"', async () => {
    // 已有图集名为 X；同一批 plan 内又有两个 basename 相同的候选（如 root 自身与其一级子目录同名）
    await addGallery(normalizePath(path.join('M:', 'existingX')), 'X');

    const folderX1 = path.join(tmpRoot, 'a', 'X');
    const folderX2 = path.join(tmpRoot, 'b', 'X');
    await fsp.mkdir(folderX1, { recursive: true });
    await fsp.mkdir(folderX2, { recursive: true });
    const normX1 = normalizePath(folderX1);
    const normX2 = normalizePath(folderX2);
    h.importByFolder[normX1] = { imported: 0, skipped: 0 };
    h.importByFolder[normX2] = { imported: 0, skipped: 0 };

    const result = await applyScanPlan({
      create: [
        { folderPath: normX1, name: 'X' },
        { folderPath: normX2, name: 'X' },
      ],
      merge: [],
      extensions: ['.jpg'],
    });

    expect(result.success).toBe(true);
    expect(result.data!.created).toBe(2);

    const names = (await all<{ name: string }>(h.db, 'SELECT name FROM galleries ORDER BY id')).map((r) => r.name);
    expect(names).toEqual(['X', 'X (2)', 'X (3)']);
  });

  it('create 无重名时保留原名，不加后缀', async () => {
    const folderPlain = path.join(tmpRoot, 'Plain');
    await fsp.mkdir(folderPlain, { recursive: true });
    const normPlain = normalizePath(folderPlain);
    h.importByFolder[normPlain] = { imported: 0, skipped: 0 };

    const result = await applyScanPlan({
      create: [{ folderPath: normPlain, name: 'Plain' }],
      merge: [],
      extensions: ['.jpg'],
    });

    expect(result.success).toBe(true);
    const names = (await all<{ name: string }>(h.db, 'SELECT name FROM galleries')).map((r) => r.name);
    expect(names).toEqual(['Plain']);
  });

  it('单项失败不中止整批：坏的 merge 不阻止好的 create', async () => {
    const folderOk = path.join(tmpRoot, 'OK');
    await fsp.mkdir(folderOk, { recursive: true });
    const normOk = normalizePath(folderOk);
    const oi = await addImage(normalizePath(path.join(folderOk, 'ok.jpg')));
    h.importByFolder[normOk] = { imported: 1, skipped: 0 };

    // 坏的 merge：folderShared 已被别的图集绑定 → bindFolder 拒绝（全局唯一）
    const galleryA = await addGallery(normalizePath(path.join('M:', 'galA')), 'A');
    const galleryB = await addGallery(normalizePath(path.join('M:', 'galB')), 'B');
    const folderShared = normalizePath(path.join('M:', 'shared'));
    await run(
      h.db,
      `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
       VALUES (?, ?, 1, ?, '2024-01-01', '2024-01-01')`,
      [galleryA, folderShared, JSON.stringify(['.jpg'])]
    );

    const result = await applyScanPlan({
      create: [{ folderPath: normOk, name: 'OK' }],
      merge: [{ folderPath: folderShared, galleryId: galleryB }],
      extensions: ['.jpg'],
    });

    // 整体仍 success（单项失败不致命）；好的 create 已落库
    expect(result.success).toBe(true);
    expect(result.data!.created).toBe(1);
    // 坏 merge 未计入 merged
    expect(result.data!.merged).toBe(0);

    const okGallery = await get<{ id: number }>(
      h.db,
      'SELECT galleryId AS id FROM gallery_folders WHERE folderPath = ?',
      [normOk]
    );
    expect(okGallery).toBeTruthy();
    const okMembers = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [okGallery!.id])
    ).map((r) => r.imageId);
    expect(okMembers).toContain(oi);

    // folderShared 仍只属于 galleryA（坏 merge 没改它）
    const sharedRows = await all<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_folders WHERE folderPath = ?', [folderShared]);
    expect(sharedRows.map((r) => r.galleryId)).toEqual([galleryA]);
  });
});
