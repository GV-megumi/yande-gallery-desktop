/**
 * 配置管理服务
 * 负责加载和管理应用配置，统一路径解析
 *
 * 路径解析优先级：
 *   .env CONFIG_DIR → config.yaml 所在目录
 *     → config.yaml 中的 dataPath（默认 CONFIG_DIR/data）
 *       → 数据库、缩略图、缓存、日志等子目录
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';

// ============= Token 选项类型 =============

// Token选项类型
export interface TokenOptions {
  limit?: number;
  maxlength?: number;
  case?: 'lower' | 'upper' | 'none';
  delimiter?: string;
  unsafe?: boolean;
  format?: string;
  single_letter?: boolean;
  pad_left?: number;
  sort?: {
    attribute?: 'name' | 'length';
    order?: 'asc' | 'desc';
  };
}

// Token默认选项配置
export interface TokenDefaultOptions {
  [key: string]: TokenOptions | undefined;
  tags?: TokenOptions;
  artist?: TokenOptions;
  character?: TokenOptions;
  copyright?: TokenOptions;
  date?: TokenOptions;
  rating?: TokenOptions;
  site?: TokenOptions;
  id?: TokenOptions;
  md5?: TokenOptions;
  width?: TokenOptions;
  height?: TokenOptions;
}

// ============= 配置类型定义 =============

export interface AppConfig {
  // 数据存储根目录（数据库、缩略图、缓存、日志等）
  // 支持绝对路径和相对路径（相对于 configDir）
  dataPath?: string;

  database: {
    path: string;
    logging: boolean;
  };
  downloads: {
    path: string;
    createSubfolders: boolean;
    subfolderFormat: string[];
  };
  galleries: {
    folders: GalleryFolder[];
  };
  thumbnails: {
    cachePath: string;
    maxWidth: number;
    maxHeight: number;
    quality: number;
    format: string;
  };
  app: {
    recentImagesCount: number;
    pageSize: number;
    defaultViewMode: 'grid' | 'list';
    showImageInfo: boolean;
    autoScan: boolean;
    autoScanInterval: number;
  };
  yande: {
    apiUrl: string;
    pageSize: number;
    downloadTimeout: number;
    maxConcurrentDownloads: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    filePath: string;
    consoleOutput: boolean;
    maxFileSize: number;
    maxFiles: number;
  };
  network: {
    proxy: {
      enabled: boolean;
      protocol: 'http' | 'https' | 'socks5';
      host: string;
      port: number;
      username?: string;
      password?: string;
    };
  };
  booru?: {
    appearance: {
      gridSize: number; // 图片网格大小（像素）
      previewQuality: 'auto' | 'low' | 'medium' | 'high' | 'original'; // 预览图质量
      itemsPerPage: number; // 每页数量
      paginationPosition: 'top' | 'bottom' | 'both'; // 页码位置
      pageMode: 'pagination' | 'infinite'; // 页面模式：翻页或无限滚动
      spacing: number; // 间距（像素）
      borderRadius: number; // 圆角（像素）
      margin: number; // 边距（像素）
      maxCacheSizeMB?: number; // 缓存目录最大大小（MB），默认 500MB
    };
    download: {
      filenameTemplate: string; // 文件名模板
      tokenDefaults: TokenDefaultOptions; // Token默认选项
    };
  };
}

export interface GalleryFolder {
  path: string;
  name: string;
  autoScan: boolean;
  recursive: boolean;
  extensions: string[];
}

// ============= 默认配置 =============

const DEFAULT_CONFIG: AppConfig = {
  dataPath: 'data',
  database: {
    path: 'gallery.db',
    logging: true
  },
  downloads: {
    path: 'downloads',
    createSubfolders: true,
    subfolderFormat: ['tags', 'date']
  },
  galleries: {
    folders: [
      {
        path: 'images',
        name: '默认图库',
        autoScan: true,
        recursive: true,
        extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
      }
    ]
  },
  thumbnails: {
    cachePath: 'thumbnails',
    maxWidth: 800,
    maxHeight: 800,
    quality: 92,
    format: 'webp'
  },
  app: {
    recentImagesCount: 100,
    pageSize: 50,
    defaultViewMode: 'grid',
    showImageInfo: true,
    autoScan: true,
    autoScanInterval: 30
  },
  yande: {
    apiUrl: 'https://yande.re/post.json',
    pageSize: 20,
    downloadTimeout: 60,
    maxConcurrentDownloads: 5
  },
  logging: {
    level: 'info',
    filePath: 'app.log',
    consoleOutput: true,
    maxFileSize: 10,
    maxFiles: 5
  },
  network: {
    proxy: {
      enabled: false,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
      username: '',
      password: ''
    }
  },
  booru: {
    appearance: {
      gridSize: 330,
      previewQuality: 'auto',
      itemsPerPage: 20,
      paginationPosition: 'bottom',
      pageMode: 'pagination',
      spacing: 16,
      borderRadius: 8,
      margin: 24
    },
    download: {
      filenameTemplate: '{site}_{id}_{md5}.{extension}',
      tokenDefaults: {
        tags: {
          limit: 10,
          maxlength: 50,
          case: 'lower',
          delimiter: '_',
          unsafe: false
        },
        artist: {
          limit: 5,
          maxlength: 30,
          case: 'lower',
          delimiter: '_',
          unsafe: false
        },
        character: {
          limit: 5,
          maxlength: 30,
          case: 'lower',
          delimiter: '_',
          unsafe: false
        },
        copyright: {
          limit: 3,
          maxlength: 30,
          case: 'lower',
          delimiter: '_',
          unsafe: false
        },
        date: {
          format: 'yyyy-MM-dd'
        },
        rating: {
          case: 'lower',
          single_letter: false
        },
        site: {
          case: 'lower'
        },
        id: {
          pad_left: 0
        },
        md5: {
          maxlength: 32
        },
        width: {
          unsafe: true
        },
        height: {
          unsafe: true
        }
      }
    }
  }
};

// ============= 路径系统 =============

// 配置文件所在目录（由 .env CONFIG_DIR 或默认值决定）
let configDir: string = '';

// 数据存储根目录（由 config.yaml dataPath 决定）
let dataDir: string = '';

// 默认配置目录名
const DEFAULT_CONFIG_DIR_NAME = '.yandegallery';

/**
 * 初始化路径系统
 * 1. 加载 .env 文件
 * 2. 从环境变量读取 CONFIG_DIR
 * 3. 默认使用 os.homedir()/.yandegallery
 * 4. 确保目录存在
 */
