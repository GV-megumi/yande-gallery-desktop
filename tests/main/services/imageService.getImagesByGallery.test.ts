import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';

/**
 * Phase 2B — getImagesByGallery（按 gallery_images 成员读取）
 *
 * 图集详情读取用显式成员表 join（不再用 folderPath 前缀匹配）：
 *   SELECT i.*, GROUP_CONCAT(t.name) FROM gallery_images gi
 *     JOIN images i ON i.id = gi.imageId
 *     LEFT JOIN image_tags it ...
 *   WHERE gi.galleryId = ?
 * 返回形状 { success, data, total, error }，data 中 tags 由 GROUP_CONCAT 解析为 Tag[]。
 *
 * 真实 :memory: sqlite 验证：只返回成员图片（不返回非成员），分页/total 正确。
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

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  cancelThumbnailGeneration: vi.fn(),
  enqueueThumbnailGeneration: vi.fn(),
  deleteThumbnail: vi.fn(),
}));

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryImagesChanged: vi.fn(),
}));

import { run, get } from '../../../src/main/services/database';
import { getImagesByGallery } from '../../../src/main/services/imageService';

/** 最小 schema：images + image_tags + tags + gallery_images（成员读取所需） */
async function setupSchema(): Promise<void> {
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
  await run(h.db, `
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE image_tags (
      imageId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      PRIMARY KEY (imageId, tagId)
    )
  `);
  await run(h.db, `
    CREATE TABLE gallery_images (
      galleryId INTEGER NOT NULL,
      imageId INTEGER NOT NULL,
      addedAt TEXT NOT NULL,
      PRIMARY KEY (galleryId, imageId)
    )
  `);
}

/** 插入一张图片并返回其 id；updatedAt 可控以验证 ORDER BY updatedAt DESC */
async function addImage(filepath: string, updatedAt: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO images (filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
     VALUES (?, ?, 0, 0, 0, 'jpg', '2024-01-01', ?)`,
    [filepath.split('/').pop(), filepath, updatedAt]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

/** 把图片加入图集成员表 */
async function addMembership(galleryId: number, imageId: number): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, '2024-01-01')`,
    [galleryId, imageId]
  );
}

/** 给图片打一个标签 */
async function addTag(imageId: number, name: string): Promise<void> {
  await run(h.db, `INSERT OR IGNORE INTO tags (name, createdAt) VALUES (?, '2024-01-01')`, [name]);
  const tag = await get<{ id: number }>(h.db, 'SELECT id FROM tags WHERE name = ?', [name]);
  await run(h.db, `INSERT INTO image_tags (imageId, tagId) VALUES (?, ?)`, [imageId, tag!.id]);
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

describe('imageService.getImagesByGallery', () => {
  it('只返回该图集的成员图片，不返回非成员图片', async () => {
    const member1 = await addImage('M:/galA/a.jpg', '2024-01-02T00:00:00.000Z');
    const member2 = await addImage('M:/galA/b.jpg', '2024-01-03T00:00:00.000Z');
    const nonMember = await addImage('M:/galA/c.jpg', '2024-01-04T00:00:00.000Z');
    await addMembership(1, member1);
    await addMembership(1, member2);
    // nonMember 不写入 gallery_images（哪怕 filepath 前缀相同也不应被返回）

    const result = await getImagesByGallery(1);

    expect(result.success).toBe(true);
    const ids = (result.data ?? []).map((img) => img.id).sort((a, b) => a - b);
    expect(ids).toEqual([member1, member2]);
    expect(ids).not.toContain(nonMember);
    expect(result.total).toBe(2);
  });

  it('不返回属于其他图集的图片', async () => {
    const inGallery1 = await addImage('M:/shared/a.jpg', '2024-01-02T00:00:00.000Z');
    const inGallery2 = await addImage('M:/shared/b.jpg', '2024-01-03T00:00:00.000Z');
    await addMembership(1, inGallery1);
    await addMembership(2, inGallery2);

    const result = await getImagesByGallery(1);

    const ids = (result.data ?? []).map((img) => img.id);
    expect(ids).toEqual([inGallery1]);
    expect(ids).not.toContain(inGallery2);
    expect(result.total).toBe(1);
  });

  it('按 updatedAt 降序返回', async () => {
    const older = await addImage('M:/g/old.jpg', '2024-01-01T00:00:00.000Z');
    const newer = await addImage('M:/g/new.jpg', '2024-06-01T00:00:00.000Z');
    await addMembership(5, older);
    await addMembership(5, newer);

    const result = await getImagesByGallery(5);

    const ids = (result.data ?? []).map((img) => img.id);
    expect(ids).toEqual([newer, older]);
  });

  it('将 GROUP_CONCAT 的标签解析为 Tag 数组', async () => {
    const img = await addImage('M:/g/tagged.jpg', '2024-01-02T00:00:00.000Z');
    await addMembership(3, img);
    await addTag(img, 'blue_eyes');
    await addTag(img, 'smile');

    const result = await getImagesByGallery(3);

    expect(result.success).toBe(true);
    const tags = result.data![0].tags.map((t) => t.name).sort();
    expect(tags).toEqual(['blue_eyes', 'smile']);
    for (const tag of result.data![0].tags) {
      expect(tag.id).toBe(0);
    }
  });

  it('无标签的成员图片 tags 为空数组', async () => {
    const img = await addImage('M:/g/notag.jpg', '2024-01-02T00:00:00.000Z');
    await addMembership(4, img);

    const result = await getImagesByGallery(4);

    expect(result.data![0].tags).toEqual([]);
  });

  it('分页：第二页按 pageSize 取剩余成员', async () => {
    // updatedAt 递减，保证排序稳定可预测：id 越大 updatedAt 越新（排在前）
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await addImage(
        `M:/page/${i}.jpg`,
        `2024-01-0${5 - i}T00:00:00.000Z`,
      );
      ids.push(id);
      await addMembership(9, id);
    }
    // 排序后顺序：updatedAt DESC → 第一张是 i=0（2024-01-05），最后是 i=4（2024-01-01）

    const page1 = await getImagesByGallery(9, 1, 2);
    const page2 = await getImagesByGallery(9, 2, 2);

    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    expect(page1.data).toHaveLength(2);
    expect(page2.data).toHaveLength(2);
    // 两页不重叠
    const page1Ids = page1.data!.map((img) => img.id);
    const page2Ids = page2.data!.map((img) => img.id);
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
  });

  it('图集无成员时返回空数组且 total=0', async () => {
    const result = await getImagesByGallery(999);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });
});
