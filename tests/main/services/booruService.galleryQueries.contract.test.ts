import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 8A 回归 — booru 侧对 galleries 的查询必须兼容 contract 后的新结构
 *
 * contract 迁移删掉了 galleries.folderPath 列（绑定文件夹归 gallery_folders）。
 * booruService 里仍有几处直接 `SELECT ... folderPath FROM galleries` / `WHERE folderPath=?`，
 * 在真实 contracted schema 上会抛 `no such column: folderPath`。
 *
 * 本测试用**真实 :memory: sqlite + 新结构 galleries（无 folderPath，含 autoScan）**
 * 跑这些查询路径，断言：
 *   1. getGallerySnapshotById：按 id 取存在性快照，不触碰 folderPath；
 *   2. findGalleryByFolderPath：改用 gallery_folders 解析 id（输入路径先归一化）；
 *   3. getFavoriteTagsWithDownloadState：内联取图集名时不再 SELECT folderPath。
 * 任何一处残留 folderPath 读取都会让对应用例因 `no such column` 失败——
 * 这正是之前 mock 掉 DB 的 booru 测试漏掉的回归。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
}));

// 真实 database：仅覆盖 getDatabase 返回测试 db。
vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return { ...actual, getDatabase: vi.fn(async () => h.db) };
});

// 各类事件 / 登记表副作用 mock 掉，保留 booruService 真实查询逻辑。
vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));
vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitBooruBlacklistTagsChanged: vi.fn(),
  emitBooruFavoriteGroupsChanged: vi.fn(),
  emitBooruPostDownloadStateChanged: vi.fn(),
  emitBooruPostFavoriteChanged: vi.fn(),
  emitBooruPostServerFavoriteChanged: vi.fn(),
  emitBooruPostVoteChanged: vi.fn(),
  emitBooruSavedSearchesChanged: vi.fn(),
  emitBooruSearchHistoryChanged: vi.fn(),
  emitBooruSitesChanged: vi.fn(),
  emitGalleryGalleriesChanged: vi.fn(),
  emitGalleryIgnoredFoldersChanged: vi.fn(),
}));
vi.mock('../../../src/main/services/galleryRootRegistry.js', () => ({
  addGalleryRoot: vi.fn(),
  removeGalleryRoot: vi.fn(),
}));
vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: vi.fn(() => ({ downloads: { path: '/tmp' }, app: { autoScan: false } })),
  getDownloadsPath: vi.fn(() => '/tmp'),
  resolveConfigPath: vi.fn((p: string) => p),
}));
vi.mock('../../../src/main/services/booruClientFactory.js', () => ({
  createBooruClient: vi.fn(),
}));
vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
}));

import { run, get } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import {
  getGallerySnapshotById,
  findGalleryByFolderPath,
  getFavoriteTagsWithDownloadState,
} from '../../../src/main/services/booruService';

// contract 后的新结构 + favorite tag / binding 相关表（最小子集）。
async function setupContractedSchema(): Promise<void> {
  await run(h.db, 'PRAGMA foreign_keys=ON');

  // Phase 8A 新结构：galleries 无 folderPath/isWatching/recursive/extensions
  await run(h.db, `
    CREATE TABLE galleries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      coverImageId INTEGER, imageCount INTEGER DEFAULT 0, lastScannedAt TEXT,
      autoScan INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE gallery_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, galleryId INTEGER NOT NULL, folderPath TEXT NOT NULL UNIQUE,
      recursive INTEGER NOT NULL DEFAULT 1, extensions TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE
    )
  `);
  await run(h.db, `
    CREATE TABLE booru_favorite_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT, siteId INTEGER, tagName TEXT NOT NULL,
      labels TEXT, queryType TEXT DEFAULT 'tag', notes TEXT, sortOrder INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL, updatedAt TEXT
    )
  `);
  await run(h.db, `
    CREATE TABLE booru_favorite_tag_download_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, favoriteTagId INTEGER NOT NULL UNIQUE,
      galleryId INTEGER, downloadPath TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      autoCreateGallery INTEGER, autoSyncGalleryAfterDownload INTEGER, quality TEXT, perPage INTEGER,
      concurrency INTEGER, skipIfExists INTEGER, notifications INTEGER, blacklistedTags TEXT,
      lastTaskId TEXT, lastSessionId TEXT, lastStartedAt TEXT, lastCompletedAt TEXT, lastStatus TEXT,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      FOREIGN KEY (favoriteTagId) REFERENCES booru_favorite_tags(id) ON DELETE CASCADE,
      FOREIGN KEY (galleryId) REFERENCES galleries(id) ON DELETE SET NULL
    )
  `);
}

async function addGallery(name: string, folderPath: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (name, autoScan, createdAt, updatedAt) VALUES (?, 1, 't', 't')`,
    [name]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  const galleryId = row!.id;
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, 1, '[".jpg"]', 't', 't')`,
    [galleryId, normalizePath(folderPath)]
  );
  return galleryId;
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await setupContractedSchema();
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('booruService galleries 查询兼容 contract 新结构（无 folderPath 列）', () => {
  it('getGallerySnapshotById 按 id 取快照（不读 folderPath）', async () => {
    const folder = normalizePath(path.join('M:', 'galA'));
    const id = await addGallery('GalA', folder);

    const snapshot = await getGallerySnapshotById(id);
    expect(snapshot).toBeTruthy();
    expect(snapshot!.id).toBe(id);
    expect(snapshot!.name).toBe('GalA');
  });

  it('getGallerySnapshotById 不存在时返回 null', async () => {
    const snapshot = await getGallerySnapshotById(99999);
    expect(snapshot).toBeNull();
  });

  it('findGalleryByFolderPath 经 gallery_folders 解析 id（输入路径归一化）', async () => {
    const folder = normalizePath(path.join('M:', 'boundGal'));
    const id = await addGallery('BoundGal', folder);

    // 传入「脏」变体（末尾分隔符 + 冗余 . 段），归一化后应命中 gallery_folders 绑定行
    const dirtyVariant = path.join('M:', 'boundGal', '.') + path.sep;
    const found = await findGalleryByFolderPath(dirtyVariant);
    expect(found).toBeTruthy();
    expect(found!.id).toBe(id);
  });

  it('findGalleryByFolderPath 无绑定时返回 null', async () => {
    const found = await findGalleryByFolderPath(normalizePath(path.join('M:', 'noSuchFolder')));
    expect(found).toBeNull();
  });

  it('getFavoriteTagsWithDownloadState 取绑定图集名时不读 folderPath', async () => {
    const folder = normalizePath(path.join('M:', 'tagGal'));
    const galleryId = await addGallery('TagGal', folder);

    // 一个有下载绑定（绑到上面图集）的收藏标签
    await run(
      h.db,
      `INSERT INTO booru_favorite_tags (id, siteId, tagName, createdAt) VALUES (1, 1, 'scenery', 't')`
    );
    await run(
      h.db,
      `INSERT INTO booru_favorite_tag_download_bindings
         (favoriteTagId, galleryId, downloadPath, enabled, createdAt, updatedAt)
       VALUES (1, ?, ?, 1, 't', 't')`,
      [galleryId, folder]
    );

    // 不应抛 `no such column: folderPath`，并能返回该标签的下载状态
    const result = await getFavoriteTagsWithDownloadState({});
    expect(result.items.length).toBe(1);
    expect(result.items[0].tagName).toBe('scenery');
  });
});
