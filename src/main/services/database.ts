import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { getDatabasePath } from './config.js';
import { normalizePath, escapeLike } from '../utils/path.js';

// 数据库连接实例
let db: sqlite3.Database | null = null;
const transactionQueues = new WeakMap<sqlite3.Database, Promise<void>>();

/**
 * 获取数据库连接（单例模式）
 * 数据库路径由 config 统一管理
 */
export async function getDatabase(): Promise<sqlite3.Database> {
  if (db) {
    return db;
  }

  const dbPath = getDatabasePath();
  const dbDir = path.dirname(dbPath);

  // 确保数据库目录存在
  await fs.mkdir(dbDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('[database] 连接失败:', err);
        reject(err);
      } else {
        console.log('[database] 连接成功:', dbPath);
        db = database;
        // SQLite PRAGMA 性能优化配置（批量执行，统一错误处理）
        // 必须在 resolve 之前完成，否则后续查询可能在 PRAGMA 生效前执行
        database.exec(
          'PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-8000; PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY;',
          (err) => {
            if (err) {
              console.error('[database] PRAGMA 设置失败:', err);
            } else {
              console.log('[database] PRAGMA 性能优化已启用');
            }
            resolve(database);
          }
        );
      }
    });
  });
}

/**
 * 创建数据表（如果不存在）
 */
