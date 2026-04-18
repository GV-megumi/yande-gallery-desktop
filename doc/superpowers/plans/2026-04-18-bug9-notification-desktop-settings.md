# Bug9 — Settings 加通知 / 桌面行为开关 + 通知服务抽层

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 兑现 TP-10 / 验收报告 §8.4 的 "下载完成通知 + 桌面能力" 要求：
1. 抽出 `notificationService.ts` 统一批量/单次下载通知分派（全局 AND 类别 AND 任务级）。
2. 单次下载补通知；通知点击 → IPC `system:navigate` → 渲染层切到对应页面。
3. Settings 新增 "通知" + "桌面行为" 两个 SettingsGroup，持久化到 `config.yaml` 的 `notifications.*` / `desktop.*`。

**Architecture:**
- `config.yaml` 新字段 + 默认值：
  - `notifications.enabled` / `byStatus.{completed,failed,allSkipped}` / `singleDownload.enabled` / `clickAction`
  - `desktop.closeAction` / `autoLaunch` / `startMinimized`
- 新服务 `src/main/services/notificationService.ts`：`notifyBulkSession` / `notifySingleDownload`；读取全局配置做三级判断；统一挂 `click` 发 `system:navigate`。
- `bulkDownloadService.showDesktopNotificationForSession` 改调 notificationService。
- `downloadManager` 完成 / 失败分支调 `notifySingleDownload`。
- App.tsx 监听 `system:navigate`，根据 `section/subKey/sessionId` 恢复页面。
- Settings UI 两个分组；`autoLaunch` 接主进程 `app.setLoginItemSettings`。

**Tech Stack:** Electron、Node.js、React、Ant Design、vitest

**前置依赖：** C1（bug1）导航恢复链 + C2（bug7）会话状态机都应已合并。

---

## File Structure

- 修改：`src/main/services/config.ts`（新类型字段 + 默认值 + normalizeConfigSaveInput + 访问器）
- 新建：`src/main/services/notificationService.ts`
- 修改：`src/main/services/bulkDownloadService.ts:90-125, 556-568`
- 修改：`src/main/services/downloadManager.ts`（完成 / 失败分支各一处）
- 修改：`src/main/ipc/channels.ts`（`SYSTEM_NAVIGATE` 事件 + `DESKTOP_SET_AUTO_LAUNCH` / `GET_AUTO_LAUNCH` 可选）
- 修改：`src/main/window.ts`（主窗口 close 事件读 `desktop.closeAction`）
- 修改：`src/main/index.ts`（启动时按 `desktop.autoLaunch` 调用 `app.setLoginItemSettings`，按 `desktop.startMinimized` 决定是否 show）
- 修改：`src/preload/index.ts`（config getter/setter；system:navigate 监听）
- 修改：`src/renderer/App.tsx`（监听 `system:navigate` → set section/subKey）
- 修改：`src/renderer/pages/SettingsPage.tsx`（加两个 SettingsGroup）
- 修改：`src/renderer/locales/zh-CN.ts` + `en-US.ts`
- 新建：`tests/main/services/notificationService.test.ts`

---

### Task 1: 配置字段与默认值

**Files:**
- Modify: `src/main/services/config.ts`

- [ ] **Step 1: 类型**

在 `AppConfig` 接口（与 `booru` 同层）追加：

```ts
  notifications?: {
    enabled?: boolean;
    byStatus?: {
      completed?: boolean;
      failed?: boolean;
      allSkipped?: boolean;
    };
    singleDownload?: {
      enabled?: boolean;
    };
    clickAction?: 'focus' | 'openDownloadHub' | 'openSessionDetail';
  };
  desktop?: {
    closeAction?: 'hide-to-tray' | 'quit' | 'ask';
    autoLaunch?: boolean;
    startMinimized?: boolean;
  };
```

- [ ] **Step 2: 默认值**

在 `DEFAULT_CONFIG` 里加：

