import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 3 — unbindFolder（解绑文件夹，保留图集，不拉黑）
 *
 * - 归一化；移除 (galleryId, folderPath) 的 gallery_folders 行；
 * - 重算：该图集当前成员中，凡其 filepath 不再被任一"剩余绑定文件夹"覆盖的，
 *   删除对应 gallery_images(galleryId,imageId) 行，并收集这些 imageId；
 *   覆盖判定与 ensureMembershipForFolder 的 recursive 感知前缀谓词一致；
 * - cleanupOrphanImages(收集到的 imageId)：其中已无任何成员的图片被回收；
 * - removeGalleryRoot(folderPath)；以 COUNT(gallery_images) 更新统计；emit updated；
 * - 图集行始终保留（不删 galleries、不写忽略名单）。
 *
 * 真实 :memory: sqlite + PRAGMA foreign_keys=ON；mock 掉 scanAndImportFolder 与 deleteThumbnail。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  removeRootCalls: [] as string[],
  deleteThumbnailCalls: [] as string[],
  galleriesChanged: [] as any[],
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return {
    ...actual,
    getDatabase: vi.fn(async () => h.db),
  };
});

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(async () => ({ success: true, data: { imported: 0, skipped: 0 } })),
}));

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  deleteThumbnail: vi.fn(async (filepath: string) => {
    h.deleteThumbnailCalls.push(filepath);
    return { success: true };
  }),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryGalleriesChanged: vi.fn((p: any) => { h.galleriesChanged.push(p); }),
  emitGalleryIgnoredFoldersChanged: vi.fn(),
}));

vi.mock('../../../src/main/services/galleryRootRegistry.js', () => ({
  addGalleryRoot: vi.fn(),
  removeGalleryRoot: vi.fn((p: string) => { h.removeRootCalls.push(p); }),
}));

