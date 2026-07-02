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

  it('集合式回填：每个图集只执行一条 INSERT 语句（语句数不随图片数增长）', async () => {
    // 大库升级首启性能约束：回填必须用 INSERT OR IGNORE ... SELECT 集合式写入
    //（与 ensureMembershipForFolder 同形态），而不是把命中行拉回 JS 逐行 INSERT——
    // 否则 20 万张图片的旧库要做 20 万+ 次语句往返，首启阻塞数十秒。
    const galA = normalizePath(path.join('M:', 'galA')); // recursive=1
    const galB = normalizePath(path.join('M:', 'galB')); // recursive=0
    const aId = await addGallery(galA, 'galA', 1);
    const bId = await addGallery(galB, 'galB', 0);
    for (let i = 0; i < 5; i++) {
      await addImage(normalizePath(path.join('M:', 'galA', `a${i}.jpg`)));
      await addImage(normalizePath(path.join('M:', 'galB', `b${i}.jpg`)));
    }

    await ensureDecouplingTables(db);

    // 用 sqlite3 trace 统计实际执行的 gallery_images INSERT 语句数：
    // 集合式实现 = 每图集 1 条（此例 2 条）；旧逐行实现 = 每张命中图片 1 条（此例 10 条）。
    const insertStatements: string[] = [];
    const onTrace = (sql: string) => {
      if (/INSERT OR IGNORE INTO gallery_images/i.test(sql)) insertStatements.push(sql);
    };
    db.on('trace', onTrace);
    try {
      await backfillGalleryImages(db);
      // trace 事件经事件循环异步派发；补一条空查询 + setImmediate 确保全部落地后再断言
      await all(db, 'SELECT 1');
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      db.removeListener('trace', onTrace);
    }

    expect(insertStatements).toHaveLength(2);

    // 集合式写入的成员结果必须与逐行版一致（递归含全部、非递归仅直接层，此例各 5 张）
    const aMembers = await all(db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [aId]);
    const bMembers = await all(db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [bId]);
    expect(aMembers).toHaveLength(5);
    expect(bMembers).toHaveLength(5);
  });

  it('文件夹名含下划线时不把兄弟目录图片回填进来（LIKE 通配符 _ 须转义）', async () => {
    // gal_1 的下划线是 LIKE 通配符；未转义时 'gal_1\%' 会误命中兄弟目录 'galA1\...'
    const gal = normalizePath(path.join('M:', 'gal_1'));
    const galId = await addGallery(gal, 'gal_1', 1);
    const own = await addImage(normalizePath(path.join('M:', 'gal_1', 'a.jpg')));
    const sibling = await addImage(normalizePath(path.join('M:', 'galA1', 'b.jpg')));

    await ensureDecouplingTables(db);
    await backfillGalleryImages(db);

    const members = (
      await all<{ imageId: number }>(db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galId])
    ).map((r) => r.imageId);
    expect(members).toContain(own);
    expect(members).not.toContain(sibling);
  });
});

describe('migrateGalleryFolderDecoupling', () => {
  it('完整迁移：建表 + 回填 folders + 回填 images', async () => {
    const galA = normalizePath(path.join('M:', 'galA'));
    const aId = await addGallery(galA, 'galA', 1);
    const aImg = await addImage(normalizePath(path.join('M:', 'galA', 'a.jpg')));

    await migrateGalleryFolderDecoupling(db);

    const folders = await all(db, 'SELECT * FROM gallery_folders WHERE galleryId = ?', [aId]);
    const members = await all<{ imageId: number }>(db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [aId]);
    expect(folders).toHaveLength(1);
    expect(members.map((m) => m.imageId)).toEqual([aImg]);
  });

  it('幂等：连续两次迁移结果不变', async () => {
    const galA = normalizePath(path.join('M:', 'galA'));
    await addGallery(galA, 'galA', 1);
    await addImage(normalizePath(path.join('M:', 'galA', 'a.jpg')));

    await migrateGalleryFolderDecoupling(db);
    await migrateGalleryFolderDecoupling(db);

    expect(await all(db, 'SELECT * FROM gallery_folders')).toHaveLength(1);
    expect(await all(db, 'SELECT * FROM gallery_images')).toHaveLength(1);
  });

  it('contract 后（galleries 无 folderPath 列）：只建表、不回填、不报错', async () => {
    await run(db, 'DROP TABLE galleries');
    await run(db, `
      CREATE TABLE galleries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        autoScan INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    await expect(migrateGalleryFolderDecoupling(db)).resolves.toBeUndefined();
    expect(await columnExists(db, 'gallery_folders', 'galleryId')).toBe(true);
    expect(await all(db, 'SELECT * FROM gallery_images')).toEqual([]);
  });

  it('嵌套图集：一张图片可同时归属父图集与子图集（复合主键允许多归属）', async () => {
    const galA = normalizePath(path.join('M:', 'galA'));            // 父，recursive=1
    const galSub = normalizePath(path.join('M:', 'galA', 'sub'));   // 子，recursive=1
    const aId = await addGallery(galA, 'galA', 1);
    const subId = await addGallery(galSub, 'galSub', 1);

    const imgId = await addImage(normalizePath(path.join('M:', 'galA', 'sub', 'x.jpg')));

    await migrateGalleryFolderDecoupling(db);

    // 同一张图片在父图集和子图集下各有一条成员行：
    // 复合主键 (galleryId, imageId) 允许跨图集多归属，INSERT OR IGNORE 仅在单个图集内去重。
    const aMembers = (
      await all<{ imageId: number }>(db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [aId])
    ).map((r) => r.imageId);
    const subMembers = (
      await all<{ imageId: number }>(db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [subId])
    ).map((r) => r.imageId);

    expect(aMembers).toContain(imgId);
    expect(subMembers).toContain(imgId);
  });

  it('空库：无图集无图片时迁移为 no-op（建表但成员/绑定均为空）', async () => {
    await expect(migrateGalleryFolderDecoupling(db)).resolves.toBeUndefined();
    expect(await all(db, 'SELECT * FROM gallery_folders')).toEqual([]);
    expect(await all(db, 'SELECT * FROM gallery_images')).toEqual([]);
  });
});
