import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * booruService.startFavoriteTagBulkDownload - Bug5 行为测试
 *
 * 覆盖 deduplicated 分流：
 * - 任务模板存在且仍有活跃会话 → 短路返回 deduplicated:true，不创建/启动新会话
 * - 任务模板存在但无活跃会话 → fallthrough 到创建+启动新会话
 *
 * 反模式守卫：旧代码在 deduplicated=true 时永远短路。
 * 在旧代码下，第二条用例（无活跃会话）会 FAIL —— 因为
 * createBulkDownloadSession / startBulkDownloadSession 均不会被调用，
 * 返回的 sessionId 也不会是 'session-new'。
 */

// ---- 1. mock bulkDownloadService（booruService 通过 dynamic import 使用） ----
const createBulkDownloadTask = vi.fn();
const createBulkDownloadSession = vi.fn();
const startBulkDownloadSession = vi.fn();
const hasActiveSessionForTask = vi.fn();
const emitBuiltRendererAppEvent = vi.fn();

vi.mock('../../../src/main/services/bulkDownloadService.js', () => ({
  createBulkDownloadTask: (...a: any[]) => createBulkDownloadTask(...a),
  createBulkDownloadSession: (...a: any[]) => createBulkDownloadSession(...a),
  startBulkDownloadSession: (...a: any[]) => startBulkDownloadSession(...a),
  hasActiveSessionForTask: (...a: any[]) => hasActiveSessionForTask(...a),
  getBulkDownloadSessionSnapshot: vi.fn(async () => null),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: (...args: any[]) => emitBuiltRendererAppEvent(...args),
}));

// ---- 2. mock database.js：通过 SQL 片段分发到不同 stub ----
const getMock = vi.fn(async (_db: any, sql: string, _params?: any[]) => {
  if (/FROM booru_favorite_tags/.test(sql)) {
    return {
      id: 1,
      siteId: 1,
      tagName: 'foo',
      queryType: 'tag',
      labels: null,
    };
  }
  if (/FROM booru_favorite_tag_download_bindings/.test(sql)) {
    return {
      id: 10,
      favoriteTagId: 1,
      galleryId: null,
      downloadPath: '/tmp/x',
      enabled: 1,
      autoCreateGallery: 0,
      autoSyncGalleryAfterDownload: 0,
      quality: null,
      perPage: null,
      concurrency: null,
      skipIfExists: null,
      notifications: null,
      blacklistedTags: null,
      lastTaskId: null,
      lastSessionId: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastStatus: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
  }
  // getRuntimeProgressBySessionId 的 stats SELECT
  if (/FROM bulk_download_sessions s/.test(sql)) {
    return { status: 'running', completed: 0, failed: 0, total: 0 };
  }
  return undefined;
});

const runMock = vi.fn(async () => undefined);
const allMock = vi.fn(async () => []);

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
  runWithChanges: (...args: any[]) => runMock(...args),
  all: (...args: any[]) => allMock(...args),
  runInTransaction: (_db: any, fn: any) => fn(),
}));

// ---- 3. mock 其它外部依赖 ----
vi.mock('fs/promises', () => ({
  default: { mkdir: vi.fn(async () => {}) },
}));
vi.mock('../../../src/main/services/galleryService.js', () => ({
  createGallery: vi.fn(),
  getGallery: vi.fn(),
  updateGalleryStats: vi.fn(),
}));
vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(),
}));
vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: vi.fn(() => ({ downloads: { path: '/tmp' } })),
  resolveConfigPath: vi.fn((p: string) => p),
}));
vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
}));

describe('booruService.startFavoriteTagBulkDownload - deduplicated 分流', () => {
  beforeEach(() => {
    createBulkDownloadTask.mockReset();
    createBulkDownloadSession.mockReset();
    startBulkDownloadSession.mockReset();
    hasActiveSessionForTask.mockReset();
    emitBuiltRendererAppEvent.mockReset();
    runMock.mockClear();
  });

  it('deduplicated 且有活跃会话 → 短路返回，不创建/启动新会话', async () => {
    createBulkDownloadTask.mockResolvedValueOnce({
      success: true,
      data: { id: 'task-a', deduplicated: true },
    });
    hasActiveSessionForTask.mockResolvedValueOnce(true);

    const mod = await import('../../../src/main/services/booruService.js');
    const result = await mod.startFavoriteTagBulkDownload(1);

    expect(result).toEqual({ taskId: 'task-a', sessionId: '', deduplicated: true });
    expect(hasActiveSessionForTask).toHaveBeenCalledWith('task-a');
    expect(createBulkDownloadSession).not.toHaveBeenCalled();
    expect(startBulkDownloadSession).not.toHaveBeenCalled();
  });

  it('deduplicated 但无活跃会话 → fallthrough 创建并启动新会话', async () => {
    createBulkDownloadTask.mockResolvedValueOnce({
      success: true,
      data: { id: 'task-b', deduplicated: true },
    });
    hasActiveSessionForTask.mockResolvedValueOnce(false);
    createBulkDownloadSession.mockResolvedValueOnce({
      success: true,
      data: { id: 'session-new' },
    });
    startBulkDownloadSession.mockResolvedValueOnce({ success: true });

    const mod = await import('../../../src/main/services/booruService.js');
    const result = await mod.startFavoriteTagBulkDownload(1);

    expect(hasActiveSessionForTask).toHaveBeenCalledWith('task-b');
    expect(createBulkDownloadSession).toHaveBeenCalledWith('task-b');
    expect(startBulkDownloadSession).toHaveBeenCalledWith('session-new');
    expect(result.taskId).toBe('task-b');
    expect(result.sessionId).toBe('session-new');
    expect(result.deduplicated).toBeUndefined();
  });

  it('创建会话后应立即返回，不等待 dryRun/扫描完成', async () => {
    createBulkDownloadTask.mockResolvedValueOnce({
      success: true,
      data: { id: 'task-fast' },
    });
    createBulkDownloadSession.mockResolvedValueOnce({
      success: true,
      data: { id: 'session-fast', status: 'pending' },
    });

    let resolveStart!: (value: { success: boolean }) => void;
    startBulkDownloadSession.mockReturnValueOnce(new Promise(resolve => {
      resolveStart = resolve;
    }));

    const mod = await import('../../../src/main/services/booruService.js');
    const result = await mod.startFavoriteTagBulkDownload(1);

    expect(result).toEqual({ taskId: 'task-fast', sessionId: 'session-fast' });
    expect(startBulkDownloadSession).toHaveBeenCalledWith('session-fast');
    expect(emitBuiltRendererAppEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'favorite-tag-download:created',
      source: 'booruService',
      payload: expect.objectContaining({
        favoriteTagId: 1,
        taskId: 'task-fast',
        sessionId: 'session-fast',
      }),
    }));

    resolveStart({ success: true });
  });
});
