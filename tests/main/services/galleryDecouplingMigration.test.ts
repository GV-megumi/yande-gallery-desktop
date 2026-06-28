import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';
import { run, get, all, columnExists } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import {
  migrateGalleryFolderDecoupling,
  ensureDecouplingTables,
  backfillGalleryFolders,
  backfillGalleryImages,
} from '../../../src/main/services/database';

let db: sqlite3.Database;

/** 建迁移前的旧结构（galleries 含 folderPath；images 全局唯一 filepath） */
async function setupLegacySchema(): Promise<void> {
  await run(db, `
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
  await run(db, `
    CREATE TABLE galleries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folderPath TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      coverImageId INTEGER,
      imageCount INTEGER DEFAULT 0,
      lastScannedAt TEXT,
      isWatching INTEGER DEFAULT 1,
      recursive INTEGER DEFAULT 1,
      extensions TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
}

async function addImage(filepath: string): Promise<number> {
  await run(
    db,
    `INSERT INTO images (filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
     VALUES (?, ?, 0, 0, 0, 'jpg', '2024-01-01', '2024-01-01')`,
    [path.basename(filepath), filepath]
  );
  const row = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function addGallery(folderPath: string, name: string, recursive: number, isWatching = 1): Promise<number> {
  await run(
    db,
    `INSERT INTO galleries (folderPath, name, isWatching, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, '2024-01-01', '2024-01-01')`,
    [folderPath, name, isWatching, recursive, JSON.stringify(['.jpg'])]
  );
  const row = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

beforeEach(async () => {
  db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(db, 'PRAGMA foreign_keys=ON');
  await setupLegacySchema();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
});

describe('ensureDecouplingTables', () => {
  it('建出 gallery_folders / gallery_images 两张表且列正确', async () => {
    await ensureDecouplingTables(db);

    expect(await columnExists(db, 'gallery_folders', 'galleryId')).toBe(true);
    expect(await columnExists(db, 'gallery_folders', 'folderPath')).toBe(true);
    expect(await columnExists(db, 'gallery_folders', 'recursive')).toBe(true);
    expect(await columnExists(db, 'gallery_folders', 'extensions')).toBe(true);

    expect(await columnExists(db, 'gallery_images', 'galleryId')).toBe(true);
    expect(await columnExists(db, 'gallery_images', 'imageId')).toBe(true);
    expect(await columnExists(db, 'gallery_images', 'addedAt')).toBe(true);
  });

  it('幂等：重复建表不报错', async () => {
    await ensureDecouplingTables(db);
    await expect(ensureDecouplingTables(db)).resolves.toBeUndefined();
  });
});
