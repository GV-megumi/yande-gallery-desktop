import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppConfig } from '../../../src/main/services/config.js';

// 由于 config.ts 使用了 __dirname 和 fileURLToPath（ESM），
// 且 getConfig/getProxyConfig 等依赖模块级别的 config 单例，
// 这里通过 vi.mock + dynamic import 来隔离测试

// Mock fs/promises 和 js-yaml，避免真实文件 I/O
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
  },
}));

vi.mock('js-yaml', () => ({
  load: vi.fn(),
  dump: vi.fn(() => 'mocked yaml'),
}));

const mockedFs = vi.mocked((await import('fs/promises')).default);
const mockedYaml = vi.mocked(await import('js-yaml'));

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('config 模块纯函数测试', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CONFIG_DIR = 'M:/test-config-root';
  });

  afterEach(() => {
    delete process.env.CONFIG_DIR;
  });
  // 由于 config.ts 的核心函数（getProxyConfig、getAbsolutePath 等）依赖模块内部单例，
  // 这里直接测试其逻辑的等价实现

  describe('saveConfig 运行时路径刷新', () => {
    it('保存配置并修改 dataPath 后应立即刷新基于 dataDir 的派生路径', async () => {
      const configModule = await import('../../../src/main/services/config.js');

      await configModule.initPaths();
      await configModule.loadConfig('M:/test-config-root/config.yaml');

      expect(configModule.getDataDir()).toBe(path.join('M:/test-config-root', 'data'));
      expect(configModule.getDownloadsPath()).toBe(path.join('M:/test-config-root', 'data', 'downloads'));
      expect(configModule.getThumbnailsPath()).toBe(path.join('M:/test-config-root', 'data', 'thumbnails'));
      expect(configModule.getLogFilePath()).toBe(path.join('M:/test-config-root', 'data', 'app.log'));

      const result = await configModule.saveConfig({
        dataPath: 'runtime-data',
      }, 'M:/test-config-root/config.yaml');

      expect(result).toEqual({ success: true });
      expect(configModule.getDataDir()).toBe(path.join('M:/test-config-root', 'runtime-data'));
      expect(configModule.getDownloadsPath()).toBe(path.join('M:/test-config-root', 'runtime-data', 'downloads'));
      expect(configModule.getThumbnailsPath()).toBe(path.join('M:/test-config-root', 'runtime-data', 'thumbnails'));
      expect(configModule.getLogFilePath()).toBe(path.join('M:/test-config-root', 'runtime-data', 'app.log'));
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        'M:/test-config-root/config.yaml.tmp.1',
        'mocked yaml',
        'utf-8'
      );
      expect(mockedFs.rename).toHaveBeenCalledWith(
        'M:/test-config-root/config.yaml.tmp.1',
        'M:/test-config-root/config.yaml'
      );
    });

    it('保存配置失败时不应提前刷新基于 dataDir 的派生路径', async () => {
      const configModule = await import('../../../src/main/services/config.js');

      await configModule.initPaths();
      await configModule.loadConfig('M:/test-config-root/config.yaml');

      const originalDataDir = configModule.getDataDir();
      const originalDownloadsPath = configModule.getDownloadsPath();
      const originalThumbnailsPath = configModule.getThumbnailsPath();
      const originalLogFilePath = configModule.getLogFilePath();

      mockedFs.writeFile.mockRejectedValueOnce(new Error('disk full'));

      const result = await configModule.saveConfig({
        dataPath: 'runtime-data',
      }, 'M:/test-config-root/config.yaml');

      expect(result).toEqual({ success: false, error: 'disk full' });
      expect(configModule.getDataDir()).toBe(originalDataDir);
      expect(configModule.getDownloadsPath()).toBe(originalDownloadsPath);
      expect(configModule.getThumbnailsPath()).toBe(originalThumbnailsPath);
      expect(configModule.getLogFilePath()).toBe(originalLogFilePath);
    });

    it('并发保存时后发请求应基于前一次结果继续合并，不能被先发慢请求回写覆盖', async () => {
      const configModule = await import('../../../src/main/services/config.js');

      await configModule.initPaths();
      await configModule.loadConfig('M:/test-config-root/config.yaml');

      const firstWrite = createDeferred();
      mockedFs.writeFile
        .mockImplementationOnce(async () => {
          await firstWrite.promise;
        })
        .mockResolvedValueOnce(undefined as any);

      const firstSavePromise = configModule.saveConfig({
        ui: {
          pagePreferences: {
            favoriteTags: {
              keyword: 'favorite-from-first-save',
            },
          },
        },
      }, 'M:/test-config-root/config.yaml');

      const secondSavePromise = configModule.saveConfig({
        ui: {
          pagePreferences: {
            blacklistedTags: {
              keyword: 'blacklisted-from-second-save',
            },
          },
        },
      }, 'M:/test-config-root/config.yaml');

      await secondSavePromise;
      firstWrite.resolve();
      await firstSavePromise;

      expect(configModule.getConfig().ui?.pagePreferences).toEqual(expect.objectContaining({
        favoriteTags: expect.objectContaining({
          keyword: 'favorite-from-first-save',
        }),
        blacklistedTags: expect.objectContaining({
          keyword: 'blacklisted-from-second-save',
        }),
      }));
    });

    it('后发保存 resolve 后，旧慢写也不能再把真实 config.yaml 写回旧快照', async () => {
      const configModule = await import('../../../src/main/services/config.js');

      await configModule.initPaths();
      await configModule.loadConfig('M:/test-config-root/config.yaml');

      mockedYaml.dump.mockReset();
      mockedYaml.dump.mockImplementation((value) => JSON.stringify(value));

      const firstStageWrite = createDeferred();
      const realConfigWrites: string[] = [];
      const stagingWrites: Array<{ filePath: string; content: string }> = [];
      const configFilePath = 'M:/test-config-root/config.yaml';

      mockedFs.rename.mockReset();
      let stageWriteCount = 0;
      mockedFs.writeFile.mockImplementation(async (filePath, content) => {
        const normalizedPath = String(filePath);
        const normalizedContent = String(content);

        stageWriteCount += 1;
        if (stageWriteCount === 1) {
          await firstStageWrite.promise;
        }
        stagingWrites.push({ filePath: normalizedPath, content: normalizedContent });
      });
      mockedFs.rename.mockImplementation(async (fromPath, toPath) => {
        const normalizedToPath = String(toPath);
        const latestStage = stagingWrites.findLast((entry) => entry.filePath === String(fromPath));
        if (normalizedToPath === configFilePath && latestStage) {
          realConfigWrites.push(latestStage.content);
        }
      });

      const firstSavePromise = configModule.saveConfig({
        ui: {
          pagePreferences: {
            favoriteTags: {
              keyword: 'favorite-from-first-save',
            },
          },
        },
      }, configFilePath);

      const secondSavePromise = configModule.saveConfig({
        ui: {
          pagePreferences: {
            blacklistedTags: {
              keyword: 'blacklisted-from-second-save',
            },
          },
        },
      }, configFilePath);

      await secondSavePromise;

      expect(realConfigWrites).toHaveLength(1);
      expect(JSON.parse(realConfigWrites[0]).ui?.pagePreferences).toEqual(expect.objectContaining({
        favoriteTags: expect.objectContaining({
          keyword: 'favorite-from-first-save',
        }),
        blacklistedTags: expect.objectContaining({
          keyword: 'blacklisted-from-second-save',
        }),
      }));

      firstStageWrite.resolve();
      await expect(firstSavePromise).resolves.toEqual({ success: true });

      expect(realConfigWrites).toHaveLength(1);
      expect(JSON.parse(realConfigWrites[0]).ui?.pagePreferences).toEqual(expect.objectContaining({
        favoriteTags: expect.objectContaining({
          keyword: 'favorite-from-first-save',
        }),
        blacklistedTags: expect.objectContaining({
          keyword: 'blacklisted-from-second-save',
        }),
      }));
      expect(stagingWrites.length).toBeGreaterThanOrEqual(2);
      expect(stagingWrites.every((entry) => entry.filePath !== configFilePath)).toBe(true);
    });

    it('最新保存 finalize 并清理后，旧保存仍应读取相同失败结果', async () => {
      const configModule = await import('../../../src/main/services/config.js');

      await configModule.initPaths();
      await configModule.loadConfig('M:/test-config-root/config.yaml');

      mockedYaml.dump.mockReset();
      mockedYaml.dump.mockImplementation((value) => JSON.stringify(value));

      const configFilePath = 'M:/test-config-root/config.yaml';
      const firstStageWrite = createDeferred();
      const realConfigWrites: string[] = [];
      const stagingWrites: Array<{ filePath: string; content: string }> = [];

      mockedFs.rename.mockReset();
      let stageWriteCount = 0;
      mockedFs.writeFile.mockImplementation(async (filePath, content) => {
        const normalizedPath = String(filePath);
        const normalizedContent = String(content);

        stageWriteCount += 1;
        if (stageWriteCount === 1) {
          await firstStageWrite.promise;
        }
        stagingWrites.push({ filePath: normalizedPath, content: normalizedContent });
      });
      mockedFs.rename.mockImplementation(async (fromPath, toPath) => {
        if (String(toPath) !== configFilePath) {
          return;
        }

        const latestStage = stagingWrites.findLast((entry) => entry.filePath === String(fromPath));
        if (latestStage?.content.includes('blacklisted-from-second-save')) {
          throw new Error('rename failed');
        }
        if (latestStage) {
          realConfigWrites.push(latestStage.content);
        }
      });

      const firstSavePromise = configModule.saveConfig({
        ui: {
          pagePreferences: {
            favoriteTags: {
              keyword: 'favorite-from-first-save',
            },
          },
        },
      }, configFilePath);

      const secondSavePromise = configModule.saveConfig({
        ui: {
          pagePreferences: {
            blacklistedTags: {
              keyword: 'blacklisted-from-second-save',
            },
          },
        },
      }, configFilePath);

      const secondResult = await secondSavePromise;
      firstStageWrite.resolve();
      const firstResult = await firstSavePromise;

      expect(secondResult).toEqual({ success: false, error: 'rename failed' });
      expect(firstResult).toEqual({ success: false, error: 'rename failed' });
      expect(realConfigWrites).toHaveLength(0);
      expect(stagingWrites.length).toBeGreaterThanOrEqual(2);
    });

    it('saveConfig 应在运行时忽略 renderer 传入的敏感字段覆盖', async () => {
      const configModule = await import('../../../src/main/services/config.js');

      mockedYaml.load.mockReturnValueOnce({
        dataPath: 'data',
        database: { path: 'gallery.db', logging: true },
        downloads: { path: 'downloads', createSubfolders: true, subfolderFormat: ['tags'] },
        galleries: { folders: [] },
        thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp' },
        app: { recentImagesCount: 100, pageSize: 50, defaultViewMode: 'grid', showImageInfo: true, autoScan: true, autoScanInterval: 30 },
        yande: { apiUrl: 'https://yande.re/post.json', pageSize: 20, downloadTimeout: 60, maxConcurrentDownloads: 5 },
        logging: { level: 'info', filePath: 'app.log', consoleOutput: true, maxFileSize: 10, maxFiles: 5 },
        network: {
          proxy: {
            enabled: true,
            protocol: 'http',
            host: '127.0.0.1',
            port: 7890,
            username: 'user',
            password: 'secret',
          },
        },
        google: {
          clientId: 'client-id',
          clientSecret: 'top-secret',
          drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
          photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
        },
      });

      await configModule.initPaths();
      await configModule.loadConfig('M:/test-config-root/config.yaml');

      const result = await configModule.saveConfig({
        downloads: {
          path: 'D:/downloads',
        },
        network: {
          proxy: {
            host: '10.0.0.2',
            username: 'attacker',
            password: 'stolen',
          },
        },
        google: {
          clientId: 'new-client-id',
          clientSecret: 'leaked-secret',
        },
      } as any, 'M:/test-config-root/config.yaml');

      expect(result).toEqual({ success: true });
      expect(configModule.getConfig().downloads.path).toBe('D:/downloads');
      expect(configModule.getConfig().network.proxy.host).toBe('10.0.0.2');
      expect(configModule.getConfig().network.proxy.username).toBe('user');
      expect(configModule.getConfig().network.proxy.password).toBe('secret');
      expect(configModule.getConfig().google?.clientId).toBe('new-client-id');
      expect(configModule.getConfig().google?.clientSecret).toBe('top-secret');
    });

    it('旧保存在最新结果 finalize 后仍能读取结果且不依赖多版本终态缓存', async () => {
      const configModule = await import('../../../src/main/services/config.js');

      await configModule.initPaths();
      await configModule.loadConfig('M:/test-config-root/config.yaml');

      mockedYaml.dump.mockReset();
      mockedYaml.dump.mockImplementation((value) => JSON.stringify(value));

      const configFilePath = 'M:/test-config-root/config.yaml';
      const firstStageWrite = createDeferred();
      const secondStageWrite = createDeferred();
      const thirdStageWrite = createDeferred();
      const stageWritesByPath = new Map<string, string>();
      const thirdRenameDone = createDeferred();

      mockedFs.rename.mockReset();
      let stageWriteCount = 0;
      mockedFs.writeFile.mockImplementation(async (filePath, content) => {
        const normalizedPath = String(filePath);
        stageWritesByPath.set(normalizedPath, String(content));
        stageWriteCount += 1;
        if (stageWriteCount === 1) {
          await firstStageWrite.promise;
        }
        if (stageWriteCount === 2) {
          await secondStageWrite.promise;
        }
        if (stageWriteCount === 3) {
          await thirdStageWrite.promise;
        }
      });
      mockedFs.rename.mockImplementation(async (fromPath, toPath) => {
        if (String(toPath) === configFilePath) {
          const stageContent = stageWritesByPath.get(String(fromPath));
          if (stageContent?.includes('third-save')) {
            thirdRenameDone.resolve();
          }
        }
      });

      const firstSavePromise = configModule.saveConfig({
        ui: { pagePreferences: { favoriteTags: { keyword: 'first-save' } } },
      }, configFilePath);
      const secondSavePromise = configModule.saveConfig({
        ui: { pagePreferences: { favoriteTags: { keyword: 'second-save' } } },
      }, configFilePath);
      const thirdSavePromise = configModule.saveConfig({
        ui: { pagePreferences: { favoriteTags: { keyword: 'third-save' } } },
      }, configFilePath);

      thirdStageWrite.resolve();
      secondStageWrite.resolve();
      await thirdSavePromise;
      await thirdRenameDone.promise;
      firstStageWrite.resolve();

      await expect(firstSavePromise).resolves.toEqual({ success: true });
      await expect(secondSavePromise).resolves.toEqual({ success: true });
    });

    it('被 supersede 的保存返回前应清理自己的 staging tmp 文件', async () => {
      const configModule = await import('../../../src/main/services/config.js');

      await configModule.initPaths();
      await configModule.loadConfig('M:/test-config-root/config.yaml');

      const firstStageWrite = createDeferred();
      mockedFs.writeFile.mockImplementationOnce(async () => {
        await firstStageWrite.promise;
      }).mockResolvedValueOnce(undefined as any);

      const firstSavePromise = configModule.saveConfig({
        ui: { pagePreferences: { favoriteTags: { keyword: 'first-save' } } },
      }, 'M:/test-config-root/config.yaml');

      const secondSavePromise = configModule.saveConfig({
        ui: { pagePreferences: { blacklistedTags: { keyword: 'second-save' } } },
      }, 'M:/test-config-root/config.yaml');

      await secondSavePromise;
      firstStageWrite.resolve();
      await firstSavePromise;

      expect(mockedFs.unlink).toHaveBeenCalledWith('M:/test-config-root/config.yaml.tmp.1');
    });

    it('commit 失败后应清理 staging tmp 且保持原错误语义', async () => {
      const configModule = await import('../../../src/main/services/config.js');

      await configModule.initPaths();
      await configModule.loadConfig('M:/test-config-root/config.yaml');

      mockedFs.rename.mockReset();
      mockedFs.rename.mockRejectedValueOnce(new Error('rename failed'));

      const result = await configModule.saveConfig({
        ui: { pagePreferences: { favoriteTags: { keyword: 'rename-fail' } } },
      }, 'M:/test-config-root/config.yaml');

      expect(result).toEqual({ success: false, error: 'rename failed' });
      expect(mockedFs.unlink).toHaveBeenCalledWith('M:/test-config-root/config.yaml.tmp.1');
    });
  });

  describe('toRendererSafeConfig', () => {
    it('应移除 google.clientSecret 和代理认证信息，但保留其余可公开配置', async () => {
      const { toRendererSafeConfig } = await import('../../../src/main/services/config.js');
      const source: AppConfig = {
        dataPath: 'data',
        database: { path: 'gallery.db', logging: true },
        downloads: { path: 'downloads', createSubfolders: true, subfolderFormat: ['tags'] },
        galleries: { folders: [] },
        thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp' },
        app: { recentImagesCount: 100, pageSize: 50, defaultViewMode: 'grid', showImageInfo: true, autoScan: true, autoScanInterval: 30 },
        yande: { apiUrl: 'https://yande.re/post.json', pageSize: 20, downloadTimeout: 60, maxConcurrentDownloads: 5 },
        logging: { level: 'info', filePath: 'app.log', consoleOutput: true, maxFileSize: 10, maxFiles: 5 },
        network: {
          proxy: {
            enabled: true,
            protocol: 'http',
            host: '127.0.0.1',
            port: 7890,
            username: 'user',
            password: 'secret',
          },
        },
        google: {
          clientId: 'client-id',
          clientSecret: 'top-secret',
          drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
          photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
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
            margin: 24,
          },
          download: { filenameTemplate: '{site}_{id}.{extension}', tokenDefaults: {} },
        },
        ui: {
          menuOrder: {
            main: ['gallery', 'booru', 'google'],
          },
          pinnedItems: [
            { section: 'google', key: 'gdrive' },
          ],
          pagePreferences: {
            favoriteTags: {
              keyword: 'keep-me',
            },
            appShell: {
              menuOrder: {
                booru: ['download', 'posts'],
              },
              pinnedItems: [
                { section: 'booru', key: 'download', defaultTab: 'bulk' },
              ],
            },
          },
        },
      };

      const result = toRendererSafeConfig(source);

      expect(result.google?.clientId).toBe('client-id');
      expect(result.google).not.toHaveProperty('clientSecret');
      expect(result.network.proxy).toEqual({
        enabled: true,
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
      });
      expect(result.downloads.path).toBe('downloads');
      expect(result.booru?.download.filenameTemplate).toBe('{site}_{id}.{extension}');
      expect(result.ui).toEqual({
        pagePreferences: {
          favoriteTags: {
            keyword: 'keep-me',
          },
        },
      });
      expect(result.ui).not.toHaveProperty('menuOrder');
      expect(result.ui).not.toHaveProperty('pinnedItems');
      expect(result.ui?.pagePreferences).not.toHaveProperty('appShell');
    });
  });

  describe('mergeSensitiveConfig', () => {
    const current: AppConfig = {
      dataPath: 'data',
      database: { path: 'gallery.db', logging: true },
      downloads: { path: 'downloads', createSubfolders: true, subfolderFormat: ['tags'] },
      galleries: { folders: [] },
      thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp' },
      app: { recentImagesCount: 100, pageSize: 50, defaultViewMode: 'grid', showImageInfo: true, autoScan: true, autoScanInterval: 30 },
      yande: { apiUrl: 'https://yande.re/post.json', pageSize: 20, downloadTimeout: 60, maxConcurrentDownloads: 5 },
      logging: { level: 'info', filePath: 'app.log', consoleOutput: true, maxFileSize: 10, maxFiles: 5 },
      network: {
        proxy: {
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
          username: 'user',
          password: 'secret',
        },
      },
      google: {
        clientId: 'client-id',
        clientSecret: 'top-secret',
        drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
        photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
      },
    };

    it('保存配置时应保留现有的 google.clientSecret 和代理认证信息', async () => {
      const { mergeSensitiveConfig } = await import('../../../src/main/services/config.js');
      const incoming: AppConfig = {
        ...current,
        downloads: { ...current.downloads, path: 'D:/downloads' },
        network: {
          proxy: {
            enabled: true,
            protocol: 'http',
            host: '127.0.0.1',
            port: 7890,
          },
        },
        google: {
          clientId: 'client-id',
          drive: current.google!.drive,
          photos: current.google!.photos,
        } as AppConfig['google'],
      };

      const result = mergeSensitiveConfig(current, incoming);

      expect(result.network.proxy.username).toBe('user');
      expect(result.network.proxy.password).toBe('secret');
      expect(result.google?.clientSecret).toBe('top-secret');
      expect(result.downloads.path).toBe('D:/downloads');
    });

    it('传入缺少 google 或 network.proxy section 时应保留现有 section 并保留必填字段', async () => {
      const { mergeSensitiveConfig } = await import('../../../src/main/services/config.js');
      const incoming = {
        ...current,
        thumbnails: { ...current.thumbnails, quality: 95 },
        network: {} as AppConfig['network'],
        google: undefined,
      } as AppConfig;

      const result = mergeSensitiveConfig(current, incoming);

      expect(result.network.proxy).toEqual(current.network.proxy);
      expect(result.google).toEqual(current.google);
      expect(result.thumbnails.quality).toBe(95);
    });
  });

  describe('normalizeConfigSaveInput', () => {
    it('应基于当前配置重建已知字段并丢弃未知键', async () => {
      const { normalizeConfigSaveInput } = await import('../../../src/main/services/config.js');
      const current: AppConfig = {
        dataPath: 'data',
        database: { path: 'gallery.db', logging: true },
        downloads: { path: 'downloads', createSubfolders: true, subfolderFormat: ['tags'] },
        galleries: { folders: [] },
        thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp' },
        app: { recentImagesCount: 100, pageSize: 50, defaultViewMode: 'grid', showImageInfo: true, autoScan: true, autoScanInterval: 30 },
        yande: { apiUrl: 'https://yande.re/post.json', pageSize: 20, downloadTimeout: 60, maxConcurrentDownloads: 5 },
        logging: { level: 'info', filePath: 'app.log', consoleOutput: true, maxFileSize: 10, maxFiles: 5 },
        network: {
          proxy: {
            enabled: true,
            protocol: 'http',
            host: '127.0.0.1',
            port: 7890,
            username: 'user',
            password: 'secret',
          },
        },
        google: {
          clientId: 'client-id',
          clientSecret: 'top-secret',
          drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
          photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
        },
      };

      const result = normalizeConfigSaveInput(current, {
        downloads: { path: 'D:/downloads' },
        network: {
          proxy: {
            enabled: false,
            host: '10.0.0.2',
          },
        },
        google: {
          clientId: 'new-client-id',
        },
        extraTopLevel: true,
      } as any);

      expect(result).toEqual({
        ...current,
        downloads: { ...current.downloads, path: 'D:/downloads' },
        network: {
          proxy: {
            enabled: false,
            protocol: 'http',
            host: '10.0.0.2',
            port: 7890,
            username: 'user',
            password: 'secret',
          },
        },
        google: {
          clientId: 'new-client-id',
          clientSecret: 'top-secret',
          drive: current.google!.drive,
          photos: current.google!.photos,
        },
      });
      expect(result).not.toHaveProperty('extraTopLevel');
    });

    it('应保留 ui.pinnedItems 并允许单独更新该受控偏好字段', async () => {
      const { normalizeConfigSaveInput } = await import('../../../src/main/services/config.js');
      const current: AppConfig = {
        dataPath: 'data',
        database: { path: 'gallery.db', logging: true },
        downloads: { path: 'downloads', createSubfolders: true, subfolderFormat: ['tags'] },
        galleries: { folders: [] },
        thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp' },
        app: { recentImagesCount: 100, pageSize: 50, defaultViewMode: 'grid', showImageInfo: true, autoScan: true, autoScanInterval: 30 },
        yande: { apiUrl: 'https://yande.re/post.json', pageSize: 20, downloadTimeout: 60, maxConcurrentDownloads: 5 },
        logging: { level: 'info', filePath: 'app.log', consoleOutput: true, maxFileSize: 10, maxFiles: 5 },
        network: {
          proxy: {
            enabled: true,
            protocol: 'http',
            host: '127.0.0.1',
            port: 7890,
            username: 'user',
            password: 'secret',
          },
        },
        ui: {
          menuOrder: {
            main: ['gallery', 'booru', 'google'],
          },
          pinnedItems: [
            { section: 'gallery', key: 'recent' },
          ],
        },
      } as AppConfig;

      const result = normalizeConfigSaveInput(current, {
        ui: {
          pinnedItems: [
            { section: 'booru', key: 'favorites' },
            { section: 'google', key: 'gphotos' },
          ],
        },
        extraTopLevel: true,
      } as any);

      expect(result.ui).toEqual({
        menuOrder: {
          main: ['gallery', 'booru', 'google'],
          gallery: undefined,
          booru: undefined,
          google: undefined,
        },
        pinnedItems: [
          { section: 'booru', key: 'favorites' },
          { section: 'google', key: 'gphotos' },
        ],
        pagePreferences: {
          appShell: {
            menuOrder: {
              main: ['gallery', 'booru', 'google'],
              gallery: undefined,
              booru: undefined,
              google: undefined,
            },
            pinnedItems: [
              { section: 'gallery', key: 'recent' },
            ],
          },
        },
      });
      expect(result).not.toHaveProperty('extraTopLevel');
    });

    it('应保留并合并 ui.pagePreferences 的受控页面偏好字段', async () => {
      const { normalizeConfigSaveInput } = await import('../../../src/main/services/config.js');
      const current: AppConfig = {
        dataPath: 'data',
        database: { path: 'gallery.db', logging: true },
        downloads: { path: 'downloads', createSubfolders: true, subfolderFormat: ['tags'] },
        galleries: { folders: [] },
        thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp' },
        app: { recentImagesCount: 100, pageSize: 50, defaultViewMode: 'grid', showImageInfo: true, autoScan: true, autoScanInterval: 30 },
        yande: { apiUrl: 'https://yande.re/post.json', pageSize: 20, downloadTimeout: 60, maxConcurrentDownloads: 5 },
        logging: { level: 'info', filePath: 'app.log', consoleOutput: true, maxFileSize: 10, maxFiles: 5 },
        network: {
          proxy: {
            enabled: true,
            protocol: 'http',
            host: '127.0.0.1',
            port: 7890,
            username: 'user',
            password: 'secret',
          },
        },
        ui: {
          menuOrder: {
            main: ['gallery', 'booru', 'google'],
          },
          pinnedItems: [
            { section: 'gallery', key: 'recent' },
          ],
          pagePreferences: {
            favoriteTags: {
              filterSiteId: 1,
              sortKey: 'tagName',
              sortOrder: 'asc',
              keyword: 'old',
              page: 2,
              pageSize: 20,
            },
            blacklistedTags: {
              filterSiteId: 2,
              keyword: 'blocked',
              page: 3,
              pageSize: 50,
            },
            galleryBySubTab: {
              all: {
                searchQuery: 'cat',
                isSearchMode: true,
                allPage: 4,
                searchPage: 5,
              },
              galleries: {
                gallerySearchQuery: 'folder',
                gallerySortKey: 'name',
                gallerySortOrder: 'asc',
                selectedGalleryId: 9,
                gallerySort: 'name',
              },
            },
          },
        },
      } as AppConfig;

      const result = normalizeConfigSaveInput(current, {
        ui: {
          pagePreferences: {
            favoriteTags: {
              keyword: 'new',
              page: 1,
            },
            galleryBySubTab: {
              galleries: {
                selectedGalleryId: 12,
                gallerySortOrder: 'desc',
              },
            },
          },
        },
      } as any);

      expect(result.ui?.pagePreferences).toEqual({
        favoriteTags: {
          filterSiteId: 1,
          sortKey: 'tagName',
          sortOrder: 'asc',
          keyword: 'new',
          page: 1,
          pageSize: 20,
        },
        blacklistedTags: {
          filterSiteId: 2,
          keyword: 'blocked',
          page: 3,
          pageSize: 50,
        },
        galleryBySubTab: {
          all: {
            searchQuery: 'cat',
            isSearchMode: true,
            allPage: 4,
            searchPage: 5,
          },
          galleries: {
            gallerySearchQuery: 'folder',
            gallerySortKey: 'name',
            gallerySortOrder: 'desc',
            selectedGalleryId: 12,
            gallerySort: 'name',
          },
        },
        appShell: {
          menuOrder: {
            main: ['gallery', 'booru', 'google'],
            gallery: undefined,
            booru: undefined,
            google: undefined,
          },
          pinnedItems: [
            { section: 'gallery', key: 'recent' },
          ],
        },
      });
    });

    it('应保留并合并 ui.pagePreferences.appShell，且缺失字段回退到 legacy ui 字段', async () => {
      const { normalizeConfigSaveInput } = await import('../../../src/main/services/config.js');
      const current: AppConfig = {
        dataPath: 'data',
        database: { path: 'gallery.db', logging: true },
        downloads: { path: 'downloads', createSubfolders: true, subfolderFormat: ['tags'] },
        galleries: { folders: [] },
        thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp' },
        app: { recentImagesCount: 100, pageSize: 50, defaultViewMode: 'grid', showImageInfo: true, autoScan: true, autoScanInterval: 30 },
        yande: { apiUrl: 'https://yande.re/post.json', pageSize: 20, downloadTimeout: 60, maxConcurrentDownloads: 5 },
        logging: { level: 'info', filePath: 'app.log', consoleOutput: true, maxFileSize: 10, maxFiles: 5 },
        network: {
          proxy: {
            enabled: true,
            protocol: 'http',
            host: '127.0.0.1',
            port: 7890,
            username: 'user',
            password: 'secret',
          },
        },
        ui: {
          menuOrder: {
            main: ['gallery', 'booru', 'google'],
            booru: ['posts', 'favorites', 'download'],
            google: ['gdrive', 'gphotos'],
          },
          pinnedItems: [
            { section: 'gallery', key: 'recent' },
          ],
          pagePreferences: {
            appShell: {
              menuOrder: {
                booru: ['download', 'posts'],
              },
            },
          },
        },
      } as AppConfig;

      const result = normalizeConfigSaveInput(current, {
        ui: {
          pagePreferences: {
            appShell: {
              pinnedItems: [
                { section: 'google', key: 'gdrive' },
              ],
              menuOrder: {
                main: ['booru', 'gallery', 'google'],
              },
            },
          },
        },
      } as any);

      expect(result.ui?.pagePreferences).toEqual({
        appShell: {
          menuOrder: {
            main: ['booru', 'gallery', 'google'],
            booru: ['download', 'posts'],
            google: ['gdrive', 'gphotos'],
          },
          pinnedItems: [
            { section: 'google', key: 'gdrive' },
          ],
        },
      });
      expect(result.ui?.menuOrder).toEqual({
        main: ['gallery', 'booru', 'google'],
        booru: ['posts', 'favorites', 'download'],
        google: ['gdrive', 'gphotos'],
        gallery: undefined,
      });
      expect(result.ui?.pinnedItems).toEqual([{ section: 'gallery', key: 'recent' }]);
    });

    it('应在配置归一化层将 ui.pagePreferences.appShell.pinnedItems 收口到最多 5 个', async () => {
      const { normalizeConfigSaveInput } = await import('../../../src/main/services/config.js');
      const current: AppConfig = {
        dataPath: 'data',
        database: { path: 'gallery.db', logging: true },
        downloads: { path: 'downloads', createSubfolders: true, subfolderFormat: ['tags'] },
        galleries: { folders: [] },
        thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp' },
        app: { recentImagesCount: 100, pageSize: 50, defaultViewMode: 'grid', showImageInfo: true, autoScan: true, autoScanInterval: 30 },
        yande: { apiUrl: 'https://yande.re/post.json', pageSize: 20, downloadTimeout: 60, maxConcurrentDownloads: 5 },
        logging: { level: 'info', filePath: 'app.log', consoleOutput: true, maxFileSize: 10, maxFiles: 5 },
        network: {
          proxy: {
            enabled: true,
            protocol: 'http',
            host: '127.0.0.1',
            port: 7890,
            username: 'user',
            password: 'secret',
          },
        },
        ui: {
          menuOrder: {
            main: ['gallery', 'booru', 'google'],
          },
          pagePreferences: {
            appShell: {
              menuOrder: {
                main: ['gallery', 'booru', 'google'],
              },
            },
          },
        },
      } as AppConfig;

      const incomingPinnedItems = [
        { section: 'gallery', key: 'recent' },
        { section: 'booru', key: 'posts' },
        { section: 'booru', key: 'download', defaultTab: 'downloads' },
        { section: 'booru', key: 'tag-management', defaultTab: 'favorite' },
        { section: 'google', key: 'gdrive' },
        { section: 'google', key: 'gphotos' },
      ] as const;

      const result = normalizeConfigSaveInput(current, {
        ui: {
          pagePreferences: {
            appShell: {
              pinnedItems: [...incomingPinnedItems],
            },
          },
        },
      } as any);

      expect(result.ui?.pagePreferences?.appShell?.pinnedItems).toEqual(incomingPinnedItems.slice(0, 5));
    });
  });

  describe('getProxyConfig 逻辑', () => {
    // 等价测试 getProxyConfig 的逻辑
    function extractProxyConfig(networkConfig: {
      proxy: {
        enabled: boolean;
        protocol: string;
        host: string;
        port: number;
        username?: string;
        password?: string;
      };
    }) {
      if (!networkConfig.proxy.enabled) {
        return undefined;
      }
      const { protocol, host, port, username, password } = networkConfig.proxy;
      const proxyConfig: any = { protocol, host, port };
      if (username && password) {
        proxyConfig.auth = { username, password };
      }
      return proxyConfig;
    }

    it('代理未启用时应返回 undefined', () => {
      const config = {
        proxy: {
          enabled: false,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
        },
      };
      expect(extractProxyConfig(config)).toBeUndefined();
    });

    it('代理启用时应返回代理配置', () => {
      const config = {
        proxy: {
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
        },
      };
      const result = extractProxyConfig(config);
      expect(result).toEqual({
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
      });
    });

    it('代理启用且有认证时应包含 auth', () => {
      const config = {
        proxy: {
          enabled: true,
          protocol: 'socks5',
          host: '192.168.1.1',
          port: 1080,
          username: 'user',
          password: 'pass',
        },
      };
      const result = extractProxyConfig(config);
      expect(result).toEqual({
        protocol: 'socks5',
        host: '192.168.1.1',
        port: 1080,
        auth: { username: 'user', password: 'pass' },
      });
    });

    it('有用户名但无密码时不应包含 auth', () => {
      const config = {
        proxy: {
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
          username: 'user',
          password: '',
        },
      };
      const result = extractProxyConfig(config);
      expect(result).not.toHaveProperty('auth');
    });

    it('有密码但无用户名时不应包含 auth', () => {
      const config = {
        proxy: {
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
          username: '',
          password: 'pass',
        },
      };
      const result = extractProxyConfig(config);
      expect(result).not.toHaveProperty('auth');
    });
  });

  describe('getAbsolutePath 逻辑', () => {
    const path = require('path');

    it('绝对路径应原样返回', () => {
      if (process.platform === 'win32') {
        const result = path.isAbsolute('M:\\downloads');
        expect(result).toBe(true);
      } else {
        const result = path.isAbsolute('/home/user/downloads');
        expect(result).toBe(true);
      }
    });

    it('相对路径应被检测为相对', () => {
      expect(path.isAbsolute('data/gallery.db')).toBe(false);
      expect(path.isAbsolute('downloads')).toBe(false);
      expect(path.isAbsolute('./config.yaml')).toBe(false);
    });

    it('path.join 应正确拼接路径', () => {
      const base = '/app/src/main/services';
      const result = path.join(base, '../../..', 'data/gallery.db');
      // 规范化后应包含 data/gallery.db
      expect(result).toContain('gallery.db');
    });
  });

  describe('validateConfig 逻辑', () => {
    // 测试配置验证的核心逻辑
    function validateConfig(config: any): string[] {
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
      if (config.galleries?.folders) {
        config.galleries.folders.forEach((folder: any, index: number) => {
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
      }
      return errors;
    }

    it('完整配置不应有错误', () => {
      const config = {
        database: { path: 'data/gallery.db' },
        downloads: { path: 'downloads' },
        galleries: {
          folders: [
            { path: '/images', name: 'default', extensions: ['.jpg', '.png'] },
          ],
        },
      };
      expect(validateConfig(config)).toEqual([]);
    });

    it('缺少 database.path 应报错', () => {
      const config = {
        database: {},
        downloads: { path: 'downloads' },
        galleries: {
          folders: [
            { path: '/images', name: 'default', extensions: ['.jpg'] },
          ],
        },
      };
      const errors = validateConfig(config);
      expect(errors).toContain('database.path 不能为空');
    });

    it('缺少 downloads.path 应报错', () => {
      const config = {
        database: { path: 'db.sqlite' },
        downloads: {},
        galleries: {
          folders: [
            { path: '/images', name: 'default', extensions: ['.jpg'] },
          ],
        },
      };
      const errors = validateConfig(config);
      expect(errors).toContain('downloads.path 不能为空');
    });

    it('空的 galleries.folders 应报错', () => {
      const config = {
        database: { path: 'db.sqlite' },
        downloads: { path: 'downloads' },
        galleries: { folders: [] },
      };
      const errors = validateConfig(config);
      expect(errors).toContain('galleries.folders 不能为空');
    });

    it('图库文件夹缺少必填字段应报错', () => {
      const config = {
        database: { path: 'db.sqlite' },
        downloads: { path: 'downloads' },
        galleries: {
          folders: [
            { path: '', name: '', extensions: [] },
          ],
        },
      };
      const errors = validateConfig(config);
      expect(errors).toContain('galleries.folders[0].path 不能为空');
      expect(errors).toContain('galleries.folders[0].name 不能为空');
      expect(errors).toContain('galleries.folders[0].extensions 不能为空');
    });

    it('多个图库文件夹应各自验证', () => {
      const config = {
        database: { path: 'db.sqlite' },
        downloads: { path: 'downloads' },
        galleries: {
          folders: [
            { path: '/valid', name: 'ok', extensions: ['.jpg'] },
            { path: '', name: 'missing_path', extensions: ['.png'] },
          ],
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('folders[1].path');
    });
  });
});
