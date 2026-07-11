import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';

/**
 * getGalleries/getGallery 有效封面（v0.6 封面能力包，安卓 spec §6.2/§8.3）：
 * 「/galleries 列表与 sync 口径一致」——显式 coverImageId ?? 最近加入（gallery_images.addedAt
 * DESC, imageId DESC），空相册为 null；只发生在读侧、不回写。
 * 补 T3 规格审指出的覆盖缺口：此前该 SQL（JOIN ON 内相关子查询）无任何直测。
 * 装置与 galleryService.setCover.test.ts 同款。
 */

const h = vi.hoisted(() => ({ db: null as unknown as import('sqlite3').Database }));

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
  emitGalleryImagesChanged: vi.fn(),
}));

vi.mock('../../../src/main/services/galleryRootRegistry.js', () => ({
  addGalleryRoot: vi.fn(),
  removeGalleryRoot: vi.fn(),
}));

import { run } from '../../../src/main/services/database';
import { getGalleries, getGallery } from '../../../src/main/services/galleryService';

async function setupSchema(): Promise<void> {
  await run(h.db, `CREATE TABLE images (
    id INTEGER PRIMARY KEY, filename TEXT NOT NULL, filepath TEXT NOT NULL UNIQUE,
    fileSize INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, format TEXT NOT NULL,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
  await run(h.db, `CREATE TABLE galleries (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, coverImageId INTEGER,
    imageCount INTEGER DEFAULT 0, lastScannedAt TEXT, autoScan INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
  await run(h.db, `CREATE TABLE gallery_images (
    galleryId INTEGER NOT NULL, imageId INTEGER NOT NULL, addedAt TEXT NOT NULL,
    PRIMARY KEY (galleryId, imageId))`);
}

async function seed(): Promise<void> {
  await run(h.db, `INSERT INTO images (id, filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
    VALUES (10, 'a.jpg', 'a.jpg', 1, 1, 1, 'jpg', '2026-01-01', '2026-01-01'),
           (20, 'b.jpg', 'b.jpg', 1, 1, 1, 'jpg', '2026-01-01', '2026-01-01'),
           (30, 'c.jpg', 'c.jpg', 1, 1, 1, 'jpg', '2026-01-01', '2026-01-01')`);
  // g1 显式封面 10；g2 无显式、成员 20(早)/30(晚) → 兜底 30；g3 空相册
  await run(h.db, `INSERT INTO galleries (id, name, coverImageId, imageCount, createdAt, updatedAt)
    VALUES (1, 'explicit', 10, 2, '2026-01-01', '2026-01-01'),
           (2, 'fallback', NULL, 2, '2026-01-02', '2026-01-02'),
           (3, 'empty', NULL, 0, '2026-01-03', '2026-01-03')`);
  await run(h.db, `INSERT INTO gallery_images (galleryId, imageId, addedAt)
    VALUES (1, 10, '2026-01-01'), (1, 20, '2026-01-05'),
           (2, 20, '2026-01-01'), (2, 30, '2026-01-05')`);
}

describe('getGalleries/getGallery 有效封面（v0.6 spec §6.2）', () => {
  beforeEach(async () => {
    h.db = new sqlite3.Database(':memory:');
    await setupSchema();
    await seed();
  });
  afterEach(() => { h.db.close(); });

  it('getGalleries：显式封面原样、无显式回落最近加入、空相册为空', async () => {
    const result = await getGalleries();
    expect(result.success).toBe(true);
    const byId = new Map(result.data!.map((g) => [g.id, g]));
    expect(byId.get(1)?.coverImageId).toBe(10);          // 显式优先（成员 20 加入更晚也不覆盖）
    expect(byId.get(1)?.coverImage?.filename).toBe('a.jpg');
    expect(byId.get(2)?.coverImageId).toBe(30);          // 兜底取 addedAt 最晚
    expect(byId.get(2)?.coverImage?.filename).toBe('c.jpg');
    expect(byId.get(3)?.coverImageId ?? null).toBeNull(); // 空相册无封面
    expect(byId.get(3)?.coverImage).toBeUndefined();
  });

  it('getGallery：单查与列表同口径', async () => {
    const fallback = await getGallery(2);
    expect(fallback.success).toBe(true);
    expect(fallback.data?.coverImageId).toBe(30);
    const empty = await getGallery(3);
    expect(empty.data?.coverImageId ?? null).toBeNull();
  });

  it('兜底不回写数据库（读侧行为）', async () => {
    await getGalleries();
    const row = await new Promise<{ coverImageId: number | null }>((resolve, reject) => {
      h.db.get('SELECT coverImageId FROM galleries WHERE id = 2', (err, r) => (err ? reject(err) : resolve(r as { coverImageId: number | null })));
    });
    expect(row.coverImageId).toBeNull();
  });

  it('显式封面被移出相册后回落兜底；全员移出后为空（审查 major 回归）', async () => {
    // g1 显式封面 10 的成员行删除（images 行仍在，模拟「移出相册」）→ 回落最近加入的成员 20
    await run(h.db, 'DELETE FROM gallery_images WHERE galleryId = 1 AND imageId = 10');
    const stale = await getGallery(1);
    expect(stale.data?.coverImageId).toBe(20);
    expect(stale.data?.coverImage?.filename).toBe('b.jpg');
    // 剩余成员也移出 → 有效封面为空，不得下发残留的非成员 coverImageId
    await run(h.db, 'DELETE FROM gallery_images WHERE galleryId = 1');
    const empty = await getGallery(1);
    expect(empty.data?.coverImageId ?? null).toBeNull();
    expect(empty.data?.coverImage).toBeUndefined();
  });

  it('explicitCoverImageId 透出显式封面原值，供渲染层区分兜底（置灰/自动补写门）', async () => {
    const result = await getGalleries();
    const byId = new Map(result.data!.map((g) => [g.id, g]));
    expect(byId.get(1)?.explicitCoverImageId).toBe(10);   // 显式
    expect(byId.get(2)?.explicitCoverImageId).toBeNull(); // 兜底：有效封面 30 但显式为空
    const single = await getGallery(2);
    expect(single.data?.explicitCoverImageId).toBeNull();
    expect(single.data?.coverImageId).toBe(30);
  });
});
