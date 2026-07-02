import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 3 — changeFolderPath = unbindFolder(old) + bindFolder(new)
 *
 * - 图集把旧文件夹换成新文件夹：旧绑定解绑（成员重算 + 回收），新绑定扫描入成员；
 * - 图集记录与 id 保持不变；
 * - bind 失败时透传错误（旧文件夹已解绑——可接受，但要清晰报错）。
 *
 * 真实 :memory: sqlite + PRAGMA foreign_keys=ON；mock 掉 scanAndImportFolder 与 deleteThumbnail。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  scanResult: { success: true, data: { imported: 0, skipped: 0 } } as any,
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return {
    ...actual,
    getDatabase: vi.fn(async () => h.db),
  };
});

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(async () => h.scanResult),
}));

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  cancelThumbnailGeneration: vi.fn(),
  deleteThumbnail: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryGalleriesChanged: vi.fn(),
  emitGalleryIgnoredFoldersChanged: vi.fn(),
}));

vi.mock('../../../src/main/services/galleryRootRegistry.js', () => ({
  addGalleryRoot: vi.fn(),
  removeGalleryRoot: vi.fn(),
}));

import { run, get, all } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { changeFolderPath } from '../../../src/main/services/galleryService';
import { scanAndImportFolder } from '../../../src/main/services/imageService';

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
  // 与 database.ts 真实定义一致：scanFolderIntoGallery 会读忽略名单做整棵子树排除
  await run(h.db, `
    CREATE TABLE gallery_ignored_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folderPath TEXT NOT NULL UNIQUE,
      note TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
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

async function addFolderBinding(
  galleryId: number,
  folderPath: string,
  recursive: number,
  extensions: string[] = ['.jpg']
): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, '2024-01-01', '2024-01-01')`,
    [galleryId, folderPath, recursive, JSON.stringify(extensions)]
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
  h.scanResult = { success: true, data: { imported: 0, skipped: 0 } };
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('changeFolderPath', () => {
  it('图集把旧文件夹改成新文件夹：成员反映新路径，图集记录与 id 不变', async () => {
    const oldFolder = normalizePath(path.join('M:', 'old'));
    const newFolder = normalizePath(path.join('M:', 'new'));
    const galleryId = await addGallery(oldFolder, 1);
    await addFolderBinding(galleryId, oldFolder, 1);

    // 旧文件夹下有 oldImg（当前成员）
    const oldImg = await addImage(normalizePath(path.join('M:', 'old', 'o.jpg')));
    await addMembership(galleryId, oldImg);
    // 新文件夹下有 newImg（changeFolderPath 后应成为成员）
    const newImg = await addImage(normalizePath(path.join('M:', 'new', 'n.jpg')));
    h.scanResult = { success: true, data: { imported: 1, skipped: 0 } };

    const result = await changeFolderPath(galleryId, oldFolder, newFolder, true, ['.jpg']);

    expect(result.success).toBe(true);

    // gallery_folders 只剩 newFolder
    const folders = (await all<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders WHERE galleryId = ?', [galleryId])).map((r) => r.folderPath);
    expect(folders).toEqual([newFolder]);

    // 成员现在是 newImg，oldImg 已移除
    const members = (await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])).map((r) => r.imageId);
    expect(members).toEqual([newImg]);

    // oldImg 被回收（孤儿）；newImg 仍在
    const imgIds = (await all<{ id: number }>(h.db, 'SELECT id FROM images ORDER BY id')).map((r) => r.id);
    expect(imgIds).toEqual([newImg]);

    // 图集记录与 id 不变
    const g = await get<{ id: number; name: string }>(h.db, 'SELECT id, name FROM galleries WHERE id = ?', [galleryId]);
    expect(g?.id).toBe(galleryId);
    expect(g?.name).toBe('g');
  });

  it('bind 失败时透传错误（新文件夹已被别处绑定）', async () => {
    const oldFolder = normalizePath(path.join('M:', 'old'));
    const takenFolder = normalizePath(path.join('M:', 'taken'));
    const galleryId = await addGallery(oldFolder, 1);
    await addFolderBinding(galleryId, oldFolder, 1);

    // takenFolder 已绑定到另一个图集
    const otherGallery = await addGallery(normalizePath(path.join('M:', 'other')), 1);
    await addFolderBinding(otherGallery, takenFolder, 1);

    const result = await changeFolderPath(galleryId, oldFolder, takenFolder, true, ['.jpg']);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // takenFolder 仍只属于 otherGallery（未被错误改写）
    const rows = await all<{ galleryId: number }>(h.db, 'SELECT galleryId FROM gallery_folders WHERE folderPath = ?', [takenFolder]);
    expect(rows.map((r) => r.galleryId)).toEqual([otherGallery]);
  });

  it('新路径绑定失败时不丢旧绑定与旧成员（先绑新再解旧，新失败保留旧状态）', async () => {
    const oldFolder = normalizePath(path.join('M:', 'keep'));
    const takenFolder = normalizePath(path.join('M:', 'taken'));
    const galleryId = await addGallery(oldFolder, 1);
    await addFolderBinding(galleryId, oldFolder, 1);

    // 旧文件夹下有成员图片
    const oldImg = await addImage(normalizePath(path.join('M:', 'keep', 'o.jpg')));
    await addMembership(galleryId, oldImg);

    // 新路径已被另一个图集占用 → bindFolder(new) 会因 UNIQUE 失败
    const otherGallery = await addGallery(normalizePath(path.join('M:', 'other')), 1);
    await addFolderBinding(otherGallery, takenFolder, 1);

    const result = await changeFolderPath(galleryId, oldFolder, takenFolder, true, ['.jpg']);

    expect(result.success).toBe(false);

    // 旧绑定行仍在（未被提前解绑）
    const oldBinding = await all<{ folderPath: string }>(
      h.db,
      'SELECT folderPath FROM gallery_folders WHERE galleryId = ? AND folderPath = ?',
      [galleryId, oldFolder]
    );
    expect(oldBinding).toHaveLength(1);

    // 旧成员仍在（未被解绑/孤儿回收删除）
    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toEqual([oldImg]);

    // 旧图片记录仍在（未被 GC 删除）
    const imgRow = await get<{ id: number }>(h.db, 'SELECT id FROM images WHERE id = ?', [oldImg]);
    expect(imgRow?.id).toBe(oldImg);
  });

  /**
   * 修复轮 U04：bindFolder 改为"短事务插绑定行 + 事务外扫描 + 失败补偿解绑"后，
   * changeFolderPath 的"先绑新后解旧"安全性必须保持：新侧扫描失败 → 补偿删除
   * 新绑定行（unbindFolder 语义），旧绑定与旧成员原样保留，无任何残留/丢失。
   */
  it('新路径扫描失败时：补偿移除新绑定，旧绑定与成员原样保留', async () => {
    const oldFolder = normalizePath(path.join('M:', 'keep2'));
    const newFolder = normalizePath(path.join('M:', 'newFail'));
    const galleryId = await addGallery(oldFolder, 1);
    await addFolderBinding(galleryId, oldFolder, 1);

    const oldImg = await addImage(normalizePath(path.join('M:', 'keep2', 'o.jpg')));
    await addMembership(galleryId, oldImg);

    // 新路径未被占用（通过 UNIQUE 预检），但扫描失败 → bindFolder 走补偿解绑
    h.scanResult = { success: false, error: '目录不可读' };

    const result = await changeFolderPath(galleryId, oldFolder, newFolder, true, ['.jpg']);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();

    // 新绑定行无残留（补偿已删除）
    expect(await all(h.db, 'SELECT * FROM gallery_folders WHERE folderPath = ?', [newFolder])).toHaveLength(0);

    // 旧绑定行仍在
    const oldBinding = await all<{ folderPath: string }>(
      h.db,
      'SELECT folderPath FROM gallery_folders WHERE galleryId = ? AND folderPath = ?',
      [galleryId, oldFolder]
    );
    expect(oldBinding).toHaveLength(1);

    // 旧成员与旧图片记录仍在（补偿的重叠感知移除不会误删仍被旧文件夹覆盖的成员）
    const members = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])
    ).map((r) => r.imageId);
    expect(members).toEqual([oldImg]);
    const imgRow = await get<{ id: number }>(h.db, 'SELECT id FROM images WHERE id = ?', [oldImg]);
    expect(imgRow?.id).toBe(oldImg);
  });

  /**
   * 修复轮 U06：调用方未显式传 recursive/extensions 时，changeFolderPath 必须继承
   * 旧绑定行的配置，而不是吃服务端默认（recursive=true + 默认扩展名）——否则
   * 非递归绑定（如旧版"扫描子文件夹"回填的 recursive=0 行）改路径后被静默翻转为
   * 递归导入全部嵌套子目录，自定义扩展名也被重置。
   */
  it('未显式传参时继承旧绑定行的 recursive=0 与自定义 extensions', async () => {
    const oldFolder = normalizePath(path.join('M:', 'flatOld'));
    const newFolder = normalizePath(path.join('M:', 'flatNew'));
    const galleryId = await addGallery(oldFolder, 0);
    await addFolderBinding(galleryId, oldFolder, 0, ['.png']);

    const result = await changeFolderPath(galleryId, oldFolder, newFolder);

    expect(result.success).toBe(true);

    // 新绑定行继承旧行的 recursive=0 与自定义扩展名
    const row = await get<{ recursive: number; extensions: string }>(
      h.db,
      'SELECT recursive, extensions FROM gallery_folders WHERE galleryId = ? AND folderPath = ?',
      [galleryId, newFolder]
    );
    expect(row?.recursive).toBe(0);
    expect(JSON.parse(row!.extensions)).toEqual(['.png']);

    // 扫描导入也按继承配置执行（非递归 + 自定义扩展名），而非默认递归全量导入
    expect(vi.mocked(scanAndImportFolder)).toHaveBeenCalledWith(newFolder, ['.png'], false, []);
  });

  it('显式传入 recursive/extensions 时覆盖旧绑定行的继承值', async () => {
    const oldFolder = normalizePath(path.join('M:', 'ovOld'));
    const newFolder = normalizePath(path.join('M:', 'ovNew'));
    const galleryId = await addGallery(oldFolder, 0);
    await addFolderBinding(galleryId, oldFolder, 0, ['.png']);

    const result = await changeFolderPath(galleryId, oldFolder, newFolder, true, ['.gif']);

    expect(result.success).toBe(true);
    const row = await get<{ recursive: number; extensions: string }>(
      h.db,
      'SELECT recursive, extensions FROM gallery_folders WHERE galleryId = ? AND folderPath = ?',
      [galleryId, newFolder]
    );
    expect(row?.recursive).toBe(1);
    expect(JSON.parse(row!.extensions)).toEqual(['.gif']);
  });

  it('旧绑定行不存在时不新增报错：按旧默认 recursive=true + 默认扩展名绑定新路径', async () => {
    const baseFolder = normalizePath(path.join('M:', 'base'));
    const oldFolder = normalizePath(path.join('M:', 'ghostOld'));
    const newFolder = normalizePath(path.join('M:', 'ghostNew'));
    // 图集存在，但 oldFolder 没有对应绑定行（继承查询落空 → 回退修复前默认，不报错）
    const galleryId = await addGallery(baseFolder, 1);
    await addFolderBinding(galleryId, baseFolder, 1);

    const result = await changeFolderPath(galleryId, oldFolder, newFolder);

    expect(result.success).toBe(true);
    const row = await get<{ recursive: number; extensions: string }>(
      h.db,
      'SELECT recursive, extensions FROM gallery_folders WHERE galleryId = ? AND folderPath = ?',
      [galleryId, newFolder]
    );
    expect(row?.recursive).toBe(1);
    expect(JSON.parse(row!.extensions)).toEqual(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
  });

  it('旧绑定行 extensions 为损坏 JSON 时回退默认扩展名，recursive 仍继承', async () => {
    const oldFolder = normalizePath(path.join('M:', 'brokenOld'));
    const newFolder = normalizePath(path.join('M:', 'brokenNew'));
    const galleryId = await addGallery(oldFolder, 0);
    // 直接写入损坏的 extensions 字符串（绕过 helper 的 JSON.stringify）
    await run(
      h.db,
      `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
       VALUES (?, ?, 0, 'not-json', '2024-01-01', '2024-01-01')`,
      [galleryId, oldFolder]
    );

    const result = await changeFolderPath(galleryId, oldFolder, newFolder);

    expect(result.success).toBe(true);
    const row = await get<{ recursive: number; extensions: string }>(
      h.db,
      'SELECT recursive, extensions FROM gallery_folders WHERE galleryId = ? AND folderPath = ?',
      [galleryId, newFolder]
    );
    expect(row?.recursive).toBe(0);
    expect(JSON.parse(row!.extensions)).toEqual(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
  });

  it('新旧路径相同时为 no-op 成功（不触发 UNIQUE 自冲突，旧绑定与成员保留）', async () => {
    const folder = normalizePath(path.join('M:', 'same'));
    const galleryId = await addGallery(folder, 1);
    await addFolderBinding(galleryId, folder, 1);
    const img = await addImage(normalizePath(path.join('M:', 'same', 'a.jpg')));
    await addMembership(galleryId, img);

    const result = await changeFolderPath(galleryId, folder, folder, true, ['.jpg']);

    expect(result.success).toBe(true);
    // 绑定与成员都还在
    const folders = (await all<{ folderPath: string }>(h.db, 'SELECT folderPath FROM gallery_folders WHERE galleryId = ?', [galleryId])).map((r) => r.folderPath);
    expect(folders).toEqual([folder]);
    const members = (await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryId])).map((r) => r.imageId);
    expect(members).toEqual([img]);
  });
});
