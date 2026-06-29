import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 4 — invalid_images 归属/计数改用 gallery_images 成员
 *
 * reportInvalidImage：
 *   - 所属图集从 galleries.folderPath 前缀匹配改为 gallery_images 成员归属（按 originalImageId）；
 *   - 上报后图集 imageCount 以 COUNT(gallery_images WHERE galleryId) 为准（已扣除被删图）。
 *
 * 真实 :memory: sqlite + PRAGMA foreign_keys=ON（验证 FK CASCADE 清成员行）；
 * mock 掉 thumbnailService（缩略图磁盘操作）、fs（源文件存在性双校验）与事件副作用。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return { ...actual, getDatabase: vi.fn(async () => h.db) };
});

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  getThumbnailIfExists: vi.fn(async () => null),
  deleteThumbnail: vi.fn(async () => undefined),
}));

// fs.access 抛错 = 源文件不存在 → 满足"确认源文件确实不存在"双校验，继续上报
vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(async () => {
      throw new Error('ENOENT');
    }),
  },
}));

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryGalleriesChanged: vi.fn(),
  emitGalleryImagesChanged: vi.fn(),
  emitGalleryInvalidImagesChanged: vi.fn(),
}));

import { run, get, all } from '../../../src/main/services/database';
import { reportInvalidImage } from '../../../src/main/services/invalidImageService';
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
    CREATE TABLE invalid_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT, originalImageId INTEGER, filename TEXT, filepath TEXT,
      fileSize INTEGER, width INTEGER, height INTEGER, format TEXT, thumbnailPath TEXT, detectedAt TEXT,
      galleryId INTEGER,
      FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE SET NULL
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