```ts
  notifications: {
    enabled: true,
    byStatus: { completed: true, failed: true, allSkipped: true },
    singleDownload: { enabled: false },
    clickAction: 'openDownloadHub',
  },
  desktop: {
    closeAction: 'hide-to-tray',
    autoLaunch: false,
    startMinimized: false,
  },
```

- [ ] **Step 3: normalizeConfigSaveInput**

在 `normalizeConfigSaveInput` 返回对象追加（与 `booru`、`bulkDownload` 同层）：

```ts
    notifications: {
      enabled: input.notifications?.enabled ?? currentConfig.notifications?.enabled ?? true,
      byStatus: {
        completed: input.notifications?.byStatus?.completed ?? currentConfig.notifications?.byStatus?.completed ?? true,
        failed: input.notifications?.byStatus?.failed ?? currentConfig.notifications?.byStatus?.failed ?? true,
        allSkipped: input.notifications?.byStatus?.allSkipped ?? currentConfig.notifications?.byStatus?.allSkipped ?? true,
      },
      singleDownload: {
        enabled: input.notifications?.singleDownload?.enabled ?? currentConfig.notifications?.singleDownload?.enabled ?? false,
      },
      clickAction: input.notifications?.clickAction ?? currentConfig.notifications?.clickAction ?? 'openDownloadHub',
    },
    desktop: {
      closeAction: input.desktop?.closeAction ?? currentConfig.desktop?.closeAction ?? 'hide-to-tray',
      autoLaunch: input.desktop?.autoLaunch ?? currentConfig.desktop?.autoLaunch ?? false,
      startMinimized: input.desktop?.startMinimized ?? currentConfig.desktop?.startMinimized ?? false,
    },
```

- [ ] **Step 4: 访问器**

在 `config.ts` 末尾：

```ts
export function getNotificationsConfig() {
  const cfg = getConfig()?.notifications;
  return {
    enabled: cfg?.enabled ?? true,
    byStatus: {
      completed: cfg?.byStatus?.completed ?? true,
      failed: cfg?.byStatus?.failed ?? true,
      allSkipped: cfg?.byStatus?.allSkipped ?? true,
    },
    singleDownload: { enabled: cfg?.singleDownload?.enabled ?? false },
    clickAction: cfg?.clickAction ?? 'openDownloadHub' as const,
  };
}

export function getDesktopConfig() {
  const cfg = getConfig()?.desktop;
  return {
    closeAction: cfg?.closeAction ?? 'hide-to-tray' as const,
    autoLaunch: cfg?.autoLaunch ?? false,
    startMinimized: cfg?.startMinimized ?? false,
  };
}
```

---

### Task 2: notificationService 抽层

**Files:**
- Create: `src/main/services/notificationService.ts`
- Modify: `src/main/services/bulkDownloadService.ts:90-125, 556-568`（改调 notificationService）

- [ ] **Step 1: 新建 notificationService**

```ts
// src/main/services/notificationService.ts
import { Notification } from 'electron';
import type { BulkDownloadSessionStatus } from '../../shared/types.js';
import { getNotificationsConfig } from './config.js';
import { restoreOrCreateMainWindow } from '../window.js';
import { getMainWindow } from '../window.js'; // 若命名不同改成实际导出
import { IPC_CHANNELS } from '../ipc/channels.js';

type BulkStatus = 'completed' | 'failed' | 'allSkipped';

function shouldNotify(status: BulkStatus, taskLevelEnabled: boolean): boolean {
  const cfg = getNotificationsConfig();
  if (!cfg.enabled) return false;
  if (!taskLevelEnabled) return false;
  return cfg.byStatus[status] === true;
}

function sendNavigate(payload: { section: string; subKey: string; sessionId?: string }) {
  const win = getMainWindow?.();
  if (!win) return;
  win.webContents.send(IPC_CHANNELS.SYSTEM_NAVIGATE, payload);
}

function handleClickByAction(opts: { sessionId?: string }) {
  const cfg = getNotificationsConfig();
  restoreOrCreateMainWindow();
  if (cfg.clickAction === 'focus') return;
  if (cfg.clickAction === 'openDownloadHub') {
    sendNavigate({ section: 'booru', subKey: 'download' });
    return;
  }
  if (cfg.clickAction === 'openSessionDetail' && opts.sessionId) {
    sendNavigate({ section: 'booru', subKey: 'download', sessionId: opts.sessionId });
    return;
  }
}

export function notifyBulkSession(ctx: {
  status: BulkStatus;
  tags: string;
  originType?: 'favoriteTag' | null;
  error?: string | null;
  sessionId?: string;
  taskLevelEnabled: boolean;
}) {
  if (typeof Notification !== 'function') return;
  if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) return;
  if (!shouldNotify(ctx.status, ctx.taskLevelEnabled)) return;

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

export function notifySingleDownload(ctx: {
  status: 'completed' | 'failed';
  filename: string;
  error?: string | null;
}) {
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
```

