import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * init.ts 模块测试
 * 由于 init.ts 重度依赖外部模块（config, database, galleryService 等），
 * 通过 vi.mock 隔离所有依赖并测试初始化流程
 */

// Mock 所有外部依赖
const mockInitPaths = vi.fn().mockResolvedValue(undefined);
const mockLoadConfig = vi.fn().mockResolvedValue(undefined);
const mockGetConfig = vi.fn().mockReturnValue({
  galleries: {
    folders: [
      { path: '/test/folder1', name: 'Gallery1', autoScan: true, recursive: true, extensions: ['.jpg', '.png'] },
      { path: '/test/folder2', name: 'Gallery2', autoScan: false, recursive: false, extensions: ['.jpg'] },
    ]
  }
});
const mockGetDatabasePath = vi.fn().mockReturnValue('/test/data/gallery.db');
const mockEnsureDataDirectories = vi.fn().mockResolvedValue(undefined);
const mockGetConfigDir = vi.fn().mockReturnValue('/test/config');
const mockGetDataDir = vi.fn().mockReturnValue('/test/data');

vi.mock('../../../src/main/services/config.js', () => ({
  initPaths: mockInitPaths,
  loadConfig: mockLoadConfig,
  getConfig: mockGetConfig,
  getDatabasePath: mockGetDatabasePath,
  ensureDataDirectories: mockEnsureDataDirectories,
  getConfigDir: mockGetConfigDir,
  getDataDir: mockGetDataDir,
}));

const mockInitDatabase = vi.fn().mockResolvedValue({ success: true });
const mockCloseDatabase = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/main/services/database.js', () => ({
  initDatabase: mockInitDatabase,
  closeDatabase: mockCloseDatabase,
}));

const mockCreateGallery = vi.fn().mockResolvedValue({ success: true });
const mockGetGalleries = vi.fn().mockResolvedValue({ success: true, data: [] });
vi.mock('../../../src/main/services/galleryService.js', () => ({
  createGallery: mockCreateGallery,
  getGalleries: mockGetGalleries,
}));

vi.mock('../../../src/main/utils/path.js', () => ({
  normalizePath: vi.fn((p: string) => p),
}));

const mockResumePendingDownloads = vi.fn().mockResolvedValue({ resumed: 0 });
const mockPauseAll = vi.fn().mockResolvedValue(true);
vi.mock('../../../src/main/services/downloadManager.js', () => ({
  downloadManager: {
    resumePendingDownloads: mockResumePendingDownloads,
    pauseAll: mockPauseAll,
  },
}));

const mockResumeRunningSessions = vi.fn().mockResolvedValue({ success: true, data: { resumed: 0 } });
const mockGetActiveBulkDownloadSessions = vi.fn().mockResolvedValue([]);
const mockPauseBulkDownloadSession = vi.fn().mockResolvedValue({ success: true });
vi.mock('../../../src/main/services/bulkDownloadService.js', () => ({
  resumeRunningSessions: mockResumeRunningSessions,
  getActiveBulkDownloadSessions: mockGetActiveBulkDownloadSessions,
  pauseBulkDownloadSession: mockPauseBulkDownloadSession,
}));

const mockCleanExpiredTags = vi.fn().mockResolvedValue(0);
vi.mock('../../../src/main/services/booruService.js', () => ({
  cleanExpiredTags: mockCleanExpiredTags,
}));