describe('reportInvalidImage 归属/计数改用 gallery_images', () => {
  it('通过成员归属定位图集，记录 galleryId 并以成员表 COUNT 刷新 imageCount', async () => {
    const galleryId = await addGallery(normalizePathLike('M:/gal'));
    // 三张图都是该图集成员；其中一张失效
    const keep1 = await addImage('M:/gal/a.jpg');
    const bad = await addImage('M:/gal/bad.jpg');
    const keep2 = await addImage('M:/gal/c.jpg');
    await addMember(galleryId, keep1);
    await addMember(galleryId, bad);
    await addMember(galleryId, keep2);
    // 预置一个过期 imageCount，验证会被刷新
    await run(h.db, 'UPDATE galleries SET imageCount = 99 WHERE id = ?', [galleryId]);

    const result = await reportInvalidImage(bad);
    expect(result.success).toBe(true);

    // invalid_images 记录归属到该图集
    const inv = await get<{ originalImageId: number; galleryId: number }>(
      h.db,
      'SELECT originalImageId, galleryId FROM invalid_images WHERE originalImageId = ?',
      [bad]
    );
    expect(inv).toMatchObject({ originalImageId: bad, galleryId });

    // 失效图已从 images 删除（连带 gallery_images 成员行 CASCADE 删除）
    const imgRow = await get<{ id: number }>(h.db, 'SELECT id FROM images WHERE id = ?', [bad]);
    expect(imgRow).toBeUndefined();
    const memberRow = await get<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE imageId = ?', [bad]);
    expect(memberRow).toBeUndefined();

    // imageCount 刷新为剩余成员数（2）
    const g = await get<{ imageCount: number }>(h.db, 'SELECT imageCount FROM galleries WHERE id = ?', [galleryId]);
    expect(g?.imageCount).toBe(2);
  });

  it('失效图是封面时清空封面', async () => {
    const galleryId = await addGallery(normalizePathLike('M:/gal2'));
    const bad = await addImage('M:/gal2/cover.jpg');
    await addMember(galleryId, bad);
    await run(h.db, 'UPDATE galleries SET coverImageId = ? WHERE id = ?', [bad, galleryId]);

    const result = await reportInvalidImage(bad);
    expect(result.success).toBe(true);

    const g = await get<{ coverImageId: number | null }>(h.db, 'SELECT coverImageId FROM galleries WHERE id = ?', [galleryId]);
    expect(g?.coverImageId).toBeNull();
  });

  it('无任何成员归属时仍记录无效项，galleryId 为 NULL', async () => {
    // 图片存在但不属于任何图集（无 gallery_images 行）
    const orphan = await addImage('M:/loose/x.jpg');

    const result = await reportInvalidImage(orphan);
    expect(result.success).toBe(true);

    const inv = await get<{ originalImageId: number; galleryId: number | null }>(
      h.db,
      'SELECT originalImageId, galleryId FROM invalid_images WHERE originalImageId = ?',
      [orphan]
    );
    expect(inv?.originalImageId).toBe(orphan);
    expect(inv?.galleryId).toBeNull();
  });

  it('多归属图片：任取一个归属图集刷新其统计', async () => {
    const galleryA = await addGallery(normalizePathLike('M:/A'));
    const galleryB = await addGallery(normalizePathLike('M:/B'));
    const shared = await addImage('M:/A/shared.jpg');
    // 同一张图同时属于 A、B（多归属）
    await addMember(galleryA, shared);
    await addMember(galleryB, shared);

    const result = await reportInvalidImage(shared);
    expect(result.success).toBe(true);

    const inv = await get<{ galleryId: number }>(
      h.db,
      'SELECT galleryId FROM invalid_images WHERE originalImageId = ?',
      [shared]
    );
    // 归属到 A 或 B 其一即可
    expect([galleryA, galleryB]).toContain(inv?.galleryId);

    // 两个图集的成员行都因 images 删除被 CASCADE 清掉
    const remaining = await all<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_images WHERE imageId = ?', [shared]);
    expect(remaining).toHaveLength(0);
  });

  it('多归属图片失效时刷新该图全部归属图集的统计（不止一个）', async () => {
    const galleryA = await addGallery(normalizePathLike('M:/AA'));
    const galleryB = await addGallery(normalizePathLike('M:/BB'));
    // 各放一张独占图（撑起初始计数）+ 一张共享图（即将失效）
    const aOwn = await addImage('M:/AA/own.jpg');
    const bOwn = await addImage('M:/BB/own.jpg');
    const shared = await addImage('M:/AA/shared.jpg');
    await addMember(galleryA, aOwn);
    await addMember(galleryA, shared);
    await addMember(galleryB, bOwn);
    await addMember(galleryB, shared);
    // 预置过期 imageCount，验证两个图集都会被刷新
    await run(h.db, 'UPDATE galleries SET imageCount = 99 WHERE id IN (?, ?)', [galleryA, galleryB]);

    const result = await reportInvalidImage(shared);
    expect(result.success).toBe(true);

    // 两个图集的 imageCount 都应刷新为各自剩余成员数（各 1，共享图已删）
    const gA = await get<{ imageCount: number }>(h.db, 'SELECT imageCount FROM galleries WHERE id = ?', [galleryA]);
    const gB = await get<{ imageCount: number }>(h.db, 'SELECT imageCount FROM galleries WHERE id = ?', [galleryB]);
    expect(gA?.imageCount).toBe(1);
    expect(gB?.imageCount).toBe(1);

    // 两个图集都应收到 statsUpdated 统计变更事件
    const statsGalleryIds = vi
      .mocked(emitGalleryGalleriesChanged)
      .mock.calls.map(([arg]) => (arg as { galleryId: number; action: string }))
      .filter((arg) => arg.action === 'statsUpdated')
      .map((arg) => arg.galleryId);
    expect(statsGalleryIds).toContain(galleryA);
    expect(statsGalleryIds).toContain(galleryB);

    // images-changed 事件的 affectedGalleryIds 应覆盖两个图集
    const affected = vi
      .mocked(emitGalleryImagesChanged)
      .mock.calls.map(([arg]) => arg as { affectedGalleryIds?: number[] })
      .flatMap((arg) => arg.affectedGalleryIds ?? []);
    expect(affected).toContain(galleryA);
    expect(affected).toContain(galleryB);
  });
});

/** 测试内简单路径占位（Windows 风格），避免引入真实 normalizePath 依赖 */
function normalizePathLike(p: string): string {
  return p;
}