如果 `getMainWindow` 当前不存在，用 `BrowserWindow.getAllWindows()[0]` 做退路，或直接导出 `restoreOrCreateMainWindow` 返回 window。

- [ ] **Step 2: bulkDownloadService 改调**

- 删除 `src/main/services/bulkDownloadService.ts:86-125` 的 `focusExistingMainWindowFromNotification` + `showDesktopNotificationForSession` 函数体。
- 修改 `L556-L568` 的调用点：

```ts
    if (
      notificationContext
      && isDesktopNotificationStatus(nextStatus)
      && notificationContext.previousStatus !== nextStatus
    ) {
      const { notifyBulkSession } = await import('./notificationService.js');
      notifyBulkSession({
        status: nextStatus,
        tags: notificationContext.tags,
        originType: notificationContext.originType,
        error: updates.error ?? notificationContext.error,
        sessionId,
        taskLevelEnabled: notificationContext.notificationsEnabled,
      });
    }
```

（删掉 `&& notificationContext.notificationsEnabled`，因为现在是 `notifyBulkSession` 内部自己看 `taskLevelEnabled`。）

- [ ] **Step 3: 写单测**

Create: `tests/main/services/notificationService.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const NotificationCtor = vi.fn().mockImplementation(function (this: any) {
  this.on = vi.fn();
  this.show = vi.fn();
  return this;
});
(NotificationCtor as any).isSupported = () => true;

vi.mock('electron', () => ({
  Notification: NotificationCtor,
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('../../../src/main/services/config.js', () => ({
  getNotificationsConfig: vi.fn(),
}));
vi.mock('../../../src/main/window.js', () => ({
  restoreOrCreateMainWindow: vi.fn(),
  getMainWindow: vi.fn(() => null),
}));

describe('notificationService.notifyBulkSession 开关', () => {
  beforeEach(() => { NotificationCtor.mockClear(); });

  it('全局 enabled=false 时不弹任何通知', async () => {
    const { getNotificationsConfig } = await import('../../../src/main/services/config.js');
    (getNotificationsConfig as any).mockReturnValue({
      enabled: false, byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: true }, clickAction: 'focus',
    });
    const { notifyBulkSession } = await import('../../../src/main/services/notificationService.js');
    notifyBulkSession({ status: 'completed', tags: 'x', taskLevelEnabled: true });
    expect(NotificationCtor).not.toHaveBeenCalled();
  });

  it('byStatus.failed=false 时不弹 failed 通知', async () => {
    const { getNotificationsConfig } = await import('../../../src/main/services/config.js');
    (getNotificationsConfig as any).mockReturnValue({
      enabled: true, byStatus: { completed: true, failed: false, allSkipped: true },
      singleDownload: { enabled: true }, clickAction: 'focus',
    });
    const { notifyBulkSession } = await import('../../../src/main/services/notificationService.js');
    notifyBulkSession({ status: 'failed', tags: 'x', taskLevelEnabled: true });
    expect(NotificationCtor).not.toHaveBeenCalled();
  });

  it('任务级 taskLevelEnabled=false 时也不弹', async () => {
    const { getNotificationsConfig } = await import('../../../src/main/services/config.js');
    (getNotificationsConfig as any).mockReturnValue({
      enabled: true, byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: true }, clickAction: 'focus',
    });
    const { notifyBulkSession } = await import('../../../src/main/services/notificationService.js');
    notifyBulkSession({ status: 'completed', tags: 'x', taskLevelEnabled: false });
    expect(NotificationCtor).not.toHaveBeenCalled();
  });

  it('三个开关都开时应弹', async () => {
    const { getNotificationsConfig } = await import('../../../src/main/services/config.js');
    (getNotificationsConfig as any).mockReturnValue({
      enabled: true, byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: true }, clickAction: 'focus',
    });
    const { notifyBulkSession } = await import('../../../src/main/services/notificationService.js');
    notifyBulkSession({ status: 'completed', tags: 'x', taskLevelEnabled: true });
    expect(NotificationCtor).toHaveBeenCalled();
  });
});
```

