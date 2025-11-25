import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      gridSize: 330, // 默认网格大小（220 * 1.5）
      previewQuality: 'auto', // 自动选择预览质量
      itemsPerPage: 20, // 每页20张
      paginationPosition: 'bottom', // 页码在底部
      pageMode: 'pagination', // 翻页模式
      spacing: 16, // 间距16px
      borderRadius: 8, // 圆角8px
      margin: 24 // 边距24px
    },
    download: {
      filenameTemplate: '{site}_{id}_{md5}.{extension}', // 默认文件名模板
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

/**
 * 获取网络配置（包含代理设置）
 */
export function getNetworkConfig() {
  const config = getConfig();
  return config.network;
}

/**
 * 获取代理配置（如果启用）
 * 返回 Axios 代理配置格式
 */
export function getProxyConfig() {
  const config = getConfig();

  if (!config.network.proxy.enabled) {
    return undefined;
  }

  const { protocol, host, port, username, password } = config.network.proxy;

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
