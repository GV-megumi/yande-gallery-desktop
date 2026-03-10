import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { getDatabasePath } from './config.js';

// 数据库连接实例
let db: sqlite3.Database | null = null;

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
        resolve(database);
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
    await run(database, `
      CREATE TABLE IF NOT EXISTS galleries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folderPath TEXT NOT NULL UNIQUE,  -- 文件夹完整路径
        name TEXT NOT NULL,               -- 图库名称
        coverImageId INTEGER,            -- 封面图片ID（引用images表）
        imageCount INTEGER DEFAULT 0,     -- 图片数量（缓存）
        lastScannedAt TEXT,              -- 最后扫描时间
        isWatching INTEGER DEFAULT 1,     -- 是否监视目录变化
        recursive INTEGER DEFAULT 1,      -- 是否递归扫描子目录
        extensions TEXT,                  -- 支持的扩展名（JSON数组）
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (coverImageId) REFERENCES images (id) ON DELETE SET NULL
      )
    `);

    // 创建索引
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_images_filename ON images (filename)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_images_createdAt ON images (createdAt DESC)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_images_updatedAt ON images (updatedAt DESC)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_images_filepath ON images (filepath)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_tags_name ON tags (name)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_yande_images_downloaded ON yande_images (downloaded)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_galleries_folderPath ON galleries (folderPath)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_galleries_lastScannedAt ON galleries (lastScannedAt DESC)');

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

    // 创建 Booru 相关索引
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_sites_type ON booru_sites(type)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_sites_active ON booru_sites(active)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_posts_siteId ON booru_posts(siteId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_posts_postId ON booru_posts(postId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_posts_downloaded ON booru_posts(downloaded)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_posts_isFavorited ON booru_posts(isFavorited)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_posts_rating ON booru_posts(rating)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_posts_md5 ON booru_posts(md5)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_tags_siteId ON booru_tags(siteId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_tags_name ON booru_tags(name)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_tags_category ON booru_tags(category)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_tags_postCount ON booru_tags(postCount DESC)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_post_tags_postId ON booru_post_tags(postId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_post_tags_tagId ON booru_post_tags(tagId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_favorites_siteId ON booru_favorites(siteId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_favorites_createdAt ON booru_favorites(createdAt DESC)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_download_queue_status ON booru_download_queue(status)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_download_queue_siteId ON booru_download_queue(siteId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_download_queue_priority ON booru_download_queue(priority DESC)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_search_history_siteId ON booru_search_history(siteId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_search_history_createdAt ON booru_search_history(createdAt DESC)');

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

    // 添加进度字段（如果不存在）- 数据库迁移
    try {
      await run(database, 'ALTER TABLE bulk_download_records ADD COLUMN progress INTEGER DEFAULT 0');
      console.log('[database] 已添加 progress 字段到 bulk_download_records');
    } catch (error: any) {
      // 字段可能已存在，忽略错误
      if (!error.message.includes('duplicate column')) {
        console.warn('[database] 添加 progress 字段失败（可能已存在）:', error.message);
      }
    }
    try {
      await run(database, 'ALTER TABLE bulk_download_records ADD COLUMN downloadedBytes INTEGER DEFAULT 0');
      console.log('[database] 已添加 downloadedBytes 字段到 bulk_download_records');
    } catch (error: any) {
      if (!error.message.includes('duplicate column')) {
        console.warn('[database] 添加 downloadedBytes 字段失败（可能已存在）:', error.message);
      }
    }
    try {
      await run(database, 'ALTER TABLE bulk_download_records ADD COLUMN totalBytes INTEGER DEFAULT 0');
      console.log('[database] 已添加 totalBytes 字段到 bulk_download_records');
    } catch (error: any) {
      if (!error.message.includes('duplicate column')) {
        console.warn('[database] 添加 totalBytes 字段失败（可能已存在）:', error.message);
      }
    }

    // 创建批量下载相关索引
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_bulk_download_tasks_siteId ON bulk_download_tasks(siteId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_bulk_download_tasks_createdAt ON bulk_download_tasks(createdAt DESC)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_bulk_download_sessions_taskId ON bulk_download_sessions(taskId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_bulk_download_sessions_status ON bulk_download_sessions(status)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_bulk_download_sessions_startedAt ON bulk_download_sessions(startedAt DESC)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_bulk_download_sessions_deletedAt ON bulk_download_sessions(deletedAt) WHERE deletedAt IS NULL');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_bulk_download_records_sessionId ON bulk_download_records(sessionId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_bulk_download_records_status ON bulk_download_records(status)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_bulk_download_records_page ON bulk_download_records(page, pageIndex)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_bulk_download_records_downloadId ON bulk_download_records(sessionId, downloadId)');

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

    // 创建收藏标签相关索引
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_favorite_tags_siteId ON booru_favorite_tags(siteId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_favorite_tags_tagName ON booru_favorite_tags(tagName)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_favorite_tags_sortOrder ON booru_favorite_tags(sortOrder)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_favorite_tag_labels_sortOrder ON booru_favorite_tag_labels(sortOrder)');

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

    // 创建黑名单标签相关索引
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_blacklisted_tags_siteId ON booru_blacklisted_tags(siteId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_blacklisted_tags_active ON booru_blacklisted_tags(isActive)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_blacklisted_tags_tagName ON booru_blacklisted_tags(tagName)');

    console.log('[database] 黑名单标签相关表创建成功');
    // === 黑名单标签相关表结束 ===

    // === 性能优化索引 ===
    console.log('[database] 创建性能优化索引...');
    // 复合索引：分页浏览和排序场景
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_posts_site_created ON booru_posts(siteId, createdAt DESC)');
    // 收藏状态查询
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_favorites_postId ON booru_favorites(postId)');
    // 批量下载进度统计（覆盖索引）
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_bulk_records_session_status ON bulk_download_records(sessionId, status)');
    // 收藏标签复合查询
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_favorite_tags_site_tag ON booru_favorite_tags(siteId, tagName)');
    // booru_posts JOIN images 表
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_posts_localImageId ON booru_posts(localImageId)');
    // image_tags 反向查询优化
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_image_tags_tagId ON image_tags(tagId)');
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

    // 为 booru_favorites 添加 groupId 字段（数据库迁移）
    try {
      await run(database, 'ALTER TABLE booru_favorites ADD COLUMN groupId INTEGER REFERENCES booru_favorite_groups(id) ON DELETE SET NULL');
      console.log('[database] 已添加 groupId 字段到 booru_favorites');
    } catch (error: any) {
      if (!error.message.includes('duplicate column')) {
        console.warn('[database] 添加 groupId 字段失败（可能已存在）:', error.message);
      }
    }

    await run(database, 'CREATE INDEX IF NOT EXISTS idx_favorite_groups_siteId ON booru_favorite_groups(siteId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_booru_favorites_groupId ON booru_favorites(groupId)');
    console.log('[database] 收藏夹分组相关表创建成功');

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

    await run(database, 'CREATE INDEX IF NOT EXISTS idx_saved_searches_siteId ON booru_saved_searches(siteId)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_saved_searches_createdAt ON booru_saved_searches(createdAt DESC)');
    console.log('[database] 保存的搜索表创建成功');

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
  await run(db, 'BEGIN TRANSACTION');
  try {
    const result = await fn();
    await run(db, 'COMMIT');
    return result;
  } catch (error) {
    await run(db, 'ROLLBACK');
    throw error;
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
