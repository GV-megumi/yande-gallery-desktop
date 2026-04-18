# Bug9 — Settings 加通知 / 桌面行为开关 + 抽 notificationService

**Status:** DONE
**Plan:** `doc/superpowers/plans/2026-04-18-bug9-notification-desktop-settings.md`

## 背景

人工测试验收报告 §8.4 / TP-10 要求兑现"下载完成通知 + 桌面能力"：

- Settings → "下载完成通知" 开关；关闭后不再弹通知
- 单次下载（Booru 逐张下载）完成也应能通知
- 点击通知 → 恢复主窗口 + 跳到相关页面
- Settings 还需"关闭窗口行为 / 开机自启 / 启动最小化"等桌面能力入口

改动前的实际能力：

- 批量下载 `bulkDownloadService.showDesktopNotificationForSession` 已实现底层通知（仅批量、且只看任务级 `notifications` 开关）
- 单次下载完全不接通知
- 点击通知只 `restoreOrCreateMainWindow`，不 navigate
- Settings 里没有任何开关

## 改动摘要

### 配置层 (`src/main/services/config.ts`)

- 新增 `AppConfig.notifications.{enabled, byStatus.{completed,failed,allSkipped}, singleDownload.enabled, clickAction}`
- 新增 `AppConfig.desktop.{closeAction, autoLaunch, startMinimized}`
- `DEFAULT_CONFIG` 加对应默认值（通知默认全开、单次下载默认关、clickAction=openDownloadHub；closeAction 默认 hide-to-tray、autoLaunch/startMinimized 默认关）
- `normalizeConfigSaveInput` 追加两段合并
- 新增 `getNotificationsConfig()` / `getDesktopConfig()` 访问器，均带默认值兜底（旧 config.yaml 不升级也能读）

### 通知服务抽层 (`src/main/services/notificationService.ts`)

- 新文件。导出 `notifyBulkSession` / `notifySingleDownload`
- 三级 AND 判断：`enabled (全局) AND byStatus[status] (状态类别) AND taskLevelEnabled (任务级)`
- 统一 `click` 处理：按 `clickAction` 决定 focus / openDownloadHub / openSessionDetail，通过 `SYSTEM_NAVIGATE` IPC 发到渲染层
- `bulkDownloadService.showDesktopNotificationForSession` 删除，调用点改调 `notifyBulkSession`（任务级开关从过滤条件下沉为参数 `taskLevelEnabled`）

### 单次下载通知 (`src/main/services/downloadManager.ts`)

- 成功分支：`broadcastStatus('completed')` 后调 `notifySingleDownload({ status: 'completed', filename })`
- 真失败分支：`handleDownloadError` 内 `broadcastStatus('failed')` 后调 `notifySingleDownload({ status: 'failed', ... })`
- 用户暂停 / 取消（`userInterruptedStatuses` 命中）在函数开头早返，不会进入通知路径

### 导航 IPC (`src/main/ipc/channels.ts` + preload + `App.tsx`)

- 新增 `SYSTEM_NAVIGATE: 'system:navigate'`
- 新增 config 分域通道：`CONFIG_GET_NOTIFICATIONS` / `CONFIG_SET_NOTIFICATIONS` / `CONFIG_GET_DESKTOP` / `CONFIG_SET_DESKTOP`
- `src/preload/shared/createSystemApi.ts` 新增 `onSystemNavigate(cb)` 订阅
- `App.tsx` 新 useEffect：监听 navigate payload → `setSidebarSection` + `setSelectedKey` + 对应 subKey；若目标是 pin 则走 `handlePinnedClick` 恢复缓存（依赖 bug1/C1 的 pin 恢复链）

### 关闭行为 & 开机自启 (`src/main/window.ts` + `src/main/index.ts`)

- 主窗口 `close` 事件按 `desktop.closeAction` 分流：
  - `quit`：不 preventDefault，走 `before-quit` 清理链
  - `hide-to-tray`：原行为（preventDefault + hide）
  - `ask`：`dialog.showMessageBoxSync` 弹 3 选项（最小化到托盘 / 退出应用 / 取消）
- 读取失败退化为 `hide-to-tray`，保证兼容
- `index.ts` 在 `initializeApp` 之后调用一次 `app.setLoginItemSettings({ openAtLogin, openAsHidden })`，跟随 `desktop.autoLaunch` / `startMinimized`
- `CONFIG_SET_DESKTOP` handler 在 autoLaunch / startMinimized 字段变化时也同步调用一次，避免必须重启才生效

### Settings UI (`src/renderer/pages/SettingsPage.tsx`)

- 在"外观"与"缓存管理"之间新增"通知"、"桌面行为"两个 SettingsGroup
- mount 时通过 `config.getNotifications()` / `config.getDesktop()` 拉取；每个开关触发 optimistic update + `setNotifications` / `setDesktop` 回写；失败回滚
- 关联态：总开关关闭时下游 Switch / Select 置灰；autoLaunch 关闭时 startMinimized 置灰
- 新增 zh-CN / en-US i18n key（settings.notifications / notifEnabled / notifClickHub / desktop / closeHideToTray 等，共 22 项）

## 测试

- 新测：`tests/main/services/notificationService.test.ts`（10 case）
  - 三级开关反模式守卫：enabled=false、byStatus.failed=false、taskLevelEnabled=false 都不应弹；三开关齐开时才弹
  - 单次下载：singleDownload.enabled=false 不弹；齐开时弹
  - click 守卫：clickAction=openDownloadHub 时应发 `system:navigate`；clickAction=focus 时不发；clickAction=openSessionDetail 带 sessionId 时 payload 含 sessionId
  - allSkipped + favoriteTag originType 时标题包含"人工处理"
- 旧测 `tests/main/services/bulkDownloadService.notifications.test.ts` 补 `getNotificationsConfig` mock（enabled=true + clickAction=focus），原 4 case 仍通过
- 反模式守卫验证：故意把 `if (!cfg.enabled) return false` 改成 `if (!cfg.enabled) { /* break */ }` → 对应 case FAIL；恢复后 PASS
- 回归：`tests/main tests/renderer` 全量 PASS

## 前置依赖

- C1 (bug1)：pin 恢复链；`App.tsx` 里的 `handlePinnedClick` 在 navigate 命中 pin 时复用
- C2 (bug7)：queued 状态机；bulk 终态通知判定基于 `isDesktopNotificationStatus`，仍只覆盖 completed / failed / allSkipped
