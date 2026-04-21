import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../src/main/ipc/channels';
import { setupBooruHandlers } from '../../../src/main/ipc/handlers/booruHandlers';
import { setupBulkDownloadHandlers } from '../../../src/main/ipc/handlers/bulkDownloadHandlers';
import { setupConfigHandlers } from '../../../src/main/ipc/handlers/configHandlers';
import { setupGalleryHandlers } from '../../../src/main/ipc/handlers/galleryHandlers';
import { setupSystemHandlers } from '../../../src/main/ipc/handlers/systemHandlers';

const { handleMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    setLoginItemSettings: vi.fn(),
  },
  ipcMain: {
    handle: handleMock,
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isAxiosError: vi.fn(() => false),
  },
  get: vi.fn(),
  isAxiosError: vi.fn(() => false),
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getProxyConfig: vi.fn(() => null),
  getConfig: vi.fn(() => ({})),
  getBooruAppearancePreference: vi.fn(() => ({})),
  saveConfig: vi.fn(),
  updateGalleryFolders: vi.fn(),
  reloadConfig: vi.fn(),
  toRendererSafeConfig: vi.fn((config) => config),
  getNotificationsConfig: vi.fn(() => ({})),
  getDesktopConfig: vi.fn(() => ({})),
}));

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
  getRecentImagesAfter: vi.fn(),
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
  listIgnoredFolders: vi.fn(),
  addIgnoredFolder: vi.fn(),
  updateIgnoredFolder: vi.fn(),
  removeIgnoredFolder: vi.fn(),
}));

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  generateThumbnail: vi.fn(),
  getThumbnailIfExists: vi.fn(),
  deleteThumbnail: vi.fn(),
}));

vi.mock('../../../src/main/services/invalidImageService.js', () => ({
  reportInvalidImage: vi.fn(),
  getInvalidImages: vi.fn(),
  getInvalidImageCount: vi.fn(),
  deleteInvalidImage: vi.fn(),
  clearInvalidImages: vi.fn(),
}));

vi.mock('../../../src/main/services/backupService.js', () => ({
  createAppBackupData: vi.fn(),
  isValidBackupData: vi.fn(),
  restoreAppBackupData: vi.fn(),
  summarizeBackupTables: vi.fn(),
}));

vi.mock('../../../src/main/services/updateService.js', () => ({
  checkForUpdate: vi.fn(),
}));

vi.mock('../../../src/main/services/moebooruClient.js', () => ({
  hashPasswordSHA1: vi.fn(),
}));

vi.mock('../../../src/main/services/booruClientFactory.js', () => ({
  createBooruClient: vi.fn(),
}));

vi.mock('../../../src/main/services/booruClientInterface.js', () => ({
  TAG_TYPE_MAP: {},
  RATING_MAP: {},
}));

vi.mock('../../../src/main/services/booruService.js', () => ({}));
vi.mock('../../../src/main/services/downloadManager.js', () => ({
  downloadManager: {},
}));
vi.mock('../../../src/main/services/imageCacheService.js', () => ({}));
vi.mock('../../../src/main/services/database.js', () => ({
  runInTransaction: vi.fn(),
  getDatabase: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
}));
vi.mock('../../../src/main/services/imageMetadataService.js', () => ({
  getImageMetadata: vi.fn(),
}));
vi.mock('../../../src/main/services/bulkDownloadService.js', () => ({}));

function expectRegisteredChannels(expectedChannels: string[]) {
  const actualChannels = handleMock.mock.calls.map(([channel]) => channel).sort();
  expect(actualChannels).toEqual([...expectedChannels].sort());
  expect(handleMock).toHaveBeenCalledTimes(expectedChannels.length);
}

