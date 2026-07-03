import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';

/**
 * imageService.addImageTags / removeImageTags（M1-T09，移动端标签写接口 spec §5.4）
 *
 * 真实 :memory: sqlite（保留真实 run/get/all/runInTransaction，只覆写 getDatabase），
 * setup 里调用真实 ensureSyncTouchTriggers(db) 以便断言 image_tags 触发器触碰 updatedAt。
 * addImageTags 复用私有 addTagsToImage（自带事务，不得再包 runInTransaction）。
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
  emitGalleryImagesChanged: vi.fn(),
}));

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  enqueueThumbnailGeneration: vi.fn(),
  deleteThumbnail: vi.fn(async () => ({ success: true })),
  deletePreview: vi.fn(async () => ({ success: true })),
  cancelThumbnailGeneration: vi.fn(),
}));

import { run, get, all, ensureSyncTouchTriggers } from '../../../src/main/services/database.js';
import { emitGalleryImagesChanged } from '../../../src/main/services/appEventPublisher.js';
import { addImageTags, removeImageTags } from '../../../src/main/services/imageService.js';

const OLD = '2020-01-01T00:00:00.000Z';
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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

async function addTestImage(filepath: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO images (filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
     VALUES (?, ?, 0, 0, 0, 'jpg', ?, ?)`,
    [filepath, filepath, OLD, OLD],
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function addTag(name: string): Promise<number> {
  await run(h.db, `INSERT INTO tags (name, createdAt) VALUES (?, ?)`, [name, OLD]);
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function linkTag(imageId: number, tagId: number): Promise<void> {
  await run(h.db, `INSERT OR IGNORE INTO image_tags (imageId, tagId) VALUES (?, ?)`, [imageId, tagId]);
}

async function updatedAtOf(imageId: number): Promise<string> {
  const row = await get<{ updatedAt: string }>(h.db, 'SELECT updatedAt FROM images WHERE id = ?', [imageId]);
  return row!.updatedAt;
}

async function tagNamesOf(imageId: number): Promise<string[]> {
  const rows = await all<{ name: string }>(
    h.db,
    `SELECT t.name FROM image_tags it JOIN tags t ON t.id = it.tagId WHERE it.imageId = ? ORDER BY t.name`,
    [imageId],
  );
  return rows.map((r) => r.name);
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  await ensureSyncTouchTriggers(h.db);
  vi.mocked(emitGalleryImagesChanged).mockClear();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('imageService.addImageTags', () => {
  it('自动建标签并关联，触发器触碰 updatedAt', async () => {
    const imageId = await addTestImage('/a/1.jpg');
    const result = await addImageTags(imageId, ['Tag1', 'tag2']);
    expect(result.success).toBe(true);

    expect(await tagNamesOf(imageId)).toEqual(['Tag1', 'tag2']);

    const touched = await updatedAtOf(imageId);
    expect(touched).not.toBe(OLD);
    expect(touched).toMatch(ISO_RE);

    expect(vi.mocked(emitGalleryImagesChanged)).toHaveBeenCalledWith({
      action: 'tagsUpdated',
      imageId,
      affectedImageIds: [imageId],
      affectedCount: 1,
    });
  });

  it('大小写不敏感复用既有标签，不重复建行', async () => {
    const imageId = await addTestImage('/a/2.jpg');
    await addTag('tag1');

    const result = await addImageTags(imageId, ['TAG1']);
    expect(result.success).toBe(true);

    const allTags = await all<{ name: string }>(h.db, 'SELECT name FROM tags');
    expect(allTags).toHaveLength(1);
    expect(await tagNamesOf(imageId)).toEqual(['tag1']);
  });

  it('图不存在 → missing:true 且不发事件', async () => {
    const result = await addImageTags(999, ['x']);
    expect(result).toMatchObject({ success: false, missing: true });
    expect(vi.mocked(emitGalleryImagesChanged)).not.toHaveBeenCalled();
  });
});

describe('imageService.removeImageTags', () => {
  it('仅删指定名（大小写不敏感），触碰 updatedAt', async () => {
    const imageId = await addTestImage('/a/3.jpg');
    const tag1Id = await addTag('tag1');
    const tag2Id = await addTag('tag2');
    await linkTag(imageId, tag1Id);
    await linkTag(imageId, tag2Id);
    // 触发器把 updatedAt 从种子值改到"现在"，把它重置回 OLD，方便断言 remove 之后确实又变了
    await run(h.db, 'UPDATE images SET updatedAt = ? WHERE id = ?', [OLD, imageId]);

    const result = await removeImageTags(imageId, ['TAG1']);
    expect(result.success).toBe(true);

    expect(await tagNamesOf(imageId)).toEqual(['tag2']);
    // tags 表本身不删行，只删关联
    const allTags = await all<{ name: string }>(h.db, 'SELECT name FROM tags ORDER BY name');
    expect(allTags.map((t) => t.name)).toEqual(['tag1', 'tag2']);

    const touched = await updatedAtOf(imageId);
    expect(touched).not.toBe(OLD);
    expect(touched).toMatch(ISO_RE);

    expect(vi.mocked(emitGalleryImagesChanged)).toHaveBeenCalledWith({
      action: 'tagsUpdated',
      imageId,
      affectedImageIds: [imageId],
      affectedCount: 1,
    });
  });

  it('对不存在的标签名为 no-op 仍 success', async () => {
    const imageId = await addTestImage('/a/4.jpg');
    const tag1Id = await addTag('tag1');
    await linkTag(imageId, tag1Id);

    const result = await removeImageTags(imageId, ['does-not-exist']);
    expect(result.success).toBe(true);
    expect(await tagNamesOf(imageId)).toEqual(['tag1']);
  });

  it('图不存在 → missing:true 且不发事件', async () => {
    const result = await removeImageTags(999, ['x']);
    expect(result).toMatchObject({ success: false, missing: true });
    expect(vi.mocked(emitGalleryImagesChanged)).not.toHaveBeenCalled();
  });
});