describe('initializeApp', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPauseAll.mockResolvedValue(true);
    mockGetActiveBulkDownloadSessions.mockResolvedValue([]);
    mockPauseBulkDownloadSession.mockResolvedValue({ success: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('应按顺序调用初始化步骤', async () => {
    const { initializeApp } = await import('../../../src/main/services/init.js');
    const result = await initializeApp();

    expect(result.success).toBe(true);
    expect(mockInitPaths).toHaveBeenCalledOnce();
    expect(mockLoadConfig).toHaveBeenCalledOnce();
    expect(mockEnsureDataDirectories).toHaveBeenCalledOnce();
    expect(mockInitDatabase).toHaveBeenCalledOnce();
  });

  it('数据库初始化失败时应返回错误', async () => {
    mockInitDatabase.mockResolvedValueOnce({ success: false, error: 'DB Error' });
    const { initializeApp } = await import('../../../src/main/services/init.js');
    const result = await initializeApp();

    expect(result.success).toBe(false);
    expect(result.error).toContain('DB Error');
  });

  it('配置加载失败时应返回错误', async () => {
    mockLoadConfig.mockRejectedValueOnce(new Error('Config not found'));
    const { initializeApp } = await import('../../../src/main/services/init.js');
    const result = await initializeApp();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Config not found');
  });
});

describe('getAppInfo', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('应返回应用信息', async () => {
    mockGetGalleries.mockResolvedValueOnce({ success: true, data: [{ id: 1 }, { id: 2 }] });
    const { getAppInfo } = await import('../../../src/main/services/init.js');
    const result = await getAppInfo();

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.galleryCount).toBe(2);
    expect(result.data!.databasePath).toBe('/test/data/gallery.db');
  });

  it('图库查询失败时 galleryCount 应为 0', async () => {
    mockGetGalleries.mockResolvedValueOnce({ success: false });
    const { getAppInfo } = await import('../../../src/main/services/init.js');
    const result = await getAppInfo();

    expect(result.success).toBe(true);
    expect(result.data!.galleryCount).toBe(0);
  });

  it('异常时应返回错误信息', async () => {
    mockGetConfig.mockImplementationOnce(() => { throw new Error('Config error'); });
    const { getAppInfo } = await import('../../../src/main/services/init.js');
    const result = await getAppInfo();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Config error');
  });
});

describe('initGalleriesFromConfig 逻辑', () => {
  // 由于 initGalleriesFromConfig 是私有函数，通过 initializeApp 间接测试
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPauseAll.mockResolvedValue(true);
    mockGetActiveBulkDownloadSessions.mockResolvedValue([]);
    mockPauseBulkDownloadSession.mockResolvedValue({ success: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('已有图库时应跳过创建', async () => {
    mockGetGalleries.mockResolvedValueOnce({ success: true, data: [{ id: 1 }] });
    const { initializeApp } = await import('../../../src/main/services/init.js');
    await initializeApp();

    expect(mockCreateGallery).not.toHaveBeenCalled();
  });

  it('无图库时应为每个配置文件夹创建图库', async () => {
    mockGetGalleries.mockResolvedValueOnce({ success: true, data: [] });
    const { initializeApp } = await import('../../../src/main/services/init.js');
    await initializeApp();

    expect(mockCreateGallery).toHaveBeenCalledTimes(2);
    expect(mockCreateGallery).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Gallery1',
      folderPath: '/test/folder1',
      isWatching: true,
      recursive: true,
    }));
    expect(mockCreateGallery).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Gallery2',
      folderPath: '/test/folder2',
      isWatching: false,
      recursive: false,
    }));
  });

  it('单个图库创建失败不应影响其他图库', async () => {
    mockGetGalleries.mockResolvedValueOnce({ success: true, data: [] });
    mockCreateGallery
      .mockRejectedValueOnce(new Error('Folder not found'))
      .mockResolvedValueOnce({ success: true });

    const { initializeApp } = await import('../../../src/main/services/init.js');
    const result = await initializeApp();

    expect(result.success).toBe(true);
    expect(mockCreateGallery).toHaveBeenCalledTimes(2);
  });
});

