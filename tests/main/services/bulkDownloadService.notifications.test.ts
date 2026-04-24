import { afterEach, describe, expect, it, vi } from 'vitest';

describe('bulkDownloadService desktop notifications', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  async function loadModule(options?: {
    notifications?: number;
    previousStatus?: string;
    originType?: 'favoriteTag' | null;
    error?: string | null;
    hasWindow?: boolean;
  }) {
    const db = {};
    const run = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue({
      id: 'session-1',
      taskId: 'task-1',
      siteId: 1,
      status: options?.previousStatus ?? 'running',
      startedAt: '2026-04-15T00:00:00.000Z',
      currentPage: 1,
      totalPages: 3,
      error: options?.error ?? null,
      originType: options?.originType ?? null,
      originId: options?.originType ? 42 : null,
      notifications: options?.notifications ?? 1,
      tags: 'blue_eyes blonde_hair',
      path: '/downloads',
      blacklistedTags: null,
      skipIfExists: 1,
      quality: null,
      perPage: 50,
      concurrency: 2,
      createdAt: '2026-04-15T00:00:00.000Z',
      updatedAt: '2026-04-15T00:00:00.000Z',
    });
    const all = vi.fn().mockResolvedValue([]);

    const focus = vi.fn();
    const show = vi.fn();
    const restore = vi.fn();
    const isMinimized = vi.fn(() => false);
    const mockWindow = { focus, show, restore, isMinimized };
    const getAllWindows = vi.fn(() => options?.hasWindow === false ? [] : [mockWindow]);
    const restoreOrCreateMainWindow = vi.fn(() => {
      if (options?.hasWindow === false) {
        return { created: true };
      }
      if (isMinimized()) {
        restore();
      }
      show();
      focus();
      return mockWindow;
    });

    let clickHandler: (() => void) | undefined;
    let lastNotificationOptions: Record<string, unknown> | undefined;
    const notificationShow = vi.fn();

    class MockNotification {
      static isSupported = vi.fn(() => true);
      on = vi.fn((event: string, handler: () => void) => {
        if (event === 'click') clickHandler = handler;
      });
      show = notificationShow;

      constructor(options: Record<string, unknown>) {
        lastNotificationOptions = options;
      }
    }

    vi.doMock('electron', () => ({
      BrowserWindow: {
        getAllWindows,
      },
      Notification: MockNotification,
    }));

    vi.doMock('../../../src/main/window.js', () => ({
      restoreOrCreateMainWindow,
      // bug9 follow-up：notificationService 优先读 getMainWindow()，返回 null 退路到
      // BrowserWindow.getAllWindows()，这里保持 null 以维持既有 electron mock 行为。
      getMainWindow: vi.fn(() => null),
    }));

    vi.doMock('../../../src/main/services/database.js', () => ({
      getDatabase: vi.fn().mockResolvedValue(db),
      run,
      runWithChanges: vi.fn(),
      get,
      all,
    }));

    // bug9：notificationService 依赖 getNotificationsConfig()。为保持既有断言语义：
    // - enabled 默认 true（上层仍靠任务级 notifications 开关决定是否弹）
    // - byStatus 全开（测试用例覆盖 completed / failed / allSkipped 三种状态）
    // - clickAction 设 'focus'，避免 click 时走 sendNavigate 影响 focus/show/restore 断言
    vi.doMock('../../../src/main/services/config.js', () => ({
      getProxyConfig: () => undefined,
      getMaxConcurrentBulkDownloadSessions: () => 3,
      getNotificationsConfig: () => ({
        enabled: true,
        byStatus: { completed: true, failed: true, allSkipped: true },
        singleDownload: { enabled: false },
        clickAction: 'focus',
      }),
    }));

    vi.doMock('../../../src/main/services/booruClientFactory.js', () => ({
      createBooruClient: vi.fn(),
    }));

    vi.doMock('../../../src/main/services/booruService.js', () => ({}));

    vi.doMock('../../../src/main/services/downloadManager.js', () => ({
      downloadManager: {},
    }));

    vi.doMock('../../../src/main/services/networkScheduler.js', () => ({
      networkScheduler: {
        onChange: vi.fn(() => () => {}),
        isBrowsingActive: vi.fn(() => false),
      },
    }));

    vi.doMock('../../../src/main/services/downloadFileProtocol.js', () => ({
      buildDownloadTempPath: vi.fn((filePath: string) => `${filePath}.tmp`),
      replaceFileWithTemp: vi.fn(),
      validateDownloadedFileSize: vi.fn(),
    }));

    const mod = await import('../../../src/main/services/bulkDownloadService.js');

    return {
      updateBulkDownloadSession: mod.updateBulkDownloadSession,
      run,
      get,
      notificationShow,
      getNotificationOptions: () => lastNotificationOptions,
      fireNotificationClick: () => clickHandler?.(),
      focus,
      show,
      restore,
      getAllWindows,
      restoreOrCreateMainWindow,
    };
  }

  it('completed 终态且 notifications 开启时应发送桌面通知', async () => {
    const { updateBulkDownloadSession, notificationShow, getNotificationOptions } = await loadModule();

    await updateBulkDownloadSession('session-1', {
      status: 'completed',
      completedAt: '2026-04-15T01:00:00.000Z',
    });

    expect(notificationShow).toHaveBeenCalledTimes(1);
    expect(getNotificationOptions()).toEqual(expect.objectContaining({
      title: expect.stringContaining('完成'),
    }));
  });

  it('notifications 关闭时不应发送桌面通知', async () => {
    const { updateBulkDownloadSession, notificationShow } = await loadModule({ notifications: 0 });

    await updateBulkDownloadSession('session-1', {
      status: 'failed',
      error: 'network down',
    });

    expect(notificationShow).not.toHaveBeenCalled();
  });

  it('allSkipped 通知点击后应恢复并聚焦已有主窗口', async () => {
    const {
      updateBulkDownloadSession,
      notificationShow,
      getNotificationOptions,
      fireNotificationClick,
      show,
      focus,
      restore,
    } = await loadModule({ originType: 'favoriteTag' });

    await updateBulkDownloadSession('session-1', {
      status: 'allSkipped',
    });

    expect(notificationShow).toHaveBeenCalledTimes(1);
    expect(getNotificationOptions()).toEqual(expect.objectContaining({
      title: expect.stringContaining('人工处理'),
    }));

    fireNotificationClick();

    expect(restore).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('通知点击时没有已存在主窗口也应走统一恢复入口重建窗口', async () => {
    const {
      updateBulkDownloadSession,
      notificationShow,
      fireNotificationClick,
      restoreOrCreateMainWindow,
      getAllWindows,
    } = await loadModule({ hasWindow: false });

    await updateBulkDownloadSession('session-1', {
      status: 'completed',
      completedAt: '2026-04-15T01:00:00.000Z',
    });

    expect(notificationShow).toHaveBeenCalledTimes(1);
    // updateBulkDownloadSession now also emits renderer app events, which query
    // BrowserWindow independently from the notification click restore path.
    getAllWindows.mockClear();
    expect(getAllWindows).toHaveBeenCalledTimes(0);
    expect(restoreOrCreateMainWindow).toHaveBeenCalledTimes(0);
    expect(() => fireNotificationClick()).not.toThrow();
    expect(getAllWindows).toHaveBeenCalledTimes(0);
    expect(restoreOrCreateMainWindow).toHaveBeenCalledTimes(1);
  });
});
