/**
 * notificationService 三级开关 + 单次下载 + click-navigate 守卫测试
 *
 * 三级判断：enabled (全局) AND byStatus[status] (状态类别) AND taskLevelEnabled (任务级)
 * 任一为 false 都不应弹通知；只有同时为 true 才应 new Notification + show。
 *
 * 额外守卫：click 事件在 clickAction='openDownloadHub' 下应触发 webContents.send(SYSTEM_NAVIGATE)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('notificationService 三级开关 + click 守卫', () => {
  let NotificationCtor: any;
  let showMock: ReturnType<typeof vi.fn>;
  let clickHandler: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    clickHandler = undefined;
    showMock = vi.fn();

    NotificationCtor = vi.fn().mockImplementation(function (this: any) {
      this.on = vi.fn((event: string, handler: () => void) => {
        if (event === 'click') clickHandler = handler;
      });
      this.show = showMock;
      return this;
    });
    (NotificationCtor as any).isSupported = () => true;
  });

  function mockElectron(sendMock?: ReturnType<typeof vi.fn>) {
    const webContents = sendMock ? { send: sendMock } : { send: vi.fn() };
    const mockWin = {
      isDestroyed: () => false,
      webContents,
    };
    vi.doMock('electron', () => ({
      Notification: NotificationCtor,
      BrowserWindow: { getAllWindows: () => [mockWin] },
    }));
    return { webContents };
  }

  function mockWindow() {
    vi.doMock('../../../src/main/window.js', () => ({
      restoreOrCreateMainWindow: vi.fn(),
    }));
  }

  function mockConfig(notifications: any) {
    vi.doMock('../../../src/main/services/config.js', () => ({
      getNotificationsConfig: () => notifications,
    }));
  }

  // ===== 反模式守卫：三级开关之一为 false 都不应弹 =====

  it('[反模式守卫] 全局 enabled=false 时不弹任何 bulk 通知', async () => {
    mockElectron();
    mockWindow();
    mockConfig({
      enabled: false,
      byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: true },
      clickAction: 'focus',
    });
    const { notifyBulkSession } = await import('../../../src/main/services/notificationService.js');
    notifyBulkSession({ status: 'completed', tags: 'x', taskLevelEnabled: true });
    expect(NotificationCtor).not.toHaveBeenCalled();
    expect(showMock).not.toHaveBeenCalled();
  });

  it('[反模式守卫] byStatus.failed=false 时 failed 终态不弹通知', async () => {
    mockElectron();
    mockWindow();
    mockConfig({
      enabled: true,
      byStatus: { completed: true, failed: false, allSkipped: true },
      singleDownload: { enabled: true },
      clickAction: 'focus',
    });
    const { notifyBulkSession } = await import('../../../src/main/services/notificationService.js');
    notifyBulkSession({ status: 'failed', tags: 'x', taskLevelEnabled: true, error: 'boom' });
    expect(NotificationCtor).not.toHaveBeenCalled();
  });

  it('[反模式守卫] 任务级 taskLevelEnabled=false 时即使全局全开也不弹', async () => {
    mockElectron();
    mockWindow();
    mockConfig({
      enabled: true,
      byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: true },
      clickAction: 'focus',
    });
    const { notifyBulkSession } = await import('../../../src/main/services/notificationService.js');
    notifyBulkSession({ status: 'completed', tags: 'x', taskLevelEnabled: false });
    expect(NotificationCtor).not.toHaveBeenCalled();
  });

  it('[反模式守卫] 三个开关都开时应弹出通知', async () => {
    mockElectron();
    mockWindow();
    mockConfig({
      enabled: true,
      byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: true },
      clickAction: 'focus',
    });
    const { notifyBulkSession } = await import('../../../src/main/services/notificationService.js');
    notifyBulkSession({ status: 'completed', tags: 'blue_eyes blonde_hair', taskLevelEnabled: true });
    expect(NotificationCtor).toHaveBeenCalledTimes(1);
    expect(showMock).toHaveBeenCalledTimes(1);
  });

  // ===== allSkipped / favoriteTag 原有语义保留 =====

  it('originType=favoriteTag + allSkipped 时标题包含"人工处理"', async () => {
    mockElectron();
    mockWindow();
    mockConfig({
      enabled: true,
      byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: true },
      clickAction: 'focus',
    });
    const { notifyBulkSession } = await import('../../../src/main/services/notificationService.js');
    notifyBulkSession({
      status: 'allSkipped',
      tags: 'x',
      originType: 'favoriteTag',
      taskLevelEnabled: true,
    });
    expect(NotificationCtor).toHaveBeenCalledTimes(1);
    const args = NotificationCtor.mock.calls[0][0];
    expect(String(args.title)).toContain('人工处理');
  });

  // ===== 单次下载开关 =====

  it('[单次下载守卫] singleDownload.enabled=false 时不弹单次通知', async () => {
    mockElectron();
    mockWindow();
    mockConfig({
      enabled: true,
      byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: false },
      clickAction: 'focus',
    });
    const { notifySingleDownload } = await import('../../../src/main/services/notificationService.js');
    notifySingleDownload({ status: 'completed', filename: 'a.jpg' });
    expect(NotificationCtor).not.toHaveBeenCalled();
  });

  it('[单次下载守卫] 三级全开时 singleDownload 应弹通知', async () => {
    mockElectron();
    mockWindow();
    mockConfig({
      enabled: true,
      byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: true },
      clickAction: 'focus',
    });
    const { notifySingleDownload } = await import('../../../src/main/services/notificationService.js');
    notifySingleDownload({ status: 'completed', filename: 'img.png' });
    expect(NotificationCtor).toHaveBeenCalledTimes(1);
    const args = NotificationCtor.mock.calls[0][0];
    expect(args.body).toBe('img.png');
  });

  // ===== click → SYSTEM_NAVIGATE 守卫 =====

  it('[click 守卫] clickAction=openDownloadHub 点击通知时应发 SYSTEM_NAVIGATE', async () => {
    const send = vi.fn();
    mockElectron(send);
    mockWindow();
    mockConfig({
      enabled: true,
      byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: true },
      clickAction: 'openDownloadHub',
    });
    const { notifyBulkSession } = await import('../../../src/main/services/notificationService.js');
    notifyBulkSession({ status: 'completed', tags: 'x', taskLevelEnabled: true, sessionId: 'sess-42' });
    expect(clickHandler).toBeDefined();
    clickHandler!();
    expect(send).toHaveBeenCalledWith(
      'system:navigate',
      expect.objectContaining({ section: 'booru', subKey: 'download' }),
    );
  });

  it('[click 守卫] clickAction=focus 点击通知时不发 SYSTEM_NAVIGATE', async () => {
    const send = vi.fn();
    mockElectron(send);
    mockWindow();
    mockConfig({
      enabled: true,
      byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: true },
      clickAction: 'focus',
    });
    const { notifyBulkSession } = await import('../../../src/main/services/notificationService.js');
    notifyBulkSession({ status: 'completed', tags: 'x', taskLevelEnabled: true });
    clickHandler?.();
    expect(send).not.toHaveBeenCalled();
  });

  it('[click 守卫] clickAction=openSessionDetail 带 sessionId 时 navigate payload 含 sessionId', async () => {
    const send = vi.fn();
    mockElectron(send);
    mockWindow();
    mockConfig({
      enabled: true,
      byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: true },
      clickAction: 'openSessionDetail',
    });
    const { notifyBulkSession } = await import('../../../src/main/services/notificationService.js');
    notifyBulkSession({ status: 'completed', tags: 'x', taskLevelEnabled: true, sessionId: 's-99' });
    clickHandler?.();
    expect(send).toHaveBeenCalledWith(
      'system:navigate',
      expect.objectContaining({ section: 'booru', subKey: 'download', sessionId: 's-99' }),
    );
  });
});
