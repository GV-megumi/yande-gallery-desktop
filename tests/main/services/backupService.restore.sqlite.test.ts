import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * 备份/恢复 × 相册解耦（真实 :memory: sqlite）
 *
 * 与 backupService.test.ts 的 mock 风格用例互补：本文件用真实 schema + 真实 SQL 验证——
 *   1. 新格式往返：导出携带 gallery_folders 绑定与 gallery_images 成员，清库后恢复完整回来，
 *      并按成员表重算 galleries.imageCount（§5.1 不变量：imageCount = COUNT(gallery_images)）；
 *   2. replace 模式连带清空两张关联表：FK OFF 下 DELETE galleries 不触发 CASCADE，
 *      若不显式清表会留下幽灵绑定（悬挂 folderPath 永久占用全局 UNIQUE、阻塞孤儿 GC）；
 *   3. 旧版（相册解耦前）备份兼容：galleries 旧列不再拖垮整个恢复事务，
 *      isWatching→autoScan、folderPath 转写为 gallery_folders 绑定。
 *
 * 只 mock 环境边界（getDatabase→内存库、config 读写、事件广播、白名单装载），SQL 全走真实 sqlite。
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

vi.mock('../../../src/main/services/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/config.js')>();
  return {
    ...actual,
    getConfig: vi.fn(() => ({
      dataPath: 'data',
      database: { path: 'gallery.db' },
      downloads: { path: 'downloads' },
      thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp', effort: 3 },
      app: { autoScan: true },
      yande: { maxConcurrentDownloads: 5 },
      network: { proxy: { enabled: false, protocol: 'http', host: '127.0.0.1', port: 7890 } },
      booru: {
        appearance: { gridSize: 330, previewQuality: 'auto', itemsPerPage: 20, paginationPosition: 'bottom', pageMode: 'pagination', spacing: 16, borderRadius: 8, margin: 24 },
        download: { filenameTemplate: '{id}.{extension}', tokenDefaults: {} },
      },
    })),
    saveConfig: vi.fn(async () => ({ success: true })),
    // 破坏性恢复尾部会 bump dataVersion；stub 掉避免真实实现读 mock 的 getConfig().sync（不存在）而炸
    bumpSyncDataVersion: vi.fn(async () => undefined),
  };
});

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitAppDataRestored: vi.fn(),
  emitConfigChanged: vi.fn(),
}));

vi.mock('../../../src/main/services/galleryRootRegistry.js', () => ({
  loadGalleryRoots: vi.fn(),
}));

vi.mock('../../../src/main/services/galleryService.js', () => ({
  getAllGalleryFolderPaths: vi.fn(async () => []),
}));

vi.mock('electron', () => ({}));

import { run, get, all, runInTransaction } from '../../../src/main/services/database';
import { bumpSyncDataVersion } from '../../../src/main/services/config';
import { normalizePath } from '../../../src/main/utils/path';
import {
  BACKUP_TABLES,
  createAppBackupData,
  restoreAppBackupData,
  isValidBackupData,
  type AppBackupData,
} from '../../../src/main/services/backupService';

/** 备份涉及的 booru 表：本文件只验证相册侧行为，booru 表建成最小结构即可满足 SELECT 与 DELETE。 */
const MINIMAL_BOORU_TABLES = [
  'booru_sites',
  'booru_posts',
  'booru_tags',
  'booru_post_tags',
  'booru_favorite_groups',
  'booru_favorites',
  'booru_search_history',
  'booru_favorite_tag_labels',
  'booru_favorite_tags',
  'booru_blacklisted_tags',
  'booru_saved_searches',
] as const;

/** 建当前（contract 后）真实结构：galleries 无旧列，绑定/成员在两张关联表 */
async function setupSchema(): Promise<void> {
  for (const table of MINIMAL_BOORU_TABLES) {
    await run(h.db, `CREATE TABLE ${table} (id INTEGER PRIMARY KEY)`);
  }

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
      name TEXT NOT NULL,
      coverImageId INTEGER,
      imageCount INTEGER DEFAULT 0,
      lastScannedAt TEXT,
      autoScan INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (coverImageId) REFERENCES images (id) ON DELETE SET NULL
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

async function seedGallery(name: string, autoScan = 1, imageCount = 0): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (name, imageCount, autoScan, createdAt, updatedAt) VALUES (?, ?, ?, '2026-01-01', '2026-01-01')`,
    [name, imageCount, autoScan]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function seedBinding(galleryId: number, folderPath: string, recursive = 1, extensions: string | null = null): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt) VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-01')`,
    [galleryId, folderPath, recursive, extensions]
  );
}