export async function initPaths(): Promise<void> {
  // 加载 .env 文件（从多个可能的位置查找）
  try {
    const dotenv = await import('dotenv');
    // 优先从 process.cwd()（程序启动目录）加载
    const envPath = path.join(process.cwd(), '.env');
    dotenv.config({ path: envPath });
    console.log('[config] 尝试加载 .env:', envPath);
  } catch (error) {
    console.warn('[config] 加载 dotenv 失败（非致命）:', error);
  }

  // 确定 configDir
  const envConfigDir = process.env.CONFIG_DIR;
  if (envConfigDir) {
    // 展开 ~ 为用户目录
    configDir = envConfigDir.startsWith('~')
      ? path.join(os.homedir(), envConfigDir.slice(1))
      : path.resolve(envConfigDir);
    console.log('[config] 使用环境变量 CONFIG_DIR:', configDir);
  } else {
    configDir = path.join(os.homedir(), DEFAULT_CONFIG_DIR_NAME);
    console.log('[config] 使用默认配置目录:', configDir);
  }

  // 确保 configDir 存在
  await fs.mkdir(configDir, { recursive: true });
}

/**
 * 初始化数据目录（在 config 加载后调用）
 * 根据 config.yaml 中的 dataPath 确定数据目录
 */
function initDataDir(config: AppConfig): void {
  const rawDataPath = config.dataPath || 'data';

  if (path.isAbsolute(rawDataPath)) {
    dataDir = rawDataPath;
  } else {
    dataDir = path.join(configDir, rawDataPath);
  }

  console.log('[config] 数据目录:', dataDir);
}

