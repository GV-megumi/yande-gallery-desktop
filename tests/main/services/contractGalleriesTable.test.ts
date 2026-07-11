import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';

/**
 * Phase 8A — contract 迁移：重建 galleries 表（删旧列、isWatching→autoScan、保 FK）
 *
 * contractGalleriesTable(db) 用 SQLite「建新表 → 拷数据 → 删旧表 → 改名」的
 * FK 保留式重建，把旧 galleries（含 folderPath/isWatching/recursive/extensions）
 * 升级为新结构（autoScan，旧列全删）。
 *
 * 验证（真实 :memory: sqlite）：
 *  - 新列 autoScan 存在；folderPath/isWatching/recursive/extensions 不存在；
 *  - id 保留、autoScan === COALESCE(isWatching,1)；
 *  - foreign_key_check 干净，引用 galleries 的子表行（gallery_folders /
 *    gallery_images / booru_favorite_tag_download_bindings / invalid_images）完好；
 *  - 幂等：再次运行无副作用（folderPath 已不存在则直接跳过）；
 *  - 新结构 DB（无 folderPath）直接跳过、不报错。
 */

const h: { db: sqlite3.Database } = { db: null as unknown as sqlite3.Database };

import { run, get, all, columnExists, runInTransaction } from '../../../src/main/services/database';
import { contractGalleriesTable } from '../../../src/main/services/database';

// ---- 旧结构 schema + 引用子表（与生产 initDatabase 旧版本一致的关键列） ----
async function setupOldSchema(): Promise<void> {
  await run(h.db, 'PRAGMA foreign_keys=ON');

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

  // 旧 galleries：含 folderPath/isWatching/recursive/extensions
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

  await run(h.db, `
    CREATE TABLE booru_favorite_tag_download_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      favoriteTagId INTEGER NOT NULL UNIQUE,
      galleryId INTEGER,
      downloadPath TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (galleryId) REFERENCES galleries(id) ON DELETE SET NULL
    )
  `);

  await run(h.db, `
    CREATE TABLE invalid_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      originalImageId INTEGER NOT NULL,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      detectedAt TEXT NOT NULL,
      galleryId INTEGER,
      FOREIGN KEY (galleryId) REFERENCES galleries(id) ON DELETE SET NULL
    )
  `);
}

async function seedOldData(): Promise<void> {
  // 图片
  await run(h.db, `INSERT INTO images (id, filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
                   VALUES (1, 'a.jpg', 'M:\\g1\\a.jpg', 0, 0, 0, 'jpg', 't', 't')`);
  await run(h.db, `INSERT INTO images (id, filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
                   VALUES (2, 'b.jpg', 'M:\\g2\\b.jpg', 0, 0, 0, 'jpg', 't', 't')`);

  // 旧相册：g1 isWatching=1，g2 isWatching=0，g3 isWatching=NULL（验证 COALESCE → 1）
  await run(h.db, `INSERT INTO galleries (id, folderPath, name, coverImageId, imageCount, lastScannedAt, isWatching, recursive, extensions, createdAt, updatedAt)
                   VALUES (1, 'M:\\g1', 'G1', 1, 5, 'ls1', 1, 1, '[".jpg"]', 'c1', 'u1')`);
  await run(h.db, `INSERT INTO galleries (id, folderPath, name, coverImageId, imageCount, lastScannedAt, isWatching, recursive, extensions, createdAt, updatedAt)
                   VALUES (2, 'M:\\g2', 'G2', NULL, 0, NULL, 0, 0, '[".png"]', 'c2', 'u2')`);
  await run(h.db, `INSERT INTO galleries (id, folderPath, name, coverImageId, imageCount, lastScannedAt, isWatching, recursive, extensions, createdAt, updatedAt)
                   VALUES (3, 'M:\\g3', 'G3', NULL, 0, NULL, NULL, 1, NULL, 'c3', 'u3')`);

  // 引用子表行（验证重建后 FK 仍指向保留的 id）
  await run(h.db, `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
                   VALUES (1, 'M:\\g1', 1, '[".jpg"]', 'c', 'u')`);
  await run(h.db, `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
                   VALUES (2, 'M:\\g2', 0, '[".png"]', 'c', 'u')`);
  await run(h.db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (1, 1, 'a')`);
  await run(h.db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (2, 2, 'a')`);
  await run(h.db, `INSERT INTO booru_favorite_tag_download_bindings (favoriteTagId, galleryId, downloadPath, enabled, createdAt, updatedAt)
                   VALUES (10, 1, 'M:\\g1', 1, 'c', 'u')`);
  await run(h.db, `INSERT INTO invalid_images (originalImageId, filename, filepath, detectedAt, galleryId)
                   VALUES (99, 'x.jpg', 'M:\\g2\\x.jpg', 'd', 2)`);
}