describe('resumeDownloadsInBackground 逻辑', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPauseAll.mockResolvedValue(true);
    mockGetActiveBulkDownloadSessions.mockResolvedValue([]);
    mockPauseBulkDownloadSession.mockResolvedValue({ success: true });
    vi.useFakeTimers();
  });

  it('应在 2 秒延迟后调用恢复函数', async () => {
    const { initializeApp } = await import('../../../src/main/services/init.js');
    await initializeApp();

    // 尚未调用
    expect(mockResumePendingDownloads).not.toHaveBeenCalled();
    expect(mockResumeRunningSessions).not.toHaveBeenCalled();

    // 快进 2 秒
    await vi.advanceTimersByTimeAsync(2000);

    expect(mockResumePendingDownloads).toHaveBeenCalledOnce();
    expect(mockResumeRunningSessions).toHaveBeenCalledOnce();
    expect(mockCleanExpiredTags).toHaveBeenCalledWith(60);
  });

  it('恢复失败不应影响后续操作', async () => {
    mockResumePendingDownloads.mockRejectedValueOnce(new Error('Resume failed'));
    const { initializeApp } = await import('../../../src/main/services/init.js');
    await initializeApp();
    await vi.advanceTimersByTimeAsync(2000);

    // 即使普通下载恢复失败，批量下载恢复仍应被调用
    expect(mockResumeRunningSessions).toHaveBeenCalledOnce();
    expect(mockCleanExpiredTags).toHaveBeenCalledOnce();
  });

  it('重复初始化时应只保留最后一次后台恢复定时器', async () => {
    const { initializeApp } = await import('../../../src/main/services/init.js');

    await initializeApp();
    await initializeApp();

    await vi.advanceTimersByTimeAsync(1999);
    expect(mockResumePendingDownloads).not.toHaveBeenCalled();
    expect(mockResumeRunningSessions).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockResumePendingDownloads).toHaveBeenCalledTimes(1);
    expect(mockResumeRunningSessions).toHaveBeenCalledTimes(1);
    expect(mockCleanExpiredTags).toHaveBeenCalledTimes(1);
  });

  it('关闭初始化资源时应先冻结普通下载与批量会话，再清理后台恢复定时器并关闭数据库', async () => {
    mockGetActiveBulkDownloadSessions.mockResolvedValueOnce([
      {
        id: 'session-running',
        status: 'running',
      },
      {
        id: 'session-dry-run',
        status: 'dryRun',
      },
      {
        id: 'session-paused',
        status: 'paused',
      },
      {
        id: 'session-completed',
        status: 'completed',
      },
    ]);

    const { initializeApp, shutdownAppResources } = await import('../../../src/main/services/init.js');

    await initializeApp();
    await shutdownAppResources();
    await vi.advanceTimersByTimeAsync(2000);

    expect(mockPauseAll).toHaveBeenCalledTimes(1);
    expect(mockGetActiveBulkDownloadSessions).toHaveBeenCalledTimes(1);
    expect(mockPauseBulkDownloadSession).toHaveBeenCalledTimes(2);
    expect(mockPauseBulkDownloadSession).toHaveBeenNthCalledWith(1, 'session-running');
    expect(mockPauseBulkDownloadSession).toHaveBeenNthCalledWith(2, 'session-dry-run');
    expect(mockResumePendingDownloads).not.toHaveBeenCalled();
    expect(mockResumeRunningSessions).not.toHaveBeenCalled();
    expect(mockCleanExpiredTags).not.toHaveBeenCalled();
    expect(mockCloseDatabase).toHaveBeenCalledTimes(1);
    expect(mockPauseAll.mock.invocationCallOrder[0]).toBeLessThan(mockCloseDatabase.mock.invocationCallOrder[0]);
    expect(mockPauseBulkDownloadSession.mock.invocationCallOrder[1]).toBeLessThan(mockCloseDatabase.mock.invocationCallOrder[0]);
  });

  it('任务冻结失败时不应继续关闭数据库，且后续允许再次重试', async () => {
    mockPauseAll
      .mockRejectedValueOnce(new Error('pause all failed'))
      .mockResolvedValueOnce(true);

    const { shutdownAppResources } = await import('../../../src/main/services/init.js');

    await expect(shutdownAppResources()).rejects.toThrow('pause all failed');
    expect(mockCloseDatabase).not.toHaveBeenCalled();

    await expect(shutdownAppResources()).resolves.toBeUndefined();

    expect(mockPauseAll).toHaveBeenCalledTimes(2);
    expect(mockCloseDatabase).toHaveBeenCalledTimes(1);
  });

  it('重复关闭初始化资源成功时应只关闭一次数据库', async () => {
    const { shutdownAppResources } = await import('../../../src/main/services/init.js');

    await shutdownAppResources();
    await shutdownAppResources();

    expect(mockCloseDatabase).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
