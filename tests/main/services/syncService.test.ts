import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';

/**
 * syncService（安卓相册 M1，spec §5.3）——移动端元数据同步核心接口的服务层。
 *
 * 用真实 :memory: sqlite 落库（照抄 Task 2 的 setupSchema：images/tags/image_tags/
 * galleries/gallery_images），只覆写 database.getDatabase 指向内存库、config 提供固定
 * serverId/dataVersion。不安装同步触碰触发器——避免 image_tags/gallery_images 写入触碰
 * updatedAt 破坏本测试精心构造的游标边界种子。
 *
 * 种子 4 张图：image2 与 image3 的 updatedAt 完全相同，令 limit=2 的分页边界恰好落在
 * 这两张之间，一并覆盖「(updatedAt,id) 键集分页」与「同 updatedAt 多行按 id 决胜跨页不丢不重」。
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
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
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

// image2 与 image3 共享 updatedAt（'2024-01-02'），令 limit=2 边界落在两者之间
const SEED = [
  { filename: '1.jpg', updatedAt: '2024-01-01T00:00:00.000Z' },
  { filename: '2.jpg', updatedAt: '2024-01-02T00:00:00.000Z' },
  { filename: '3.jpg', updatedAt: '2024-01-02T00:00:00.000Z' },
  { filename: '4.jpg', updatedAt: '2024-01-04T00:00:00.000Z' },
];

async function seed(): Promise<void> {
  for (const row of SEED) {
    await run(
      h.db,
      `INSERT INTO images (filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
       VALUES (?, ?, 100, 800, 600, 'jpg', '2024-01-01T00:00:00.000Z', ?)`,
      [row.filename, row.filename, row.updatedAt]
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
  let cursor: { u: string; i: number } | null = null;
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
  it('meta：serverId/dataVersion/imageCount/latestCursor', async () => {
    const meta = await getSyncMeta();
    expect(meta).toMatchObject({ serverId: 'srv-1', dataVersion: 3, imageCount: 4 });
    expect(decodeSyncCursor(meta.latestCursor!)).toEqual({ u: '2024-01-04T00:00:00.000Z', i: 4 });
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

  it('游标编解码往返 + 非法游标返回 null', () => {
    const c = encodeSyncCursor('2024-01-01T00:00:00.000Z', 7);
    expect(decodeSyncCursor(c)).toEqual({ u: '2024-01-01T00:00:00.000Z', i: 7 });
    expect(decodeSyncCursor('not-base64!')).toBeNull();
    // 合法 base64url 但形状不符（缺 u/i）→ null
    expect(decodeSyncCursor(Buffer.from('{"x":1}').toString('base64url'))).toBeNull();
    // u 非字符串 / i 非整数 → null
    expect(decodeSyncCursor(Buffer.from('{"u":1,"i":2}').toString('base64url'))).toBeNull();
    expect(decodeSyncCursor(Buffer.from('{"u":"a","i":1.5}').toString('base64url'))).toBeNull();
    // i 非正整数（<=0）→ null
    expect(
      decodeSyncCursor(Buffer.from('{"u":"2024-01-01T00:00:00.000Z","i":0}').toString('base64url')),
    ).toBeNull();
    expect(
      decodeSyncCursor(Buffer.from('{"u":"2024-01-01T00:00:00.000Z","i":-1}').toString('base64url')),
    ).toBeNull();
    // u 非项目 ISO 时间戳格式（YYYY-MM-DDTHH:mm:ss.sssZ）→ null
    expect(decodeSyncCursor(Buffer.from('{"u":"2024-01-01","i":1}').toString('base64url'))).toBeNull();
    expect(
      decodeSyncCursor(Buffer.from('{"u":"2024-01-01T00:00:00Z","i":1}').toString('base64url')),
    ).toBeNull();
    expect(
      decodeSyncCursor(Buffer.from('{"u":"not-a-timestamp","i":1}').toString('base64url')),
    ).toBeNull();
  });

  it('空游标全量升序分页，(updatedAt,id) 排序，limit+1 探测 hasMore', async () => {
    const page1 = await listSyncImages(null, 2);
    expect(page1.items.map((i) => i.id)).toEqual([1, 2]);
    expect(page1.hasMore).toBe(true);

    const page2 = await listSyncImages(decodeSyncCursor(page1.nextCursor!), 2);
    expect(page2.items.map((i) => i.id)).toEqual([3, 4]);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).not.toBeNull();
  });

  it('同 updatedAt 多行按 id 决胜且跨页不丢不重', async () => {
    // limit=2 边界落在 image2/image3（同 updatedAt）之间：键集谓词须用 id 决胜跨页
    const byTwo = await collectAllIds(2);
    expect(byTwo).toEqual([1, 2, 3, 4]);
    expect(new Set(byTwo).size).toBe(4);

    // limit=1 每页一行也不丢不重
    const byOne = await collectAllIds(1);
    expect(byOne).toEqual([1, 2, 3, 4]);
    expect(new Set(byOne).size).toBe(4);
  });

  it('items 携带 tagIds/galleryIds，无 filepath 字段', async () => {
    const { items } = await listSyncImages(null, 10);
    const withTag = items.find((i) => i.tagIds.length > 0)!;
    expect(withTag.tagIds).toEqual([1, 2]);
    expect(withTag.galleryIds).toEqual([1]);
    // 载荷不含 filepath（spec §5.3）——逐项断言，杜绝本地路径经同步接口外泄
    for (const item of items) {
      expect('filepath' in item).toBe(false);
    }
    // 无标签/图集的图片映射为空数组
    const noTag = items.find((i) => i.id === 4)!;
    expect(noTag.tagIds).toEqual([]);
    expect(noTag.galleryIds).toEqual([]);
  });

  it('galleries/tags/image-ids 全量', async () => {
    expect(await listSyncGalleries()).toEqual([{ id: 1, name: 'g1', coverImageId: null, imageCount: 0 }]);
    expect(await listSyncTags()).toEqual([
      { id: 1, name: 't1', category: null },
      { id: 2, name: 't2', category: null },
    ]);
    expect(await listSyncImageIds()).toEqual([1, 2, 3, 4]);
  });
});