/**
 * 获取配置目录
 */
export function getConfigDir(): string {
  if (!configDir) {
    throw new Error('路径系统尚未初始化，请先调用 initPaths()');
  }
  return configDir;
}

/**
 * 获取数据目录
 */
export function getDataDir(): string {
  if (!dataDir) {
    throw new Error('数据目录尚未初始化，请先调用 loadConfig()');
  }
  return dataDir;
}

/**
 * 解析配置目录路径：将相对路径基于 configDir 转为绝对路径
 * 用于数据库等直接存放在 configDir 下的文件
 * 绝对路径原样返回
 */
export function resolveConfigPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.join(getConfigDir(), relativePath);
}

/**
 * 解析数据路径：将相对路径基于 dataDir 转为绝对路径
 * 用于缓存、缩略图、日志等运行数据
 * 绝对路径原样返回
 */
export function resolveDataPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.join(getDataDir(), relativePath);
}

/**
 * 确保所有数据子目录存在
 */
export async function ensureDataDirectories(): Promise<void> {
  const dirs = [
    getConfigDir(),             // configDir（存放 config.yaml 和 db）
    getDataDir(),               // dataDir（存放运行数据）
    getThumbnailsPath(),        // 缩略图目录
    getCachePath(),             // Booru 图片缓存目录
  ];

  // 日志文件目录
  try {
    const config = getConfig();
    if (config.logging?.filePath) {
      dirs.push(path.dirname(resolveDataPath(config.logging.filePath)));
    }
  } catch {
    // config 可能尚未加载，跳过日志目录
  }

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
  console.log('[config] 数据目录结构已确保存在');
}

// ============= 配置加载与管理 =============

let config: AppConfig | null = null;

/**
 * 自动迁移旧格式路径
 * 旧版本的 database.path 等包含 data/ 前缀，需要去掉
 */
function migrateOldPaths(rawConfig: any): void {
  // database.path: 'data/gallery.db' → 'gallery.db'
  if (rawConfig.database?.path?.startsWith('data/')) {
    console.log('[config] 迁移旧路径: database.path', rawConfig.database.path, '→', rawConfig.database.path.replace('data/', ''));
    rawConfig.database.path = rawConfig.database.path.replace('data/', '');
  }
  // thumbnails.cachePath: 'data/thumbnails' → 'thumbnails'
  if (rawConfig.thumbnails?.cachePath?.startsWith('data/')) {
    console.log('[config] 迁移旧路径: thumbnails.cachePath', rawConfig.thumbnails.cachePath, '→', rawConfig.thumbnails.cachePath.replace('data/', ''));
    rawConfig.thumbnails.cachePath = rawConfig.thumbnails.cachePath.replace('data/', '');
  }
  // logging.filePath: 'data/app.log' → 'app.log'
  if (rawConfig.logging?.filePath?.startsWith('data/')) {
    console.log('[config] 迁移旧路径: logging.filePath', rawConfig.logging.filePath, '→', rawConfig.logging.filePath.replace('data/', ''));
    rawConfig.logging.filePath = rawConfig.logging.filePath.replace('data/', '');
  }
}

/**
 * 加载配置文件
 * 从 configDir/config.yaml 加载
 */
