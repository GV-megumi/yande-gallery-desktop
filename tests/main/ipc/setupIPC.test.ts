import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { IPC_CHANNELS } from '../../../src/main/ipc/channels.ts';

const handleMock = vi.fn();
const getAllWindowsMock = vi.fn();
const getConfigMock = vi.fn();
const saveConfigMock = vi.fn();
const getBooruSitesMock = vi.fn();
const getActiveBooruSiteMock = vi.fn();
const getBooruSiteByIdMock = vi.fn();
const createBooruClientMock = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  },
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
}));

vi.mock('../../../src/main/services/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/main/services/config.js')>('../../../src/main/services/config.js');
  return {
    ...actual,
    getProxyConfig: vi.fn(() => null),
    getConfig: getConfigMock,
    getBooruAppearancePreference: vi.fn((config?: any) => config?.booru?.appearance ?? {
      gridSize: 330,
      previewQuality: 'auto',
      itemsPerPage: 20,
      paginationPosition: 'bottom',
      pageMode: 'pagination',
      spacing: 16,
      borderRadius: 8,
      margin: 24,
    }),
    saveConfig: saveConfigMock,
    updateGalleryFolders: vi.fn(),
    reloadConfig: vi.fn(),
  };
});

vi.mock('../../../src/main/services/imageService.js', () => ({
  initDatabase: vi.fn(),
  getImages: vi.fn(),
  addImage: vi.fn(),
  searchImages: vi.fn(),
  getImageById: vi.fn(),
  deleteImage: vi.fn(),
  updateImageTags: vi.fn(),
  getAllTags: vi.fn(),
  searchTags: vi.fn(),
  getRecentImages: vi.fn(),
  getImagesByFolder: vi.fn(),
  getAllFolders: vi.fn(),
  scanAndImportFolder: vi.fn(),
}));

vi.mock('../../../src/main/services/galleryService.js', () => ({
  getGalleries: vi.fn(),
  getGallery: vi.fn(),
  createGallery: vi.fn(),
  updateGallery: vi.fn(),
  deleteGallery: vi.fn(),
  setGalleryCover: vi.fn(),
  updateGalleryStats: vi.fn(),
  syncGalleryFolder: vi.fn(),
  scanSubfoldersAndCreateGalleries: vi.fn(),
}));

vi.mock('../../../src/main/services/moebooruClient.js', () => ({
  hashPasswordSHA1: vi.fn(),
}));

vi.mock('../../../src/main/services/booruClientFactory.js', () => ({
  createBooruClient: createBooruClientMock,
}));

vi.mock('../../../src/main/services/booruClientInterface.js', () => ({
  TAG_TYPE_MAP: {},
  RATING_MAP: {},
}));

vi.mock('../../../src/main/services/booruService.js', () => ({
  getBooruSites: getBooruSitesMock,
  getActiveBooruSite: getActiveBooruSiteMock,
  getBooruSiteById: getBooruSiteByIdMock,
}));

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  generateThumbnail: vi.fn(),
  getThumbnailIfExists: vi.fn(),
  deleteThumbnail: vi.fn(),
}));

vi.mock('../../../src/main/services/downloadManager.js', () => ({
  downloadManager: {},
}));

vi.mock('../../../src/main/services/bulkDownloadService.js', () => ({}));
vi.mock('../../../src/main/services/imageCacheService.js', () => ({}));
vi.mock('../../../src/main/services/database.js', () => ({
  runInTransaction: vi.fn(),
  getDatabase: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
}));
vi.mock('../../../src/main/services/backupService.js', () => ({
  createAppBackupData: vi.fn(),
  isValidBackupData: vi.fn(),
  restoreAppBackupData: vi.fn(),
  summarizeBackupTables: vi.fn(),
}));
vi.mock('../../../src/main/services/imageMetadataService.js', () => ({
  getImageMetadata: vi.fn(),
}));
vi.mock('../../../src/main/services/invalidImageService.js', () => ({
  reportInvalidImage: vi.fn(),
  getInvalidImages: vi.fn(),
  getInvalidImageCount: vi.fn(),
  deleteInvalidImage: vi.fn(),
  clearInvalidImages: vi.fn(),
}));
vi.mock('../../../src/main/services/updateService.js', () => ({
  checkForUpdate: vi.fn(),
}));

async function loadHandlersModule() {
  return import('../../../src/main/ipc/handlers');
}