describe('IPC handler submodule runtime registration', () => {
  beforeEach(() => {
    handleMock.mockReset();
  });

  it('setupGalleryHandlers 注册 db/image/gallery 域 handler', () => {
    setupGalleryHandlers();

    expectRegisteredChannels([
      IPC_CHANNELS.DB_INIT,
      IPC_CHANNELS.DB_GET_IMAGES,
      IPC_CHANNELS.DB_ADD_IMAGE,
      IPC_CHANNELS.DB_SEARCH_IMAGES,
      IPC_CHANNELS.IMAGE_SCAN_FOLDER,
      IPC_CHANNELS.IMAGE_GENERATE_THUMBNAIL,
      IPC_CHANNELS.IMAGE_GET_THUMBNAIL,
      IPC_CHANNELS.IMAGE_DELETE,
      IPC_CHANNELS.IMAGE_DELETE_THUMBNAIL,
      IPC_CHANNELS.GALLERY_GET_RECENT_IMAGES,
      IPC_CHANNELS.GALLERY_GET_RECENT_IMAGES_AFTER,
      IPC_CHANNELS.GALLERY_GET_IMAGES_BY_FOLDER,
      IPC_CHANNELS.GALLERY_GET_ALL_FOLDERS,
      IPC_CHANNELS.GALLERY_SCAN_AND_IMPORT_FOLDER,
      IPC_CHANNELS.GALLERY_GET_GALLERIES,
      IPC_CHANNELS.GALLERY_GET_GALLERY,
      IPC_CHANNELS.GALLERY_CREATE_GALLERY,
      IPC_CHANNELS.GALLERY_UPDATE_GALLERY,
      IPC_CHANNELS.GALLERY_DELETE_GALLERY,
      IPC_CHANNELS.GALLERY_SET_GALLERY_COVER,
      IPC_CHANNELS.GALLERY_UPDATE_GALLERY_STATS,
      IPC_CHANNELS.GALLERY_SYNC_GALLERY_FOLDER,
      IPC_CHANNELS.GALLERY_REPORT_INVALID_IMAGE,
      IPC_CHANNELS.GALLERY_GET_INVALID_IMAGES,
      IPC_CHANNELS.GALLERY_GET_INVALID_IMAGE_COUNT,
      IPC_CHANNELS.GALLERY_DELETE_INVALID_IMAGE,
      IPC_CHANNELS.GALLERY_CLEAR_INVALID_IMAGES,
      IPC_CHANNELS.GALLERY_LIST_IGNORED_FOLDERS,
      IPC_CHANNELS.GALLERY_ADD_IGNORED_FOLDER,
      IPC_CHANNELS.GALLERY_UPDATE_IGNORED_FOLDER,
      IPC_CHANNELS.GALLERY_REMOVE_IGNORED_FOLDER,
      IPC_CHANNELS.GALLERY_SCAN_SUBFOLDERS,
    ]);
  });

  it('setupConfigHandlers 注册 config/booru-preferences/page-preferences 域 handler', () => {
    setupConfigHandlers();

    expectRegisteredChannels([
      IPC_CHANNELS.CONFIG_GET,
      IPC_CHANNELS.BOORU_PREFERENCES_GET_APPEARANCE,
      IPC_CHANNELS.CONFIG_SAVE,
      IPC_CHANNELS.CONFIG_GET_NOTIFICATIONS,
      IPC_CHANNELS.CONFIG_SET_NOTIFICATIONS,
      IPC_CHANNELS.CONFIG_GET_DESKTOP,
      IPC_CHANNELS.CONFIG_SET_DESKTOP,
      IPC_CHANNELS.PAGE_PREFERENCES_GET_FAVORITE_TAGS,
      IPC_CHANNELS.PAGE_PREFERENCES_SAVE_FAVORITE_TAGS,
      IPC_CHANNELS.PAGE_PREFERENCES_GET_BLACKLISTED_TAGS,
      IPC_CHANNELS.PAGE_PREFERENCES_SAVE_BLACKLISTED_TAGS,
      IPC_CHANNELS.PAGE_PREFERENCES_GET_GALLERY,
      IPC_CHANNELS.PAGE_PREFERENCES_SAVE_GALLERY,
      IPC_CHANNELS.PAGE_PREFERENCES_GET_APP_SHELL,
      IPC_CHANNELS.PAGE_PREFERENCES_SAVE_APP_SHELL,
      IPC_CHANNELS.CONFIG_UPDATE_GALLERY_FOLDERS,
      IPC_CHANNELS.CONFIG_RELOAD,
    ]);
  });

  it('setupSystemHandlers 注册 system/network/backup 域 handler', () => {
    setupSystemHandlers();

    expectRegisteredChannels([
      IPC_CHANNELS.SYSTEM_SELECT_FOLDER,
      IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL,
      IPC_CHANNELS.SYSTEM_SHOW_ITEM,
      IPC_CHANNELS.SYSTEM_CHECK_FOR_UPDATE,
      IPC_CHANNELS.SYSTEM_EXPORT_BACKUP,
      IPC_CHANNELS.SYSTEM_IMPORT_BACKUP,
      IPC_CHANNELS.NETWORK_TEST_BAIDU,
      IPC_CHANNELS.NETWORK_TEST_GOOGLE,
    ]);
  });

  it('setupBulkDownloadHandlers 注册批量下载命令 handler，不注册事件通道', () => {
    setupBulkDownloadHandlers();

    expectRegisteredChannels([
      IPC_CHANNELS.BULK_DOWNLOAD_CREATE_TASK,
      IPC_CHANNELS.BULK_DOWNLOAD_GET_TASKS,
      IPC_CHANNELS.BULK_DOWNLOAD_GET_TASK,
      IPC_CHANNELS.BULK_DOWNLOAD_UPDATE_TASK,
      IPC_CHANNELS.BULK_DOWNLOAD_DELETE_TASK,
      IPC_CHANNELS.BULK_DOWNLOAD_CREATE_SESSION,
      IPC_CHANNELS.BULK_DOWNLOAD_GET_ACTIVE_SESSIONS,
      IPC_CHANNELS.BULK_DOWNLOAD_START_SESSION,
      IPC_CHANNELS.BULK_DOWNLOAD_PAUSE_SESSION,
      IPC_CHANNELS.BULK_DOWNLOAD_CANCEL_SESSION,
      IPC_CHANNELS.BULK_DOWNLOAD_DELETE_SESSION,
      IPC_CHANNELS.BULK_DOWNLOAD_GET_SESSION_STATS,
      IPC_CHANNELS.BULK_DOWNLOAD_GET_RECORDS,
      IPC_CHANNELS.BULK_DOWNLOAD_RETRY_ALL_FAILED,
      IPC_CHANNELS.BULK_DOWNLOAD_RETRY_FAILED_RECORD,
      IPC_CHANNELS.BULK_DOWNLOAD_RESUME_RUNNING_SESSIONS,
    ]);
  });

  it('setupBooruHandlers 注册 Booru 命令 handler，不注册事件和废弃 hash 通道', () => {
    setupBooruHandlers();

    const eventAndLegacyKeys = new Set([
      'BOORU_PREFERENCES_GET_APPEARANCE',
      'BOORU_FAVORITES_REPAIR_DONE',
      'BOORU_DOWNLOAD_PROGRESS',
      'BOORU_DOWNLOAD_STATUS',
      'BOORU_DOWNLOAD_QUEUE_STATUS',
      'BOORU_HASH_PASSWORD',
    ]);
    const expectedBooruChannels = Object.entries(IPC_CHANNELS)
      .filter(([key]) => key.startsWith('BOORU_') && !eventAndLegacyKeys.has(key))
      .map(([, channel]) => channel);

    expectRegisteredChannels(expectedBooruChannels);
  });
});