export async function initDatabase(): Promise<{ success: boolean; error?: string }> {
  try {
    const database = await getDatabase();

    // 创建图片表
    await run(database, `
      CREATE TABLE IF NOT EXISTS images (
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

    // 创建标签表
    await run(database, `
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        category TEXT,
        createdAt TEXT NOT NULL
      )
    `);

    // 创建图片标签关联表
    await run(database, `
      CREATE TABLE IF NOT EXISTS image_tags (
        imageId INTEGER NOT NULL,
        tagId INTEGER NOT NULL,
        PRIMARY KEY (imageId, tagId),
        FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE,
        FOREIGN KEY (tagId) REFERENCES tags (id) ON DELETE CASCADE
      )
    `);

    // 创建Yande.re图片表
    await run(database, `
      CREATE TABLE IF NOT EXISTS yande_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        yandeId INTEGER NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        fileUrl TEXT NOT NULL,
        previewUrl TEXT,
        rating TEXT CHECK(rating IN ('safe', 'questionable', 'explicit')),
        downloaded INTEGER DEFAULT 0,
        localPath TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    // 创建图库表（懒加载设计）
    // Phase 8A contract：图集与文件夹解耦后，galleries 不再存 folderPath/recursive/extensions
    // （这些归 gallery_folders），isWatching 改名为语义更准确的 autoScan（是否随启动/进入自动扫描）。
    // 新库直接建新结构；旧库由下方 contractGalleriesTable 在解耦回填之后重建升级。
    await run(database, `
      CREATE TABLE IF NOT EXISTS galleries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,               -- 图库名称
        coverImageId INTEGER,            -- 封面图片ID（引用images表）
        imageCount INTEGER DEFAULT 0,     -- 图片数量（缓存）
        lastScannedAt TEXT,              -- 最后扫描时间
        autoScan INTEGER NOT NULL DEFAULT 1, -- 是否自动扫描（旧 isWatching 改名）
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (coverImageId) REFERENCES images (id) ON DELETE SET NULL
      )
    `);

    // 创建图库忽略名单表（bug12：删除图集后写入，扫描时跳过）
    // 存归一化后的 folderPath；note 记录忽略原因；createdAt/updatedAt 便于排序与审计。
    await run(database, `
      CREATE TABLE IF NOT EXISTS gallery_ignored_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folderPath TEXT NOT NULL UNIQUE,
        note TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    // 批量创建基础索引（减少数据库往返次数）
    await new Promise<void>((resolve, reject) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_images_filename ON images (filename);
        CREATE INDEX IF NOT EXISTS idx_images_createdAt ON images (createdAt DESC);
        CREATE INDEX IF NOT EXISTS idx_images_updatedAt ON images (updatedAt DESC);
        CREATE INDEX IF NOT EXISTS idx_images_updatedAt_id ON images (updatedAt, id);
        CREATE INDEX IF NOT EXISTS idx_images_filepath ON images (filepath);
        CREATE INDEX IF NOT EXISTS idx_tags_name ON tags (name);
        CREATE INDEX IF NOT EXISTS idx_yande_images_downloaded ON yande_images (downloaded);
        CREATE INDEX IF NOT EXISTS idx_galleries_lastScannedAt ON galleries (lastScannedAt DESC);
        CREATE INDEX IF NOT EXISTS idx_gallery_ignored_folders_folderPath ON gallery_ignored_folders (folderPath);
      `, (err) => err ? reject(err) : resolve());
    });

    // API 服务访问日志
    await run(database, `
      CREATE TABLE IF NOT EXISTS api_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        sourceIp TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        permissionKey TEXT,
        statusCode INTEGER NOT NULL,
        success INTEGER NOT NULL CHECK(success IN (0, 1)),
        durationMs INTEGER NOT NULL,
        errorCode TEXT,
        errorMessage TEXT,
        requestSummary TEXT
      )
    `);

    await new Promise<void>((resolve, reject) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_api_logs_timestamp ON api_logs (timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_api_logs_success ON api_logs (success);
        CREATE INDEX IF NOT EXISTS idx_api_logs_path ON api_logs (path);
      `, (err) => err ? reject(err) : resolve());
    });

    // === Booru 相关表开始 ===
    console.log('[database] 开始创建 Booru 相关表...');

    // 创建 booru_sites 表 - Booru站点配置信息
    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        salt TEXT,
        version TEXT,
        apiKey TEXT,
        username TEXT,
        passwordHash TEXT,
        favoriteSupport INTEGER DEFAULT 1,
        active INTEGER DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    // 创建 booru_posts 表 - Booru图片信息
    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        siteId INTEGER NOT NULL,
        postId INTEGER NOT NULL,
        md5 TEXT,
        fileUrl TEXT NOT NULL,
        previewUrl TEXT,
        sampleUrl TEXT,
        width INTEGER,
        height INTEGER,
        fileSize INTEGER,
        fileExt TEXT,
        rating TEXT,
        score INTEGER,
        source TEXT,
        tags TEXT,
        downloaded INTEGER DEFAULT 0,
        localPath TEXT,
        localImageId INTEGER,
        isFavorited INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE,
        FOREIGN KEY (localImageId) REFERENCES images(id) ON DELETE SET NULL,
        UNIQUE(siteId, postId)
      )
    `);

    // 创建 booru_tags 表 - Booru标签信息
    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        siteId INTEGER NOT NULL,
        name TEXT NOT NULL,
        category TEXT,
        postCount INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE,
        UNIQUE(siteId, name)
      )
    `);

    // 创建 booru_post_tags 表 - Booru图片标签关联表
    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_post_tags (
        postId INTEGER NOT NULL,
        tagId INTEGER NOT NULL,
        PRIMARY KEY (postId, tagId),
        FOREIGN KEY (postId) REFERENCES booru_posts(id) ON DELETE CASCADE,
        FOREIGN KEY (tagId) REFERENCES booru_tags(id) ON DELETE CASCADE
      )
    `);

    // 创建 booru_favorites 表 - 收藏的Booru图片
    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        postId INTEGER NOT NULL,
        siteId INTEGER NOT NULL,
        notes TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (postId) REFERENCES booru_posts(id) ON DELETE CASCADE,
        FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE,
        UNIQUE(postId)
      )
    `);

    // 创建 booru_download_queue 表 - 下载队列
    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_download_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        postId INTEGER NOT NULL,
        siteId INTEGER NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        downloadedBytes INTEGER DEFAULT 0,
        totalBytes INTEGER DEFAULT 0,
        errorMessage TEXT,
        retryCount INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 0,
        targetPath TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        completedAt TEXT,
        FOREIGN KEY (postId) REFERENCES booru_posts(id) ON DELETE CASCADE,
        FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE
      )
    `);

    // 创建 booru_search_history 表 - 搜索历史
    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_search_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        siteId INTEGER NOT NULL,
        query TEXT NOT NULL,
        resultCount INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE
      )
    `);

    // 批量创建 Booru 相关索引
    await new Promise<void>((resolve, reject) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_booru_sites_type ON booru_sites(type);
        CREATE INDEX IF NOT EXISTS idx_booru_sites_active ON booru_sites(active);
        CREATE INDEX IF NOT EXISTS idx_booru_posts_siteId ON booru_posts(siteId);
        CREATE INDEX IF NOT EXISTS idx_booru_posts_postId ON booru_posts(postId);
        CREATE INDEX IF NOT EXISTS idx_booru_posts_downloaded ON booru_posts(downloaded);
        CREATE INDEX IF NOT EXISTS idx_booru_posts_isFavorited ON booru_posts(isFavorited);
        CREATE INDEX IF NOT EXISTS idx_booru_posts_rating ON booru_posts(rating);
        CREATE INDEX IF NOT EXISTS idx_booru_posts_md5 ON booru_posts(md5);
        CREATE INDEX IF NOT EXISTS idx_booru_tags_siteId ON booru_tags(siteId);
        CREATE INDEX IF NOT EXISTS idx_booru_tags_name ON booru_tags(name);
        CREATE INDEX IF NOT EXISTS idx_booru_tags_category ON booru_tags(category);
        CREATE INDEX IF NOT EXISTS idx_booru_tags_postCount ON booru_tags(postCount DESC);
        CREATE INDEX IF NOT EXISTS idx_booru_post_tags_postId ON booru_post_tags(postId);
        CREATE INDEX IF NOT EXISTS idx_booru_post_tags_tagId ON booru_post_tags(tagId);
        CREATE INDEX IF NOT EXISTS idx_booru_favorites_siteId ON booru_favorites(siteId);
        CREATE INDEX IF NOT EXISTS idx_booru_favorites_createdAt ON booru_favorites(createdAt DESC);
        CREATE INDEX IF NOT EXISTS idx_booru_download_queue_status ON booru_download_queue(status);
        CREATE INDEX IF NOT EXISTS idx_booru_download_queue_siteId ON booru_download_queue(siteId);
        CREATE INDEX IF NOT EXISTS idx_booru_download_queue_priority ON booru_download_queue(priority DESC);
        CREATE INDEX IF NOT EXISTS idx_booru_search_history_siteId ON booru_search_history(siteId);
        CREATE INDEX IF NOT EXISTS idx_booru_search_history_createdAt ON booru_search_history(createdAt DESC);
      `, (err) => err ? reject(err) : resolve());
    });

    console.log('[database] Booru相关表创建成功');
    // === Booru 相关表结束 ===

    // === 批量下载相关表开始 ===
    console.log('[database] 开始创建批量下载相关表...');

    // 创建 bulk_download_tasks 表 - 批量下载任务配置
    await run(database, `
      CREATE TABLE IF NOT EXISTS bulk_download_tasks (
        id TEXT PRIMARY KEY,
        siteId INTEGER NOT NULL,
        path TEXT NOT NULL,
        tags TEXT NOT NULL,
        blacklistedTags TEXT,
        notifications INTEGER DEFAULT 1,
        skipIfExists INTEGER DEFAULT 1,
        quality TEXT,
        perPage INTEGER DEFAULT 20,
        concurrency INTEGER DEFAULT 3,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE
      )
    `);

    // 创建 bulk_download_sessions 表 - 批量下载会话
    await run(database, `
      CREATE TABLE IF NOT EXISTS bulk_download_sessions (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        siteId INTEGER NOT NULL,
        status TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        completedAt TEXT,
        currentPage INTEGER DEFAULT 1,
        totalPages INTEGER,
        error TEXT,
        deletedAt TEXT,
        FOREIGN KEY (taskId) REFERENCES bulk_download_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE
      )
    `);

    // 创建 bulk_download_records 表 - 批量下载记录（每个图片的下载记录）
    await run(database, `
      CREATE TABLE IF NOT EXISTS bulk_download_records (
        url TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        status TEXT NOT NULL,
        page INTEGER NOT NULL,
        pageIndex INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        fileSize INTEGER,
        fileName TEXT NOT NULL,
        extension TEXT,
        error TEXT,
        downloadId TEXT,
        headers TEXT,
        thumbnailUrl TEXT,
        sourceUrl TEXT,
        PRIMARY KEY (url, sessionId),
        FOREIGN KEY (sessionId) REFERENCES bulk_download_sessions(id) ON DELETE CASCADE
      )
    `);

    // 创建 bulk_download_session_stats 表 - 批量下载会话统计
    await run(database, `
      CREATE TABLE IF NOT EXISTS bulk_download_session_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT UNIQUE,
        coverUrl TEXT,
        siteUrl TEXT,
        totalFiles INTEGER,
        totalSize INTEGER,
        averageDuration INTEGER,
        averageFileSize INTEGER,
        largestFileSize INTEGER,
        smallestFileSize INTEGER,
        medianFileSize INTEGER,
        avgFilesPerPage REAL,
        maxFilesPerPage INTEGER,
        minFilesPerPage INTEGER,
        extensionCounts TEXT,
        FOREIGN KEY (sessionId) REFERENCES bulk_download_sessions(id) ON DELETE SET NULL
      )
    `);

    // 添加进度字段（如果不存在）- 使用 PRAGMA 检查避免锁表
    if (!(await columnExists(database, 'bulk_download_records', 'progress'))) {
      await run(database, 'ALTER TABLE bulk_download_records ADD COLUMN progress INTEGER DEFAULT 0');
      console.log('[database] 已添加 progress 字段到 bulk_download_records');
    }
    if (!(await columnExists(database, 'bulk_download_records', 'downloadedBytes'))) {
      await run(database, 'ALTER TABLE bulk_download_records ADD COLUMN downloadedBytes INTEGER DEFAULT 0');
      console.log('[database] 已添加 downloadedBytes 字段到 bulk_download_records');
    }
    if (!(await columnExists(database, 'bulk_download_records', 'totalBytes'))) {
      await run(database, 'ALTER TABLE bulk_download_records ADD COLUMN totalBytes INTEGER DEFAULT 0');
      console.log('[database] 已添加 totalBytes 字段到 bulk_download_records');
    }

    // 批量创建批量下载相关索引
    await new Promise<void>((resolve, reject) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_bulk_download_tasks_siteId ON bulk_download_tasks(siteId);
        CREATE INDEX IF NOT EXISTS idx_bulk_download_tasks_createdAt ON bulk_download_tasks(createdAt DESC);
        CREATE INDEX IF NOT EXISTS idx_bulk_download_sessions_taskId ON bulk_download_sessions(taskId);
        CREATE INDEX IF NOT EXISTS idx_bulk_download_sessions_status ON bulk_download_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_bulk_download_sessions_startedAt ON bulk_download_sessions(startedAt DESC);
        CREATE INDEX IF NOT EXISTS idx_bulk_download_sessions_deletedAt ON bulk_download_sessions(deletedAt) WHERE deletedAt IS NULL;
        CREATE INDEX IF NOT EXISTS idx_bulk_download_records_sessionId ON bulk_download_records(sessionId);
        CREATE INDEX IF NOT EXISTS idx_bulk_download_records_status ON bulk_download_records(status);
        CREATE INDEX IF NOT EXISTS idx_bulk_download_records_page ON bulk_download_records(page, pageIndex);
        CREATE INDEX IF NOT EXISTS idx_bulk_download_records_downloadId ON bulk_download_records(sessionId, downloadId);
      `, (err) => err ? reject(err) : resolve());
    });

    console.log('[database] 批量下载相关表创建成功');
    // === 批量下载相关表结束 ===

    // === 收藏标签相关表开始 ===
    console.log('[database] 开始创建收藏标签相关表...');

    // 创建 booru_favorite_tags 表 - 收藏的标签
    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_favorite_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        siteId INTEGER,
        tagName TEXT NOT NULL,
        labels TEXT,
        queryType TEXT DEFAULT 'tag',
        notes TEXT,
        sortOrder INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT,
        FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE,
        UNIQUE(siteId, tagName)
      )
    `);

    // 创建 booru_favorite_tag_labels 表 - 标签分组
    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_favorite_tag_labels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        sortOrder INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL
      )
    `);

    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_favorite_tag_download_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        favoriteTagId INTEGER NOT NULL UNIQUE,
        galleryId INTEGER,
        downloadPath TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        autoCreateGallery INTEGER,
        autoSyncGalleryAfterDownload INTEGER,
        quality TEXT,
        perPage INTEGER,
        concurrency INTEGER,
        skipIfExists INTEGER,
        notifications INTEGER,
        blacklistedTags TEXT,
        lastTaskId TEXT,
        lastSessionId TEXT,
        lastStartedAt TEXT,
        lastCompletedAt TEXT,
        lastStatus TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (favoriteTagId) REFERENCES booru_favorite_tags(id) ON DELETE CASCADE,
        FOREIGN KEY (galleryId) REFERENCES galleries(id) ON DELETE SET NULL
      )
    `);

    // 批量创建收藏标签相关索引
    await new Promise<void>((resolve, reject) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_favorite_tags_siteId ON booru_favorite_tags(siteId);
        CREATE INDEX IF NOT EXISTS idx_favorite_tags_tagName ON booru_favorite_tags(tagName);
        CREATE INDEX IF NOT EXISTS idx_favorite_tags_sortOrder ON booru_favorite_tags(sortOrder);
        CREATE INDEX IF NOT EXISTS idx_favorite_tag_labels_sortOrder ON booru_favorite_tag_labels(sortOrder);
        CREATE INDEX IF NOT EXISTS idx_favorite_tag_download_bindings_galleryId ON booru_favorite_tag_download_bindings(galleryId);
        CREATE INDEX IF NOT EXISTS idx_favorite_tag_download_bindings_lastSessionId ON booru_favorite_tag_download_bindings(lastSessionId);
      `, (err) => err ? reject(err) : resolve());
    });

    console.log('[database] 收藏标签相关表创建成功');
    // === 收藏标签相关表结束 ===

    // === 黑名单标签相关表开始 ===
    console.log('[database] 开始创建黑名单标签相关表...');

    // 创建 booru_blacklisted_tags 表 - 黑名单标签
    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_blacklisted_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        siteId INTEGER,
        tagName TEXT NOT NULL,
        isActive INTEGER DEFAULT 1,
        reason TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT,
        FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE,
        UNIQUE(siteId, tagName)
      )
    `);

    // 批量创建黑名单标签相关索引
    await new Promise<void>((resolve, reject) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_blacklisted_tags_siteId ON booru_blacklisted_tags(siteId);
        CREATE INDEX IF NOT EXISTS idx_blacklisted_tags_active ON booru_blacklisted_tags(isActive);
        CREATE INDEX IF NOT EXISTS idx_blacklisted_tags_tagName ON booru_blacklisted_tags(tagName);
      `, (err) => err ? reject(err) : resolve());
    });

    console.log('[database] 黑名单标签相关表创建成功');
    // === 黑名单标签相关表结束 ===

    // === 无效图片表 ===
    console.log('[database] 开始创建无效图片表...');

    await run(database, `
      CREATE TABLE IF NOT EXISTS invalid_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        originalImageId INTEGER NOT NULL,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        fileSize INTEGER,
        width INTEGER,
        height INTEGER,
        format TEXT,
        thumbnailPath TEXT,
        detectedAt TEXT NOT NULL,
        galleryId INTEGER,
        FOREIGN KEY (galleryId) REFERENCES galleries(id) ON DELETE SET NULL
      )
    `);

    await new Promise<void>((resolve, reject) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_invalid_images_detectedAt ON invalid_images(detectedAt DESC);
        CREATE INDEX IF NOT EXISTS idx_invalid_images_galleryId ON invalid_images(galleryId);
        CREATE INDEX IF NOT EXISTS idx_invalid_images_originalImageId ON invalid_images(originalImageId);
      `, (err) => err ? reject(err) : resolve());
    });

    console.log('[database] 无效图片表创建成功');

    // === 性能优化索引 ===
    console.log('[database] 创建性能优化索引...');
    // 复合索引：分页浏览和排序场景
    // 收藏状态查询、批量下载进度统计（覆盖索引）、收藏标签复合查询
    // booru_posts JOIN images 表、image_tags 反向查询优化
    // 下载页过滤：按站点 + 下载状态、评级过滤、收藏列表分页
    await new Promise<void>((resolve, reject) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_booru_posts_site_created ON booru_posts(siteId, createdAt DESC);
        CREATE INDEX IF NOT EXISTS idx_booru_favorites_postId ON booru_favorites(postId);
        CREATE INDEX IF NOT EXISTS idx_bulk_records_session_status ON bulk_download_records(sessionId, status);
        CREATE INDEX IF NOT EXISTS idx_favorite_tags_site_tag ON booru_favorite_tags(siteId, tagName);
        CREATE INDEX IF NOT EXISTS idx_booru_posts_localImageId ON booru_posts(localImageId);
        CREATE INDEX IF NOT EXISTS idx_image_tags_tagId ON image_tags(tagId);
        CREATE INDEX IF NOT EXISTS idx_booru_posts_site_downloaded ON booru_posts(siteId, downloaded);
        CREATE INDEX IF NOT EXISTS idx_booru_posts_site_rating ON booru_posts(siteId, rating);
        CREATE INDEX IF NOT EXISTS idx_booru_favorites_site_created ON booru_favorites(siteId, createdAt DESC);
      `, (err) => err ? reject(err) : resolve());
    });
    console.log('[database] 性能优化索引创建成功');

    // === 收藏夹分组相关表 ===
    console.log('[database] 开始创建收藏夹分组相关表...');

    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_favorite_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        siteId INTEGER,
        name TEXT NOT NULL,
        color TEXT,
        sortOrder INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE
      )
    `);

    // 为 booru_favorites 添加 groupId 字段
    if (!(await columnExists(database, 'booru_favorites', 'groupId'))) {
      await run(database, 'ALTER TABLE booru_favorites ADD COLUMN groupId INTEGER REFERENCES booru_favorite_groups(id) ON DELETE SET NULL');
      console.log('[database] 已添加 groupId 字段到 booru_favorites');
    }

    await new Promise<void>((resolve, reject) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_favorite_groups_siteId ON booru_favorite_groups(siteId);
        CREATE INDEX IF NOT EXISTS idx_booru_favorites_groupId ON booru_favorites(groupId);
      `, (err) => err ? reject(err) : resolve());
    });
    console.log('[database] 收藏夹分组相关表创建成功');

    // 为 booru_posts 添加 isLiked 字段（服务端喜欢状态，跨页面持久化）
    if (!(await columnExists(database, 'booru_posts', 'isLiked'))) {
      await run(database, 'ALTER TABLE booru_posts ADD COLUMN isLiked INTEGER DEFAULT 0');
      console.log('[database] 已添加 isLiked 字段到 booru_posts');
    }

    // 为 booru_tags 添加 updatedAt 字段（标签缓存过期清理用）
    if (!(await columnExists(database, 'booru_tags', 'updatedAt'))) {
      await run(database, "ALTER TABLE booru_tags ADD COLUMN updatedAt TEXT NOT NULL DEFAULT ''");
      await run(database, 'UPDATE booru_tags SET updatedAt = createdAt WHERE updatedAt = \'\'');
      console.log('[database] 已添加 updatedAt 字段到 booru_tags');
    }

    if (!(await columnExists(database, 'booru_favorite_tag_download_bindings', 'autoCreateGallery'))) {
      await run(database, 'ALTER TABLE booru_favorite_tag_download_bindings ADD COLUMN autoCreateGallery INTEGER');
      console.log('[database] 已添加 autoCreateGallery 字段到 booru_favorite_tag_download_bindings');
    }

    if (!(await columnExists(database, 'booru_favorite_tag_download_bindings', 'autoSyncGalleryAfterDownload'))) {
      await run(database, 'ALTER TABLE booru_favorite_tag_download_bindings ADD COLUMN autoSyncGalleryAfterDownload INTEGER');
      console.log('[database] 已添加 autoSyncGalleryAfterDownload 字段到 booru_favorite_tag_download_bindings');
    }

    if (!(await columnExists(database, 'bulk_download_sessions', 'originType'))) {
      await run(database, 'ALTER TABLE bulk_download_sessions ADD COLUMN originType TEXT');
      console.log('[database] 已添加 originType 字段到 bulk_download_sessions');
    }

    if (!(await columnExists(database, 'bulk_download_sessions', 'originId'))) {
      await run(database, 'ALTER TABLE bulk_download_sessions ADD COLUMN originId INTEGER');
      console.log('[database] 已添加 originId 字段到 bulk_download_sessions');
    }

    // === 保存的搜索表 ===
    console.log('[database] 开始创建保存的搜索表...');

    await run(database, `
      CREATE TABLE IF NOT EXISTS booru_saved_searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        siteId INTEGER,
        name TEXT NOT NULL,
        query TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE
      )
    `);

    await new Promise<void>((resolve, reject) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_saved_searches_siteId ON booru_saved_searches(siteId);
        CREATE INDEX IF NOT EXISTS idx_saved_searches_createdAt ON booru_saved_searches(createdAt DESC);
      `, (err) => err ? reject(err) : resolve());
    });
    console.log('[database] 保存的搜索表创建成功');

    // === 迁移 booru_favorites.postId 从 API post ID 到 booru_posts.id ===
    // 旧版代码将 Moebooru API post ID 存入 booru_favorites.postId，
    // 但 FK 约束要求存储 booru_posts.id（自动增量主键）。
    // 此迁移将不合规的行更新为正确的 DB 主键，并删除孤儿行。
    try {
      const invalidCount = await get<{ cnt: number }>(
        database,
        'SELECT COUNT(*) as cnt FROM booru_favorites WHERE postId NOT IN (SELECT id FROM booru_posts)'
      );
      if (invalidCount && invalidCount.cnt > 0) {
        console.log(`[database] 检测到 ${invalidCount.cnt} 条 booru_favorites 行存储了 API post ID，开始迁移...`);
        // 将 API post ID 映射到对应的 booru_posts.id
        await run(database, `
          UPDATE booru_favorites
          SET postId = (
            SELECT p.id FROM booru_posts p
            WHERE p.postId = booru_favorites.postId AND p.siteId = booru_favorites.siteId
            LIMIT 1
          )
          WHERE postId NOT IN (SELECT id FROM booru_posts)
            AND EXISTS (
              SELECT 1 FROM booru_posts p
              WHERE p.postId = booru_favorites.postId AND p.siteId = booru_favorites.siteId
            )
        `);
        // 删除无法映射的孤儿行（对应帖子已不在 booru_posts 中）
        await run(database, 'DELETE FROM booru_favorites WHERE postId NOT IN (SELECT id FROM booru_posts)');
        console.log('[database] booru_favorites.postId 迁移完成');
      }
    } catch (migErr) {
      console.warn('[database] booru_favorites 迁移跳过（可能数据库为空）:', migErr);
    }

    // === 图集与文件夹解耦迁移（Expand：建关联表 + 回填，不动旧列） ===
    console.log('[database] 开始图集与文件夹解耦迁移...');
    await migrateGalleryFolderDecoupling(database);
    console.log('[database] 图集与文件夹解耦迁移完成');

    // === Phase 8A contract：重建 galleries 删旧列（folderPath/isWatching/recursive/extensions），
    //     isWatching→autoScan。必须在 migrateGalleryFolderDecoupling 之后——回填读 galleries.folderPath，
    //     contract 删列后回填判断自动短路。 ===
    console.log('[database] 开始 galleries contract 迁移...');
    await contractGalleriesTable(database);
    console.log('[database] galleries contract 迁移完成');

    // changeSeq 迁移必须先于触发器安装：触发器体引用 sync_change_seq 表与 images.changeSeq 列
    await ensureChangeSeqMigration(database);

    // 同步触碰触发器（依赖 gallery_images 表已由上方迁移建好）
    await ensureSyncTouchTriggers(database);

    // 插入默认站点（如果不存在）
    console.log('[database] 检查并插入默认Booru站点...');
    const defaultSites = [
      {
        name: 'Yande.re',
        url: 'https://yande.re',
        type: 'moebooru',
        salt: 'choujin-steiner--{0}--',
        favoriteSupport: 1,
        active: 1
      },
      {
        name: 'Konachan.com',
        url: 'https://konachan.com',
        type: 'moebooru',
        salt: 'So-I-Heard-You-Like-Mupkids-?--{0}--',
        favoriteSupport: 1,
        active: 0
      },
      {
        name: 'Konachan.net',
        url: 'https://konachan.net',
        type: 'moebooru',
        salt: 'So-I-Heard-You-Like-Mupkids-?--{0}--',
        favoriteSupport: 1,
        active: 0
      }
    ];

    for (const site of defaultSites) {
      try {
        await run(database, `
          INSERT OR IGNORE INTO booru_sites (name, url, type, salt, favoriteSupport, active, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `, [
          site.name,
          site.url,
          site.type,
          site.salt,
          site.favoriteSupport,
          site.active
        ]);
        console.log(`[database] 站点 ${site.name} 已添加（如果不存在）`);
      } catch (error) {
        console.error(`[database] 添加站点 ${site.name} 失败:`, error);
      }
    }

    console.log('Database tables created successfully');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Database initialization error:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 关闭数据库连接
 */