describe('setupIPC source-level registration coverage', () => {
  const handlersPath = path.resolve(process.cwd(), 'src/main/ipc/handlers.ts');
  const preloadPath = path.resolve(process.cwd(), 'src/preload/index.ts');
  const channelsPath = path.resolve(process.cwd(), 'src/main/ipc/channels.ts');
  const source = readFileSync(handlersPath, 'utf-8');
  const preloadSource = readFileSync(preloadPath, 'utf-8');
  const channelsSource = readFileSync(channelsPath, 'utf-8');

  // TW-08: TW-05 把 window/booru/booruPreferences/system 4 个域的 IPC 调用
  // 从主 preload 搬到 src/preload/shared/create*Api.ts factory 文件。
  // 测试意图（"调用以 IPC_CHANNELS.X 形式存在而非裸字符串"）不变，
  // 但断言范围应扩展到整个 preload 层（主 preload + factory + 子窗口 preload）。
  const factoryDir = path.resolve(process.cwd(), 'src/preload/shared');
  const windowFactorySource = readFileSync(path.join(factoryDir, 'createWindowApi.ts'), 'utf-8');
  const booruFactorySource = readFileSync(path.join(factoryDir, 'createBooruApi.ts'), 'utf-8');
  const systemFactorySource = readFileSync(path.join(factoryDir, 'createSystemApi.ts'), 'utf-8');
  const booruPreferencesFactorySource = readFileSync(path.join(factoryDir, 'createBooruPreferencesApi.ts'), 'utf-8');
  const subwindowPreloadSource = readFileSync(path.resolve(process.cwd(), 'src/preload/subwindow-index.ts'), 'utf-8');
  const preloadLayerSource =
    preloadSource +
    '\n' + windowFactorySource +
    '\n' + booruFactorySource +
    '\n' + systemFactorySource +
    '\n' + booruPreferencesFactorySource +
    '\n' + subwindowPreloadSource;

  it('应在真实 handlers.ts 中注册 favorite-tag 下载相关 handlers', () => {
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_DOWNLOAD_BINDING');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_DOWNLOAD_HISTORY');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_GET_GALLERY_SOURCE_FAVORITE_TAGS');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_UPSERT_FAVORITE_TAG_DOWNLOAD_BINDING');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_DOWNLOAD_BINDING');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_START_FAVORITE_TAG_BULK_DOWNLOAD');
  });

  it('应在真实 handlers.ts 中精确注册 favorite-tag 导入导出 handlers', () => {
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_EXPORT_FAVORITE_TAGS');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_PICK_FILE');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_COMMIT');
  });

  it('主入口应仅从 handlers.ts 注册 setupIPC，且不再保留 handlers-full.ts', () => {
    const mainIndexPath = path.resolve(process.cwd(), 'src/main/index.ts');
    const mainIndexSource = readFileSync(mainIndexPath, 'utf-8');
    const legacyHandlersPath = path.resolve(process.cwd(), 'src/main/ipc/handlers-full.ts');

    expect(mainIndexSource).toContain("import { setupIPC } from './ipc/handlers.js';");
    expect(mainIndexSource).not.toContain('handlers-full');
    expect(existsSync(legacyHandlersPath)).toBe(false);
  });

  it('preload 应直接复用 channels.ts 导出的 IPC_CHANNELS，避免继续维护第二份通道表', () => {
    // not.toContain 检查：仍用 preloadSource，范围精确（主 preload 不应包含这些旧模式）
    expect(preloadSource).not.toContain('hashPassword: (salt: string, password: string) =>');
    expect(preloadSource).not.toContain('IPC_CHANNELS.BOORU_HASH_PASSWORD');
    expect(preloadSource).not.toContain('const IPC_CHANNELS = {');
    expect(preloadSource).not.toContain("callback(getBooruAppearancePreference(config))");
    expect(preloadSource).not.toContain("getBooruAppearancePreference,");
    expect(preloadSource).not.toContain("function getBooruAppearanceFromConfig(");
    // 主 preload 仍应保留 IPC_CHANNELS 导入语句
    expect(preloadSource).toContain("import { IPC_CHANNELS } from '../main/ipc/channels.js';");
    // toContain 检查：用 preloadLayerSource（含 factory）——TW-05 把 IPC 调用搬到了 factory 文件
    expect(preloadLayerSource).toContain("exportBackup: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_EXPORT_BACKUP)");
    expect(preloadLayerSource).toContain("importBackup: (mode: 'merge' | 'replace' = 'merge') => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_IMPORT_BACKUP, mode)");
    expect(preloadLayerSource).toContain("booruPreferences: {");
    expect(preloadLayerSource).toContain("appearance: {");
    expect(preloadLayerSource).toContain("get: () => ipcRenderer.invoke(IPC_CHANNELS.BOORU_PREFERENCES_GET_APPEARANCE)");
    expect(preloadLayerSource).toContain("ipcRenderer.on(IPC_CHANNELS.CONFIG_CHANGED, subscription)");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET)");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.BOORU_PREFERENCES_GET_APPEARANCE)");
    expect(preloadLayerSource).toContain("getTagRelationships: (siteId: number, name: string) =>");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_TAG_RELATIONSHIPS, siteId, name)");
    expect(preloadLayerSource).toContain("reportPost: (siteId: number, postId: number, reason: string) =>");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.BOORU_REPORT_POST, siteId, postId, reason)");
    expect(preloadLayerSource).toContain("getImageMetadata: (request: { localPath?: string; fileUrl?: string; md5?: string; fileExt?: string }) =>");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_IMAGE_METADATA, request)");
    expect(preloadLayerSource).toContain("getWiki: (siteId: number, title: string) =>");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_WIKI, siteId, title)");
    expect(preloadLayerSource).toContain("getForumTopics: (siteId: number, page?: number, limit?: number) =>");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FORUM_TOPICS, siteId, page, limit)");
    expect(preloadLayerSource).toContain("getForumPosts: (siteId: number, topicId: number, page?: number, limit?: number) =>");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FORUM_POSTS, siteId, topicId, page, limit)");
    expect(preloadLayerSource).toContain("getProfile: (siteId: number) =>");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_PROFILE, siteId)");
    expect(preloadLayerSource).toContain("getUserProfile: (siteId: number, params: { userId?: number; username?: string }) =>");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_USER_PROFILE, siteId, params)");
    expect(preloadLayerSource).toContain("testBaidu: () => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_TEST_BAIDU)");
    expect(preloadLayerSource).toContain("testGoogle: () => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_TEST_GOOGLE)");
  });

  it('channels.ts 应收录 preload 和 handlers 当前共同使用的新增通道常量', () => {
    expect(channelsSource).toContain("SYSTEM_EXPORT_BACKUP: 'system:export-backup'");
    expect(channelsSource).toContain("SYSTEM_IMPORT_BACKUP: 'system:import-backup'");
    expect(channelsSource).toContain("BOORU_PREFERENCES_GET_APPEARANCE: 'booru-preferences:get-appearance'");
    expect(channelsSource).toContain("BOORU_GET_TAG_RELATIONSHIPS: 'booru:get-tag-relationships'");
    expect(channelsSource).toContain("BOORU_REPORT_POST: 'booru:report-post'");
    expect(channelsSource).toContain("BOORU_GET_IMAGE_METADATA: 'booru:get-image-metadata'");
    expect(channelsSource).toContain("NETWORK_TEST_BAIDU: 'network:test-baidu'");
    expect(channelsSource).toContain("NETWORK_TEST_GOOGLE: 'network:test-google'");
    expect(channelsSource).toContain("BOORU_GET_WIKI: 'booru:get-wiki'");
    expect(channelsSource).toContain("BOORU_GET_FORUM_TOPICS: 'booru:get-forum-topics'");
    expect(channelsSource).toContain("BOORU_GET_FORUM_POSTS: 'booru:get-forum-posts'");
    expect(channelsSource).toContain("BOORU_GET_PROFILE: 'booru:get-profile'");
    expect(channelsSource).toContain("BOORU_GET_USER_PROFILE: 'booru:get-user-profile'");
  });

  it('preload 的 bulk-download API 应复用 channels.ts 现有常量而不是继续写裸字符串', () => {
    expect(preloadSource).toContain("createTask: (options: any) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_CREATE_TASK, options)");
    expect(preloadSource).toContain("getTasks: () => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_GET_TASKS)");
    expect(preloadSource).toContain("getTask: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_GET_TASK, taskId)");
    expect(preloadSource).toContain("updateTask: (taskId: string, updates: any) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_UPDATE_TASK, taskId, updates)");
    expect(preloadSource).toContain("deleteTask: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_DELETE_TASK, taskId)");
    expect(preloadSource).toContain("createSession: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_CREATE_SESSION, taskId)");
    expect(preloadSource).toContain("getActiveSessions: () => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_GET_ACTIVE_SESSIONS)");
    expect(preloadSource).toContain("startSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_START_SESSION, sessionId)");
    expect(preloadSource).toContain("pauseSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_PAUSE_SESSION, sessionId)");
    expect(preloadSource).toContain("cancelSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_CANCEL_SESSION, sessionId)");
    expect(preloadSource).toContain("deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_DELETE_SESSION, sessionId)");
    expect(preloadSource).toContain("getSessionStats: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_GET_SESSION_STATS, sessionId)");
    expect(preloadSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_GET_RECORDS, sessionId, status, page, autoFix)");
    expect(preloadSource).toContain("retryAllFailed: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_RETRY_ALL_FAILED, sessionId)");
    expect(preloadSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_RETRY_FAILED_RECORD, sessionId, recordUrl)");
    expect(preloadSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_RESUME_RUNNING_SESSIONS)");
  });

  it('image/gallery/config 共享调用与事件应继续收敛到 IPC_CHANNELS，避免双端裸字符串漂移', () => {
    expect(channelsSource).toContain("IMAGE_GET_THUMBNAIL: 'image:get-thumbnail'");
    expect(channelsSource).toContain("IMAGE_DELETE: 'image:delete'");
    expect(channelsSource).toContain("IMAGE_DELETE_THUMBNAIL: 'image:delete-thumbnail'");
    expect(channelsSource).toContain("GALLERY_GET_RECENT_IMAGES: 'gallery:get-recent-images'");
    expect(channelsSource).toContain("GALLERY_GET_ALL_FOLDERS: 'gallery:get-all-folders'");
    expect(channelsSource).toContain("GALLERY_GET_GALLERIES: 'gallery:get-galleries'");
    expect(channelsSource).toContain("GALLERY_GET_GALLERY: 'gallery:get-gallery'");
    expect(channelsSource).toContain("GALLERY_CREATE_GALLERY: 'gallery:create-gallery'");
    expect(channelsSource).toContain("GALLERY_UPDATE_GALLERY: 'gallery:update-gallery'");
    expect(channelsSource).toContain("GALLERY_DELETE_GALLERY: 'gallery:delete-gallery'");
    expect(channelsSource).toContain("GALLERY_SET_GALLERY_COVER: 'gallery:set-gallery-cover'");
    expect(channelsSource).toContain("GALLERY_UPDATE_GALLERY_STATS: 'gallery:update-gallery-stats'");
    expect(channelsSource).toContain("GALLERY_GET_IMAGES_BY_FOLDER: 'gallery:get-images-by-folder'");
    expect(channelsSource).toContain("GALLERY_SCAN_AND_IMPORT_FOLDER: 'gallery:scan-and-import-folder'");
    expect(channelsSource).toContain("GALLERY_SYNC_GALLERY_FOLDER: 'gallery:sync-gallery-folder'");
    expect(channelsSource).toContain("GALLERY_SCAN_SUBFOLDERS: 'gallery:scan-subfolders'");
    expect(channelsSource).toContain("GALLERY_REPORT_INVALID_IMAGE: 'gallery:report-invalid-image'");
    expect(channelsSource).toContain("GALLERY_GET_INVALID_IMAGES: 'gallery:get-invalid-images'");
    expect(channelsSource).toContain("GALLERY_GET_INVALID_IMAGE_COUNT: 'gallery:get-invalid-image-count'");
    expect(channelsSource).toContain("GALLERY_DELETE_INVALID_IMAGE: 'gallery:delete-invalid-image'");
    expect(channelsSource).toContain("GALLERY_CLEAR_INVALID_IMAGES: 'gallery:clear-invalid-images'");
    expect(channelsSource).toContain("CONFIG_GET: 'config:get'");
    expect(channelsSource).toContain("CONFIG_SAVE: 'config:save'");
    expect(channelsSource).toContain("CONFIG_UPDATE_GALLERY_FOLDERS: 'config:update-gallery-folders'");
    expect(channelsSource).toContain("CONFIG_RELOAD: 'config:reload'");
    expect(channelsSource).toContain("CONFIG_CHANGED: 'config:changed'");
    expect(channelsSource).toContain("BOORU_FAVORITES_REPAIR_DONE: 'booru:favorites-repair-done'");

    expect(preloadSource).not.toContain("ipcRenderer.invoke('gallery:");
    expect(preloadSource).not.toContain("ipcRenderer.invoke('config:");
    expect(preloadSource).not.toContain("ipcRenderer.invoke('image:get-thumbnail'");
    expect(preloadSource).not.toContain("ipcRenderer.invoke('image:delete-thumbnail'");
    expect(preloadSource).not.toContain("ipcRenderer.invoke('image:delete'");
    expect(preloadSource).not.toContain("ipcRenderer.on('config:changed'");
    expect(preloadSource).not.toContain("ipcRenderer.on('booru:favorites-repair-done'");

    expect(source).not.toContain("ipcMain.handle('gallery:");
    expect(source).not.toContain("ipcMain.handle('config:");
    expect(source).not.toContain("ipcMain.handle('image:get-thumbnail'");
    expect(source).not.toContain("ipcMain.handle('image:delete-thumbnail'");
    expect(source).not.toContain("ipcMain.handle('image:delete'");
    expect(source).not.toContain("webContents.send('config:changed'");
    expect(source).not.toContain("webContents.send('booru:favorites-repair-done'");
  });

  it('window、下载进度与批量下载记录事件也应收敛到 IPC_CHANNELS，避免 preload 与主进程继续共享裸字符串', () => {
    expect(channelsSource).toContain("WINDOW_OPEN_TAG_SEARCH: 'window:open-tag-search'");
    expect(channelsSource).toContain("WINDOW_OPEN_ARTIST: 'window:open-artist'");
    expect(channelsSource).toContain("WINDOW_OPEN_CHARACTER: 'window:open-character'");
    expect(channelsSource).toContain("WINDOW_OPEN_SECONDARY_MENU: 'window:open-secondary-menu'");
    expect(channelsSource).toContain("BOORU_DOWNLOAD_PROGRESS: 'booru:download-progress'");
    expect(channelsSource).toContain("BOORU_DOWNLOAD_STATUS: 'booru:download-status'");
    expect(channelsSource).toContain("BOORU_DOWNLOAD_QUEUE_STATUS: 'booru:download-queue-status'");
    expect(channelsSource).toContain("BULK_DOWNLOAD_RECORD_PROGRESS: 'bulk-download:record-progress'");
    expect(channelsSource).toContain("BULK_DOWNLOAD_RECORD_STATUS: 'bulk-download:record-status'");

    // toContain 检查：用 preloadLayerSource（含 factory）——TW-05 把 IPC 调用搬到了 factory 文件
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_TAG_SEARCH, tag, siteId)");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_ARTIST, name, siteId)");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_CHARACTER, name, siteId)");
    expect(preloadLayerSource).toContain("ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_SECONDARY_MENU, section, key, tab)");
    expect(preloadLayerSource).toContain("ipcRenderer.on(IPC_CHANNELS.BOORU_DOWNLOAD_PROGRESS, subscription)");
    expect(preloadLayerSource).toContain("ipcRenderer.on(IPC_CHANNELS.BOORU_DOWNLOAD_STATUS, subscription)");
    expect(preloadLayerSource).toContain("ipcRenderer.on(IPC_CHANNELS.BOORU_DOWNLOAD_QUEUE_STATUS, subscription)");
    expect(preloadLayerSource).toContain("ipcRenderer.on(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_PROGRESS, subscription)");
    expect(preloadLayerSource).toContain("ipcRenderer.on(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, subscription)");
    // not.toContain 检查：用 preloadLayerSource 更严格（整个 preload 层均不应出现裸字符串）
    expect(preloadLayerSource).not.toContain("ipcRenderer.invoke('window:");
    expect(preloadLayerSource).not.toContain("ipcRenderer.on('booru:download-");
    expect(preloadLayerSource).not.toContain("ipcRenderer.on('bulk-download:record-");
  });
});

