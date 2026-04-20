import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleMock = vi.fn();
const openExternalMock = vi.fn();
const dnsLookupMock = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  },
  shell: {
    openExternal: openExternalMock,
    showItemInFolder: vi.fn(),
  },
  BrowserWindow: class {},
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getProxyConfig: vi.fn(() => null),
  getConfig: vi.fn(() => ({})),
  saveConfig: vi.fn(),
  updateGalleryFolders: vi.fn(),
  reloadConfig: vi.fn(),
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

vi.mock('../../../src/main/services/booruService.js', () => ({
  saveBooruTags: vi.fn(),
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

vi.mock('node:dns/promises', () => ({
  lookup: dnsLookupMock,
}));

async function loadHandlersModule() {
  return import('../../../src/main/ipc/handlers');
}

describe('system:open-external 安全策略', () => {
  beforeEach(() => {
    vi.resetModules();
    handleMock.mockReset();
    openExternalMock.mockReset();
    dnsLookupMock.mockReset();
    dnsLookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
  });

  it('只允许打开受控 https 外链', async () => {
    const { setupIPC } = await loadHandlersModule();
    setupIPC();

    const registration = handleMock.mock.calls.find(([channel]) => channel === 'system:open-external');
    expect(registration).toBeTruthy();

    const handler = registration?.[1] as (_event: unknown, url: string) => Promise<unknown>;
    await expect(handler({}, 'https://example.com/path?q=1')).resolves.toEqual({ success: true });
    expect(openExternalMock).toHaveBeenCalledWith('https://example.com/path?q=1');
  });

  it('拒绝非字符串、空字符串和不安全协议', async () => {
    const { setupIPC } = await loadHandlersModule();
    setupIPC();

    const registration = handleMock.mock.calls.find(([channel]) => channel === 'system:open-external');
    const handler = registration?.[1] as (_event: unknown, url: unknown) => Promise<unknown>;

    await expect(handler({}, '')).resolves.toMatchObject({ success: false });
    await expect(handler({}, 'javascript:alert(1)')).resolves.toMatchObject({ success: false });
    await expect(handler({}, 'file:///etc/passwd')).resolves.toMatchObject({ success: false });
    await expect(handler({}, 'mailto:test@example.com')).resolves.toMatchObject({ success: false });
    await expect(handler({}, 123 as unknown as string)).resolves.toMatchObject({ success: false });
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('拒绝带凭据的 https 目标', async () => {
    const { setupIPC } = await loadHandlersModule();
    setupIPC();

    const registration = handleMock.mock.calls.find(([channel]) => channel === 'system:open-external');
    const handler = registration?.[1] as (_event: unknown, url: unknown) => Promise<{ success: boolean; error?: string }>;

    await expect(handler({}, 'https://user@example.com/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开包含账号信息的外部链接'
    });
    await expect(handler({}, 'https://user:pass@example.com/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开包含账号信息的外部链接'
    });
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('拒绝指向本机、环回或私有网络的 https 目标', async () => {
    const { setupIPC } = await loadHandlersModule();
    setupIPC();

    const registration = handleMock.mock.calls.find(([channel]) => channel === 'system:open-external');
    const handler = registration?.[1] as (_event: unknown, url: unknown) => Promise<{ success: boolean; error?: string }>;

    await expect(handler({}, 'https://localhost/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    await expect(handler({}, 'https://127.0.0.1/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    await expect(handler({}, 'https://[::1]/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    await expect(handler({}, 'https://[::ffff:127.0.0.1]/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    await expect(handler({}, 'https://[::ffff:192.168.1.10]/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    await expect(handler({}, 'https://192.168.1.10/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    await expect(handler({}, 'https://10.0.0.8/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    await expect(handler({}, 'https://172.16.5.4/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    await expect(handler({}, 'https://169.254.2.3/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    await expect(handler({}, 'https://[fd12:3456::1]/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    await expect(handler({}, 'https://[fe80::1]/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('拒绝 DNS 解析到本地或内网地址的主机名', async () => {
    dnsLookupMock.mockResolvedValueOnce({ address: '127.0.0.1', family: 4 });

    const { setupIPC } = await loadHandlersModule();
    setupIPC();

    const registration = handleMock.mock.calls.find(([channel]) => channel === 'system:open-external');
    const handler = registration?.[1] as (_event: unknown, url: string) => Promise<{ success: boolean; error?: string }>;

    await expect(handler({}, 'https://public-looking.example/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    expect(dnsLookupMock).toHaveBeenCalledWith('public-looking.example', { all: true, verbatim: true });
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('拒绝 DNS 解析到链路本地 IPv6 的主机名', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: 'fe80::abcd', family: 6 }]);

    const { setupIPC } = await loadHandlersModule();
    setupIPC();

    const registration = handleMock.mock.calls.find(([channel]) => channel === 'system:open-external');
    const handler = registration?.[1] as (_event: unknown, url: string) => Promise<{ success: boolean; error?: string }>;

    await expect(handler({}, 'https://ipv6-private.example/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('拒绝 DNS 解析到 IPv4 映射 IPv6 私网地址的主机名', async () => {
    dnsLookupMock.mockResolvedValueOnce([{ address: '::ffff:192.168.1.10', family: 6 }]);

    const { setupIPC } = await loadHandlersModule();
    setupIPC();

    const registration = handleMock.mock.calls.find(([channel]) => channel === 'system:open-external');
    const handler = registration?.[1] as (_event: unknown, url: string) => Promise<{ success: boolean; error?: string }>;

    await expect(handler({}, 'https://mapped-private.example/path')).resolves.toMatchObject({
      success: false,
      error: '不允许打开指向本地或内网的外部链接'
    });
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('保留正常产品流中的公开 https 目标', async () => {
    dnsLookupMock
      .mockResolvedValueOnce({ address: '140.82.114.4', family: 4 })
      .mockResolvedValueOnce({ address: '104.21.48.1', family: 4 })
      .mockResolvedValueOnce({ address: '210.140.92.183', family: 4 });

    const { setupIPC } = await loadHandlersModule();
    setupIPC();

    const registration = handleMock.mock.calls.find(([channel]) => channel === 'system:open-external');
    const handler = registration?.[1] as (_event: unknown, url: string) => Promise<unknown>;

    await expect(handler({}, 'https://github.com/gv/yande-gallery-desktop/releases')).resolves.toEqual({ success: true });
    await expect(handler({}, 'https://yande.re/post/show/123')).resolves.toEqual({ success: true });
    await expect(handler({}, 'https://www.pixiv.net/artworks/123456')).resolves.toEqual({ success: true });
    expect(openExternalMock).toHaveBeenCalledTimes(3);
  });
});