export function closeDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve();
      return;
    }

    db.close((err) => {
      if (err) {
        reject(err);
      } else {
        db = null;
        console.log('Database connection closed');
        resolve();
      }
    });
  });
}

/**
 * 封装 db.run 为 Promise
 */
/**
 * 检查表中是否存在指定列（使用 PRAGMA table_info，零开销）
 */
export async function columnExists(db: sqlite3.Database, table: string, column: string): Promise<boolean> {
  const rows = await all<{ name: string }>(db, `PRAGMA table_info(${table})`);
  return rows.some(r => r.name === column);
}

export function run(db: sqlite3.Database, sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * 封装 db.run 为 Promise，并返回 changes（受影响的行数）
 */
export function runWithChanges(db: sqlite3.Database, sql: string, params: any[] = []): Promise<{ changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve({ changes: this.changes });
      }
    });
  });
}

/**
 * 封装 db.get 为 Promise
 */
export function get<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row as T);
      }
    });
  });
}

/**
 * 封装 db.all 为 Promise
 */
export function all<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows as T[]);
      }
    });
  });
}

/**
 * 在事务中执行一组数据库操作
 * 所有操作成功则提交，任一操作失败则回滚
 * @param db 数据库连接
 * @param fn 包含数据库操作的异步函数
 */
