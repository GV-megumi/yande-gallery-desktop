import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';

// ensureChangeSeqMigration 首次迁移会动态 import config.js 并 bumpSyncDataVersion；
// mock 之——测试只关心「有没有 bump、bump 几次」，绝不落真实配置盘。
vi.mock('../../../src/main/services/config.js', () => ({
  bumpSyncDataVersion: vi.fn(),
}));

import {
  run,
  get,
  all,
  ensureSyncTouchTriggers,
  ensureChangeSeqMigration,
  nextChangeSeq,
} from '../../../src/main/services/database.js';
import { bumpSyncDataVersion } from '../../../src/main/services/config.js';

let db: sqlite3.Database;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// setupSchema 不预加 changeSeq 列——由 ensureChangeSeqMigration 的 ALTER 负责，
// 测的才是真迁移路径（生产 initDatabase 的 images 建表同样无 changeSeq 列）。
async function setupSchemaOn(target: sqlite3.Database): Promise<void> {
  await run(target, `CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, filepath TEXT NOT NULL UNIQUE,
    fileSize INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, format TEXT NOT NULL,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
  await run(target, `CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, category TEXT, createdAt TEXT NOT NULL)`);
  await run(target, `CREATE TABLE image_tags (
    imageId INTEGER NOT NULL, tagId INTEGER NOT NULL, PRIMARY KEY (imageId, tagId),
    FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE,
    FOREIGN KEY (tagId) REFERENCES tags (id) ON DELETE CASCADE)`);
  await run(target, `CREATE TABLE galleries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, coverImageId INTEGER,
    imageCount INTEGER DEFAULT 0, lastScannedAt TEXT, autoScan INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (coverImageId) REFERENCES images (id) ON DELETE SET NULL)`);
  await run(target, `CREATE TABLE gallery_images (
    galleryId INTEGER NOT NULL, imageId INTEGER NOT NULL, addedAt TEXT NOT NULL,
    PRIMARY KEY (galleryId, imageId),
    FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE,
    FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE)`);
}

const OLD = '2020-01-01T00:00:00.000Z';

async function newMemoryDb(): Promise<sqlite3.Database> {
  return new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
}

// 镜像生产 imageService.addImage 路径：INSERT 显式携带 nextChangeSeq 分配值
// （images 无 INSERT 触发器；UNIQUE 索引下靠 DEFAULT 0 第二次插入即崩）。
async function addImage(filepath: string): Promise<number> {
  const seq = await nextChangeSeq(db);
  await run(db, `INSERT INTO images (filename, filepath, fileSize, width, height, format, createdAt, updatedAt, changeSeq)
    VALUES (?, ?, 0, 0, 0, 'jpg', ?, ?, ?)`, [filepath, filepath, OLD, OLD, seq]);
  const row = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function addGallery(name: string): Promise<number> {
  await run(db, `INSERT INTO galleries (name, createdAt, updatedAt) VALUES (?, ?, ?)`, [name, OLD, OLD]);
  const row = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function updatedAtOf(id: number): Promise<string> {
  const row = await get<{ updatedAt: string }>(db, 'SELECT updatedAt FROM images WHERE id = ?', [id]);
  return row!.updatedAt;
}

beforeEach(async () => {
  db = await newMemoryDb();
  await run(db, 'PRAGMA foreign_keys=ON');
  await setupSchemaOn(db);
  await ensureChangeSeqMigration(db); // 空表上 ALTER 加列 + 建序列表
  await ensureSyncTouchTriggers(db);
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
});

describe('ensureSyncTouchTriggers', () => {
  it('图集成员 INSERT 触碰 images.updatedAt，格式与 toISOString 一致', async () => {
    const imageId = await addImage('/a/1.jpg');
    const galleryId = await addGallery('g1');
    await run(db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, ?)`, [galleryId, imageId, OLD]);
    const touched = await updatedAtOf(imageId);
    expect(touched).not.toBe(OLD);
    expect(touched).toMatch(ISO_RE);
    expect(touched > OLD).toBe(true);
  });

  it('INSERT OR IGNORE 命中重复不触碰（幂等重扫不churn）', async () => {
    const imageId = await addImage('/a/1.jpg');
    const galleryId = await addGallery('g1');
    await run(db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, ?)`, [galleryId, imageId, OLD]);
    const after = await updatedAtOf(imageId);
    await run(db, `UPDATE images SET updatedAt = ? WHERE id = ?`, [OLD, imageId]);
    await run(db, `INSERT OR IGNORE INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, ?)`, [galleryId, imageId, OLD]);
    expect(await updatedAtOf(imageId)).toBe(OLD);
    expect(after).toMatch(ISO_RE);
  });

  it('DELETE FROM galleries 的 FK CASCADE 触碰幸存成员', async () => {
    const imageId = await addImage('/a/1.jpg');
    const galleryId = await addGallery('g1');
    await run(db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, ?)`, [galleryId, imageId, OLD]);
    await run(db, `UPDATE images SET updatedAt = ? WHERE id = ?`, [OLD, imageId]);
    await run(db, 'DELETE FROM galleries WHERE id = ?', [galleryId]);
    expect(await updatedAtOf(imageId)).not.toBe(OLD);
  });

  it('image_tags INSERT 与 DELETE 均触碰', async () => {
    const imageId = await addImage('/a/1.jpg');
    await run(db, `INSERT INTO tags (name, createdAt) VALUES ('t1', ?)`, [OLD]);
    await run(db, `INSERT INTO image_tags (imageId, tagId) VALUES (?, 1)`, [imageId]);
    expect(await updatedAtOf(imageId)).not.toBe(OLD);
    await run(db, `UPDATE images SET updatedAt = ? WHERE id = ?`, [OLD, imageId]);
    await run(db, `DELETE FROM image_tags WHERE imageId = ? AND tagId = 1`, [imageId]);
    expect(await updatedAtOf(imageId)).not.toBe(OLD);
  });

  it('重复调用幂等', async () => {
    await ensureSyncTouchTriggers(db);
    await ensureSyncTouchTriggers(db);
  });

  it('触发器 bump：跨多次触碰单调递增且互不重复（含 CASCADE 删除路径）', async () => {
    const a = await addImage('/a/1.jpg');
    const b = await addImage('/a/2.jpg');
    const g = await addGallery('g1');
    await run(db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, ?)`, [g, a, OLD]);
    await run(db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, ?)`, [g, b, OLD]);
    await run(db, `DELETE FROM galleries WHERE id = ?`, [g]); // FK CASCADE → AD 触发器逐行 bump
    const seqs = (await all<{ changeSeq: number }>(db, 'SELECT changeSeq FROM images ORDER BY changeSeq')).map(
      (r) => r.changeSeq,
    );
    expect(new Set(seqs).size).toBe(seqs.length); // 全 distinct
    expect([...seqs]).toEqual([...seqs].sort((x, y) => x - y)); // 单调
  });

  it('image_tags 触发器同样 bump changeSeq（AI 与 AD 各一次，覆齐 4 个触发器体）', async () => {
    const imageId = await addImage('/a/1.jpg');
    const seqOf = async () =>
      (await get<{ c: number }>(db, 'SELECT changeSeq AS c FROM images WHERE id = ?', [imageId]))!.c;
    const seq0 = await seqOf();
    await run(db, `INSERT INTO tags (name, createdAt) VALUES ('t1', ?)`, [OLD]);
    await run(db, `INSERT INTO image_tags (imageId, tagId) VALUES (?, 1)`, [imageId]);
    const seq1 = await seqOf();
    expect(seq1).toBeGreaterThan(seq0);
    await run(db, `DELETE FROM image_tags WHERE imageId = ? AND tagId = 1`, [imageId]);
    expect(await seqOf()).toBeGreaterThan(seq1);
  });

  it('nextChangeSeq 与触发器共用同一计数器不回退', async () => {
    const a = await addImage('/a/1.jpg');
    const g = await addGallery('g1');
    await run(db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, ?)`, [g, a, OLD]);
    const afterTrigger = (await get<{ c: number }>(db, 'SELECT changeSeq AS c FROM images WHERE id = ?', [a]))!.c;
    const next = await nextChangeSeq(db);
    expect(next).toBeGreaterThan(afterTrigger);
  });
});

describe('ensureChangeSeqMigration', () => {
  it('迁移回填：按 (updatedAt,id) 序 ROW_NUMBER，交错种子回填值正确且互异', async () => {
    // 本用例自建独立库：回填必须发生在「已有存量行」的库上，不能用 beforeEach 的空表迁移
    const local = await newMemoryDb();
    try {
      await run(local, 'PRAGMA foreign_keys=ON');
      await setupSchemaOn(local); // 无 changeSeq 列
      // 交错种子：id 序与 updatedAt 序不一致
      await run(local, `INSERT INTO images (id, filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
        VALUES (1, '1.jpg', '1.jpg', 0, 0, 0, 'jpg', ?, '2024-01-03T00:00:00.000Z')`, [OLD]);
      await run(local, `INSERT INTO images (id, filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
        VALUES (2, '2.jpg', '2.jpg', 0, 0, 0, 'jpg', ?, '2024-01-01T00:00:00.000Z')`, [OLD]);
      await run(local, `INSERT INTO images (id, filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
        VALUES (3, '3.jpg', '3.jpg', 0, 0, 0, 'jpg', ?, '2024-01-02T00:00:00.000Z')`, [OLD]);
      await ensureChangeSeqMigration(local);
      const rows = await all<{ id: number; changeSeq: number }>(
        local,
        'SELECT id, changeSeq FROM images ORDER BY id',
      );
      // (updatedAt,id) 升序 → id2(01-01)=1, id3(01-02)=2, id1(01-03)=3
      expect(rows).toEqual([
        { id: 1, changeSeq: 3 },
        { id: 2, changeSeq: 1 },
        { id: 3, changeSeq: 2 },
      ]);
      // 序列表初值 = MAX(changeSeq)：迁移后 nextChangeSeq 从存量最大值之后继续
      expect(await nextChangeSeq(local)).toBe(4);
    } finally {
      await new Promise<void>((resolve, reject) => local.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('幂等：首次迁移 bump dataVersion 恰一次，二次调用不重复回填不再 bump', async () => {
    const bumpMock = vi.mocked(bumpSyncDataVersion);
    const local = await newMemoryDb();
    try {
      await run(local, 'PRAGMA foreign_keys=ON');
      await setupSchemaOn(local);
      const before = bumpMock.mock.calls.length;
      await ensureChangeSeqMigration(local);
      expect(bumpMock.mock.calls.length).toBe(before + 1); // 首次迁移 bump 一次
      await ensureChangeSeqMigration(local); // columnExists 门控：二次调用无副作用
      expect(bumpMock.mock.calls.length).toBe(before + 1); // 不再 bump
      const seqRows = await all<{ seq: number }>(local, 'SELECT seq FROM sync_change_seq');
      expect(seqRows).toEqual([{ seq: 0 }]); // 序列表仍单行、不重复播种
    } finally {
      await new Promise<void>((resolve, reject) => local.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('事务恢复契约：迁移半途失败整体回滚（ALTER 不留痕），排障后重试干净完成', async () => {
    // 确定性中途失败注入（走真实代码路径，非 mock）：预置一张 schema 不符的毒表
    // sync_change_seq(wrong)——迁移事务内 ALTER/回填成功后，播种 INSERT 因缺 seq 列失败。
    // 断言的是真契约：失败尝试连 ALTER 一起回滚（columnExists 仍假），下次调用干净重试。
    // 「进程半途崩溃」窗口无法由测试直接制造，由同一事务结构 by construction 覆盖
    // （未提交事务在连接/进程消亡时由 SQLite 自动回滚，与本用例的 ROLLBACK 路径同一终态）。
    const bumpMock = vi.mocked(bumpSyncDataVersion);
    const local = await newMemoryDb();
    try {
      await run(local, 'PRAGMA foreign_keys=ON');
      await setupSchemaOn(local);
      await run(local, `INSERT INTO images (id, filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
        VALUES (1, '1.jpg', '1.jpg', 0, 0, 0, 'jpg', ?, '2024-01-01T00:00:00.000Z')`, [OLD]);
      await run(local, 'CREATE TABLE sync_change_seq (wrong TEXT)'); // 毒表：迫使播种语句失败
      const before = bumpMock.mock.calls.length;

      await expect(ensureChangeSeqMigration(local)).rejects.toThrow();
      // 整体回滚：列不留痕（下次启动 columnExists 门控判「未迁移」）、dataVersion 未 bump
      const cols = await all<{ name: string }>(local, 'PRAGMA table_info(images)');
      expect(cols.some((c) => c.name === 'changeSeq')).toBe(false);
      expect(bumpMock.mock.calls.length).toBe(before);

      // 排障（清掉毒表）后重试：干净完成，回填/播种/索引齐备
      await run(local, 'DROP TABLE sync_change_seq');
      await ensureChangeSeqMigration(local);
      const rows = await all<{ id: number; changeSeq: number }>(local, 'SELECT id, changeSeq FROM images');
      expect(rows).toEqual([{ id: 1, changeSeq: 1 }]);
      expect(bumpMock.mock.calls.length).toBe(before + 1);
      expect(await nextChangeSeq(local)).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) => local.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('nextChangeSeq 对未播种计数器给出明确错误而非裸 TypeError', async () => {
    const local = await newMemoryDb();
    try {
      await run(local, 'CREATE TABLE sync_change_seq (seq INTEGER NOT NULL)'); // 有表无行
      await expect(nextChangeSeq(local)).rejects.toThrow('计数器未初始化');
    } finally {
      await new Promise<void>((resolve, reject) => local.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