Run: `npx vitest run tests/main/services/notificationService.test.ts --config vitest.config.ts`

Expected: PASS。

---

### Task 3: 单次下载接通知

**Files:**
- Modify: `src/main/services/downloadManager.ts`

- [ ] **Step 1: 成功分支**

在 `downloadManager.ts` 下载成功的那段（搜索 `updateDownloadStatus(queueId, 'completed')` 附近，bug8 修复后大约 L490-L505），`broadcastStatus` 之后追加：

```ts
try {
  const { notifySingleDownload } = await import('./notificationService.js');
  notifySingleDownload({
    status: 'completed',
    filename: item?.filename ?? String(queueId),
  });
} catch (err) {
  console.warn('[DownloadManager] 发送完成通知失败:', err);
}
```

（`item` / `filename` 字段按实际代码替换；若外部没有 filename，改用 `item.targetPath` 的 basename。）

- [ ] **Step 2: 失败分支（真失败，不是用户中止）**

在 `handleDownloadError` 的 "真正意义上的失败" 分支里（bug8 修好后的版本，`updateDownloadStatus(queueId, 'failed', errorMessage)` 之后）追加：

```ts
try {
  const { notifySingleDownload } = await import('./notificationService.js');
  notifySingleDownload({
    status: 'failed',
    filename: String(queueId), // 若能从 activeDownloads 取到 filename 更好
    error: errorMessage,
  });
} catch (err) {
  console.warn('[DownloadManager] 发送失败通知失败:', err);
}
```

- [ ] **Step 3: TS 编译**

Run: `npx tsc -p tsconfig.main.json --noEmit`

Expected: 无错误。

---

### Task 4: `system:navigate` IPC + App 监听

**Files:**
- Modify: `src/main/ipc/channels.ts`（加 `SYSTEM_NAVIGATE: 'system:navigate'`）
- Modify: `src/preload/index.ts`（暴露 `onSystemNavigate(cb)`）
- Modify: `src/renderer/App.tsx`（监听事件 → 切 section/subKey）

- [ ] **Step 1: channels.ts**

追加：

```ts
  SYSTEM_NAVIGATE: 'system:navigate',
```

- [ ] **Step 2: preload 暴露监听器**

在 `system` 分域（若不存在则创建）：

```ts
      // 运行时
      onSystemNavigate: (cb: (payload: { section: string; subKey: string; sessionId?: string }) => void) => {
        const listener = (_: any, payload: any) => cb(payload);
        ipcRenderer.on(IPC_CHANNELS.SYSTEM_NAVIGATE, listener);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.SYSTEM_NAVIGATE, listener);
      },
```

类型声明：

```ts
      onSystemNavigate: (cb: (payload: { section: string; subKey: string; sessionId?: string }) => void) => (() => void);
```

- [ ] **Step 3: App.tsx 订阅**

在 `App.tsx` 挂载 effect（能访问 `setSelectedKey` / `setSelectedSubKey` / `setSelectedBooruSubKey` / `setSelectedGoogleSubKey` / `setSidebarSection` / `handlePinnedClick` 等的位置）加：