export async function runInTransaction<T>(db: sqlite3.Database, fn: () => Promise<T>): Promise<T> {
  const previousTransaction = transactionQueues.get(db) ?? Promise.resolve();

  const transaction = previousTransaction
    .catch(() => undefined)
    .then(async () => {
      let committed = false;

      await run(db, 'BEGIN TRANSACTION');
      try {
        const result = await fn();
        await run(db, 'COMMIT');
        committed = true;
        return result;
      } catch (error) {
        if (!committed) {
          try {
            await run(db, 'ROLLBACK');
          } catch (rollbackError) {
            console.error('[database] ROLLBACK failed:', rollbackError);
          }
        }
        throw error;
      }
    });

  transactionQueues.set(db, transaction.then(() => undefined, () => undefined));
  return transaction;
}

/**
 * 在与 runInTransaction 相同的事务队列上独占执行一段数据库操作。
 * 只串行化、不自动包 BEGIN/COMMIT：回调自行负责事务配对（或完全不开事务）。
 *
 * 用途：需要在「事务外」执行才生效的 PRAGMA（如 foreign_keys 开关在事务内是
 * no-op），同时又必须与所有排队事务互斥的迁移类操作（见 contractGalleriesTable）。
 * 队列不因回调抛错而中断，错误原样向调用方传播。
 */
