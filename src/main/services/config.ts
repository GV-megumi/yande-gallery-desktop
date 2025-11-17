import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置类型定义
export interface AppConfig {
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
}

export interface GalleryFolder {
  path: string;
  name: string;
  autoScan: boolean;
  recursive: boolean;
  extensions: string[];
}

// 默认配置
const DEFAULT_CONFIG: AppConfig = {
  database: {
    path: 'data/gallery.db',
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
    cachePath: 'data/thumbnails',
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
    filePath: 'data/app.log',
    consoleOutput: true,
    maxFileSize: 10,
    maxFiles: 5
  }
};

let config: AppConfig | null = null;

/**
 * 加载配置文件
 * @param configPath 配置文件路径
 */
export async function loadConfig(configPath?: string): Promise<AppConfig> {
  // 如果配置已加载，直接返回
  if (config) {
    return config;
  }

  const configFilePath = configPath || path.join(__dirname, '../../../config.yaml');

  try {
    // 尝试读取配置文件
    const configData = await fs.readFile(configFilePath, 'utf-8');

    // 注意：这里需要 js-yaml 库来解析 YAML
    // 请先安装: npm install js-yaml @types/js-yaml
    const yaml = await import('js-yaml');
    config = yaml.load(configData) as AppConfig;

    console.log('✅ 配置文件加载成功:', configFilePath);

    // 验证配置
    validateConfig(config);

    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // 配置文件不存在，创建默认配置
      console.warn('⚠️ 配置文件不存在，创建默认配置:', configFilePath);
      await saveDefaultConfig(configFilePath);
      config = { ...DEFAULT_CONFIG };
      return config;
    }

    console.error('❌ 加载配置文件失败:', error);
    console.log('使用默认配置');
    config = { ...DEFAULT_CONFIG };
    return config;
  }
}

/**
 * 保存默认配置文件
 */
async function saveDefaultConfig(configPath: string): Promise<void> {
  try {
    const configDir = path.dirname(configPath);

    // 确保配置目录存在
    await fs.mkdir(configDir, { recursive: true });

    // 注意：这里需要 js-yaml 库来生成 YAML
    const yaml = await import('js-yaml');
    const configYaml = yaml.dump(DEFAULT_CONFIG, {
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });

    await fs.writeFile(configPath, configYaml, 'utf-8');
    console.log('✅ 默认配置文件已创建:', configPath);
  } catch (error) {
    console.error('❌ 创建默认配置文件失败:', error);
  }
}

/**
 * 验证配置
 */
function validateConfig(config: AppConfig): void {
  const errors: string[] = [];

  // 验证必要字段
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
  config.galleries.folders.forEach((folder, index) => {
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
    console.warn('⚠️ 配置验证警告:');
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
    const configFilePath = configPath || path.join(__dirname, '../../../config.yaml');
    
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
    console.log('✅ 配置已保存:', configFilePath);
    
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ 保存配置失败:', errorMessage);
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

/**
 * 获取绝对路径
 * 将相对路径转换为绝对路径
 */
export function getAbsolutePath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }

  return path.join(__dirname, '../../..', relativePath);
}

/**
 * 获取数据库路径
 */
export function getDatabasePath(): string {
  const config = getConfig();
  return getAbsolutePath(config.database.path);
}

/**
 * 获取下载目录路径
 */
export function getDownloadsPath(): string {
  const config = getConfig();
  return getAbsolutePath(config.downloads.path);
}

/**
 * 获取缩略图缓存路径
 */
export function getThumbnailsPath(): string {
  const config = getConfig();
  return getAbsolutePath(config.thumbnails.cachePath);
}

/**
 * 获取图库目录列表
 */
export function getGalleryFolders(): GalleryFolder[] {
  const config = getConfig();
  return config.galleries.folders;
}

/**
 * 获取应用配置
 */
export function getAppConfig() {
  const config = getConfig();
  return config.app;
}
