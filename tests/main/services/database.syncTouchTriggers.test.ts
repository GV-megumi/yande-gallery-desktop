import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { run, get, ensureSyncTouchTriggers } from '../../../src/main/services/database.js';

let db: sqlite3.Database;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function setupSchema(): Promise<void> {
  await run(db, `CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, filepath TEXT NOT NULL UNIQUE,
    fileSize INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, format TEXT NOT NULL,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
  await run(db, `CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, category TEXT, createdAt TEXT NOT NULL)`);
  await run(db, `CREATE TABLE image_tags (
    imageId INTEGER NOT NULL, tagId INTEGER NOT NULL, PRIMARY KEY (imageId, tagId),
    FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE,
    FOREIGN KEY (tagId) REFERENCES tags (id) ON DELETE CASCADE)`);
  await run(db, `CREATE TABLE galleries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, coverImageId INTEGER,
    imageCount INTEGER DEFAULT 0, lastScannedAt TEXT, autoScan INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (coverImageId) REFERENCES images (id) ON DELETE SET NULL)`);
  await run(db, `CREATE TABLE gallery_images (
    galleryId INTEGER NOT NULL, imageId INTEGER NOT NULL, addedAt TEXT NOT NULL,
    PRIMARY KEY (galleryId, imageId),
    FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE,
    FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE)`);
}

const OLD = '2020-01-01T00:00:00.000Z';

async function addImage(filepath: string): Promise<number> {
  await run(db, `INSERT INTO images (filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
    VALUES (?, ?, 0, 0, 0, 'jpg', ?, ?)`, [filepath, filepath, OLD, OLD]);
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
  db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
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
});