export async function runExclusive<T>(db: sqlite3.Database, fn: () => Promise<T>): Promise<T> {
  const previousTransaction = transactionQueues.get(db) ?? Promise.resolve();

  const exclusive = previousTransaction
    .catch(() => undefined)
    .then(fn);

  transactionQueues.set(db, exclusive.then(() => undefined, () => undefined));
  return exclusive;
}

/**
 * 预编译批量执行：同一条参数化 SQL 对多组参数按序逐组执行（prepare 一次、run N 次、finalize）。
 *
 * node-sqlite3 的 db.run 每次调用都要 prepare→run→finalize 三次线程池往返；
 * 大批量逐行改写（如重定位整库 UPDATE，单表可达数十万行）用本函数省去逐行重编译，
 * 往返数降为约 1/3。只做语句复用，不改变逐行语义与执行顺序；参数经绑定传入
 *（嵌入 NUL 等特殊字符安全）；在事务内调用时随事务一并回滚。
 */
export async function runBatch(db: sqlite3.Database, sql: string, paramRows: unknown[][]): Promise<void> {
  if (paramRows.length === 0) return;
  const stmt = await new Promise<sqlite3.Statement>((resolve, reject) => {
    const prepared: sqlite3.Statement = db.prepare(sql, (err) => (err ? reject(err) : resolve(prepared)));
  });
  try {
    for (const params of paramRows) {
      await new Promise<void>((resolve, reject) => {
        stmt.run(params as any[], (err) => (err ? reject(err) : resolve()));
      });
    }
  } finally {
    // finalize 失败不掩盖循环里的原始错误（只释放语句句柄）
    await new Promise<void>((resolve) => {
      stmt.finalize(() => resolve());
    });
  }
}

