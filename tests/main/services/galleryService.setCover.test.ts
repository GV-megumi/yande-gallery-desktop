import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';

/**
 * setGalleryCover（v0.6 封面能力包，安卓 spec §6.1）：
 *   - 成员校验：封面必须是该相册成员（gallery_images 有行），杜绝跨相册串封面；
 *   - 接受 null：清除显式封面（读侧回落「最近加入」兜底）。
 *
 * 装置沿用 syncService.test.ts 的 :memory: sqlite + mock getDatabase 形态；
 * galleryService 顶部静态依赖（imageService/事件/白名单注册）按同目录
 * galleryService.deleteGallery.test.ts 既有 mock 补齐。
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

import { run, get } from '../../../src/main/services/database';
import { setGalleryCover } from '../../../src/main/services/galleryService';

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
  await run(h.db, `INSERT INTO galleries (id, name, createdAt, updatedAt) VALUES (1, 'g', '2026-01-01', '2026-01-01')`);
  await run(h.db, `INSERT INTO images (id, filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
    VALUES (10, 'a.jpg', 'a.jpg', 1, 1, 1, 'jpg', '2026-01-01', '2026-01-01'),
           (20, 'b.jpg', 'b.jpg', 1, 1, 1, 'jpg', '2026-01-01', '2026-01-01')`);
  await run(h.db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (1, 10, '2026-01-02')`);
}

describe('setGalleryCover（v0.6 封面能力包）', () => {
  beforeEach(async () => {
    h.db = new sqlite3.Database(':memory:');
    await setupSchema();
    await seed();
  });
  afterEach(() => { h.db.close(); });

  it('成员图 → 成功写入', async () => {
    const result = await setGalleryCover(1, 10);
    expect(result.success).toBe(true);
    const row = await get<{ coverImageId: number }>(h.db, 'SELECT coverImageId FROM galleries WHERE id = 1');
    expect(row?.coverImageId).toBe(10);
  });

  it('图片存在但非成员 → 拒绝（spec §6.1 成员校验）', async () => {
    const result = await setGalleryCover(1, 20);
    expect(result).toEqual({ success: false, error: 'Cover image not in gallery' });
  });

  it('图片不存在 → 拒绝', async () => {
    const result = await setGalleryCover(1, 999);
    expect(result).toEqual({ success: false, error: 'Cover image not found' });
  });

  it('null → 清除显式封面（回落读侧兜底）', async () => {
    await setGalleryCover(1, 10);
    const result = await setGalleryCover(1, null);
    expect(result.success).toBe(true);
    const row = await get<{ coverImageId: number | null }>(h.db, 'SELECT coverImageId FROM galleries WHERE id = 1');
    expect(row?.coverImageId).toBeNull();
  });
});