import { run, get, all } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { unbindFolder } from '../../../src/main/services/galleryService';

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
  await run(h.db, `
    CREATE TABLE gallery_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      galleryId INTEGER NOT NULL,
      folderPath TEXT NOT NULL UNIQUE,
      recursive INTEGER NOT NULL DEFAULT 1,
      extensions TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE
    )
  `);
  await run(h.db, `
    CREATE TABLE gallery_images (
      galleryId INTEGER NOT NULL,
      imageId INTEGER NOT NULL,
      addedAt TEXT NOT NULL,
      PRIMARY KEY (galleryId, imageId),
      FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE,
      FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE
    )
  `);
  await run(h.db, `
    CREATE TABLE booru_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      siteId INTEGER NOT NULL DEFAULT 1,
      postId INTEGER NOT NULL,
      fileUrl TEXT NOT NULL DEFAULT '',
      downloaded INTEGER DEFAULT 0,
      localPath TEXT,
      localImageId INTEGER,
      createdAt TEXT NOT NULL DEFAULT '2024-01-01',
      updatedAt TEXT NOT NULL DEFAULT '2024-01-01',
      FOREIGN KEY (localImageId) REFERENCES images(id) ON DELETE SET NULL
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

async function addGallery(folderPath: string, recursive: number): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (folderPath, name, isWatching, recursive, extensions, createdAt, updatedAt)
     VALUES (?, 'g', 1, ?, ?, '2024-01-01', '2024-01-01')`,
    [folderPath, recursive, JSON.stringify(['.jpg'])]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function addFolderBinding(galleryId: number, folderPath: string, recursive: number): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, '2024-01-01', '2024-01-01')`,
    [galleryId, folderPath, recursive, JSON.stringify(['.jpg'])]
  );
}

async function addMembership(galleryId: number, imageId: number): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (?, ?, '2024-01-01')`,
    [galleryId, imageId]
  );
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  h.removeRootCalls = [];
  h.deleteThumbnailCalls = [];
  h.galleriesChanged = [];
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('unbindFolder', () => {
  it('单文件夹图集：解绑后移除全部成员并回收孤儿，图集行仍在（count=0）', async () => {
    const folder = normalizePath(path.join('M:', 'galA'));
    const galleryId = await addGallery(folder, 1);
    await addFolderBinding(galleryId, folder, 1);
    const i1 = await addImage(normalizePath(path.join('M:', 'galA', 'a.jpg')));
    const i2 = await addImage(normalizePath(path.join('M:', 'galA', 'sub', 'b.jpg')));
    await addMembership(galleryId, i1);
    await addMembership(galleryId, i2);

    const result = await unbindFolder(galleryId, folder);

    expect(result.success).toBe(true);

    // gallery_folders 行已移除
    expect(await all(h.db, 'SELECT * FROM gallery_folders WHERE galleryId = ?', [galleryId])).toHaveLength(0);
    // 成员清空
    expect(await all(h.db, 'SELECT * FROM gallery_images WHERE galleryId = ?', [galleryId])).toHaveLength(0);
    // 图片被回收（孤儿）
    expect(await all(h.db, 'SELECT id FROM images')).toHaveLength(0);
    // 图集行仍在，统计 count=0
    const g = await get<{ id: number; imageCount: number }>(h.db, 'SELECT id, imageCount FROM galleries WHERE id = ?', [galleryId]);
    expect(g?.id).toBe(galleryId);
    expect(g?.imageCount).toBe(0);
    // removeGalleryRoot + emit updated
    expect(h.removeRootCalls).toContain(folder);
    expect(h.galleriesChanged.some((p) => p.galleryId === galleryId && p.action === 'updated')).toBe(true);
    // 尝试清两张孤儿缩略图
    expect(h.deleteThumbnailCalls.sort()).toEqual(
      [normalizePath(path.join('M:', 'galA', 'a.jpg')), normalizePath(path.join('M:', 'galA', 'sub', 'b.jpg'))].sort()
    );
    // 不应写忽略名单 / 不应删图集
    expect(await all(h.db, 'SELECT * FROM galleries')).toHaveLength(1);
  });

  it('两个重叠文件夹共享一张图片：解绑其一保留共享图，仅移除独占图', async () => {
    // folderParent = M:/p（recursive=1，覆盖 shared.jpg 与 exclusive.jpg）
    // folderChild  = M:/p/sub（recursive=1，覆盖 shared.jpg）
    // 解绑 folderChild 后：shared.jpg 仍被 folderParent 覆盖（保留）；
    //   解绑 folderChild 移除的应只是其独占成员——但本场景 folderChild 下只有 shared，
    //   所以解绑 folderChild 不应移除任何成员（shared 仍被 parent 覆盖）。
    // 为体现"仅移除独占"，再加 childOnly.jpg 放在 M:/p/sub 下，
    //   它被 parent（递归）也覆盖 → 解绑 child 仍保留。
    // 因此构造一个真正独占的场景：folderChild 是非递归 M:/p2/sub，parent 是非递归 M:/p2，
    //   childOnly 在 M:/p2/sub 下只被 child 覆盖。
    const parent = normalizePath(path.join('M:', 'p2'));
    const child = normalizePath(path.join('M:', 'p2', 'sub'));
    const galleryId = await addGallery(parent, 0);
    await addFolderBinding(galleryId, parent, 0); // 非递归：仅 M:/p2 直接子文件
    await addFolderBinding(galleryId, child, 0);  // 非递归：仅 M:/p2/sub 直接子文件

    const sharedTop = await addImage(normalizePath(path.join('M:', 'p2', 'top.jpg')));        // 仅 parent 覆盖
    const childOnly = await addImage(normalizePath(path.join('M:', 'p2', 'sub', 'only.jpg'))); // 仅 child 覆盖
    await addMembership(galleryId, sharedTop);
    await addMembership(galleryId, childOnly);

    const result = await unbindFolder(galleryId, child);

    expect(result.success).toBe(true);

    // child 绑定移除，parent 仍在
    const remaining = await all<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders WHERE galleryId = ?', [galleryId]);
    expect(remaining.map((r) => r.folderPath)).toEqual([parent]);

    // 成员：sharedTop 保留（被 parent 覆盖），childOnly 移除
    const members = (await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])).map((r) => r.imageId);
    expect(members).toEqual([sharedTop]);

    // childOnly 成为孤儿被回收；sharedTop 图片仍在
    const imgIds = (await all<{ id: number }>(h.db, 'SELECT id FROM images ORDER BY id')).map((r) => r.id);
    expect(imgIds).toEqual([sharedTop]);

    // 统计 count=1
    const g = await get<{ imageCount: number }>(h.db, 'SELECT imageCount FROM galleries WHERE id = ?', [galleryId]);
    expect(g?.imageCount).toBe(1);
  });

  it('共享图同时归属另一图集时，解绑不删除该共享图片（多归属保护）', async () => {
    // galleryA 绑定 folderA（递归）含 shared.jpg；galleryB 也把 shared.jpg 作为成员。
    // 解绑 galleryA 的 folderA → shared 从 A 移除成员，但仍是 B 的成员 → 图片不被删。
    const folderA = normalizePath(path.join('M:', 'A'));
    const galleryA = await addGallery(folderA, 1);
    const galleryB = await addGallery(normalizePath(path.join('M:', 'B')), 1);
    await addFolderBinding(galleryA, folderA, 1);

    const shared = await addImage(normalizePath(path.join('M:', 'A', 'shared.jpg')));
    await addMembership(galleryA, shared);
    await addMembership(galleryB, shared);

    const result = await unbindFolder(galleryA, folderA);

    expect(result.success).toBe(true);
    // A 成员清空
    expect(await all(h.db, 'SELECT * FROM gallery_images WHERE galleryId = ?', [galleryA])).toHaveLength(0);
    // 图片仍在（B 还引用）
    expect((await all<{ id: number }>(h.db, 'SELECT id FROM images')).map((r) => r.id)).toEqual([shared]);
    // B 成员仍在
    expect(await all(h.db, 'SELECT * FROM gallery_images WHERE galleryId = ?', [galleryB])).toHaveLength(1);
    // 未清共享图缩略图
    expect(h.deleteThumbnailCalls).toEqual([]);
  });
});