/**
 * 检查数据库是否已初始化
 */
export async function isDatabaseInitialized(): Promise<boolean> {
  try {
    const dbPath = getDatabasePath();
    await fs.access(dbPath);
    return true;
  } catch {
    return false;
  }
}

// ===========================================================================
// 图集与文件夹解耦迁移（Expand 阶段）
//
// 引入两张关联表，把"图片归属"从 filepath 前缀隐式匹配升级为显式成员表：
//   - gallery_folders：图集 ↔ 文件夹（1:N），folderPath 全局唯一
//   - gallery_images ：图集 ↔ 图片成员（主键 galleryId+imageId）
//
// 本迁移只"扩张"（建表 + 回填），不动 galleries 旧列（folderPath/isWatching/
// recursive/extensions），保证迁移期间旧代码仍可运行。旧列清理（galleries 重建、
// isWatching→autoScan 改名）留到所有消费方改造完成后的 contract 阶段。
//
// 幂等：建表用 IF NOT EXISTS；回填用 INSERT OR IGNORE（folderPath 唯一 / 成员主键）。
// ===========================================================================

/** 建 gallery_folders / gallery_images 两张表与索引（幂等） */
export async function ensureDecouplingTables(database: sqlite3.Database): Promise<void> {
  await run(database, `
    CREATE TABLE IF NOT EXISTS gallery_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      galleryId INTEGER NOT NULL,
      folderPath TEXT NOT NULL UNIQUE,   -- 全局唯一：一个文件夹只属于一个图集
      recursive INTEGER NOT NULL DEFAULT 1,
      extensions TEXT,                   -- JSON 数组；为空时由调用方用默认扩展名
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE
    )
  `);

  await run(database, `
    CREATE TABLE IF NOT EXISTS gallery_images (
      galleryId INTEGER NOT NULL,
      imageId INTEGER NOT NULL,
      addedAt TEXT NOT NULL,
      PRIMARY KEY (galleryId, imageId),
      FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE,
      FOREIGN KEY (imageId) REFERENCES images (id) ON DELETE CASCADE
    )
  `);

  await run(database, `CREATE INDEX IF NOT EXISTS idx_gallery_folders_galleryId ON gallery_folders (galleryId)`);
  await run(database, `CREATE INDEX IF NOT EXISTS idx_gallery_images_imageId ON gallery_images (imageId)`);
}

/**
 * 从旧 galleries.folderPath 回填 gallery_folders（每个图集一条绑定）。
 * 幂等：folderPath 全局唯一 + INSERT OR IGNORE。
 * 仅在 galleries 仍含 folderPath 列时由编排函数调用。
 */
export async function backfillGalleryFolders(database: sqlite3.Database): Promise<void> {
  await run(database, `
    INSERT OR IGNORE INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
    SELECT id, folderPath, COALESCE(recursive, 1), extensions, createdAt, updatedAt
      FROM galleries
     WHERE folderPath IS NOT NULL AND folderPath <> ''
  `);
}

/**
 * 回填 gallery_images：对每个图集，按与 deleteGallery 一致的 recursive 感知前缀匹配
 * 选出其图片写入成员表。幂等（成员主键 + INSERT OR IGNORE）。
 *
 * 匹配规则（与 galleryService 的成员/覆盖谓词字面一致，保持图片归属与现状相同）：
 *   - recursive=1：filepath LIKE 'F{sep}%' ESCAPE '\' OR filepath = 'F'
 *   - recursive=0：filepath LIKE 'F{sep}%' ESCAPE '\' AND filepath NOT LIKE 'F{sep}%{sep}%' ESCAPE '\'
 * 其中 F = normalizePath(folderPath)，sep = path.sep（与入库 filepath 分隔符一致）。
 * 字面前缀 F{sep} 经 escapeLike 转义（_/% 不再当通配符），故兄弟目录（如 F=...gal_1
 * 误匹配 ...galA1）不会被错误塞进成员表；末尾 % 与 {sep}% 段保留为通配符。
 *
 * 性能：每个图集用单条集合式 INSERT OR IGNORE ... SELECT 完成（与
 * galleryService.ensureMembershipForFolder 同形态），语句数只随图集数增长、不随
 * 图片数增长——避免大库升级首启时"命中行拉回 JS 再逐行 INSERT"的数十万次语句往返。
 */