export async function loadConfig(configPath?: string): Promise<AppConfig> {
  // 如果配置已加载，直接返回
  if (config) {
    return config;
  }

  const configFilePath = configPath || path.join(configDir, 'config.yaml');

  try {
    // 尝试读取配置文件
    const configData = await fs.readFile(configFilePath, 'utf-8');

    const yaml = await import('js-yaml');
    const rawConfig = yaml.load(configData) as any;

    // 自动迁移旧格式路径
    migrateOldPaths(rawConfig);

    config = rawConfig as AppConfig;

    console.log('[config] 配置文件加载成功:', configFilePath);

    // 验证配置
    validateConfig(config);

    // 初始化数据目录
    initDataDir(config);

    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // 配置文件不存在，尝试从程序目录迁移旧配置
      const migrated = await migrateFromAppDirectory(configFilePath);
      if (migrated) {
        // 迁移成功，重新加载
        return loadConfig(configFilePath);
      }

      // 没有旧配置，创建默认配置
      console.warn('[config] 配置文件不存在，创建默认配置:', configFilePath);
      await saveDefaultConfig(configFilePath);
      config = { ...DEFAULT_CONFIG };
      initDataDir(config);
      return config;
    }

    console.error('[config] 加载配置文件失败:', error);
    console.log('[config] 使用默认配置');
    config = { ...DEFAULT_CONFIG };
    initDataDir(config);
    return config;
  }
}

/**
 * 尝试从程序目录迁移旧配置到 configDir
 * @returns 是否成功迁移
 */
async function migrateFromAppDirectory(targetConfigPath: string): Promise<boolean> {
  // 检查程序目录下是否有旧的 config.yaml
  const appDir = process.cwd();
  const oldConfigPath = path.join(appDir, 'config.yaml');

  try {
    await fs.access(oldConfigPath);
  } catch {
    return false; // 旧配置不存在
  }

  console.log('[config] 发现程序目录下的旧配置文件，开始迁移...');
  console.log('[config]   源:', oldConfigPath);
  console.log('[config]   目标:', targetConfigPath);

  try {
    // 复制 config.yaml
    const configData = await fs.readFile(oldConfigPath, 'utf-8');
    await fs.writeFile(targetConfigPath, configData, 'utf-8');
    console.log('[config] config.yaml 迁移成功');

    // 旧布局的 data/ 目录
    const oldDataDir = path.join(appDir, 'data');
    const newDataDir = path.join(configDir, 'data');

    try {
      await fs.access(oldDataDir);

      // 数据库文件迁移到 configDir（与 config.yaml 同级）
      const oldDbPath = path.join(oldDataDir, 'gallery.db');
      const newDbPath = path.join(configDir, 'gallery.db');
      try {
        await fs.access(oldDbPath);
        await fs.copyFile(oldDbPath, newDbPath);
        console.log('[config] gallery.db 迁移到 configDir');
      } catch {
        console.log('[config] 旧数据库不存在，跳过');
      }

      // data/ 下的其他内容（thumbnails, cache 等）复制到新 data/
      await copyDirectory(oldDataDir, newDataDir);
      console.log('[config] data/ 目录迁移成功');
    } catch {
      console.log('[config] 程序目录下无 data/ 目录，跳过');
    }

    console.log('[config] 旧配置迁移完成');
    return true;
  } catch (error) {
    console.error('[config] 迁移旧配置失败:', error);
    return false;
  }
}

/**
 * 递归复制目录
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * 保存默认配置文件
 */
async function saveDefaultConfig(configPath: string): Promise<void> {
  try {
    const configDirPath = path.dirname(configPath);
    await fs.mkdir(configDirPath, { recursive: true });

    const yaml = await import('js-yaml');
    const configYaml = yaml.dump(DEFAULT_CONFIG, {
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });

    await fs.writeFile(configPath, configYaml, 'utf-8');
    console.log('[config] 默认配置文件已创建:', configPath);
  } catch (error) {
    console.error('[config] 创建默认配置文件失败:', error);
  }
}

/**
 * 验证配置
 */
