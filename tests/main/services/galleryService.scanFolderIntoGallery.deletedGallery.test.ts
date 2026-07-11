import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * 修复轮 U08 — scanFolderIntoGallery 对「扫描期间相册被并发删除」的兜底回收。
 *
 * 场景：autoScan 大文件夹导入可达分钟级（逐文件 INSERT 即时提交，成员在导入循环
 * 结束后才由 ensureMembershipForFolder 统一写入）；期间用户删除该相册 →
 * ensureMembershipForFolder 的 INSERT OR IGNORE 触发 FK 约束错误（OR IGNORE 不豁免
 * 外键违例，foreign_keys=ON）。旧实现直接抛错：本次刚导入的图片永久滞留为零归属
 * 僵尸行——不出现在任何相册、文件夹又已被拉黑不会重扫收编，无任何 GC 路径。
 *
 * 新契约：
 *   - 捕获成员写入错误后确认相册已不存在 → 对「本次导入且零归属」的图片
 *     cleanupOrphanImages 兜底回收（多归属图片保留），返回 success:false + 明确错误；
 *   - 相册仍存在的其它异常维持原抛出行为（调用方各自兜底），不触发回收。
 *
 * 用真实 :memory: sqlite（带 FK 约束）验证；磁盘扫描（scanAndImportFolder）与
 * 缩略图 IO（deleteThumbnail）mock 掉。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  scanResult: { success: true, data: { imported: 0, skipped: 0, importedIds: [] as number[] } } as any,
  deleteThumbnailCalls: [] as string[],
  emitted: [] as any[],
}));

// 只覆盖 getDatabase（返回测试 db），其余 run/get/all/runWithChanges/runInTransaction 用真实实现。
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
  deletePreview: vi.fn(async () => ({ success: true })),
  cancelThumbnailGeneration: vi.fn(),
  deleteThumbnail: vi.fn(async (filepath: string) => {
    h.deleteThumbnailCalls.push(filepath);
    return { success: true };
  }),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn((e: any) => { h.emitted.push(e); }),
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
import { scanFolderIntoGallery } from '../../../src/main/services/galleryService';

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
  // 与真实 schema 一致：galleryId 带 FK——相册被删后成员 INSERT 会触发外键违例
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
    CREATE TABLE gallery_ignored_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folderPath TEXT NOT NULL UNIQUE,
      note TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  // cleanupOrphanImages 会重置 booru_posts（回收路径依赖该表存在）
  await run(h.db, `
    CREATE TABLE booru_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      siteId INTEGER NOT NULL,
      postId INTEGER NOT NULL,
      fileUrl TEXT NOT NULL,
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
  h.scanResult = { success: true, data: { imported: 0, skipped: 0, importedIds: [] } };
  h.deleteThumbnailCalls = [];
  h.emitted = [];
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('scanFolderIntoGallery — 目标相册在扫描期间被并发删除', () => {
  it('对已删 galleryId 扫描：返回明确错误，本次导入的零归属图片被兜底回收', async () => {
    const folder = normalizePath(path.join('M:', 'gone'));
    const galleryId = await addGallery(folder, 1);

    // 模拟磁盘导入侧效果：本次扫描的图片行已逐条即时提交入库
    const fa = normalizePath(path.join('M:', 'gone', 'a.jpg'));
    const fb = normalizePath(path.join('M:', 'gone', 'b.jpg'));
    const i1 = await addImage(fa);
    const i2 = await addImage(fb);
    // 同一文件夹下的既有零归属图片（不属于本次导入）：不得被误删——回收范围仅限本次导入
    const preexisting = await addImage(normalizePath(path.join('M:', 'gone', 'old.jpg')));
    // 文件夹外的无关零归属图片：同样不受影响
    const unrelated = await addImage(normalizePath(path.join('M:', 'other', 'z.jpg')));
    h.scanResult = { success: true, data: { imported: 2, skipped: 0, importedIds: [i1, i2] } };

    // 成员写入（ensureMembershipForFolder）之前，相册被并发删除
    await run(h.db, 'DELETE FROM galleries WHERE id = ?', [galleryId]);

    const result = await scanFolderIntoGallery(galleryId, folder, true, ['.jpg']);

    // 干净报错：明确指出相册已不存在，而非裸 FK 约束错误
    expect(result.success).toBe(false);
    expect(result.error).toContain('相册已不存在');

    // 本次导入的两张零归属图片被回收；范围外图片保留
    const ids = (await all<{ id: number }>(h.db, 'SELECT id FROM images ORDER BY id')).map((r) => r.id);
    expect(ids).toEqual([preexisting, unrelated].sort((x, y) => x - y));

    // 成员表无泄漏（不存在指向已删相册的行）
    expect(await all(h.db, 'SELECT * FROM gallery_images')).toHaveLength(0);

    // 回收路径清了本次导入图片的缩略图
    expect(h.deleteThumbnailCalls.sort()).toEqual([fa, fb].sort());

    // 未发出 images-imported 事件（导入结果已被回收）
    expect(h.emitted.filter((e) => e.type === 'gallery:images-imported')).toHaveLength(0);
  });

  it('本次导入图片若同时已是其他相册成员则保留（多归属保护）', async () => {
    const folderA = normalizePath(path.join('M:', 'dead'));
    const folderB = normalizePath(path.join('M:', 'keep'));
    const galleryA = await addGallery(folderA, 1);
    const galleryB = await addGallery(folderB, 1);

    const shared = await addImage(normalizePath(path.join('M:', 'dead', 'shared.jpg')));
    const only = await addImage(normalizePath(path.join('M:', 'dead', 'only.jpg')));
    // shared 已被另一相册 B 收编（多归属）
    await addMembership(galleryB, shared);
    h.scanResult = { success: true, data: { imported: 2, skipped: 0, importedIds: [shared, only] } };

    await run(h.db, 'DELETE FROM galleries WHERE id = ?', [galleryA]);

    const result = await scanFolderIntoGallery(galleryA, folderA, true, ['.jpg']);

    expect(result.success).toBe(false);
    // 仅独占的 only 被回收，shared 因 B 仍引用而保留
    const ids = (await all<{ id: number }>(h.db, 'SELECT id FROM images ORDER BY id')).map((r) => r.id);
    expect(ids).toEqual([shared]);
    const bMembers = (
      await all<{ imageId: number }>(h.db, 'SELECT imageId FROM gallery_images WHERE galleryId = ?', [galleryB])
    ).map((r) => r.imageId);
    expect(bMembers).toEqual([shared]);
    expect(h.deleteThumbnailCalls).toEqual([normalizePath(path.join('M:', 'dead', 'only.jpg'))]);
  });

  it('成员写入报错但相册仍存在时维持原抛出行为，不触发兜底回收', async () => {
    const folder = normalizePath(path.join('M:', 'alive'));
    const galleryId = await addGallery(folder, 1);
    const img = await addImage(normalizePath(path.join('M:', 'alive', 'a.jpg')));
    h.scanResult = { success: true, data: { imported: 1, skipped: 0, importedIds: [img] } };

    // 让成员写入炸出与「并发删除」无关的错误（相册行仍在）
    await run(h.db, 'DROP TABLE gallery_images');

    await expect(scanFolderIntoGallery(galleryId, folder, true, ['.jpg'])).rejects.toThrow();

    // 未触发回收：图片仍在、缩略图未被清
    const ids = (await all<{ id: number }>(h.db, 'SELECT id FROM images')).map((r) => r.id);
    expect(ids).toEqual([img]);
    expect(h.deleteThumbnailCalls).toEqual([]);
  });
});