async function seedImage(filepath: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO images (filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
     VALUES (?, ?, 0, 0, 0, 'jpg', '2026-01-01', '2026-01-01')`,
    [path.basename(filepath), filepath]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function seedMember(galleryId: number, imageId: number): Promise<void> {
  await run(h.db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, '2026-01-01')`, [galleryId, imageId]);
}

/** 模拟异机恢复：换成一个全新空库（images 从未有行，AUTOINCREMENT 从 1 重新计数） */
async function resetToFreshDb(): Promise<void> {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
  vi.clearAllMocks();
});

describe('BACKUP_TABLES 相册解耦覆盖', () => {
  it('应在 galleries 之后纳入 gallery_folders / gallery_images（恢复正序、删除逆序满足 FK 依赖）', () => {
    const tables = BACKUP_TABLES as readonly string[];
    const galleriesIdx = tables.indexOf('galleries');
    const foldersIdx = tables.indexOf('gallery_folders');
    const imagesIdx = tables.indexOf('gallery_images');
    expect(galleriesIdx).toBeGreaterThanOrEqual(0);
    expect(foldersIdx).toBeGreaterThan(galleriesIdx);
    expect(imagesIdx).toBeGreaterThan(foldersIdx);
  });

  it('旧版备份缺 gallery_folders / gallery_images 两表时仍应通过格式校验（视为可选）', async () => {
    const backup = await createAppBackupData();
    const legacyTables = { ...backup.tables } as Record<string, unknown>;
    delete legacyTables.gallery_folders;
    delete legacyTables.gallery_images;
    expect(isValidBackupData({ ...backup, tables: legacyTables })).toBe(true);
    // 缺必备表（如 galleries）仍应拒绝
    const broken = { ...legacyTables } as Record<string, unknown>;
    delete broken.galleries;
    expect(isValidBackupData({ ...backup, tables: broken })).toBe(false);
  });
});

