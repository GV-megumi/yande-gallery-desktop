/**
 * 桌面通知服务
 *
 * 统一两种通知的分派：
 * - notifyBulkSession：批量下载会话的终态通知（completed / failed / allSkipped）
 * - notifySingleDownload：Booru 单次下载完成 / 失败通知
 *
 * 三级开关判断（notifyBulkSession 专属）：
 *   enabled (全局)  AND  byStatus[status] (状态类别)  AND  taskLevelEnabled (任务级)
 *
 * 单次下载通知判断：
 *   enabled (全局)  AND  byStatus[completed|failed]  AND  singleDownload.enabled
 *
 * 点击行为由 notifications.clickAction 决定：
 *   - 'focus'             : 只恢复主窗口
 *   - 'openDownloadHub'   : 恢复 + 发 SYSTEM_NAVIGATE 跳到 Booru 下载管理
 *   - 'openSessionDetail' : 恢复 + 带 sessionId 跳到下载管理（渲染端可据此高亮）
 *
 * 旧入口 bulkDownloadService.showDesktopNotificationForSession 改调 notifyBulkSession，
 * 把"任务级 notifications 开关"从调用方下沉为参数 taskLevelEnabled。
 */
import { BrowserWindow, Notification } from 'electron';
import { IPC_CHANNELS } from '../ipc/channels.js';
import { getNotificationsConfig } from './config.js';
import { restoreOrCreateMainWindow, getMainWindow } from '../window.js';

type BulkStatus = 'completed' | 'failed' | 'allSkipped';

/** 三级开关 AND，用于批量会话通知 */
function shouldNotifyBulk(status: BulkStatus, taskLevelEnabled: boolean): boolean {
  const cfg = getNotificationsConfig();
  if (!cfg.enabled) return false;
  if (!taskLevelEnabled) return false;
  return cfg.byStatus[status] === true;
}

/**
 * 取主窗口 webContents。
 * 优先用 window.ts 持有的 mainWindowRef（via getMainWindow）——SYSTEM_NAVIGATE 必须发到**主窗口**，
 * 因为只有主窗口的 App.tsx 有 section/subKey 切换逻辑；子窗口（tag-search / secondary-menu 等）
 * 虽然共享主 preload 会订阅同名事件，但没有相应处理逻辑，事件会被静默丢弃。
 *
 * 仅在主窗口尚未创建（罕见：通知触发时 mainWindowRef 还是 null）时退路到 getAllWindows()[0]，
 * 保证不至于完全静默；这路径下若命中子窗口仍会丢失，但主窗口尚未创建时通常也没什么子窗口存在。
 */
function getMainWebContents() {
  try {
    const main = getMainWindow();
    if (main) return main.webContents;
    const windows = BrowserWindow.getAllWindows();
    const candidate = windows.find((w) => !w.isDestroyed());
    return candidate?.webContents ?? null;
  } catch {
    return null;
  }
}

/** 发 SYSTEM_NAVIGATE 到渲染层，让 App.tsx 切 section+subKey */
function sendNavigate(payload: { section: string; subKey: string; sessionId?: string }) {
  const wc = getMainWebContents();
  if (!wc) return;
  wc.send(IPC_CHANNELS.SYSTEM_NAVIGATE, payload);
}

/**
 * 点击通知的统一处理：
 * 1. 先 restoreOrCreateMainWindow() 恢复主窗口（保留 Bug1 的 pin 恢复链兜底）
 * 2. 按 clickAction 决定是否 + 如何发 SYSTEM_NAVIGATE
 */
function handleClickByAction(opts: { sessionId?: string }) {
  const cfg = getNotificationsConfig();
  try {
    restoreOrCreateMainWindow();
  } catch (err) {
    console.warn('[notificationService] restoreOrCreateMainWindow 失败:', err);
  }
  if (cfg.clickAction === 'focus') return;
  if (cfg.clickAction === 'openDownloadHub') {
    sendNavigate({ section: 'booru', subKey: 'download' });
    return;
  }
  if (cfg.clickAction === 'openSessionDetail' && opts.sessionId) {
    sendNavigate({ section: 'booru', subKey: 'download', sessionId: opts.sessionId });
    return;
  }
  // openSessionDetail 但 sessionId 缺失时，退化为 openDownloadHub 行为
  if (cfg.clickAction === 'openSessionDetail') {
    sendNavigate({ section: 'booru', subKey: 'download' });
  }
}

/**
 * 批量下载会话通知。三级 AND 判断，通过才会实际 new Notification()。
 * 调用方（bulkDownloadService）负责从任务行读出 notifications 字段并作为 taskLevelEnabled 传入。
 */
export function notifyBulkSession(ctx: {
  status: BulkStatus;
  tags: string;
  originType?: 'favoriteTag' | null;
  error?: string | null;
  sessionId?: string;
  taskLevelEnabled: boolean;
}): void {
  if (typeof Notification !== 'function') return;
  if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) return;
  if (!shouldNotifyBulk(ctx.status, ctx.taskLevelEnabled)) return;

  const scopeLabel = ctx.originType === 'favoriteTag' ? '收藏标签下载' : '批量下载';
  const bodyBase = ctx.tags ? `标签：${ctx.tags}` : '请打开应用查看详情';
  const content = ctx.status === 'completed'
    ? { title: `${scopeLabel}已完成`, body: bodyBase }
    : ctx.status === 'failed'
      ? { title: `${scopeLabel}失败`, body: ctx.error ? `错误：${ctx.error}` : '请打开应用查看详情' }
      : { title: `${scopeLabel}需人工处理`, body: '本次任务全部跳过，请检查下载目录、去重规则或标签条件。' };

  const n = new Notification(content);
  n.on('click', () => handleClickByAction({ sessionId: ctx.sessionId }));
  n.show();
}

/**
 * 单次下载（Booru 逐张下载）完成 / 失败通知。
 * 必须同时满足：enabled + singleDownload.enabled + byStatus[status]。
 */
export function notifySingleDownload(ctx: {
  status: 'completed' | 'failed';
  filename: string;
  error?: string | null;
}): void {
  if (typeof Notification !== 'function') return;
  if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) return;
  const cfg = getNotificationsConfig();
  if (!cfg.enabled) return;
  if (!cfg.singleDownload.enabled) return;
  if (ctx.status === 'completed' && !cfg.byStatus.completed) return;
  if (ctx.status === 'failed' && !cfg.byStatus.failed) return;

  const content = ctx.status === 'completed'
    ? { title: '下载完成', body: ctx.filename }
    : { title: '下载失败', body: ctx.error ? `${ctx.filename}：${ctx.error}` : ctx.filename };
  const n = new Notification(content);
  n.on('click', () => handleClickByAction({}));
  n.show();
}
