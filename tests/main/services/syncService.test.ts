import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';

/**
 * syncService（安卓相册 M1，spec §5.3；M4-T16 changeSeq 单调游标）——移动端元数据同步核心接口。
 *
 * 用真实 :memory: sqlite 落库（照抄 Task 2 的 setupSchema：images/tags/image_tags/
 * galleries/gallery_images；images 建表直接带 changeSeq 列——本文件测查询语义，
 * 迁移/回填路径由 database.syncTouchTriggers.test.ts 覆盖），只覆写 database.getDatabase
 * 指向内存库、config 提供固定 serverId/dataVersion。不安装同步触碰触发器——避免
 * image_tags/gallery_images 写入触碰 updatedAt/changeSeq 破坏本测试精心构造的游标边界种子。
 *
 * 种子 4 张图：changeSeq 1..4；image2 与 image3 的 updatedAt 完全相同——用于旧 {u,i}
 * 游标换轨用例与 M1 Issue 1 同毫秒边界复刻用例。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return { ...actual, getDatabase: vi.fn(async () => h.db) };
});

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: () => ({ sync: { serverId: 'srv-1', dataVersion: 3 } }),
  ensureSyncServerId: vi.fn(async () => 'srv-1'),
}));

import { run } from '../../../src/main/services/database';
import {
  encodeSyncCursor,
  decodeSyncCursor,
  getSyncMeta,
  listSyncImages,
  listSyncGalleries,
  listSyncTags,
  listSyncImageIds,
} from '../../../src/main/services/syncService';

async function setupSchema(): Promise<void> {
  await run(h.db, `CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, filepath TEXT NOT NULL UNIQUE,
    fileSize INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, format TEXT NOT NULL,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, changeSeq INTEGER NOT NULL DEFAULT 0)`);
  await run(h.db, `CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, category TEXT, createdAt TEXT NOT NULL)`);
  await run(h.db, `CREATE TABLE image_tags (
    imageId INTEGER NOT NULL, tagId INTEGER NOT NULL, PRIMARY KEY (imageId, tagId),
    FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE,
    FOREIGN KEY (tagId) REFERENCES tags (id) ON DELETE CASCADE)`);
  await run(h.db, `CREATE TABLE galleries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, coverImageId INTEGER,
    imageCount INTEGER DEFAULT 0, lastScannedAt TEXT, autoScan INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (coverImageId) REFERENCES images (id) ON DELETE SET NULL)`);
  await run(h.db, `CREATE TABLE gallery_images (
    galleryId INTEGER NOT NULL, imageId INTEGER NOT NULL, addedAt TEXT NOT NULL,
    PRIMARY KEY (galleryId, imageId),
    FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE,
    FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE)`);
}

// 显式 changeSeq（1..4）；image2 与 image3 仍共享 updatedAt（'2024-01-02'）——
// 用于旧 {u,i} 游标换轨与同毫秒边界用例
const SEED = [
  { filename: '1.jpg', updatedAt: '2024-01-01T00:00:00.000Z', changeSeq: 1 },
  { filename: '2.jpg', updatedAt: '2024-01-02T00:00:00.000Z', changeSeq: 2 },
  { filename: '3.jpg', updatedAt: '2024-01-02T00:00:00.000Z', changeSeq: 3 },
  { filename: '4.jpg', updatedAt: '2024-01-04T00:00:00.000Z', changeSeq: 4 },
];

async function seed(): Promise<void> {
  for (const row of SEED) {
    await run(
      h.db,
      `INSERT INTO images (filename, filepath, fileSize, width, height, format, createdAt, updatedAt, changeSeq)
       VALUES (?, ?, 100, 800, 600, 'jpg', '2024-01-01T00:00:00.000Z', ?, ?)`,
      [row.filename, row.filename, row.updatedAt, row.changeSeq]
    );
  }
  await run(h.db, `INSERT INTO tags (id, name, category, createdAt) VALUES (1, 't1', NULL, '2024-01-01T00:00:00.000Z')`);
  await run(h.db, `INSERT INTO tags (id, name, category, createdAt) VALUES (2, 't2', NULL, '2024-01-01T00:00:00.000Z')`);
  // image1 带 2 个标签
  await run(h.db, `INSERT INTO image_tags (imageId, tagId) VALUES (1, 1)`);
  await run(h.db, `INSERT INTO image_tags (imageId, tagId) VALUES (1, 2)`);
  await run(
    h.db,
    `INSERT INTO galleries (id, name, coverImageId, imageCount, createdAt, updatedAt)
     VALUES (1, 'g1', NULL, 0, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')`
  );
  // image1 归属 gallery1
  await run(h.db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (1, 1, '2024-01-01T00:00:00.000Z')`);
}

async function collectAllIds(limit: number): Promise<number[]> {
  const ids: number[] = [];
  let cursor: ReturnType<typeof decodeSyncCursor> = null;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await listSyncImages(cursor, limit);
    ids.push(...page.items.map((i) => i.id));
    if (!page.hasMore) {
      return ids;
    }
    cursor = decodeSyncCursor(page.nextCursor!);
  }
  throw new Error('cursor pagination did not terminate');
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  await seed();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('syncService', () => {
  it('meta：serverId/dataVersion/imageCount，latestCursor 用 MAX(changeSeq)', async () => {
    const meta = await getSyncMeta();
    expect(meta).toMatchObject({ serverId: 'srv-1', dataVersion: 3, imageCount: 4 });
    expect(decodeSyncCursor(meta.latestCursor!)).toEqual({ s: 4 });
  });

  it('空库：imageCount 0，latestCursor null，images 空页', async () => {
    // 独立分支：清空图片（FK CASCADE 连带清理 image_tags/gallery_images）
    await run(h.db, 'DELETE FROM images');
    const meta = await getSyncMeta();
    expect(meta.imageCount).toBe(0);
    expect(meta.latestCursor).toBeNull();

    const page = await listSyncImages(null, 2000);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });

  it('游标编解码：新形状 {s} 往返，非法仍 null', () => {
    expect(decodeSyncCursor(encodeSyncCursor(7))).toEqual({ s: 7 });
    expect(decodeSyncCursor('not-base64!')).toBeNull();
    expect(decodeSyncCursor(Buffer.from('{"x":1}').toString('base64url'))).toBeNull();
    expect(decodeSyncCursor(Buffer.from('{"s":-1}').toString('base64url'))).toBeNull();
    expect(decodeSyncCursor(Buffer.from('{"s":1.5}').toString('base64url'))).toBeNull();
    // 旧 {u,i} 形状仍走格式校验：非法 → null（合法旧形状的容忍见换轨用例）
    expect(decodeSyncCursor(Buffer.from('{"u":1,"i":2}').toString('base64url'))).toBeNull();
    expect(decodeSyncCursor(Buffer.from('{"u":"a","i":1.5}').toString('base64url'))).toBeNull();
    expect(
      decodeSyncCursor(Buffer.from('{"u":"2024-01-01T00:00:00.000Z","i":0}').toString('base64url')),
    ).toBeNull();
    expect(
      decodeSyncCursor(Buffer.from('{"u":"2024-01-01T00:00:00.000Z","i":-1}').toString('base64url')),
    ).toBeNull();
    expect(decodeSyncCursor(Buffer.from('{"u":"2024-01-01","i":1}').toString('base64url'))).toBeNull();
    expect(
      decodeSyncCursor(Buffer.from('{"u":"2024-01-01T00:00:00Z","i":1}').toString('base64url')),
    ).toBeNull();
    expect(
      decodeSyncCursor(Buffer.from('{"u":"not-a-timestamp","i":1}').toString('base64url')),
    ).toBeNull();
  });

  it('空游标全量升序分页，changeSeq 排序，limit+1 探测 hasMore', async () => {
    const page1 = await listSyncImages(null, 2);
    expect(page1.items.map((i) => i.id)).toEqual([1, 2]);
    expect(page1.hasMore).toBe(true);
    expect(decodeSyncCursor(page1.nextCursor!)).toEqual({ s: 2 });

    const page2 = await listSyncImages(decodeSyncCursor(page1.nextCursor!), 2);
    expect(page2.items.map((i) => i.id)).toEqual([3, 4]);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).not.toBeNull();
  });

  it('同 updatedAt 多行按 changeSeq 全序分页，跨页不丢不重', async () => {
    // limit=2 边界落在 image2/image3（同 updatedAt）之间：changeSeq 全序天然决胜
    const byTwo = await collectAllIds(2);
    expect(byTwo).toEqual([1, 2, 3, 4]);
    expect(new Set(byTwo).size).toBe(4);

    // limit=1 每页一行也不丢不重
    const byOne = await collectAllIds(1);
    expect(byOne).toEqual([1, 2, 3, 4]);
    expect(new Set(byOne).size).toBe(4);
  });

  it('旧 {u,i} 游标容忍：保守水位换轨续传不 422（可能重发由 upsert 吸收，绝不丢未读）', async () => {
    // 客户端持升级前游标 (2024-01-02, id=3)（旧序已读 image1..3）；未读集 {image4(seq4)} → 水位 3
    const legacy = Buffer.from(JSON.stringify({ u: '2024-01-02T00:00:00.000Z', i: 3 }), 'utf8').toString('base64url');
    const cursor = decodeSyncCursor(legacy);
    expect(cursor).not.toBeNull();
    const page = await listSyncImages(cursor, 2000);
    expect(page.items.map((i) => i.id)).toEqual([4]); // 换轨后从 changeSeq>3 续传
  });

  it('旧游标换轨判别：id 序与 updatedAt 序交错时取未读集 MIN(changeSeq)-1，不跳未读行', async () => {
    // 交错种子（模拟 ROW_NUMBER 回填结果）：id1 最新(01-03,seq4)、id2 最旧(01-01,seq1)、
    // id3/id4 同毫秒(01-02,seq2/seq3)——id 序与 changeSeq 序不一致，专测换轨判别式
    await run(h.db, 'DELETE FROM images');
    const rows = [
      { id: 1, u: '2024-01-03T00:00:00.000Z', seq: 4 },
      { id: 2, u: '2024-01-01T00:00:00.000Z', seq: 1 },
      { id: 3, u: '2024-01-02T00:00:00.000Z', seq: 2 },
      { id: 4, u: '2024-01-02T00:00:00.000Z', seq: 3 },
    ];
    for (const r of rows) {
      await run(
        h.db,
        `INSERT INTO images (id, filename, filepath, fileSize, width, height, format, createdAt, updatedAt, changeSeq)
         VALUES (?, ?, ?, 100, 800, 600, 'jpg', ?, ?, ?)`,
        [r.id, `${r.id}.jpg`, `${r.id}.jpg`, r.u, r.u, r.seq],
      );
    }
    // 旧游标 (2024-01-02, id=3)：旧序已读 {id2,id3}，未读 {id4(seq3), id1(seq4)} → 水位 = min(3,4)-1 = 2
    const legacy = decodeSyncCursor(
      Buffer.from(JSON.stringify({ u: '2024-01-02T00:00:00.000Z', i: 3 }), 'utf8').toString('base64url'),
    );
    const page = await listSyncImages(legacy, 2000);
    expect(page.items.map((i) => i.id)).toEqual([4, 1]); // 未读全在、按 changeSeq 序
  });

  it('旧游标全读尽：未读集为空回落 MAX(changeSeq)，返回空页不重放', async () => {
    const legacy = decodeSyncCursor(
      Buffer.from(JSON.stringify({ u: '2024-01-04T00:00:00.000Z', i: 4 }), 'utf8').toString('base64url'),
    );
    const page = await listSyncImages(legacy, 2000);
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('同毫秒边界（M1 Issue 1 复刻）：更小 id 行被触碰后不再被跳过', async () => {
    // 客户端游标已越过 image3（changeSeq=3）；随后 image1（id 更小）被触碰——
    // 旧协议下若触碰写出与游标相同的 updatedAt 毫秒，谓词 (updatedAt>? OR (=? AND id>?)) 会跳过它。
    await run(h.db, `UPDATE images SET updatedAt = '2024-01-02T00:00:00.000Z', changeSeq = 5 WHERE id = 1`);
    const page = await listSyncImages({ s: 3 }, 2000);
    expect(page.items.map((i) => i.id)).toEqual([4, 1]); // changeSeq 4,5——image1 必现，不丢
    expect(decodeSyncCursor(page.nextCursor!)).toEqual({ s: 5 });
  });

  it('items 携带 tagIds/galleryIds，无 filepath/changeSeq 字段', async () => {
    const { items } = await listSyncImages(null, 10);
    const withTag = items.find((i) => i.tagIds.length > 0)!;
    expect(withTag.tagIds).toEqual([1, 2]);
    expect(withTag.galleryIds).toEqual([1]);
    for (const item of items) {
      // 载荷不含 filepath（spec §5.3）——逐项断言，杜绝本地路径经同步接口外泄
      expect('filepath' in item).toBe(false);
      // changeSeq 是游标内部实现，不进载荷（契约不变，android 端无感知）
      expect('changeSeq' in item).toBe(false);
    }
    // 无标签/图集的图片映射为空数组
    const noTag = items.find((i) => i.id === 4)!;
    expect(noTag.tagIds).toEqual([]);
    expect(noTag.galleryIds).toEqual([]);
  });

  it('galleries/tags/image-ids 全量', async () => {
    // v0.6：载荷带 createdAt；g1 无显式封面但有成员 image1 → 有效封面兜底回落 1
    expect(await listSyncGalleries()).toEqual([
      { id: 1, name: 'g1', coverImageId: 1, imageCount: 0, createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    expect(await listSyncTags()).toEqual([
      { id: 1, name: 't1', category: null },
      { id: 2, name: 't2', category: null },
    ]);
    expect(await listSyncImageIds()).toEqual([1, 2, 3, 4]);
  });

  it('listSyncGalleries：有效封面兜底 + createdAt 载荷（v0.6 spec §6.2/§6.3）', async () => {
    // 装置适配：种子 seed() 已建 gallery1 + 成员行，这里清空后按用例自建三图集
    // （DELETE galleries 经 FK CASCADE 连带清 gallery_images），断言与计划一致
    await run(h.db, 'DELETE FROM galleries');
    await run(h.db, `INSERT INTO galleries (id, name, coverImageId, imageCount, createdAt, updatedAt)
      VALUES (1, 'explicit', 2, 2, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
             (2, 'fallback', NULL, 2, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
             (3, 'empty', NULL, 0, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z')`);
    // 种子 images 已有 id 1..4（本文件 seed()）；图集2 两个成员，addedAt 晚者 id=1 应当选
    await run(h.db, `INSERT INTO gallery_images (galleryId, imageId, addedAt)
      VALUES (1, 2, '2026-01-01T00:00:00.000Z'),
             (2, 3, '2026-01-01T00:00:00.000Z'),
             (2, 1, '2026-01-05T00:00:00.000Z')`);
    const rows = await listSyncGalleries();
    expect(rows).toEqual([
      { id: 1, name: 'explicit', coverImageId: 2, imageCount: 2, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, name: 'fallback', coverImageId: 1, imageCount: 2, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 3, name: 'empty', coverImageId: null, imageCount: 0, createdAt: '2026-01-03T00:00:00.000Z' },
    ]);
  });

  it('listSyncGalleries：显式封面被移出图集后回落兜底，不下发非成员封面（审查 major 回归）', async () => {
    await run(h.db, 'DELETE FROM galleries');
    // g1 显式封面 2 但成员只剩 3（2 已被移出，images 行仍在）；g2 显式封面 2 且已无任何成员
    await run(h.db, `INSERT INTO galleries (id, name, coverImageId, imageCount, createdAt, updatedAt)
      VALUES (1, 'stale-cover', 2, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
             (2, 'stale-empty', 2, 0, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`);
    await run(h.db, `INSERT INTO gallery_images (galleryId, imageId, addedAt)
      VALUES (1, 3, '2026-01-01T00:00:00.000Z')`);
    const rows = await listSyncGalleries();
    expect(rows).toEqual([
      { id: 1, name: 'stale-cover', coverImageId: 3, imageCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, name: 'stale-empty', coverImageId: null, imageCount: 0, createdAt: '2026-01-02T00:00:00.000Z' },
    ]);
  });
});