describe('setupIPC booru site IPC boundary behavior', () => {
  async function registerHandler(channel: string) {
    const registration = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
    expect(registration).toBeTruthy();
    return registration?.[1] as (...args: any[]) => Promise<unknown>;
  }

  beforeEach(async () => {
    vi.resetModules();
    handleMock.mockReset();
    getAllWindowsMock.mockReset();
    getConfigMock.mockReset();
    saveConfigMock.mockReset();
    getBooruSitesMock.mockReset();
    getActiveBooruSiteMock.mockReset();
    getBooruSiteByIdMock.mockReset();
    createBooruClientMock.mockReset();
    const { setupIPC } = await loadHandlersModule();
    setupIPC();
  });

  async function registerAndGetBooruSiteHandlers() {
    const getSitesRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.BOORU_GET_SITES);
    const getActiveSiteRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.BOORU_GET_ACTIVE_SITE);

    expect(getSitesRegistration).toBeTruthy();
    expect(getActiveSiteRegistration).toBeTruthy();

    return {
      getSitesHandler: getSitesRegistration?.[1] as (_event: unknown) => Promise<unknown>,
      getActiveSiteHandler: getActiveSiteRegistration?.[1] as (_event: unknown) => Promise<unknown>,
    };
  }

  it('BOORU_GET_SITES 应返回不含敏感凭据的安全站点 DTO，并补充 authenticated', async () => {
    getBooruSitesMock.mockResolvedValue([
      {
        id: 1,
        name: 'Yande',
        url: 'https://yande.re',
        type: 'moebooru',
        salt: 'secret-salt',
        apiKey: 'secret-key',
        username: 'alice',
        passwordHash: 'secret-hash',
        favoriteSupport: true,
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 2,
        name: 'Danbooru',
        url: 'https://danbooru.donmai.us',
        type: 'danbooru',
        salt: 'secret-salt-2',
        apiKey: 'secret-key-2',
        username: 'bob',
        passwordHash: '',
        favoriteSupport: false,
        active: false,
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z',
      },
    ]);

    const { getSitesHandler } = await registerAndGetBooruSiteHandlers();
    const result = await getSitesHandler({}) as { success: boolean; data: any[] };

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      {
        id: 1,
        name: 'Yande',
        url: 'https://yande.re',
        type: 'moebooru',
        username: 'alice',
        favoriteSupport: true,
        active: true,
        authenticated: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 2,
        name: 'Danbooru',
        url: 'https://danbooru.donmai.us',
        type: 'danbooru',
        username: 'bob',
        favoriteSupport: false,
        active: false,
        authenticated: false,
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z',
      },
    ]);
    expect(result.data[0]).not.toHaveProperty('salt');
    expect(result.data[0]).not.toHaveProperty('apiKey');
    expect(result.data[0]).not.toHaveProperty('passwordHash');
  });

  it('BOORU_GET_ACTIVE_SITE 应返回不含敏感凭据的安全站点 DTO，并补充 authenticated', async () => {
    getActiveBooruSiteMock.mockResolvedValue({
      id: 3,
      name: 'Gelbooru',
      url: 'https://gelbooru.com',
      type: 'gelbooru',
      salt: 'secret-salt-3',
      apiKey: 'secret-key-3',
      username: 'carol',
      passwordHash: 'secret-hash-3',
      favoriteSupport: true,
      active: true,
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: '2026-01-06T00:00:00.000Z',
    });

    const { getActiveSiteHandler } = await registerAndGetBooruSiteHandlers();
    const result = await getActiveSiteHandler({}) as { success: boolean; data: any };

    expect(result).toEqual({
      success: true,
      data: {
        id: 3,
        name: 'Gelbooru',
        url: 'https://gelbooru.com',
        type: 'gelbooru',
        username: 'carol',
        favoriteSupport: true,
        active: true,
        authenticated: true,
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-06T00:00:00.000Z',
      },
    });
    expect(result.data).not.toHaveProperty('salt');
    expect(result.data).not.toHaveProperty('apiKey');
    expect(result.data).not.toHaveProperty('passwordHash');
  });

  it('Wiki/Forum/Profile IPC 应返回 shared 层定义的 camelCase DTO，而不是原始 upstream 字段', async () => {
    getBooruSiteByIdMock.mockResolvedValue({
      id: 7,
      name: 'Danbooru',
      url: 'https://danbooru.donmai.us',
      type: 'danbooru',
      username: 'alice',
      passwordHash: 'secret',
      favoriteSupport: true,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    createBooruClientMock.mockReturnValue({
      getWiki: vi.fn().mockResolvedValue({
        id: 11,
        title: 'test_wiki',
        body: 'body',
        other_names: ['alias_a'],
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-02T00:00:00.000Z',
        is_locked: true,
        is_deleted: false,
      }),
      getForumTopics: vi.fn().mockResolvedValue([
        {
          id: 21,
          title: 'topic',
          response_count: 5,
          is_sticky: true,
          is_locked: false,
          is_hidden: false,
          category_id: 2,
          creator_id: 3,
          updater_id: 4,
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-02T00:00:00.000Z',
        },
      ]),
      getForumPosts: vi.fn().mockResolvedValue([
        {
          id: 31,
          topic_id: 21,
          body: 'post body',
          creator_id: 8,
          updater_id: 9,
          created_at: '2026-03-03T00:00:00.000Z',
          updated_at: '2026-03-04T00:00:00.000Z',
          is_deleted: false,
          is_hidden: true,
        },
      ]),
      getProfile: vi.fn().mockResolvedValue({
        id: 41,
        name: 'alice',
        level_string: 'Gold',
        created_at: '2026-04-01T00:00:00.000Z',
        avatar_url: 'https://example.com/avatar.png',
        post_upload_count: 10,
        post_update_count: 11,
        note_update_count: 12,
        comment_count: 13,
        forum_post_count: 14,
        favorite_count: 15,
        feedback_count: 16,
      }),
      getUserProfile: vi.fn().mockResolvedValue({
        id: 42,
        name: 'bob',
        level_string: 'Member',
        created_at: '2026-04-05T00:00:00.000Z',
        avatar_url: 'https://example.com/bob.png',
        post_upload_count: 20,
        post_update_count: 21,
        note_update_count: 22,
        comment_count: 23,
        forum_post_count: 24,
        favorite_count: 25,
        feedback_count: 26,
      }),
    });

    const wikiHandler = await registerHandler(IPC_CHANNELS.BOORU_GET_WIKI);
    const forumTopicsHandler = await registerHandler(IPC_CHANNELS.BOORU_GET_FORUM_TOPICS);
    const forumPostsHandler = await registerHandler(IPC_CHANNELS.BOORU_GET_FORUM_POSTS);
    const profileHandler = await registerHandler(IPC_CHANNELS.BOORU_GET_PROFILE);
    const userProfileHandler = await registerHandler(IPC_CHANNELS.BOORU_GET_USER_PROFILE);

    await expect(wikiHandler({}, 7, 'test_wiki')).resolves.toEqual({
      success: true,
      data: {
        id: 11,
        title: 'test_wiki',
        body: 'body',
        otherNames: ['alias_a'],
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-02T00:00:00.000Z',
        isLocked: true,
        isDeleted: false,
      },
    });

    createBooruClientMock.mockReturnValueOnce({
      getWiki: vi.fn().mockResolvedValue({
        id: 12,
        title: 'test_wiki_2',
        body: 'body 2',
        other_names: undefined,
      }),
    });

    await expect(wikiHandler({}, 7, 'test_wiki_2')).resolves.toEqual({
      success: true,
      data: {
        id: 12,
        title: 'test_wiki_2',
        body: 'body 2',
        otherNames: [],
        createdAt: undefined,
        updatedAt: undefined,
        isLocked: undefined,
        isDeleted: undefined,
      },
    });

    createBooruClientMock.mockReturnValueOnce({
      getWiki: vi.fn().mockResolvedValue({
        id: 13,
        title: 'test_wiki_3',
        body: undefined,
        other_names: ['alias_b'],
      }),
    });

    await expect(wikiHandler({}, 7, 'test_wiki_3')).resolves.toEqual({
      success: true,
      data: {
        id: 13,
        title: 'test_wiki_3',
        body: '',
        otherNames: ['alias_b'],
        createdAt: undefined,
        updatedAt: undefined,
        isLocked: undefined,
        isDeleted: undefined,
      },
    });

    await expect(forumTopicsHandler({}, 7, 1, 20)).resolves.toEqual({
      success: true,
      data: [
        {
          id: 21,
          title: 'topic',
          responseCount: 5,
          isSticky: true,
          isLocked: false,
          isHidden: false,
          categoryId: 2,
          creatorId: 3,
          updaterId: 4,
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-02T00:00:00.000Z',
        },
      ],
    });

    await expect(forumPostsHandler({}, 7, 21, 1, 20)).resolves.toEqual({
      success: true,
      data: [
        {
          id: 31,
          topicId: 21,
          body: 'post body',
          creatorId: 8,
          updaterId: 9,
          createdAt: '2026-03-03T00:00:00.000Z',
          updatedAt: '2026-03-04T00:00:00.000Z',
          isDeleted: false,
          isHidden: true,
        },
      ],
    });

    await expect(profileHandler({}, 7)).resolves.toEqual({
      success: true,
      data: {
        id: 41,
        name: 'alice',
        levelString: 'Gold',
        createdAt: '2026-04-01T00:00:00.000Z',
        avatarUrl: 'https://example.com/avatar.png',
        postUploadCount: 10,
        postUpdateCount: 11,
        noteUpdateCount: 12,
        commentCount: 13,
        forumPostCount: 14,
        favoriteCount: 15,
        feedbackCount: 16,
      },
    });

    await expect(userProfileHandler({}, 7, { username: 'bob' })).resolves.toEqual({
      success: true,
      data: {
        id: 42,
        name: 'bob',
        levelString: 'Member',
        createdAt: '2026-04-05T00:00:00.000Z',
        avatarUrl: 'https://example.com/bob.png',
        postUploadCount: 20,
        postUpdateCount: 21,
        noteUpdateCount: 22,
        commentCount: 23,
        forumPostCount: 24,
        favoriteCount: 25,
        feedbackCount: 26,
      },
    });
  });
});