```tsx
  useEffect(() => {
    const off = window.electronAPI?.system?.onSystemNavigate?.((payload) => {
      const { section, subKey } = payload;
      if (section === 'gallery') {
        setSidebarSection('gallery');
        setSelectedKey('gallery');
        setSelectedSubKey(subKey);
      } else if (section === 'booru') {
        setSidebarSection('booru');
        setSelectedKey('booru');
        setSelectedBooruSubKey(subKey);
      } else if (section === 'google') {
        setSidebarSection('google');
        setSelectedKey('google');
        setSelectedGoogleSubKey(subKey);
      }
      // 命中 pin 则恢复 pin 缓存（依赖 C1 的 handlePinnedClick）
      if (pinnedItems.some(p => p.section === section && p.key === subKey)) {
        handlePinnedClick({ section: section as any, key: subKey });
      } else {
        setActivePinnedId(null);
      }
      // 如果 payload.sessionId 存在，可在目标页面里高亮，但当前不做硬依赖
    });
    return () => { off?.(); };
  }, [pinnedItems, handlePinnedClick]);
```

---

### Task 5: close 行为 + 开机自启

**Files:**
- Modify: `src/main/window.ts`（主窗口 close 事件看 `desktop.closeAction`）
- Modify: `src/main/index.ts`（启动时按 `desktop.autoLaunch` / `startMinimized` 生效）

- [ ] **Step 1: close 处理**

在 `window.ts` 主窗口创建处搜 `mainWindow.on('close'`（若当前是 `'hide-to-tray'` 硬编码的写法）。改为：

```ts
  mainWindow.on('close', (e) => {
    const action = getDesktopConfig().closeAction;
    if (action === 'quit') {
      // 走真实退出流程：由 beforeQuit 链收尾
      return;
    }
    if (action === 'hide-to-tray') {
      e.preventDefault();
      mainWindow?.hide();
      return;
    }
    if (action === 'ask') {
      // TP-10 的"每次询问"产品细节：这里最简实现——弹 dialog.showMessageBoxSync
      e.preventDefault();
      const { dialog } = require('electron');
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'question',
        buttons: ['最小化到托盘', '退出应用', '取消'],
        defaultId: 0,
        cancelId: 2,
        title: '关闭选项',
        message: '是否退出应用？',
      });
      if (choice === 0) mainWindow?.hide();
      else if (choice === 1) { /* 触发真实退出 */ require('electron').app.quit(); }
      // choice 2：什么都不做
    }
  });
```

- [ ] **Step 2: 开机自启 + 启动隐藏**

在 `src/main/index.ts` `app.whenReady` 之后（或 `createMainWindow` 之前）：

```ts
  const desktop = getDesktopConfig();
  app.setLoginItemSettings({
    openAtLogin: desktop.autoLaunch,
    openAsHidden: desktop.startMinimized,
  });
```

在 `createMainWindow` 里，如果 `desktop.startMinimized` 则初始 `show: false`，`ready-to-show` 时也不 `show()`，而是隐藏到托盘（依 tray 已有能力）。

- [ ] **Step 3: TS 编译**

Run: `npx tsc -p tsconfig.main.json --noEmit`

Expected: 无错误。

---

### Task 6: Settings UI

**Files:**
- Modify: `src/renderer/pages/SettingsPage.tsx`（新增 "通知" 和 "桌面行为" SettingsGroup）
- Modify: `src/renderer/locales/*.ts`

- [ ] **Step 1: preload getter/setter**

在 `src/preload/index.ts` 的 `config` 分域追加：

运行时：

```ts
        getNotifications: () => ipcRenderer.invoke('config:get-notifications'),
        setNotifications: (patch: any) => ipcRenderer.invoke('config:set-notifications', patch),
        getDesktop: () => ipcRenderer.invoke('config:get-desktop'),
        setDesktop: (patch: any) => ipcRenderer.invoke('config:set-desktop', patch),
```

对应 handler 在 `handlers.ts`：

