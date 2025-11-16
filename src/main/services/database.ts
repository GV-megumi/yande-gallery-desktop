import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径
const DB_DIR = path.join(__dirname, '../../../data');
const DB_PATH = path.join(DB_DIR, 'gallery.db');

// 数据库连接实例
let db: sqlite3.Database | null = null;

/**
 * 初始化数据库目录
 */
async function initDbDirectory(): Promise<void> {
  try {
    await fs.access(DB_DIR);
  } catch {
    await fs.mkdir(DB_DIR, { recursive: true });
    console.log('Created database directory:', DB_DIR);
  }
}

/**
 * 获取数据库连接（单例模式）
 */
export async function getDatabase(): Promise<sqlite3.Database> {
  if (db) {
    return db;
  }

  await initDbDirectory();

  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Database connection error:', err);
        reject(err);
      } else {
        console.log('Database connected successfully:', DB_PATH);
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
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_images_filepath ON images (filepath)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_tags_name ON tags (name)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_yande_images_downloaded ON yande_images (downloaded)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_galleries_folderPath ON galleries (folderPath)');
    await run(database, 'CREATE INDEX IF NOT EXISTS idx_galleries_lastScannedAt ON galleries (lastScannedAt DESC)');

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
 * 检查数据库是否已初始化
 */
export async function isDatabaseInitialized(): Promise<boolean> {
  try {
    await fs.access(DB_PATH);
    return true;
  } catch {
    return false;
  }
}