function openMemoryDb(): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
}

beforeEach(async () => {
  h.db = await openMemoryDb();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('contractGalleriesTable — 重建 galleries（删旧列、isWatching→autoScan、保 FK）', () => {
  it('删除 folderPath/isWatching/recursive/extensions，新增 autoScan', async () => {
    await setupOldSchema();
    await seedOldData();

    await contractGalleriesTable(h.db);

    expect(await columnExists(h.db, 'galleries', 'autoScan')).toBe(true);
    expect(await columnExists(h.db, 'galleries', 'folderPath')).toBe(false);
    expect(await columnExists(h.db, 'galleries', 'isWatching')).toBe(false);
    expect(await columnExists(h.db, 'galleries', 'recursive')).toBe(false);
    expect(await columnExists(h.db, 'galleries', 'extensions')).toBe(false);
  });

  it('保留 id，且 autoScan === COALESCE(isWatching, 1)', async () => {
    await setupOldSchema();
    await seedOldData();

    await contractGalleriesTable(h.db);

    const rows = await all<{ id: number; name: string; autoScan: number; imageCount: number; lastScannedAt: string | null }>(
      h.db,
      'SELECT id, name, autoScan, imageCount, lastScannedAt FROM galleries ORDER BY id'
    );
    expect(rows.map(r => r.id)).toEqual([1, 2, 3]);
    expect(rows.map(r => r.name)).toEqual(['G1', 'G2', 'G3']);
    // g1 isWatching=1 → 1；g2 isWatching=0 → 0；g3 isWatching=NULL → COALESCE → 1
    expect(rows.map(r => r.autoScan)).toEqual([1, 0, 1]);
    // 其它保留列原样
    expect(rows[0].imageCount).toBe(5);
    expect(rows[0].lastScannedAt).toBe('ls1');
  });

  it('foreign_key_check 干净，引用子表行完好', async () => {
    await setupOldSchema();
    await seedOldData();

    await contractGalleriesTable(h.db);

    const violations = await all(h.db, 'PRAGMA foreign_key_check');
    expect(violations).toEqual([]);

    // 子表行仍在，FK 仍指向保留的 galleryId
    const folders = await all<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_folders ORDER BY galleryId');
    expect(folders.map(f => f.galleryId)).toEqual([1, 2]);
    const members = await all<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_images ORDER BY galleryId');
    expect(members.map(m => m.galleryId)).toEqual([1, 2]);
    const binding = await get<{ galleryId: number }>(h.db, 'SELECT galleryId FROM booru_favorite_tag_download_bindings WHERE favoriteTagId = 10');
    expect(binding?.galleryId).toBe(1);
    const invalid = await get<{ galleryId: number }>(h.db, 'SELECT galleryId FROM invalid_images WHERE originalImageId = 99');
    expect(invalid?.galleryId).toBe(2);
  });

  it('幂等：再次运行不报错且结果不变（folderPath 已删则跳过）', async () => {
    await setupOldSchema();
    await seedOldData();

    await contractGalleriesTable(h.db);
    // 第二次运行应为 no-op（folderPath 列已不存在）
    await contractGalleriesTable(h.db);

    expect(await columnExists(h.db, 'galleries', 'autoScan')).toBe(true);
    expect(await columnExists(h.db, 'galleries', 'folderPath')).toBe(false);
    const rows = await all<{ id: number; autoScan: number }>(h.db, 'SELECT id, autoScan FROM galleries ORDER BY id');
    expect(rows.map(r => r.id)).toEqual([1, 2, 3]);
    expect(rows.map(r => r.autoScan)).toEqual([1, 0, 1]);
  });

  it('新结构 DB（无 folderPath）直接跳过、不报错', async () => {
    // 直接建新结构（无旧列）
    await run(h.db, 'PRAGMA foreign_keys=ON');
    await run(h.db, `
      CREATE TABLE galleries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        coverImageId INTEGER,
        imageCount INTEGER DEFAULT 0,
        lastScannedAt TEXT,
        autoScan INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    await run(h.db, `INSERT INTO galleries (id, name, autoScan, createdAt, updatedAt) VALUES (1, 'G', 1, 'c', 'u')`);

    await expect(contractGalleriesTable(h.db)).resolves.toBeUndefined();

    expect(await columnExists(h.db, 'galleries', 'autoScan')).toBe(true);
    expect(await columnExists(h.db, 'galleries', 'folderPath')).toBe(false);
    const row = await get<{ id: number; autoScan: number }>(h.db, 'SELECT id, autoScan FROM galleries WHERE id = 1');
    expect(row?.autoScan).toBe(1);
  });
});

describe('contractGalleriesTable — 与并发事务互斥（transactionQueues 独占）', () => {
  it('与 runInTransaction 排队事务交错时严格串行：排队事务原子提交，contract 排队后正常完成', async () => {
    await setupOldSchema();
    await seedOldData();

    const order: string[] = [];
    let releaseTx!: () => void;
    const txGate = new Promise<void>((resolve) => { releaseTx = resolve; });
    let notifyTxStarted!: () => void;
    const txStarted = new Promise<void>((resolve) => { notifyTxStarted = resolve; });

    // 模拟 finding 场景：升级首启窗口内渲染层触发的排队事务（如 reportInvalidImage：
    // 先写 invalid_images，再删 images 行），contract 必须等它提交后再跑
    const queuedTx = runInTransaction(h.db, async () => {
      order.push('tx-start');
      await run(h.db, `INSERT INTO invalid_images (originalImageId, filename, filepath, detectedAt, galleryId)
                       VALUES (100, 'y.jpg', 'M:\\g1\\y.jpg', 'd', 1)`);
      notifyTxStarted();
      await txGate;
      await run(h.db, 'DELETE FROM images WHERE id = 1');
      order.push('tx-end');
    });

    await txStarted;

    // 排队事务尚未提交时启动 contract：修复前裸 BEGIN 直接撞上进行中的事务并盲 ROLLBACK
    const contract = contractGalleriesTable(h.db).then(() => { order.push('contract-end'); });

    // 给 contract 一个抢跑窗口（若它未排队，此期间就会撞车）
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseTx();

    await expect(Promise.all([queuedTx, contract])).resolves.toBeDefined();
    expect(order).toEqual(['tx-start', 'tx-end', 'contract-end']);

    // 排队事务的两步原子生效：invalid_images 有记录、images 行已删
    expect(await get(h.db, 'SELECT 1 AS x FROM invalid_images WHERE originalImageId = 100')).toBeDefined();
    expect(await get(h.db, 'SELECT 1 AS x FROM images WHERE id = 1')).toBeUndefined();
    // contract 已完成：新结构 + FK 干净
    expect(await columnExists(h.db, 'galleries', 'folderPath')).toBe(false);
    expect(await columnExists(h.db, 'galleries', 'autoScan')).toBe(true);
    expect(await all(h.db, 'PRAGMA foreign_key_check')).toEqual([]);
  });

  it('BEGIN 失败（独占段外已有裸事务）时不发 ROLLBACK，不摧毁对方进行中的事务', async () => {
    await setupOldSchema();
    await seedOldData();

    // 队列外手动开事务，模拟绕过 transactionQueues 的并发者占用连接
    await run(h.db, 'BEGIN');
    await run(h.db, `INSERT INTO invalid_images (originalImageId, filename, filepath, detectedAt, galleryId)
                     VALUES (200, 'm.jpg', 'M:\\g1\\m.jpg', 'd', 1)`);

    // contract 的 BEGIN 撞上外部裸事务而失败，应干净报错
    await expect(contractGalleriesTable(h.db)).rejects.toThrow(/within a transaction/i);

    // 关键断言：contract 未发 ROLLBACK——外部事务仍在进行中，可继续写入并提交
    await run(h.db, `INSERT INTO invalid_images (originalImageId, filename, filepath, detectedAt, galleryId)
                     VALUES (201, 'n.jpg', 'M:\\g1\\n.jpg', 'd', 1)`);
    // 若被盲 ROLLBACK，这里会抛 cannot commit - no transaction is active
    await run(h.db, 'COMMIT');

    const rows = await all<{ originalImageId: number }>(
      h.db,
      'SELECT originalImageId FROM invalid_images WHERE originalImageId IN (200, 201) ORDER BY originalImageId'
    );
    expect(rows.map(r => r.originalImageId)).toEqual([200, 201]);
    // contract 整体未执行：galleries 仍为旧结构，下次启动可安全重跑
    expect(await columnExists(h.db, 'galleries', 'folderPath')).toBe(true);
  });

  it('并发双跑防护：两个 contract 同时发起，后进入独占段者重检后安全跳过', async () => {
    await setupOldSchema();
    await seedOldData();

    // 模拟主进程 initDatabase 与渲染层挂载时再次 db.init 的并发双跑
    await expect(Promise.all([
      contractGalleriesTable(h.db),
      contractGalleriesTable(h.db),
    ])).resolves.toBeDefined();

    expect(await columnExists(h.db, 'galleries', 'folderPath')).toBe(false);
    const rows = await all<{ id: number; autoScan: number }>(h.db, 'SELECT id, autoScan FROM galleries ORDER BY id');
    expect(rows.map(r => r.id)).toEqual([1, 2, 3]);
    expect(rows.map(r => r.autoScan)).toEqual([1, 0, 1]);
    expect(await all(h.db, 'PRAGMA foreign_key_check')).toEqual([]);
  });
});