```ts
ipcMain.handle('config:get-notifications', async () => ({
  success: true, data: getNotificationsConfig(),
}));
ipcMain.handle('config:set-notifications', async (_e, patch: any) =>
  saveConfig({ notifications: { ...getConfig().notifications, ...patch } }),
);
ipcMain.handle('config:get-desktop', async () => ({
  success: true, data: getDesktopConfig(),
}));
ipcMain.handle('config:set-desktop', async (_e, patch: any) => {
  const res = await saveConfig({ desktop: { ...getConfig().desktop, ...patch } });
  if (res.success && 'autoLaunch' in patch) {
    app.setLoginItemSettings({
      openAtLogin: patch.autoLaunch,
      openAsHidden: getDesktopConfig().startMinimized,
    });
  }
  return res;
});
```

- [ ] **Step 2: 新增 SettingsGroup**

在 `SettingsPage.tsx` 的 "外观" 分组（L643）之后、"缓存管理"（L646）之前插入：

```tsx
          {/* 通知 */}
          <SettingsGroup title={t('settings.notifications')} footer={t('settings.notificationsFooter')}>
            <SettingsRow
              label={t('settings.notifEnabled')}
              extra={<Switch checked={notif.enabled} onChange={v => setNotif('enabled', v)} />}
            />
            <SettingsRow
              label={t('settings.notifCompleted')}
              extra={<Switch checked={notif.byStatus.completed} onChange={v => setNotifStatus('completed', v)} />}
            />
            <SettingsRow
              label={t('settings.notifFailed')}
              extra={<Switch checked={notif.byStatus.failed} onChange={v => setNotifStatus('failed', v)} />}
            />
            <SettingsRow
              label={t('settings.notifAllSkipped')}
              extra={<Switch checked={notif.byStatus.allSkipped} onChange={v => setNotifStatus('allSkipped', v)} />}
            />
            <SettingsRow
              label={t('settings.notifSingleDownload')}
              extra={<Switch checked={notif.singleDownload.enabled} onChange={v => setNotif('singleDownload.enabled', v)} />}
            />
            <SettingsRow
              isLast
              label={t('settings.notifClickAction')}
              extra={
                <Select
                  value={notif.clickAction}
                  onChange={v => setNotif('clickAction', v)}
                  style={{ width: 200 }}
                  options={[
                    { value: 'focus', label: t('settings.notifClickFocus') },
                    { value: 'openDownloadHub', label: t('settings.notifClickHub') },
                    { value: 'openSessionDetail', label: t('settings.notifClickSession') },
                  ]}
                />
              }
            />
          </SettingsGroup>

          {/* 桌面行为 */}
          <SettingsGroup title={t('settings.desktop')} footer={t('settings.desktopFooter')}>
            <SettingsRow
              label={t('settings.desktopCloseAction')}
              extra={
                <Segmented
                  value={desktop.closeAction}
                  onChange={v => setDesktop('closeAction', v as any)}
                  options={[
                    { value: 'hide-to-tray', label: t('settings.closeHideToTray') },
                    { value: 'quit', label: t('settings.closeQuit') },
                    { value: 'ask', label: t('settings.closeAsk') },
                  ]}
                />
              }
            />
            <SettingsRow
              label={t('settings.autoLaunch')}
              extra={<Switch checked={desktop.autoLaunch} onChange={v => setDesktop('autoLaunch', v)} />}
            />
            <SettingsRow
              isLast
              label={t('settings.startMinimized')}
              extra={<Switch checked={desktop.startMinimized} onChange={v => setDesktop('startMinimized', v)} />}
            />
          </SettingsGroup>
```

（组件内部需要：`const [notif, setNotifState] = useState(...)` + `const [desktop, setDesktopState] = useState(...)` + 首次 `useEffect` 载入 + `setNotif` / `setDesktop` / `setNotifStatus` 工具函数。按 SettingsPage 既有模式实现即可。）

- [ ] **Step 3: i18n**

加 zh/en 对应 key；英文可按字面直译即可。

- [ ] **Step 4: TS 编译**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: 无错误。

---

### Task 7: 回归 + 人工验证 + 归档提交

**Files:** —

