import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';

/**
 * Phase 3 — cleanupOrphanImages
 *
 * 给定一批候选 imageId（刚被从某相册移除成员），删除其中"已成孤儿"的图片
 * = 在 gallery_images 中已无任何成员行的图片。复用 deleteGallery 的清理动作，
 * 但作用域是孤儿 imageId 集合（而非 folderPath 前缀）：
 *   - SELECT id, filepath FROM images WHERE id IN(...) AND id NOT IN (SELECT imageId FROM gallery_images)
 *   - 事务外 best-effort deleteThumbnail(filepath)
 *   - 事务内：重置 booru_posts(downloaded/localPath) → DELETE images（FK CASCADE 清 image_tags / 残留 gallery_images）
 *   - 返回孤儿数量
 *
 * 用真实 :memory: sqlite + PRAGMA foreign_keys=ON 验证 CASCADE 与多归属保护；
 * 只把 deleteThumbnail（磁盘 IO）mock 成 spy。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
  deleteThumbnailCalls: [] as string[],
  // 记录每次 run(sql, params) 调用的 SQL 与参数个数，用于断言分批（每条语句参数数 ≤ 批大小）。
  runCalls: [] as Array<{ sql: string; paramCount: number }>,
}));

// getDatabase 返回测试 db；run 包一层 spy（仍委托真实实现，记录 SQL + 参数数）；
// 其余 get/all/runWithChanges/runInTransaction 用真实实现。
vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return {
    ...actual,
    getDatabase: vi.fn(async () => h.db),
    run: (db: any, sql: string, params: any[] = []) => {
      h.runCalls.push({ sql, paramCount: Array.isArray(params) ? params.length : 0 });
      return actual.run(db, sql, params);
    },
  };
});

// deleteThumbnail 是 galleryService 动态 import('./thumbnailService.js') 进来的，mock 成 spy。
vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  deletePreview: vi.fn(async () => ({ success: true })),
  deleteHq: vi.fn(async () => ({ success: true })),
  cancelThumbnailGeneration: vi.fn(),
  deleteThumbnail: vi.fn(async (filepath: string) => {
    h.deleteThumbnailCalls.push(filepath);
    return { success: true };
  }),
}));

// galleryService 顶部静态依赖：避免间接拉起 filesystem / 事件总线。
vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(async () => ({ success: true, data: { imported: 0, skipped: 0 } })),
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
import { cleanupOrphanImages } from '../../../src/main/services/galleryService';

/** 完整建表：images + image_tags + tags + gallery_images + booru_sites + booru_posts，含 FK CASCADE/SET NULL */
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
      category TEXT,
      createdAt TEXT NOT NULL DEFAULT '2024-01-01'
    )
  `);
  await run(h.db, `
    CREATE TABLE image_tags (
      imageId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      PRIMARY KEY (imageId, tagId),
      FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES tags (id) ON DELETE CASCADE
    )
  `);
  await run(h.db, `
    CREATE TABLE gallery_images (
      galleryId INTEGER NOT NULL,
      imageId INTEGER NOT NULL,
      addedAt TEXT NOT NULL,
      PRIMARY KEY (galleryId, imageId),
      FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE
    )
  `);
  await run(h.db, `
    CREATE TABLE booru_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT '2024-01-01',
      updatedAt TEXT NOT NULL DEFAULT '2024-01-01'
    )
  `);
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
  h.deleteThumbnailCalls = [];
  h.runCalls = [];
  vi.clearAllMocks();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe('cleanupOrphanImages', () => {
  it('空输入应返回 0 且不删除任何图片、不调 deleteThumbnail', async () => {
    const img = await addImage(normalizePath(path.join('M:', 'g', 'a.jpg')));
    await addMembership(1, img);

    const count = await cleanupOrphanImages(h.db, []);

    expect(count).toBe(0);
    expect(h.deleteThumbnailCalls).toEqual([]);
    const rows = await all(h.db, 'SELECT id FROM images');
    expect(rows).toHaveLength(1);
  });

  it('仍归属另一相册的图片不应被删除（多归属保护）', async () => {
    // img 同时在相册 1 与相册 2；从相册 1 移除成员后调用 cleanupOrphanImages([img])
    const img = await addImage(normalizePath(path.join('M:', 'shared', 'x.jpg')));
    await addMembership(1, img);
    await addMembership(2, img);
    // 模拟"刚从相册 1 移除成员"
    await run(h.db, 'DELETE FROM gallery_images WHERE galleryId = 1 AND imageId = ?', [img]);

    const count = await cleanupOrphanImages(h.db, [img]);

    expect(count).toBe(0);
    // 图片仍在（相册 2 还引用它）
    const rows = await all<{ id: number }>(h.db, 'SELECT id FROM images');
    expect(rows.map((r) => r.id)).toEqual([img]);
    // 仍保留相册 2 的成员行
    const member = await all(h.db, 'SELECT * FROM gallery_images WHERE imageId = ?', [img]);
    expect(member).toHaveLength(1);
    // 未尝试清缩略图
    expect(h.deleteThumbnailCalls).toEqual([]);
  });

  it('无成员图片应被删除：清缩略图 + 重置 booru + FK CASCADE 清 image_tags', async () => {
    const filepath = normalizePath(path.join('M:', 'orph', 'o.jpg'));
    const img = await addImage(filepath);
    // 关联 image_tags（验证 CASCADE）
    await run(h.db, `INSERT INTO tags (name) VALUES ('t1')`);
    const tagRow = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
    await run(h.db, `INSERT INTO image_tags (imageId, tagId) VALUES (?, ?)`, [img, tagRow!.id]);
    // 关联 booru_post（localImageId 命中 + localPath 命中）
    await run(h.db, `INSERT INTO booru_sites (name, url, type) VALUES ('S', 'https://s', 'moebooru')`);
    const siteRow = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
    await run(
      h.db,
      `INSERT INTO booru_posts (siteId, postId, fileUrl, downloaded, localPath, localImageId)
       VALUES (?, 100, 'https://f', 1, ?, ?)`,
      [siteRow!.id, filepath, img]
    );
    // img 没有任何成员行 → 孤儿

    const count = await cleanupOrphanImages(h.db, [img]);

    expect(count).toBe(1);
    // 图片删除
    expect(await all(h.db, 'SELECT id FROM images')).toHaveLength(0);
    // image_tags 经 CASCADE 清空
    expect(await all(h.db, 'SELECT * FROM image_tags')).toHaveLength(0);
    // booru_posts 重置（downloaded=0, localPath=NULL；localImageId 经 SET NULL 也已清）
    const post = await get<{ downloaded: number; localPath: string | null; localImageId: number | null }>(
      h.db,
      'SELECT downloaded, localPath, localImageId FROM booru_posts WHERE postId = 100'
    );
    expect(post?.downloaded).toBe(0);
    expect(post?.localPath).toBeNull();
    expect(post?.localImageId).toBeNull();
    // 尝试清缩略图
    expect(h.deleteThumbnailCalls).toEqual([filepath]);
    // 删缩略图之前先取消队列中挂着的生成任务（否则删除后队列补生成 = 永久孤儿缩略图）
    const { cancelThumbnailGeneration } = await import('../../../src/main/services/thumbnailService');
    expect(vi.mocked(cancelThumbnailGeneration)).toHaveBeenCalledWith([filepath]);
  });

  it('deleteThumbnail 抛错应被吞（best-effort），图片仍被删除', async () => {
    const filepath = normalizePath(path.join('M:', 'orph2', 'p.jpg'));
    const img = await addImage(filepath);
    const { deleteThumbnail } = await import('../../../src/main/services/thumbnailService.js');
    (deleteThumbnail as any).mockRejectedValueOnce(new Error('fs EACCES'));

    const count = await cleanupOrphanImages(h.db, [img]);

    expect(count).toBe(1);
    expect(await all(h.db, 'SELECT id FROM images')).toHaveLength(0);
  });

  it('混合输入：仅删孤儿，保留仍有成员的图片', async () => {
    const orphan = await addImage(normalizePath(path.join('M:', 'mix', 'orphan.jpg')));
    const kept = await addImage(normalizePath(path.join('M:', 'mix', 'kept.jpg')));
    await addMembership(5, kept); // kept 仍在相册 5

    const count = await cleanupOrphanImages(h.db, [orphan, kept]);

    expect(count).toBe(1);
    const ids = (await all<{ id: number }>(h.db, 'SELECT id FROM images ORDER BY id')).map((r) => r.id);
    expect(ids).toEqual([kept]);
  });

  /**
   * 大相册回收：候选 id 数量跨多个 500 分批边界。
   *
   * 旧实现把每个 id 拼成一个占位符放进单条 IN(...)，在变量上限为 999 的环境会抛
   * "too many SQL variables"。本测试不依赖环境的硬上限（现代 SQLite 可达 32766），
   * 而是用 run spy 直接断言"分批"这一行为契约：DELETE FROM images 必须被拆成多条语句、
   * 每条参数数 ≤ 500（批大小）。同时验证全部孤儿被删、非孤儿保留。
   */
  it('候选跨多个 500 分批：DELETE images 应分批（每条 ≤500 参数）且全部孤儿被删', async () => {
    const ORPHAN_COUNT = 1200; // 跨 3 个 500 分批边界
    const orphanIds: number[] = [];
    for (let i = 0; i < ORPHAN_COUNT; i++) {
      orphanIds.push(await addImage(normalizePath(path.join('M:', 'big', `o${i}.jpg`))));
    }
    // 一张非孤儿：仍是相册 7 的成员
    const kept = await addImage(normalizePath(path.join('M:', 'big', 'kept.jpg')));
    await addMembership(7, kept);

    h.runCalls = []; // 清掉 setup/插入阶段的记录，只看 cleanupOrphanImages 内部
    const count = await cleanupOrphanImages(h.db, [...orphanIds, kept]);

    expect(count).toBe(ORPHAN_COUNT);

    // 分批契约：DELETE FROM images 被拆成多条；每条参数数 ≤ 500
    const deleteCalls = h.runCalls.filter((c) => /DELETE FROM images WHERE id IN/i.test(c.sql));
    expect(deleteCalls.length).toBeGreaterThan(1);
    for (const c of deleteCalls) {
      expect(c.paramCount).toBeLessThanOrEqual(500);
    }
    // 删除总数应覆盖全部孤儿
    const totalDeleted = deleteCalls.reduce((s, c) => s + c.paramCount, 0);
    expect(totalDeleted).toBe(ORPHAN_COUNT);

    // 仅剩 kept；kept 成员行仍在
    const ids = (await all<{ id: number }>(h.db, 'SELECT id FROM images ORDER BY id')).map((r) => r.id);
    expect(ids).toEqual([kept]);
    expect(await all(h.db, 'SELECT * FROM gallery_images WHERE imageId = ?', [kept])).toHaveLength(1);
  });

  /**
   * 大相册 booru 重置：超过 500 个孤儿对应的 booru_posts 也应分批重置。
   * UPDATE booru_posts 一条语句同时带 localImageId 与 localPath 两组占位符（2×批大小），
   * 故每条参数数应 ≤ 1000（2 × 500）。
   */
  it('候选跨多个 500 分批：UPDATE booru_posts 也应分批重置', async () => {
    const ORPHAN_COUNT = 1100;
    await run(h.db, `INSERT INTO booru_sites (name, url, type) VALUES ('S', 'https://s', 'moebooru')`);
    const siteRow = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');

    const orphanIds: number[] = [];
    for (let i = 0; i < ORPHAN_COUNT; i++) {
      const fp = normalizePath(path.join('M:', 'bigb', `o${i}.jpg`));
      const imgId = await addImage(fp);
      orphanIds.push(imgId);
      await run(
        h.db,
        `INSERT INTO booru_posts (siteId, postId, fileUrl, downloaded, localPath, localImageId)
         VALUES (?, ?, 'https://f', 1, ?, ?)`,
        [siteRow!.id, i, fp, imgId]
      );
    }

    h.runCalls = [];
    const count = await cleanupOrphanImages(h.db, orphanIds);

    expect(count).toBe(ORPHAN_COUNT);

    // 分批契约：UPDATE booru_posts 被拆成多条；每条参数数 ≤ 1000（id 组 + path 组，各 ≤500）
    const updateCalls = h.runCalls.filter((c) => /UPDATE booru_posts/i.test(c.sql));
    expect(updateCalls.length).toBeGreaterThan(1);
    for (const c of updateCalls) {
      expect(c.paramCount).toBeLessThanOrEqual(1000);
    }

    expect(await all(h.db, 'SELECT id FROM images')).toHaveLength(0);
    // 所有 booru_posts 应被重置
    const stillDownloaded = await all(h.db, 'SELECT id FROM booru_posts WHERE downloaded = 1 OR localPath IS NOT NULL');
    expect(stillDownloaded).toHaveLength(0);
  });
});
