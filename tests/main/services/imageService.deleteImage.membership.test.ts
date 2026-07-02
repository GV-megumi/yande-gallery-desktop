import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * deleteImage 多归属统计刷新（对齐 848887a 对 reportInvalidImage 的同类修复）
 *
 * 删除 images 行会 FK CASCADE 清掉该图在所有图集的 gallery_images 成员行，因此：
 *   - 删除前必须读出全部归属图集（不 LIMIT 1）；
 *   - 删除后逐个归属图集以 COUNT(gallery_images) 回写 galleries.imageCount；
 *   - 逐图集发 galleries-changed(statsUpdated)，images-changed 的 affectedGalleryIds 覆盖全部归属。
 *
 * 真实 :memory: sqlite + PRAGMA foreign_keys=ON（验证 FK CASCADE 清成员行）；
 * mock 掉 thumbnailService / fs（磁盘副作用）与事件发布器。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return { ...actual, getDatabase: vi.fn(async () => h.db) };
});

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  cancelThumbnailGeneration: vi.fn(),
  enqueueThumbnailGeneration: vi.fn(),
  deleteThumbnail: vi.fn(async () => undefined),
}));

// 磁盘原图删除是 best-effort，mock 掉避免真实文件操作
vi.mock('fs/promises', () => ({
  default: {
    unlink: vi.fn(async () => undefined),
  },
}));

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryGalleriesChanged: vi.fn(),
  emitGalleryImagesChanged: vi.fn(),
}));

// imageService 顶层引入 rendererEventBus（scanAndImportFolder 用），mock 掉以切断 apiEventHub 依赖图
vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));

import { run, get, all } from '../../../src/main/services/database';
import { deleteImage } from '../../../src/main/services/imageService';
import {
  emitGalleryGalleriesChanged,
  emitGalleryImagesChanged,
} from '../../../src/main/services/appEventPublisher';

async function setupSchema(): Promise<void> {
  await run(h.db, `
    CREATE TABLE images (
      id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, filepath TEXT NOT NULL UNIQUE,
      fileSize INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, format TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE galleries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, folderPath TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      coverImageId INTEGER, imageCount INTEGER DEFAULT 0, lastScannedAt TEXT, isWatching INTEGER DEFAULT 1,
      recursive INTEGER DEFAULT 1, extensions TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
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
  await run(h.db, `
    CREATE TABLE image_tags (
      imageId INTEGER NOT NULL, tagId INTEGER NOT NULL,
      PRIMARY KEY (imageId, tagId),
      FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE
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

async function addGallery(folderPath: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (folderPath, name, isWatching, recursive, extensions, createdAt, updatedAt)
     VALUES (?, 'g', 1, 1, ?, '2024-01-01', '2024-01-01')`,
    [folderPath, JSON.stringify(['.jpg'])]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function addMember(galleryId: number, imageId: number): Promise<void> {
  await run(h.db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, '2024-01-01')`, [galleryId, imageId]);
}

/** 收集 statsUpdated 事件携带的 galleryId 列表 */
function statsUpdatedGalleryIds(): number[] {
  return vi
    .mocked(emitGalleryGalleriesChanged)
    .mock.calls.map(([arg]) => arg as { galleryId?: number; action: string })
    .filter((arg) => arg.action === 'statsUpdated')
    .map((arg) => arg.galleryId!)
    .filter((gid) => gid !== undefined);
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('deleteImage 归属图集统计刷新（gallery_images 成员表）', () => {
  it('多归属图片删除后刷新全部归属图集的 imageCount，statsUpdated 与 affectedGalleryIds 覆盖全部归属', async () => {
    const galleryA = await addGallery('M:/AA');
    const galleryB = await addGallery('M:/BB');
    // 各放一张独占图（撑起初始计数）+ 一张共享图（即将删除）
    const aOwn = await addImage('M:/AA/own.jpg');
    const bOwn = await addImage('M:/BB/own.jpg');
    const shared = await addImage('M:/AA/shared.jpg');
    await addMember(galleryA, aOwn);
    await addMember(galleryA, shared);
    await addMember(galleryB, bOwn);
    await addMember(galleryB, shared);
    // 预置过期 imageCount，验证两个图集都会被刷新
    await run(h.db, 'UPDATE galleries SET imageCount = 99 WHERE id IN (?, ?)', [galleryA, galleryB]);

    const result = await deleteImage(shared);
    expect(result.success).toBe(true);

    // 图片与其全部成员行已删（FK CASCADE）
    const imgRow = await get<{ id: number }>(h.db, 'SELECT id FROM images WHERE id = ?', [shared]);
    expect(imgRow).toBeUndefined();
    const remaining = await all<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_images WHERE imageId = ?', [shared]);
    expect(remaining).toHaveLength(0);

    // 两个图集的 imageCount 都应刷新为各自剩余成员数（各 1）
    const gA = await get<{ imageCount: number }>(h.db, 'SELECT imageCount FROM galleries WHERE id = ?', [galleryA]);
    const gB = await get<{ imageCount: number }>(h.db, 'SELECT imageCount FROM galleries WHERE id = ?', [galleryB]);
    expect(gA?.imageCount).toBe(1);
    expect(gB?.imageCount).toBe(1);

    // 两个图集都应收到 statsUpdated 统计变更事件
    const statsIds = statsUpdatedGalleryIds();
    expect(statsIds).toContain(galleryA);
    expect(statsIds).toContain(galleryB);

    // images-changed 事件：affectedGalleryIds 覆盖全部归属，代表 galleryId 取其一
    expect(emitGalleryImagesChanged).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(emitGalleryImagesChanged).mock.calls[0][0] as {
      action: string; galleryId: number | null; affectedGalleryIds?: number[];
    };
    expect(payload.action).toBe('deleted');
    expect([galleryA, galleryB]).toContain(payload.galleryId);
    expect(payload.affectedGalleryIds ?? []).toContain(galleryA);
    expect(payload.affectedGalleryIds ?? []).toContain(galleryB);
  });

  it('单归属图片删除后刷新该图集的 imageCount 并发 statsUpdated', async () => {
    const galleryId = await addGallery('M:/gal');
    const keep = await addImage('M:/gal/keep.jpg');
    const doomed = await addImage('M:/gal/doomed.jpg');
    await addMember(galleryId, keep);
    await addMember(galleryId, doomed);
    await run(h.db, 'UPDATE galleries SET imageCount = 99 WHERE id = ?', [galleryId]);

    const result = await deleteImage(doomed);
    expect(result.success).toBe(true);

    const g = await get<{ imageCount: number }>(h.db, 'SELECT imageCount FROM galleries WHERE id = ?', [galleryId]);
    expect(g?.imageCount).toBe(1);
    expect(statsUpdatedGalleryIds()).toContain(galleryId);
  });

  it('无归属图片删除：事件 galleryId 为 null 且不发 statsUpdated', async () => {
    const orphan = await addImage('M:/loose/x.jpg');

    const result = await deleteImage(orphan);
    expect(result.success).toBe(true);

    expect(emitGalleryImagesChanged).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(emitGalleryImagesChanged).mock.calls[0][0] as {
      galleryId: number | null; affectedGalleryIds?: number[];
    };
    expect(payload.galleryId).toBeNull();
    expect(payload.affectedGalleryIds).toBeUndefined();
    expect(emitGalleryGalleriesChanged).not.toHaveBeenCalled();
  });
});