- [ ] **Step 1: 全量测试**

Run: `npx vitest run tests/main tests/renderer --config vitest.config.ts`

Expected: PASS。如既有 `tests/main/services/bulkDownloadService.notifications.test.ts` 依赖旧 `showDesktopNotificationForSession`，更新为 mock `notifyBulkSession`。

- [ ] **Step 2: 人工验证（对应 TP-10 测试用例）**

`npm run dev`：
- Settings → 通知 → 关 "下载完成通知" → 跑一个批量下载到 completed → 不弹通知；开 → 再跑一个 → 弹通知。
- 失败状态单独关 → failed 不弹，completed 仍会弹。
- 启用 "单次下载完成也通知" → 下载单张图到完成 → 弹单次通知。
- 点击通知 → 主窗口恢复，且根据 `clickAction` 跳到下载管理页（依赖 C1 的 pin 恢复链能正常工作）。
- Settings → 桌面行为 → 关闭主窗口按钮切换成 "每次询问" → 点 X → 弹确认 dialog。
- 开 "开机自启" → 查操作系统启动项出现该应用；关后消失。

- [ ] **Step 3: 归档 + 提交**

```bash
git mv bug9.md doc/done/bug9-notification-desktop-settings.md
git add src/main/services/config.ts \
        src/main/services/notificationService.ts \
        src/main/services/bulkDownloadService.ts \
        src/main/services/downloadManager.ts \
        src/main/ipc/channels.ts \
        src/main/ipc/handlers.ts \
        src/main/window.ts \
        src/main/index.ts \
        src/preload/index.ts \
        src/renderer/App.tsx \
        src/renderer/pages/SettingsPage.tsx \
        src/renderer/locales/zh-CN.ts \
        src/renderer/locales/en-US.ts \
        tests/main/services/notificationService.test.ts \
        doc/done/bug9-notification-desktop-settings.md
git commit -m "feat(bug9): Settings 加通知 / 桌面行为开关，抽 notificationService

$(cat <<'EOF'
验收报告 §8.4 / TP-10 的"下载完成通知 + 桌面能力"过去只有底层实现，
Settings 没有任何开关；单次下载完全不接通知；点击通知不跳转。

- config.yaml 新字段 notifications.{enabled,byStatus,singleDownload,
  clickAction} 与 desktop.{closeAction,autoLaunch,startMinimized}；
  访问器给默认值兜底
- 抽出 notificationService：notifyBulkSession / notifySingleDownload，
  做"全局 AND 类别 AND 任务级"三级判断
- bulkDownloadService.showDesktopNotificationForSession 改调
  notificationService（taskLevelEnabled 上移到调用方）
- downloadManager 完成 / 真失败分支补通知
- IPC SYSTEM_NAVIGATE：通知 click → 主进程发消息 → App.tsx 监听
  切 section + subKey（依赖 C1 pin 恢复链）
- window.ts close 事件读 desktop.closeAction（hide-to-tray / quit / ask）
- index.ts 按 desktop.autoLaunch / startMinimized 调
  app.setLoginItemSettings 并决定初始 show
- SettingsPage 新增"通知"、"桌面行为"两个 SettingsGroup

前置依赖：bug1（C1）pin 恢复链、bug7（C2）queued 状态机
EOF
)"
```

Expected: commit 成功。

---

## Self-Review Checklist

- [x] Spec §批 C C4 七条子点全部覆盖：config 字段 + notificationService + 单次下载接入 + system:navigate + Settings UI + close 行为 + autoLaunch。
- [x] 三级开关判断正确：enabled AND byStatus[status] AND taskLevelEnabled（任务级从 bulkDownloadService 上移到 notifyBulkSession 参数）。
- [x] 前置依赖 (C1/C2) 在 plan 顶部与 commit message 中显式声明。
- [x] 回退兜底：`getNotificationsConfig` / `getDesktopConfig` 都给明确默认值，升级后用户不会"默认弹一堆"或"一条也不弹"。
- [x] 无占位符；文件位置基于 Read 实际结果。