describe('setupIPC config IPC boundary behavior', () => {
  beforeEach(async () => {
    vi.resetModules();
    handleMock.mockReset();
    getAllWindowsMock.mockReset();
    getConfigMock.mockReset();
    saveConfigMock.mockReset();
    getBooruSitesMock.mockReset();
    getActiveBooruSiteMock.mockReset();
    getBooruSiteByIdMock.mockReset();
    createBooruClientMock.mockReset();
    const { setupIPC } = await loadHandlersModule();
    setupIPC();
  });

  async function registerAndGetConfigHandlers() {
    const getRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.CONFIG_GET);
    const saveRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.CONFIG_SAVE);
    const getBooruAppearanceRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.BOORU_PREFERENCES_GET_APPEARANCE);
    const getFavoriteTagsPreferencesRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.PAGE_PREFERENCES_GET_FAVORITE_TAGS);
    const saveFavoriteTagsPreferencesRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.PAGE_PREFERENCES_SAVE_FAVORITE_TAGS);
    const getBlacklistedTagsPreferencesRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.PAGE_PREFERENCES_GET_BLACKLISTED_TAGS);
    const saveBlacklistedTagsPreferencesRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.PAGE_PREFERENCES_SAVE_BLACKLISTED_TAGS);
    const getGalleryPreferencesRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.PAGE_PREFERENCES_GET_GALLERY);
    const saveGalleryPreferencesRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.PAGE_PREFERENCES_SAVE_GALLERY);
    const getAppShellPreferencesRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.PAGE_PREFERENCES_GET_APP_SHELL);
    const saveAppShellPreferencesRegistration = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.PAGE_PREFERENCES_SAVE_APP_SHELL);

    expect(getRegistration).toBeTruthy();
    expect(saveRegistration).toBeTruthy();
    expect(getBooruAppearanceRegistration).toBeTruthy();
    expect(getFavoriteTagsPreferencesRegistration).toBeTruthy();
    expect(saveFavoriteTagsPreferencesRegistration).toBeTruthy();
    expect(getBlacklistedTagsPreferencesRegistration).toBeTruthy();
    expect(saveBlacklistedTagsPreferencesRegistration).toBeTruthy();
    expect(getGalleryPreferencesRegistration).toBeTruthy();
    expect(saveGalleryPreferencesRegistration).toBeTruthy();
    expect(getAppShellPreferencesRegistration).toBeTruthy();
    expect(saveAppShellPreferencesRegistration).toBeTruthy();

    return {
      getHandler: getRegistration?.[1] as (_event: unknown) => Promise<unknown>,
      saveHandler: saveRegistration?.[1] as (_event: unknown, payload: unknown) => Promise<unknown>,
      getBooruAppearanceHandler: getBooruAppearanceRegistration?.[1] as (_event: unknown) => Promise<unknown>,
      getFavoriteTagsPreferencesHandler: getFavoriteTagsPreferencesRegistration?.[1] as (_event: unknown) => Promise<unknown>,
      saveFavoriteTagsPreferencesHandler: saveFavoriteTagsPreferencesRegistration?.[1] as (_event: unknown, payload: unknown) => Promise<unknown>,
      getBlacklistedTagsPreferencesHandler: getBlacklistedTagsPreferencesRegistration?.[1] as (_event: unknown) => Promise<unknown>,
      saveBlacklistedTagsPreferencesHandler: saveBlacklistedTagsPreferencesRegistration?.[1] as (_event: unknown, payload: unknown) => Promise<unknown>,
      getGalleryPreferencesHandler: getGalleryPreferencesRegistration?.[1] as (_event: unknown) => Promise<unknown>,
      saveGalleryPreferencesHandler: saveGalleryPreferencesRegistration?.[1] as (_event: unknown, payload: unknown) => Promise<unknown>,
      getAppShellPreferencesHandler: getAppShellPreferencesRegistration?.[1] as (_event: unknown) => Promise<unknown>,
      saveAppShellPreferencesHandler: saveAppShellPreferencesRegistration?.[1] as (_event: unknown, payload: unknown) => Promise<unknown>,
    };
  }

  it('CONFIG_GET 应返回去敏后的 safe config', async () => {
    getConfigMock.mockReturnValue({
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
          username: 'secret-user',
          password: 'secret-pass',
        },
      },
      google: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
        photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
      },
      booru: {
        appearance: {
          gridSize: 360,
          previewQuality: 'high',
          itemsPerPage: 42,
          paginationPosition: 'both',
          pageMode: 'infinite',
          spacing: 20,
          borderRadius: 10,
          margin: 28,
        },
        download: {
          filenameTemplate: '{id}',
          tokenDefaults: {},
        },
      },
      ui: {
        menuOrder: {
          main: ['gallery', 'booru', 'google'],
        },
        pinnedItems: [{ section: 'google', key: 'gdrive' }],
        pagePreferences: {
          favoriteTags: { keyword: 'keep-me' },
          appShell: {
            menuOrder: { booru: ['download', 'posts'] },
            pinnedItems: [{ section: 'booru', key: 'download', defaultTab: 'bulk' }],
          },
        },
      },
    });

    const { getHandler, getBooruAppearanceHandler } = await registerAndGetConfigHandlers();

    await expect(getHandler({})).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
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
          drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
          photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
        },
      }),
    });

    const result = await getHandler({}) as { success: boolean; data: any };
    expect(result.data.network.proxy).not.toHaveProperty('username');
    expect(result.data.network.proxy).not.toHaveProperty('password');
    expect(result.data.google).not.toHaveProperty('clientSecret');
    expect(result.data.ui).toEqual({
      pagePreferences: {
        favoriteTags: { keyword: 'keep-me' },
      },
    });
    expect(result.data.ui).not.toHaveProperty('menuOrder');
    expect(result.data.ui).not.toHaveProperty('pinnedItems');
    expect(result.data.ui.pagePreferences).not.toHaveProperty('appShell');

    await expect(getBooruAppearanceHandler({})).resolves.toEqual({
      success: true,
      data: {
        gridSize: 360,
        previewQuality: 'high',
        itemsPerPage: 42,
        paginationPosition: 'both',
        pageMode: 'infinite',
        spacing: 20,
        borderRadius: 10,
        margin: 28,
      },
    });
  });

  it('BOORU_PREFERENCES_GET_APPEARANCE 应只返回 appearance DTO 而不是整包 config', async () => {
    getConfigMock.mockReturnValue({
      network: {
        proxy: {
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
          username: 'secret-user',
          password: 'secret-pass',
        },
      },
      booru: {
        appearance: {
          gridSize: 320,
          previewQuality: 'medium',
          itemsPerPage: 30,
          paginationPosition: 'bottom',
          pageMode: 'pagination',
          spacing: 18,
          borderRadius: 6,
          margin: 22,
        },
      },
    });

    const { getBooruAppearanceHandler } = await registerAndGetConfigHandlers();
    const result = await getBooruAppearanceHandler({}) as { success: boolean; data: Record<string, unknown> };

    expect(result).toEqual({
      success: true,
      data: {
        gridSize: 320,
        previewQuality: 'medium',
        itemsPerPage: 30,
        paginationPosition: 'bottom',
        pageMode: 'pagination',
        spacing: 18,
        borderRadius: 6,
        margin: 22,
      },
    });
    expect(result.data).not.toHaveProperty('network');
    expect(result.data).not.toHaveProperty('booru');
  });

  it('CONFIG_SAVE 成功时应广播 CONFIG_CHANGED 摘要，不再下发整包 safe config', async () => {
    const windowA = { webContents: { send: vi.fn() } };
    const windowB = { webContents: { send: vi.fn() } };
    getAllWindowsMock.mockReturnValue([windowA, windowB]);
    saveConfigMock.mockResolvedValue({ success: true });
    getConfigMock.mockReturnValue({
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
          username: 'secret-user',
          password: 'secret-pass',
        },
      },
      google: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
        photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
      },
    });

    const { saveHandler } = await registerAndGetConfigHandlers();
    const payload = { ui: { pagePreferences: { favoriteTags: { keyword: 'hello' } } } };

    await expect(saveHandler({}, payload)).resolves.toEqual({ success: true });
    expect(saveConfigMock).toHaveBeenCalledWith(payload);
    expect(windowA.webContents.send).toHaveBeenCalledTimes(1);
    expect(windowB.webContents.send).toHaveBeenCalledTimes(1);

    const [channel, summary] = windowA.webContents.send.mock.calls[0];
    expect(channel).toBe(IPC_CHANNELS.CONFIG_CHANGED);
    expect(summary).toEqual({
      version: expect.any(Number),
      sections: ['ui.pagePreferences.favoriteTags'],
    });
    expect(summary).not.toHaveProperty('network');
    expect(summary).not.toHaveProperty('google');
    expect(summary).not.toHaveProperty('ui');
  });

  it('CONFIG_SAVE 失败时不应广播 CONFIG_CHANGED', async () => {
    const windowA = { webContents: { send: vi.fn() } };
    getAllWindowsMock.mockReturnValue([windowA]);
    saveConfigMock.mockResolvedValue({ success: false, error: 'save failed' });

    const { saveHandler } = await registerAndGetConfigHandlers();

    await expect(saveHandler({}, { ui: { pagePreferences: { blacklistedTags: { keyword: 'x' } } } })).resolves.toEqual({
      success: false,
      error: 'save failed',
    });
    expect(windowA.webContents.send).not.toHaveBeenCalled();
  });

  it('PAGE_PREFERENCES_GET_FAVORITE_TAGS 应返回当前 favoriteTags 页面偏好', async () => {
    getConfigMock.mockReturnValue({
      ui: {
        pagePreferences: {
          favoriteTags: {
            filterSiteId: 1,
            sortKey: 'galleryName',
            sortOrder: 'desc',
            keyword: 'persisted keyword',
            page: 3,
            pageSize: 50,
          },
        },
      },
    });

    const { getFavoriteTagsPreferencesHandler } = await registerAndGetConfigHandlers();

    await expect(getFavoriteTagsPreferencesHandler({})).resolves.toEqual({
      success: true,
      data: {
        filterSiteId: 1,
        sortKey: 'galleryName',
        sortOrder: 'desc',
        keyword: 'persisted keyword',
        page: 3,
        pageSize: 50,
      },
    });
  });

  it('PAGE_PREFERENCES_SAVE_FAVORITE_TAGS 成功时应广播 favoriteTags 变更摘要', async () => {
    const windowA = { webContents: { send: vi.fn() } };
    getAllWindowsMock.mockReturnValue([windowA]);
    saveConfigMock.mockResolvedValue({ success: true });
    getConfigMock.mockReturnValue({
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
          username: 'secret-user',
          password: 'secret-pass',
        },
      },
      google: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
        photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
      },
    });

    const { saveFavoriteTagsPreferencesHandler } = await registerAndGetConfigHandlers();
    const preferences = {
      filterSiteId: 1,
      sortKey: 'galleryName',
      sortOrder: 'desc',
      keyword: 'persisted keyword',
      page: 3,
      pageSize: 50,
    };

    await expect(saveFavoriteTagsPreferencesHandler({}, preferences)).resolves.toEqual({ success: true });
    expect(saveConfigMock).toHaveBeenCalledWith({
      ui: {
        pagePreferences: {
          favoriteTags: preferences,
        },
      },
    });
    expect(windowA.webContents.send).toHaveBeenCalledTimes(1);
    const [channel, summary] = windowA.webContents.send.mock.calls[0];
    expect(channel).toBe(IPC_CHANNELS.CONFIG_CHANGED);
    expect(summary).toEqual({
      version: expect.any(Number),
      sections: [expect.any(String)],
    });
    expect(summary).not.toHaveProperty('network');
    expect(summary).not.toHaveProperty('google');
    expect(summary).not.toHaveProperty('ui');
  });

  it('PAGE_PREFERENCES_SAVE_FAVORITE_TAGS 失败时不应广播 CONFIG_CHANGED', async () => {
    const windowA = { webContents: { send: vi.fn() } };
    getAllWindowsMock.mockReturnValue([windowA]);
    saveConfigMock.mockResolvedValue({ success: false, error: 'save failed' });

    const { saveFavoriteTagsPreferencesHandler } = await registerAndGetConfigHandlers();

    await expect(saveFavoriteTagsPreferencesHandler({}, { keyword: 'oops' })).resolves.toEqual({
      success: false,
      error: 'save failed',
    });
    expect(windowA.webContents.send).not.toHaveBeenCalled();
  });

  it('PAGE_PREFERENCES_GET_BLACKLISTED_TAGS 应返回当前 blacklistedTags 页面偏好', async () => {
    getConfigMock.mockReturnValue({
      ui: {
        pagePreferences: {
          blacklistedTags: {
            filterSiteId: 1,
            keyword: 'persisted blacklist',
            page: 4,
            pageSize: 100,
          },
        },
      },
    });

    const { getBlacklistedTagsPreferencesHandler } = await registerAndGetConfigHandlers();

    await expect(getBlacklistedTagsPreferencesHandler({})).resolves.toEqual({
      success: true,
      data: {
        filterSiteId: 1,
        keyword: 'persisted blacklist',
        page: 4,
        pageSize: 100,
      },
    });
  });

  it('PAGE_PREFERENCES_SAVE_BLACKLISTED_TAGS 成功时应广播 blacklistedTags 变更摘要', async () => {
    const windowA = { webContents: { send: vi.fn() } };
    getAllWindowsMock.mockReturnValue([windowA]);
    saveConfigMock.mockResolvedValue({ success: true });
    getConfigMock.mockReturnValue({
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
          username: 'secret-user',
          password: 'secret-pass',
        },
      },
      google: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
        photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
      },
    });

    const { saveBlacklistedTagsPreferencesHandler } = await registerAndGetConfigHandlers();
    const preferences = {
      filterSiteId: 1,
      keyword: 'persisted blacklist',
      page: 4,
      pageSize: 100,
    };

    await expect(saveBlacklistedTagsPreferencesHandler({}, preferences)).resolves.toEqual({ success: true });
    expect(saveConfigMock).toHaveBeenCalledWith({
      ui: {
        pagePreferences: {
          blacklistedTags: preferences,
        },
      },
    });
    expect(windowA.webContents.send).toHaveBeenCalledTimes(1);
    const [channel, summary] = windowA.webContents.send.mock.calls[0];
    expect(channel).toBe(IPC_CHANNELS.CONFIG_CHANGED);
    expect(summary).toEqual({
      version: expect.any(Number),
      sections: [expect.any(String)],
    });
    expect(summary).not.toHaveProperty('network');
    expect(summary).not.toHaveProperty('google');
    expect(summary).not.toHaveProperty('ui');
  });

  it('PAGE_PREFERENCES_SAVE_BLACKLISTED_TAGS 失败时不应广播 CONFIG_CHANGED', async () => {
    const windowA = { webContents: { send: vi.fn() } };
    getAllWindowsMock.mockReturnValue([windowA]);
    saveConfigMock.mockResolvedValue({ success: false, error: 'save failed' });

    const { saveBlacklistedTagsPreferencesHandler } = await registerAndGetConfigHandlers();

    await expect(saveBlacklistedTagsPreferencesHandler({}, { keyword: 'oops' })).resolves.toEqual({
      success: false,
      error: 'save failed',
    });
    expect(windowA.webContents.send).not.toHaveBeenCalled();
  });

  it('PAGE_PREFERENCES_GET_GALLERY 应返回当前 galleryBySubTab 页面偏好', async () => {
    getConfigMock.mockReturnValue({
      ui: {
        pagePreferences: {
          galleryBySubTab: {
            all: {
              searchQuery: 'persisted query',
              isSearchMode: true,
              allPage: 4,
              searchPage: 3,
            },
            galleries: {
              gallerySearchQuery: '测试',
              gallerySortKey: 'name',
              gallerySortOrder: 'asc',
              selectedGalleryId: 1,
              gallerySort: 'name',
            },
          },
        },
      },
    });

    const { getGalleryPreferencesHandler } = await registerAndGetConfigHandlers();

    await expect(getGalleryPreferencesHandler({})).resolves.toEqual({
      success: true,
      data: {
        all: {
          searchQuery: 'persisted query',
          isSearchMode: true,
          allPage: 4,
          searchPage: 3,
        },
        galleries: {
          gallerySearchQuery: '测试',
          gallerySortKey: 'name',
          gallerySortOrder: 'asc',
          selectedGalleryId: 1,
          gallerySort: 'name',
        },
      },
    });
  });

  it('PAGE_PREFERENCES_SAVE_GALLERY 成功时应广播 galleryBySubTab 变更摘要', async () => {
    const windowA = { webContents: { send: vi.fn() } };
    getAllWindowsMock.mockReturnValue([windowA]);
    saveConfigMock.mockResolvedValue({ success: true });
    getConfigMock.mockReturnValue({
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
          username: 'secret-user',
          password: 'secret-pass',
        },
      },
      google: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
        photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
      },
    });

    const { saveGalleryPreferencesHandler } = await registerAndGetConfigHandlers();
    const preferences = {
      galleries: {
        gallerySearchQuery: '测试',
        gallerySortKey: 'name',
        gallerySortOrder: 'asc',
      },
    };

    await expect(saveGalleryPreferencesHandler({}, preferences)).resolves.toEqual({ success: true });
    expect(saveConfigMock).toHaveBeenCalledWith({
      ui: {
        pagePreferences: {
          galleryBySubTab: preferences,
        },
      },
    });
    expect(windowA.webContents.send).toHaveBeenCalledTimes(1);
    const [channel, summary] = windowA.webContents.send.mock.calls[0];
    expect(channel).toBe(IPC_CHANNELS.CONFIG_CHANGED);
    expect(summary).toEqual({
      version: expect.any(Number),
      sections: [expect.any(String)],
    });
    expect(summary).not.toHaveProperty('network');
    expect(summary).not.toHaveProperty('google');
    expect(summary).not.toHaveProperty('ui');
  });

  it('PAGE_PREFERENCES_SAVE_GALLERY 失败时不应广播 CONFIG_CHANGED', async () => {
    const windowA = { webContents: { send: vi.fn() } };
    getAllWindowsMock.mockReturnValue([windowA]);
    saveConfigMock.mockResolvedValue({ success: false, error: 'save failed' });

    const { saveGalleryPreferencesHandler } = await registerAndGetConfigHandlers();

    await expect(saveGalleryPreferencesHandler({}, { all: { searchQuery: 'oops' } })).resolves.toEqual({
      success: false,
      error: 'save failed',
    });
    expect(windowA.webContents.send).not.toHaveBeenCalled();
  });

  it('PAGE_PREFERENCES_GET_APP_SHELL 应优先返回 pagePreferences.appShell 并支持 legacy ui 回填', async () => {
    getConfigMock.mockReturnValue({
      ui: {
        menuOrder: {
          main: ['legacy-gallery', 'legacy-booru'],
          booru: ['legacy-download'],
        },
        pinnedItems: [{ section: 'google', key: 'gdrive' }],
        pagePreferences: {
          appShell: {
            menuOrder: {
              main: ['booru', 'gallery', 'google'],
            },
          },
        },
      },
    });

    const { getAppShellPreferencesHandler } = await registerAndGetConfigHandlers();

    await expect(getAppShellPreferencesHandler({})).resolves.toEqual({
      success: true,
      data: {
        menuOrder: {
          main: ['booru', 'gallery', 'google'],
          booru: ['legacy-download'],
        },
        pinnedItems: [{ section: 'google', key: 'gdrive' }],
      },
    });
  });

  it('PAGE_PREFERENCES_SAVE_APP_SHELL 成功时应广播 appShell 变更摘要', async () => {
    const windowA = { webContents: { send: vi.fn() } };
    getAllWindowsMock.mockReturnValue([windowA]);
    saveConfigMock.mockResolvedValue({ success: true });
    getConfigMock.mockReturnValue({
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
          username: 'secret-user',
          password: 'secret-pass',
        },
      },
      google: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
        photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
      },
    });

    const { saveAppShellPreferencesHandler } = await registerAndGetConfigHandlers();
    const preferences = {
      menuOrder: {
        main: ['booru', 'gallery', 'google'],
      },
    };

    await expect(saveAppShellPreferencesHandler({}, preferences)).resolves.toEqual({ success: true });
    expect(saveConfigMock).toHaveBeenCalledWith({
      ui: {
        pagePreferences: {
          appShell: preferences,
        },
      },
    });
    expect(windowA.webContents.send).toHaveBeenCalledTimes(1);
    const [channel, summary] = windowA.webContents.send.mock.calls[0];
    expect(channel).toBe(IPC_CHANNELS.CONFIG_CHANGED);
    expect(summary).toEqual({
      version: expect.any(Number),
      sections: [expect.any(String)],
    });
    expect(summary).not.toHaveProperty('network');
    expect(summary).not.toHaveProperty('google');
    expect(summary).not.toHaveProperty('ui');
  });

  it('PAGE_PREFERENCES_SAVE_APP_SHELL 应透传完整偏好对象，并仅广播 appShell 变更摘要', async () => {
    const windowA = { webContents: { send: vi.fn() } };
    getAllWindowsMock.mockReturnValue([windowA]);
    getConfigMock.mockReturnValue({
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
          username: 'secret-user',
          password: 'secret-pass',
        },
      },
      google: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
        photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
      },
    });
    saveConfigMock.mockResolvedValue({ success: true });

    const { saveAppShellPreferencesHandler } = await registerAndGetConfigHandlers();
    const preferences = {
      menuOrder: {
        main: ['booru', 'gallery', 'google'],
      },
      pinnedItems: [
        { section: 'gallery', key: 'recent' },
        { section: 'booru', key: 'posts' },
        { section: 'booru', key: 'download', defaultTab: 'downloads' },
        { section: 'booru', key: 'tag-management', defaultTab: 'favorite' },
        { section: 'google', key: 'gdrive' },
        { section: 'google', key: 'gphotos' },
      ],
    };

    await expect(saveAppShellPreferencesHandler({}, preferences)).resolves.toEqual({ success: true });
    expect(saveConfigMock).toHaveBeenCalledWith({
      ui: {
        pagePreferences: {
          appShell: preferences,
        },
      },
    });
  });
});
