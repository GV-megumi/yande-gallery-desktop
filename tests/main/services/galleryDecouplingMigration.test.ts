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

describe('backfillGalleryFolders', () => {
  it('每个图集回填一条绑定，含 folderPath/recursive/extensions', async () => {
    const galA = normalizePath(path.join('M:', 'galA'));
    const galB = normalizePath(path.join('M:', 'galB'));
    const aId = await addGallery(galA, 'galA', 1);
    const bId = await addGallery(galB, 'galB', 0);

    await ensureDecouplingTables(db);
    await backfillGalleryFolders(db);

    const rows = await all<{ galleryId: number; folderPath: string; recursive: number; extensions: string }>(
      db,
      'SELECT galleryId, folderPath, recursive, extensions FROM gallery_folders ORDER BY galleryId'
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ galleryId: aId, folderPath: galA, recursive: 1 });
    expect(rows[1]).toMatchObject({ galleryId: bId, folderPath: galB, recursive: 0 });
    expect(JSON.parse(rows[0].extensions)).toEqual(['.jpg']);
  });

  it('幂等：重复回填不产生重复绑定', async () => {
    const galA = normalizePath(path.join('M:', 'galA'));
    await addGallery(galA, 'galA', 1);
    await ensureDecouplingTables(db);
    await backfillGalleryFolders(db);
    await backfillGalleryFolders(db);
    const rows = await all(db, 'SELECT * FROM gallery_folders');
    expect(rows).toHaveLength(1);
  });
});

describe('backfillGalleryImages', () => {
  it('递归图集含嵌套图片，非递归图集仅含直接图片', async () => {
    const galA = normalizePath(path.join('M:', 'galA')); // recursive=1
    const galB = normalizePath(path.join('M:', 'galB')); // recursive=0
    const aId = await addGallery(galA, 'galA', 1);
    const bId = await addGallery(galB, 'galB', 0);

    const aDirect = await addImage(normalizePath(path.join('M:', 'galA', 'a.jpg')));
    const aNested = await addImage(normalizePath(path.join('M:', 'galA', 'sub', 'b.jpg')));
    const bDirect = await addImage(normalizePath(path.join('M:', 'galB', 'c.jpg')));
    const bNested = await addImage(normalizePath(path.join('M:', 'galB', 'sub', 'd.jpg')));

    await ensureDecouplingTables(db);
    await backfillGalleryImages(db);

    const aMembers = (
      await all<{ imageId: number }>(db, 'SELECT imageId FROM gallery_images WHERE galleryId = ? ORDER BY imageId', [aId])
    ).map((r) => r.imageId);
    const bMembers = (
      await all<{ imageId: number }>(db, 'SELECT imageId FROM gallery_images WHERE galleryId = ? ORDER BY imageId', [bId])
    ).map((r) => r.imageId);

    expect(aMembers).toEqual([aDirect, aNested].sort((x, y) => x - y)); // 递归：直接 + 嵌套
    expect(bMembers).toEqual([bDirect]);                                // 非递归：仅直接
    // 反向确认：嵌套图片没有被错误塞进非递归图集
    expect(bMembers).not.toContain(bNested);
  });

  it('幂等：重复回填不产生重复成员', async () => {
    const galA = normalizePath(path.join('M:', 'galA'));
    const aId = await addGallery(galA, 'galA', 1);
    await addImage(normalizePath(path.join('M:', 'galA', 'a.jpg')));
    await ensureDecouplingTables(db);
    await backfillGalleryImages(db);
    await backfillGalleryImages(db);
    const members = await all(db, 'SELECT * FROM gallery_images WHERE galleryId = ?', [aId]);
    expect(members).toHaveLength(1);
  });
});
