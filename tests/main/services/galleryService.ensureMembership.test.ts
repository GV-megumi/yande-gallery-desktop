import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';
import { run, get, all } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { ensureMembershipForFolder } from '../../../src/main/services/galleryService';

/**
 * Phase 2A — ensureMembershipForFolder
 *
 * 按 recursive 感知前缀（与 deleteGallery / backfillGalleryImages 字面一致）
 * 把某文件夹范围内的 images 写入 gallery_images 成员表。
 *   - recursive=1：filepath LIKE 'F{sep}%' OR filepath = 'F'
 *   - recursive=0：filepath LIKE 'F{sep}%' AND filepath NOT LIKE 'F{sep}%{sep}%'
 * 集合式单条 INSERT OR IGNORE，幂等（成员主键 + OR IGNORE）。
 */

let db: sqlite3.Database;

/** 与解耦迁移测试一致的最小 schema（images + gallery_images） */
async function setupSchema(): Promise<void> {
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
    CREATE TABLE gallery_images (
      galleryId INTEGER NOT NULL,
      imageId INTEGER NOT NULL,
      addedAt TEXT NOT NULL,
      PRIMARY KEY (galleryId, imageId)
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

async function memberIds(galleryId: number): Promise<number[]> {
  const rows = await all<{ imageId: number }>(
    db,
    'SELECT imageId FROM gallery_images WHERE galleryId = ? ORDER BY imageId',
    [galleryId]
  );
  return rows.map((r) => r.imageId);
}

beforeEach(async () => {
  db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
});

describe('ensureMembershipForFolder', () => {
  it('recursive 图集应写入直接子文件与嵌套子文件', async () => {
    const folder = normalizePath(path.join('M:', 'galA'));
    const direct = await addImage(normalizePath(path.join('M:', 'galA', 'a.jpg')));
    const nested = await addImage(normalizePath(path.join('M:', 'galA', 'sub', 'b.jpg')));

    const count = await ensureMembershipForFolder(db, 1, folder, true);

    expect(count).toBe(2);
    expect(await memberIds(1)).toEqual([direct, nested].sort((x, y) => x - y));
  });

  it('非递归图集只写直接子文件，不写嵌套子文件', async () => {
    const folder = normalizePath(path.join('M:', 'galB'));
    const direct = await addImage(normalizePath(path.join('M:', 'galB', 'c.jpg')));
    const nested = await addImage(normalizePath(path.join('M:', 'galB', 'sub', 'd.jpg')));

    const count = await ensureMembershipForFolder(db, 2, folder, false);

    expect(count).toBe(1);
    const members = await memberIds(2);
    expect(members).toContain(direct);
    expect(members).not.toContain(nested);
  });

  it('幂等：重复执行不产生重复成员', async () => {
    const folder = normalizePath(path.join('M:', 'galC'));
    await addImage(normalizePath(path.join('M:', 'galC', 'a.jpg')));
    await addImage(normalizePath(path.join('M:', 'galC', 'sub', 'b.jpg')));

    await ensureMembershipForFolder(db, 3, folder, true);
    await ensureMembershipForFolder(db, 3, folder, true);

    expect(await memberIds(3)).toHaveLength(2);
  });

  it('文件夹名含下划线时不误匹配兄弟目录（LIKE 通配符 _ 须转义）', async () => {
    // gal_1 的下划线是 LIKE 通配符（匹配任意单字符），未转义时 'gal_1\%' 会误命中 'galA1\...'
    const folder = normalizePath(path.join('M:', 'gal_1'));
    const own = await addImage(normalizePath(path.join('M:', 'gal_1', 'a.jpg')));
    const sibling = await addImage(normalizePath(path.join('M:', 'galA1', 'b.jpg')));

    await ensureMembershipForFolder(db, 7, folder, true);

    const members = await memberIds(7);
    expect(members).toContain(own);
    expect(members).not.toContain(sibling);
  });

  it('非递归 + 下划线文件夹名也不误匹配兄弟目录', async () => {
    const folder = normalizePath(path.join('M:', 'g_b'));
    const own = await addImage(normalizePath(path.join('M:', 'g_b', 'a.jpg')));
    const sibling = await addImage(normalizePath(path.join('M:', 'gXb', 'b.jpg')));

    await ensureMembershipForFolder(db, 8, folder, false);

    const members = await memberIds(8);
    expect(members).toContain(own);
    expect(members).not.toContain(sibling);
  });
});
