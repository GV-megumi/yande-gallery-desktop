import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';

/**
 * galleryService.createEmptyGallery / addImagesToGallery / removeImagesFromGallery
 * （M1-T11，移动端相册写接口 spec §5.4）
 *
 * 真实 :memory: sqlite（保留真实 run/get/all/runInTransaction，只覆写 getDatabase），
 * setup 里调用真实 ensureSyncTouchTriggers(db) 以便断言 gallery_images 触发器触碰
 * images.updatedAt。schema 为 Task 2 setupSchema 五表（images/tags/image_tags/
 * galleries/gallery_images）+ gallery_folders（createEmptyGallery 的"无文件夹绑定"
 * 断言需要查它，照抄 galleryService.applyScanPlan.test.ts 的建表语句）。
 *
 * mock 策略：appEventPublisher.js 整体 mock（本测试只关心 emitGalleryGalleriesChanged /
 * emitGalleryImagesChanged 是否被以预期载荷调用，不依赖其真实实现——它最终只是转发到
 * rendererEventBus）；galleryStats.js 用 importOriginal 保留 recalcGalleriesImageCount
 * 真实实现（用于断言 galleries.imageCount 列值经由真实 SQL 重算），仅 spy
 * emitGalleriesStatsUpdated（避免依赖 appEventPublisher 的转发细节）。
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

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryGalleriesChanged: vi.fn(),
  emitGalleryImagesChanged: vi.fn(),
  emitGalleryIgnoredFoldersChanged: vi.fn(),
}));

vi.mock('../../../src/main/services/galleryStats.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/galleryStats.js')>();
  return {
    ...actual,
    emitGalleriesStatsUpdated: vi.fn(),
  };
});

import { run, get, all, ensureSyncTouchTriggers } from '../../../src/main/services/database.js';
import { emitGalleryGalleriesChanged, emitGalleryImagesChanged } from '../../../src/main/services/appEventPublisher.js';
import { emitGalleriesStatsUpdated } from '../../../src/main/services/galleryStats.js';
import {
  createEmptyGallery,
  addImagesToGallery,
  removeImagesFromGallery,
} from '../../../src/main/services/galleryService.js';

const OLD = '2020-01-01T00:00:00.000Z';

async function setupSchema(): Promise<void> {
  // M4-T16 起触发器体引用 images.changeSeq 与 sync_change_seq 计数器，schema 需一并具备
  // （本文件只断言 updatedAt 触碰语义；changeSeq 语义由 database.syncTouchTriggers.test.ts 覆盖）
  await run(h.db, `CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, filepath TEXT NOT NULL UNIQUE,
    fileSize INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, format TEXT NOT NULL,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, changeSeq INTEGER NOT NULL DEFAULT 0)`);
  await run(h.db, `CREATE TABLE sync_change_seq (seq INTEGER NOT NULL)`);
  await run(h.db, `INSERT INTO sync_change_seq (seq) VALUES (0)`);
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
  await run(h.db, `CREATE TABLE gallery_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    galleryId INTEGER NOT NULL,
    folderPath TEXT NOT NULL UNIQUE,
    recursive INTEGER NOT NULL DEFAULT 1,
    extensions TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE)`);
}

async function seedGallery(name: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (name, autoScan, createdAt, updatedAt) VALUES (?, 1, ?, ?)`,
    [name, OLD, OLD],
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function seedImage(filepath: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO images (filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
     VALUES (?, ?, 0, 0, 0, 'jpg', ?, ?)`,
    [filepath, filepath, OLD, OLD],
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function updatedAtOf(imageId: number): Promise<string> {
  const row = await get<{ updatedAt: string }>(h.db, 'SELECT updatedAt FROM images WHERE id = ?', [imageId]);
  return row!.updatedAt;
}

async function imageCountOf(galleryId: number): Promise<number> {
  const row = await get<{ imageCount: number }>(h.db, 'SELECT imageCount FROM galleries WHERE id = ?', [galleryId]);
  return row!.imageCount;
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  await ensureSyncTouchTriggers(h.db);
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('galleryService.createEmptyGallery', () => {
  it('createEmptyGallery 建无文件夹相册并发 created 事件', async () => {
    const result = await createEmptyGallery('  手机新建  ');
    expect(result.success).toBe(true);

    const row = await get<{ name: string; imageCount: number }>(
      h.db,
      'SELECT name, imageCount FROM galleries WHERE id = ?',
      [result.data],
    );
    expect(row).toMatchObject({ name: '手机新建', imageCount: 0 });

    const folders = await all(h.db, 'SELECT * FROM gallery_folders WHERE galleryId = ?', [result.data]);
    expect(folders).toEqual([]);

    expect(emitGalleryGalleriesChanged).toHaveBeenCalledWith({ galleryId: result.data, action: 'created' });
  });

  it('createEmptyGallery 空名 → error', async () => {
    const result = await createEmptyGallery('   ');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(emitGalleryGalleriesChanged).not.toHaveBeenCalled();
  });

  it('createEmptyGallery 不查重名（galleries.name 无 UNIQUE）', async () => {
    const first = await createEmptyGallery('同名');
    const second = await createEmptyGallery('同名');
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.data).not.toBe(second.data);

    const names = (await all<{ name: string }>(h.db, 'SELECT name FROM galleries ORDER BY id')).map((r) => r.name);
    expect(names).toEqual(['同名', '同名']);
  });
});

describe('galleryService.addImagesToGallery', () => {
  it('过滤缺失 id、幂等、重算 imageCount、触碰 updatedAt，发 membershipChanged + statsUpdated', async () => {
    const g = await seedGallery('g1');
    const a = await seedImage('/a/1.jpg');
    const b = await seedImage('/a/2.jpg');

    const result = await addImagesToGallery(g, [a, b, 999]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ added: 2, missingImageIds: [999] });

    expect(await imageCountOf(g)).toBe(2);
    expect(await updatedAtOf(a)).not.toBe(OLD);

    expect(emitGalleryImagesChanged).toHaveBeenCalledWith({
      action: 'membershipChanged',
      galleryId: g,
      affectedGalleryIds: [g],
      affectedImageIds: [a, b],
      affectedCount: 2,
    });
    expect(emitGalleriesStatsUpdated).toHaveBeenCalledWith([g]);

    // 幂等：重加同批（无新增，不应再重复触碰/重复发事件计数之外的副作用）
    vi.clearAllMocks();
    const again = await addImagesToGallery(g, [a, b]);
    expect(again.success).toBe(true);
    expect(again.data).toEqual({ added: 0, missingImageIds: [] });
    // added=0 时无成员变化：不应再发 membershipChanged/statsUpdated
    expect(emitGalleryImagesChanged).not.toHaveBeenCalled();
    expect(emitGalleriesStatsUpdated).not.toHaveBeenCalled();
  });

  it('addImagesToGallery 相册不存在 → Gallery not found', async () => {
    const result = await addImagesToGallery(999, [1, 2]);
    expect(result).toEqual({ success: false, error: 'Gallery not found' });
    expect(emitGalleryImagesChanged).not.toHaveBeenCalled();
    expect(emitGalleriesStatsUpdated).not.toHaveBeenCalled();
  });
});

describe('galleryService.removeImagesFromGallery', () => {
  it('删归属、重算计数、不删 images 行（无孤儿 GC），发 membershipChanged + statsUpdated', async () => {
    const g = await seedGallery('g2');
    const a = await seedImage('/b/1.jpg');
    await addImagesToGallery(g, [a]);
    expect(await imageCountOf(g)).toBe(1);

    // 触发器已把 updatedAt 从种子值改到"现在"；重置回 OLD，便于断言 remove 之后确实又变了
    await run(h.db, 'UPDATE images SET updatedAt = ? WHERE id = ?', [OLD, a]);
    vi.clearAllMocks();

    const result = await removeImagesFromGallery(g, [a]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ removed: 1 });

    // images 行仍在（无孤儿 GC，与 unbindFolder 语义有意不同）
    const imageRow = await get<{ id: number }>(h.db, 'SELECT id FROM images WHERE id = ?', [a]);
    expect(imageRow).toBeTruthy();

    // gallery_images 归属行没了
    const memberRow = await get(h.db, 'SELECT 1 FROM gallery_images WHERE galleryId = ? AND imageId = ?', [g, a]);
    expect(memberRow).toBeUndefined();

    expect(await imageCountOf(g)).toBe(0);
    expect(await updatedAtOf(a)).not.toBe(OLD);

    expect(emitGalleryImagesChanged).toHaveBeenCalledWith({
      action: 'membershipChanged',
      galleryId: g,
      affectedGalleryIds: [g],
      affectedImageIds: [a],
      affectedCount: 1,
    });
    expect(emitGalleriesStatsUpdated).toHaveBeenCalledWith([g]);
  });

  it('removeImagesFromGallery 相册不存在 → Gallery not found', async () => {
    const result = await removeImagesFromGallery(999, [1]);
    expect(result).toEqual({ success: false, error: 'Gallery not found' });
    expect(emitGalleryImagesChanged).not.toHaveBeenCalled();
    expect(emitGalleriesStatsUpdated).not.toHaveBeenCalled();
  });
});