function validateConfig(config: AppConfig): void {
  const errors: string[] = [];

  if (!config.database?.path) {
    errors.push('database.path 不能为空');
  }

  if (!config.downloads?.path) {
    errors.push('downloads.path 不能为空');
  }

  if (!config.galleries?.folders || config.galleries.folders.length === 0) {
    errors.push('galleries.folders 不能为空');
  }

  // 验证每个图库目录
  config.galleries?.folders?.forEach((folder, index) => {
    if (!folder.path) {
      errors.push(`galleries.folders[${index}].path 不能为空`);
    }
    if (!folder.name) {
      errors.push(`galleries.folders[${index}].name 不能为空`);
    }
    if (!folder.extensions || folder.extensions.length === 0) {
      errors.push(`galleries.folders[${index}].extensions 不能为空`);
    }
  });

  if (errors.length > 0) {
    console.warn('[config] 配置验证警告:');
    errors.forEach(err => console.warn('  -', err));
  }
}

/**
 * 获取当前配置（同步方法）
 * 注意：必须先调用 loadConfig()
 */
export function getConfig(): AppConfig {
  if (!config) {
    throw new Error('配置尚未加载，请先调用 loadConfig()');
  }
  return config;
}

/**
 * 重新加载配置
 */
export async function reloadConfig(configPath?: string): Promise<AppConfig> {
  config = null;
  return loadConfig(configPath);
}

/**
 * 保存配置到文件
 */
export async function saveConfig(newConfig: AppConfig, configPath?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const configFilePath = configPath || path.join(configDir, 'config.yaml');

    // 更新内存中的配置
    config = newConfig;

    // 保存到文件
    const yaml = await import('js-yaml');
    const configYaml = yaml.dump(newConfig, {
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });

    await fs.writeFile(configFilePath, configYaml, 'utf-8');
    console.log('[config] 配置已保存:', configFilePath);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[config] 保存配置失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 更新图库文件夹配置
 */
export async function updateGalleryFolders(folders: GalleryFolder[]): Promise<{ success: boolean; error?: string }> {
  try {
    const currentConfig = getConfig();
    const newConfig: AppConfig = {
      ...currentConfig,
      galleries: {
        folders
      }
    };

    return await saveConfig(newConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

// ============= 路径获取快捷方法 =============

/**
 * 获取数据库路径
 * 数据库存放在 configDir 下（与 config.yaml 同级）
 */
export function getDatabasePath(): string {
  const cfg = getConfig();
  return resolveConfigPath(cfg.database.path);
}

/**
 * 获取下载目录路径
 * 用户自定义绝对路径直接返回，相对路径基于 dataDir
 */
export function getDownloadsPath(): string {
  const cfg = getConfig();
  if (path.isAbsolute(cfg.downloads.path)) {
    return cfg.downloads.path;
  }
  return resolveDataPath(cfg.downloads.path);
}

/**
 * 获取缩略图缓存路径
 */
export function getThumbnailsPath(): string {
  const cfg = getConfig();
  return resolveDataPath(cfg.thumbnails.cachePath);
}

/**
 * 获取图片缓存目录路径（Booru 图片缓存）
 */
export function getCachePath(): string {
  return path.join(getDataDir(), 'cache');
}

/**
 * 获取日志文件路径
 */
export function getLogFilePath(): string {
  const cfg = getConfig();
  return resolveDataPath(cfg.logging.filePath);
}

/**
 * 获取图库目录列表
 */
export function getGalleryFolders(): GalleryFolder[] {
  const cfg = getConfig();
  return cfg.galleries.folders;
}

/**
 * 获取应用配置
 */
export function getAppConfig() {
  const cfg = getConfig();
  return cfg.app;
}

/**
 * 获取网络配置（包含代理设置）
 */
export function getNetworkConfig() {
  const cfg = getConfig();
  return cfg.network;
}

/**
 * 获取代理配置（如果启用）
 * 返回 Axios 代理配置格式
 */
export function getProxyConfig() {
  const cfg = getConfig();

  if (!cfg.network.proxy.enabled) {
    return undefined;
  }

  const { protocol, host, port, username, password } = cfg.network.proxy;

  const proxyConfig: any = {
    protocol,
    host,
    port
  };

  // 如果有认证信息，添加 auth
  if (username && password) {
    proxyConfig.auth = {
      username,
      password
    };
  }

  return proxyConfig;
}