export async function backfillGalleryImages(database: sqlite3.Database): Promise<void> {
  const galleries = await all<{ id: number; folderPath: string; recursive: number }>(
    database,
    `SELECT id, folderPath, recursive FROM galleries WHERE folderPath IS NOT NULL AND folderPath <> ''`
  );

  const now = new Date().toISOString();

  for (const g of galleries) {
    const normalized = normalizePath(g.folderPath);
    const likePrefix = normalized + path.sep;
    const isRecursive = g.recursive === 1 || (g.recursive as unknown as boolean) === true;

    // 前缀经 escapeLike 转义（_/% 不再当通配符），配套 ESCAPE '\'；末尾 % 与 sep% 段保留为通配符。
    const escapedPrefix = escapeLike(likePrefix);
    if (isRecursive) {
      await run(
        database,
        `INSERT OR IGNORE INTO gallery_images (galleryId, imageId, addedAt)
           SELECT ?, id, ? FROM images
            WHERE filepath LIKE ? ESCAPE '\\' OR filepath = ?`,
        [g.id, now, escapedPrefix + '%', normalized]
      );
    } else {
      await run(
        database,
        `INSERT OR IGNORE INTO gallery_images (galleryId, imageId, addedAt)
           SELECT ?, id, ? FROM images
            WHERE filepath LIKE ? ESCAPE '\\' AND filepath NOT LIKE ? ESCAPE '\\'`,
        [g.id, now, escapedPrefix + '%', escapedPrefix + '%' + escapeLike(path.sep) + '%']
      );
    }
  }
}

/**
 * 解耦迁移编排（幂等）。在 initDatabase 末尾调用。
 * - 先建两张关联表（始终执行）。
 * - 仅当 galleries 仍是旧结构（含 folderPath 列）时回填 folders/images；
 *   contract 阶段删列后该判断为 false，回填自动跳过。
 */
export async function migrateGalleryFolderDecoupling(database: sqlite3.Database): Promise<void> {
  await ensureDecouplingTables(database);                 // DDL 留在事务外（避免隐式提交干扰事务）

  if (await columnExists(database, 'galleries', 'folderPath')) {
    // 回填可能涉及大量行；与 deleteGallery 一致包进单事务，避免逐行 autocommit 在
    // 大图库启动时产生数千次 WAL 提交。幂等保证（INSERT OR IGNORE + 唯一/主键约束）
    // 不变：事务整体失败回滚后重启可安全重跑。
    await runInTransaction(database, async () => {
      await backfillGalleryFolders(database);
      await backfillGalleryImages(database);
    });
    console.log('[database] 图集解耦迁移：gallery_folders / gallery_images 回填完成');
  }
}

// ===========================================================================
// 图集与文件夹解耦迁移（Contract 阶段）
//
// 删除 galleries 的旧列（folderPath/isWatching/recursive/extensions）并把 isWatching
// 改名为 autoScan。folderPath/recursive/extensions 现在归 gallery_folders（解耦回填后
// 已是 source of truth），galleries 只保留图集自身元数据 + autoScan 自动扫描开关。
//
// 必须在 migrateGalleryFolderDecoupling 之后运行：回填读 galleries.folderPath，删列后
// 回填判断（columnExists 'folderPath'）自动短路。
//
// SQLite 不支持 DROP COLUMN（旧版本）+ 重命名列的一步迁移，统一用「建新表 → 拷数据 →
// 删旧表 → 改名」的 FK 保留式重建：
//   - 引用 galleries(id) 的子表（gallery_folders / gallery_images /
//     booru_favorite_tag_download_bindings / invalid_images）通过保留 id 保持有效；
//   - 用 PRAGMA foreign_key_check 在提交前自检，发现违例即抛错回滚（绝不留坏库）。
//
// 幂等：仅当 galleries 仍含 folderPath 列时执行；contract 后该判断为 false，直接跳过。
//
// 注意：用裸 run('BEGIN'/'COMMIT')（而非 runInTransaction），因为 PRAGMA foreign_keys
// 在事务内是 no-op——必须先在事务外关闭外键、重建后再打开。为避免裸 BEGIN 与
// transactionQueues 里的排队事务互撞（升级首启窗口/IPC 先于迁移开放，渲染层可能
// 已排入事务），整体通过 runExclusive 挂进同一条队列：PRAGMA 的关/开在独占段内、
// 事务外执行，与所有 runInTransaction 事务严格互斥。
// ===========================================================================
export async function contractGalleriesTable(database: sqlite3.Database): Promise<void> {
  // 幂等快路径：已是新结构（无 folderPath）则不必进独占队列
  if (!(await columnExists(database, 'galleries', 'folderPath'))) {
    return;
  }

  await runExclusive(database, async () => {
    // 独占段内重新检查：防并发双跑（渲染层 App.tsx 挂载时会再触发一次 db.init，
    // 两个 contract 先后进入队列时，后进入者在此短路而不是重复重建）
    if (!(await columnExists(database, 'galleries', 'folderPath'))) {
      return;
    }

    await run(database, 'PRAGMA foreign_keys=OFF');
    // 标记 BEGIN 是否已成功开启：若 BEGIN 本身失败（如撞上队列外的裸事务），
    // 绝不能发 ROLLBACK——那会回滚别人正在进行的事务、破坏其原子性。
    let began = false;
    try {
      await run(database, 'BEGIN');
      began = true;

      // 新结构表（与上方 CREATE TABLE IF NOT EXISTS galleries 一致）
      await run(database, `
        CREATE TABLE galleries_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          coverImageId INTEGER,
          imageCount INTEGER DEFAULT 0,
          lastScannedAt TEXT,
          autoScan INTEGER NOT NULL DEFAULT 1,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          FOREIGN KEY (coverImageId) REFERENCES images (id) ON DELETE SET NULL
        )
      `);

      // 拷数据：保留 id（子表 FK 依赖），isWatching→autoScan（NULL 回退 1）
      await run(database, `
        INSERT INTO galleries_new (id, name, coverImageId, imageCount, lastScannedAt, autoScan, createdAt, updatedAt)
        SELECT id, name, coverImageId, imageCount, lastScannedAt, COALESCE(isWatching, 1), createdAt, updatedAt
          FROM galleries
      `);

      await run(database, 'DROP TABLE galleries');
      await run(database, 'ALTER TABLE galleries_new RENAME TO galleries');

      // 重建保留的索引（folderPath 索引随列一并废弃）
      await run(database, 'CREATE INDEX IF NOT EXISTS idx_galleries_lastScannedAt ON galleries (lastScannedAt DESC)');

      // 提交前 FK 自检：保留 id 后引用 galleries 的子表行应全部有效
      const violations = await all(database, 'PRAGMA foreign_key_check');
      if (violations.length) {
        throw new Error('contract galleries FK check failed: ' + JSON.stringify(violations));
      }

      await run(database, 'COMMIT');
    } catch (e) {
      if (began) {
        await run(database, 'ROLLBACK').catch(() => {});
      }
      throw e;
    } finally {
      await run(database, 'PRAGMA foreign_keys=ON');
    }
  });
}