describe('新格式备份：绑定与成员随备份往返', () => {
  it('导出应携带 gallery_folders 绑定与 gallery_images 成员', async () => {
    const folder = normalizePath(path.join('M:', 'gal', 'A'));
    const gid = await seedGallery('G1');
    await seedBinding(gid, folder, 0, JSON.stringify(['.jpg']));
    const img1 = await seedImage(normalizePath(path.join('M:', 'gal', 'A', 'a.jpg')));
    const img2 = await seedImage(normalizePath(path.join('M:', 'gal', 'A', 'b.jpg')));
    await seedMember(gid, img1);
    await seedMember(gid, img2);

    const backup = await createAppBackupData();

    expect(backup.tables.gallery_folders).toHaveLength(1);
    expect(backup.tables.gallery_folders[0]).toMatchObject({ galleryId: gid, folderPath: folder, recursive: 0 });
    expect(backup.tables.gallery_images).toHaveLength(2);
    expect(backup.tables.gallery_images.map((r) => r.imageId).sort()).toEqual([img1, img2].sort());
  });

  it('导出→清库→replace 恢复：绑定与成员完整往返，imageCount 按成员表重算而非沿用备份行旧值', async () => {
    const folder = normalizePath(path.join('M:', 'gal', 'A'));
    const gid = await seedGallery('G1', 0, 2);
    await seedBinding(gid, folder, 1, JSON.stringify(['.jpg', '.png']));
    const img1 = await seedImage(normalizePath(path.join('M:', 'gal', 'A', 'a.jpg')));
    const img2 = await seedImage(normalizePath(path.join('M:', 'gal', 'A', 'b.jpg')));
    await seedMember(gid, img1);
    await seedMember(gid, img2);

    const backup = await createAppBackupData();
    // 篡改备份行中的 imageCount 缓存，验证恢复后按 gallery_images 重算（§5.1 不变量）
    (backup.tables.galleries[0] as Record<string, unknown>).imageCount = 999;

    // 模拟丢失相册数据后的恢复（images 表仍在，如同本机数据修复场景）
    await run(h.db, 'DELETE FROM gallery_images');
    await run(h.db, 'DELETE FROM gallery_folders');
    await run(h.db, 'DELETE FROM galleries');

    await restoreAppBackupData(backup, { mode: 'replace' });

    const galleries = await all<{ id: number; name: string; autoScan: number; imageCount: number }>(
      h.db,
      'SELECT id, name, autoScan, imageCount FROM galleries'
    );
    expect(galleries).toHaveLength(1);
    expect(galleries[0]).toMatchObject({ id: gid, name: 'G1', autoScan: 0, imageCount: 2 });

    const folders = await all<{ galleryId: number; folderPath: string; recursive: number; extensions: string }>(
      h.db,
      'SELECT galleryId, folderPath, recursive, extensions FROM gallery_folders'
    );
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ galleryId: gid, folderPath: folder, recursive: 1 });
    expect(JSON.parse(folders[0].extensions)).toEqual(['.jpg', '.png']);

    const members = await all<{ galleryId: number; imageId: number }>(h.db, 'SELECT galleryId, imageId FROM gallery_images');
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.imageId).sort()).toEqual([img1, img2].sort());

    // 恢复成功尾部应 bump 一次 dataVersion（移动端据此全量重建镜像，spec §5.3）
    expect(vi.mocked(bumpSyncDataVersion)).toHaveBeenCalledTimes(1);
  });

  it('replace 恢复应连带清空恢复前残留的 gallery_folders / gallery_images（不留占用 UNIQUE 的幽灵绑定）', async () => {
    const folderA = normalizePath(path.join('M:', 'gal', 'A'));
    const folderB = normalizePath(path.join('M:', 'gal', 'B'));

    const g1 = await seedGallery('G1');
    await seedBinding(g1, folderA);
    const img1 = await seedImage(normalizePath(path.join('M:', 'gal', 'A', 'a.jpg')));
    await seedMember(g1, img1);

    const backup = await createAppBackupData();

    // 备份之后新建相册 G2 并绑定 folderB——replace 恢复应把它连同绑定/成员一起清掉
    const g2 = await seedGallery('G2');
    await seedBinding(g2, folderB);
    const img2 = await seedImage(normalizePath(path.join('M:', 'gal', 'B', 'b.jpg')));
    await seedMember(g2, img2);

    await restoreAppBackupData(backup, { mode: 'replace' });

    const galleryIds = (await all<{ id: number }>(h.db, 'SELECT id FROM galleries')).map((r) => r.id);
    expect(galleryIds).toEqual([g1]);

    // 幽灵绑定检查：G2 的绑定/成员不得残留（残留会永久占用 folderPath 全局 UNIQUE）
    const folderPaths = (await all<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders')).map((r) => r.folderPath);
    expect(folderPaths).toEqual([folderA]);
    const memberGalleryIds = (await all<{ galleryId: number }>(h.db, 'SELECT DISTINCT galleryId FROM gallery_images')).map((r) => r.galleryId);
    expect(memberGalleryIds).toEqual([g1]);

    // folderB 的 UNIQUE 占用已释放：重新绑定应成功
    await expect(seedBinding(g1, folderB)).resolves.toBeUndefined();
  });
});

/** 构造合法的备份 config 段（与 mocked getConfig 同形），供手工拼装的备份 payload 使用 */
function buildBackupConfig(): AppBackupData['config'] {
  return {
    dataPath: 'data',
    database: { path: 'gallery.db' },
    downloads: { path: 'downloads' },
    thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp', effort: 3 },
    app: { autoScan: true },
    yande: { maxConcurrentDownloads: 5 },
    network: { proxy: { enabled: false, protocol: 'http', host: '127.0.0.1', port: 7890 } },
    booru: {
      appearance: { gridSize: 330, previewQuality: 'auto', itemsPerPage: 20, paginationPosition: 'bottom', pageMode: 'pagination', spacing: 16, borderRadius: 8, margin: 24 },
      download: { filenameTemplate: '{id}.{extension}', tokenDefaults: {} },
    },
  } as AppBackupData['config'];
}

/**
 * 构造旧版（相册解耦前）备份 payload：
 * - galleries 行携带旧列 folderPath/isWatching/recursive/extensions（contract 后已不存在）；
 * - 没有 gallery_folders / gallery_images 两张表（当时尚未引入）。
 */
function buildLegacyBackup(galleryRows: Record<string, unknown>[]): AppBackupData {
  const tables: Record<string, Record<string, unknown>[]> = { galleries: galleryRows };
  for (const table of MINIMAL_BOORU_TABLES) {
    tables[table] = [];
  }
  return {
    version: 1,
    exportedAt: '2025-06-01T00:00:00.000Z',
    config: buildBackupConfig(),
    tables,
  } as unknown as AppBackupData;
}

describe('旧版（相册解耦前）备份兼容恢复', () => {
  it('galleries 旧行不再拖垮恢复：isWatching→autoScan，folderPath 转写为 gallery_folders 绑定，imageCount 重算为 0', async () => {
    const legacyFolder = path.join('M:', 'legacy', 'gal') + path.sep; // 末尾分隔符验证 normalizePath 归一
    const backup = buildLegacyBackup([
      {
        id: 7,
        folderPath: legacyFolder,
        name: 'Legacy',
        coverImageId: null,
        imageCount: 42,
        lastScannedAt: null,
        isWatching: 0,
        recursive: 0,
        extensions: JSON.stringify(['.png']),
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
      },
    ]);

    await expect(restoreAppBackupData(backup, { mode: 'merge' })).resolves.toMatchObject({ mode: 'merge' });

    const gallery = await get<{ id: number; name: string; autoScan: number; imageCount: number }>(
      h.db,
      'SELECT id, name, autoScan, imageCount FROM galleries WHERE id = 7'
    );
    // isWatching=0 映射为 autoScan=0；旧备份无成员数据，imageCount 重算为 0 是诚实结果（绑定已恢复，重扫即可找回）
    expect(gallery).toMatchObject({ id: 7, name: 'Legacy', autoScan: 0, imageCount: 0 });

    const bindings = await all<{ galleryId: number; folderPath: string; recursive: number; extensions: string }>(
      h.db,
      'SELECT galleryId, folderPath, recursive, extensions FROM gallery_folders'
    );
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      galleryId: 7,
      folderPath: normalizePath(legacyFolder),
      recursive: 0,
    });
    expect(JSON.parse(bindings[0].extensions)).toEqual(['.png']);

    expect(await all(h.db, 'SELECT * FROM gallery_images')).toEqual([]);
  });

  it('isWatching 为 NULL 时 autoScan 回退 1（与 contract 迁移 COALESCE 一致）；folderPath 空串不产生绑定', async () => {
    const backup = buildLegacyBackup([
      {
        id: 8,
        folderPath: '',
        name: 'NoFolder',
        coverImageId: null,
        imageCount: 0,
        lastScannedAt: null,
        isWatching: null,
        recursive: 1,
        extensions: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await restoreAppBackupData(backup, { mode: 'merge' });

    const gallery = await get<{ autoScan: number }>(h.db, 'SELECT autoScan FROM galleries WHERE id = 8');
    expect(gallery).toMatchObject({ autoScan: 1 });
    expect(await all(h.db, 'SELECT * FROM gallery_folders')).toEqual([]);
  });

  it('merge 模式下旧绑定路径已被现有相册占用时按 INSERT OR IGNORE 保留现状（与启动迁移回填语义一致）', async () => {
    const folder = normalizePath(path.join('M:', 'shared', 'gal'));
    const existing = await seedGallery('Current');
    await seedBinding(existing, folder);

    const backup = buildLegacyBackup([
      {
        id: 99,
        folderPath: folder,
        name: 'LegacyDup',
        coverImageId: null,
        imageCount: 1,
        lastScannedAt: null,
        isWatching: 1,
        recursive: 1,
        extensions: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    await restoreAppBackupData(backup, { mode: 'merge' });

    // 相册行本身恢复成功；folderPath 全局 UNIQUE 已被现有相册占用，绑定保持不变
    expect(await get(h.db, 'SELECT id FROM galleries WHERE id = 99')).toBeTruthy();
    const bindings = await all<{ galleryId: number; folderPath: string }>(h.db, 'SELECT galleryId, folderPath FROM gallery_folders');
    expect(bindings).toEqual([{ galleryId: existing, folderPath: folder }]);
  });
});

describe('恢复时未知列过滤（通用防御）', () => {
  it('行内含目标表当前不存在的列时应被过滤而非整体失败', async () => {
    const backup = buildLegacyBackup([]);
    (backup.tables as Record<string, Record<string, unknown>[]>).galleries = [
      {
        id: 3,
        name: 'WithBogus',
        imageCount: 0,
        autoScan: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        bogusColumn: 'boom', // 未来版本/异构备份多出的列
      },
    ];
    (backup.tables as Record<string, Record<string, unknown>[]>).booru_sites = [
      { id: 11, zzz: 'unknown' }, // booru_sites 最小结构只有 id 列
    ];

    await expect(restoreAppBackupData(backup, { mode: 'merge' })).resolves.toBeTruthy();

    expect(await get(h.db, 'SELECT id, name FROM galleries WHERE id = 3')).toMatchObject({ id: 3, name: 'WithBogus' });
    expect(await get(h.db, 'SELECT id FROM booru_sites WHERE id = 11')).toMatchObject({ id: 11 });
  });

  it('整行与当前表结构无共同列时跳过该行且不中断恢复', async () => {
    const backup = buildLegacyBackup([]);
    (backup.tables as Record<string, Record<string, unknown>[]>).booru_sites = [
      { zzz: 'no-known-column' },
      { id: 12 },
    ];

    await expect(restoreAppBackupData(backup, { mode: 'merge' })).resolves.toBeTruthy();

    // 全未知列的行被跳过，正常行照常恢复
    const rows = await all<{ id: number }>(h.db, 'SELECT id FROM booru_sites');
    expect(rows).toEqual([{ id: 12 }]);
  });
});

describe('恢复后悬挂 images 引用清理（images 表不随备份走）', () => {
  it('异机（空库）replace 恢复：悬挂成员被清、imageCount 诚实为 0、悬挂封面置空；重扫复用 AUTOINCREMENT id 不会错误归属', async () => {
    // 源机：G1 绑 A（图 1/2，封面=图1），G2 绑 B（图 3/4）
    const folderA = normalizePath(path.join('M:', 'gal', 'A'));
    const folderB = normalizePath(path.join('M:', 'gal', 'B'));
    const g1 = await seedGallery('G1');
    const g2 = await seedGallery('G2');
    await seedBinding(g1, folderA);
    await seedBinding(g2, folderB);
    const a1 = await seedImage(normalizePath(path.join('M:', 'gal', 'A', 'a1.jpg')));
    const a2 = await seedImage(normalizePath(path.join('M:', 'gal', 'A', 'a2.jpg')));
    const b1 = await seedImage(normalizePath(path.join('M:', 'gal', 'B', 'b1.jpg')));
    const b2 = await seedImage(normalizePath(path.join('M:', 'gal', 'B', 'b2.jpg')));
    await seedMember(g1, a1);
    await seedMember(g1, a2);
    await seedMember(g2, b1);
    await seedMember(g2, b2);
    await run(h.db, 'UPDATE galleries SET coverImageId = ? WHERE id = ?', [a1, g1]);

    const backup = await createAppBackupData();

    // 异机：全新空库，images 表 0 行
    await resetToFreshDb();
    await restoreAppBackupData(backup, { mode: 'replace' });

    // 成员行全部指向本库不存在的 imageId，必须被清理而非悬挂保留
    expect(await all(h.db, 'SELECT * FROM gallery_images')).toHaveLength(0);
    const galleries = await all<{ id: number; imageCount: number; coverImageId: number | null }>(
      h.db,
      'SELECT id, imageCount, coverImageId FROM galleries ORDER BY id'
    );
    expect(galleries.map((g) => g.imageCount)).toEqual([0, 0]);
    expect(galleries[0].coverImageId).toBeNull();

    // 绑定完整恢复：重扫入口仍在
    const folders = await all<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders ORDER BY folderPath');
    expect(folders.map((f) => f.folderPath)).toEqual([folderA, folderB].sort());

    // 用户先重扫 B 文件夹：新图复用 AUTOINCREMENT id 1/2——若悬挂成员未清，
    // G1 的 (g1,1)/(g1,2) 会立刻指向 B 的图片（静默错误归属）
    const nb1 = await seedImage(normalizePath(path.join('M:', 'gal', 'B', 'b1.jpg')));
    const nb2 = await seedImage(normalizePath(path.join('M:', 'gal', 'B', 'b2.jpg')));
    expect([nb1, nb2]).toEqual([1, 2]); // 前提确认：id 复用确实发生
    expect(await all(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [g1])).toHaveLength(0);
  });

  it('本机恢复：有效引用保留、仅悬挂引用被清；booru_posts.localImageId 悬挂时置空', async () => {
    const folderA = normalizePath(path.join('M:', 'gal', 'A'));
    const gid = await seedGallery('G1');
    await seedBinding(gid, folderA);
    const img1 = await seedImage(normalizePath(path.join('M:', 'gal', 'A', 'a.jpg')));
    await seedMember(gid, img1);
    // 最小 booru_posts 结构补上 localImageId 列（真实 schema 里 FK SET NULL 指向 images）
    await run(h.db, 'ALTER TABLE booru_posts ADD COLUMN localImageId INTEGER');
    await run(h.db, 'INSERT INTO booru_posts (id, localImageId) VALUES (1, ?)', [img1]);

    const backup = await createAppBackupData();
    // 注入悬挂引用：成员指向不存在的图 999、封面指向 997、booru 下载关联指向 998
    (backup.tables as Record<string, Record<string, unknown>[]>).gallery_images.push({
      galleryId: gid,
      imageId: 999,
      addedAt: '2026-01-01',
    });
    (backup.tables as Record<string, Record<string, unknown>[]>).galleries[0].coverImageId = 997;
    (backup.tables as Record<string, Record<string, unknown>[]>).booru_posts.push({ id: 2, localImageId: 998 });

    await restoreAppBackupData(backup, { mode: 'replace' });

    // img1 仍在本机 images 表：有效成员与有效下载关联保留，悬挂的被清
    const members = await all<{ galleryId: number; imageId: number }>(h.db, 'SELECT galleryId, imageId FROM gallery_images');
    expect(members).toEqual([{ galleryId: gid, imageId: img1 }]);
    expect(await get(h.db, 'SELECT imageCount, coverImageId FROM galleries WHERE id = ?', [gid])).toMatchObject({
      imageCount: 1,
      coverImageId: null,
    });
    const posts = await all<{ id: number; localImageId: number | null }>(
      h.db,
      'SELECT id, localImageId FROM booru_posts ORDER BY id'
    );
    expect(posts).toEqual([
      { id: 1, localImageId: img1 },
      { id: 2, localImageId: null },
    ]);
  });
});

describe('恢复与并发事务互斥（runExclusive）', () => {
  it('恢复期间并发的 runInTransaction 不会让 PRAGMA foreign_keys 永久失效', async () => {
    const gid = await seedGallery('并发期相册');
    await seedBinding(gid, normalizePath('M:/con/root'));
    const backup = await createAppBackupData();

    // 并发发起：恢复（独占段内 FK OFF → 恢复事务 → FK ON）与一个普通写事务。
    // 修复前 PRAGMA 不排队，FK ON 可能落进并发开放事务的窗口被 SQLite 静默忽略
    // （外键从此进程级 OFF）；修复后两者在同一条事务队列上严格互斥。
    const concurrentWrite = runInTransaction(h.db, async () => {
      await run(h.db, 'INSERT INTO booru_search_history (id) VALUES (999)');
    });
    await Promise.all([restoreAppBackupData(backup, { mode: 'replace' }), concurrentWrite]);

    // FK 必须回到 ON
    const fk = await get<{ foreign_keys: number }>(h.db, 'PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);

    // 且约束确实在生效：插入悬挂成员行应被外键拒绝
    await expect(
      run(h.db, "INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (99999, 88888, '2026-01-01')")
    ).rejects.toThrow(/FOREIGN KEY/i);

    // 恢复内容本身完好：绑定行按备份回来了
    const folder = await get<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_folders WHERE folderPath = ?', [normalizePath('M:/con/root')]);
    expect(folder?.galleryId).toBe(gid);
  });
});