/**
 * changeSeq 迁移（M4-T16，根治 M1 Issue 1）：images 加单调变更序列列，
 * 退役「低精度墙钟 updatedAt 承担全序变更日志」的职责。幂等（columnExists 门控）。
 *
 * 回填按旧游标序 (updatedAt, id) 编 ROW_NUMBER（D14）：changeSeq 序与旧 {u,i} 游标序
 * 同构，旧游标的保守换轨水位（见 syncService.listSyncImages）才不会跳过未读行；
 * 用 `changeSeq = id` 回填则 id 序与 updatedAt 序交错时换轨水位会跳行，违反 D14。
 *
 * 首次迁移必须 bump dataVersion：存量客户端全量重建，旧 {u,i} 游标不会再被发出，
 * 换轨兼容仅作 defense-in-depth。
 */
export async function ensureChangeSeqMigration(database: sqlite3.Database): Promise<void> {
  const migrated = await columnExists(database, 'images', 'changeSeq');
  if (!migrated) {
    await run(database, 'ALTER TABLE images ADD COLUMN changeSeq INTEGER NOT NULL DEFAULT 0');
    // UPDATE...FROM 需 SQLite 3.33+（npm sqlite3 捆绑版本满足），一次 O(N log N) 完成，
    // 勿用相关子查询 O(N²) 写法。
    await run(database, `
      UPDATE images SET changeSeq = ranked.rn
      FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY updatedAt, id) AS rn FROM images) AS ranked
      WHERE images.id = ranked.id
    `);
  }
  await run(database, 'CREATE TABLE IF NOT EXISTS sync_change_seq (seq INTEGER NOT NULL)');
  // 播种必须经派生表：聚合 SELECT 无论 WHERE 如何都恒出一行（WHERE 只筛 images 输入行，
  // 不筛聚合输出），直接挂 NOT EXISTS 会在重复调用时再插一行、破坏单行不变量。
  await run(database, `INSERT INTO sync_change_seq (seq)
    SELECT seq FROM (SELECT COALESCE(MAX(changeSeq), 0) AS seq FROM images)
    WHERE NOT EXISTS (SELECT 1 FROM sync_change_seq)`);
  await run(database, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_images_changeSeq ON images (changeSeq)');
  if (!migrated) {
    // 动态 import 防 database↔config 模块环；bump 失败仅记录（bumpSyncDataVersion 自身语义）
    const { bumpSyncDataVersion } = await import('./config.js');
    await bumpSyncDataVersion();
  }
}

/** 取下一个变更序列值（JS INSERT 路径用；触发器路径在 SQL 内自增同一计数器）。单语句原子。 */
export async function nextChangeSeq(db: sqlite3.Database): Promise<number> {
  const row = await get<{ seq: number }>(db, 'UPDATE sync_change_seq SET seq = seq + 1 RETURNING seq');
  return row!.seq;
}

/**
 * 同步触碰触发器（安卓相册 M1，spec §5.3；M4-T16 起同时维护 changeSeq）：
 * 标签/图集归属变化时触碰 images.updatedAt 并写入新 bump 的 changeSeq，
 * 供移动端 changeSeq 游标增量同步感知（updatedAt 保留服务 DTO 展示与排序）。
 * strftime('%Y-%m-%dT%H:%M:%fZ','now') 与 JS new Date().toISOString() 字节一致，
 * 保证与既有 JS 写入的时间戳字典序可比；INSERT OR IGNORE 命中重复不触发，
 * DELETE FROM galleries 的 FK CASCADE 会触发（幂等重扫不churn、删图集可感知）。
 *
 * 先 DROP 再 CREATE：CREATE TRIGGER IF NOT EXISTS 不更新既有触发器体，
 * 升级库若不 DROP 会继续跑旧触发器（只碰 updatedAt 不碰 changeSeq），静默漏同步。
 */
export async function ensureSyncTouchTriggers(database: sqlite3.Database): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    database.exec(`
      DROP TRIGGER IF EXISTS trg_image_tags_touch_ai;
      CREATE TRIGGER trg_image_tags_touch_ai AFTER INSERT ON image_tags
      BEGIN
        UPDATE sync_change_seq SET seq = seq + 1;
        UPDATE images SET updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                          changeSeq = (SELECT seq FROM sync_change_seq)
         WHERE id = NEW.imageId;
      END;
      DROP TRIGGER IF EXISTS trg_image_tags_touch_ad;
      CREATE TRIGGER trg_image_tags_touch_ad AFTER DELETE ON image_tags
      BEGIN
        UPDATE sync_change_seq SET seq = seq + 1;
        UPDATE images SET updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                          changeSeq = (SELECT seq FROM sync_change_seq)
         WHERE id = OLD.imageId;
      END;
      DROP TRIGGER IF EXISTS trg_gallery_images_touch_ai;
      CREATE TRIGGER trg_gallery_images_touch_ai AFTER INSERT ON gallery_images
      BEGIN
        UPDATE sync_change_seq SET seq = seq + 1;
        UPDATE images SET updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                          changeSeq = (SELECT seq FROM sync_change_seq)
         WHERE id = NEW.imageId;
      END;
      DROP TRIGGER IF EXISTS trg_gallery_images_touch_ad;
      CREATE TRIGGER trg_gallery_images_touch_ad AFTER DELETE ON gallery_images
      BEGIN
        UPDATE sync_change_seq SET seq = seq + 1;
        UPDATE images SET updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                          changeSeq = (SELECT seq FROM sync_change_seq)
         WHERE id = OLD.imageId;
      END;
    `, (err) => (err ? reject(err) : resolve()));
  });
}
