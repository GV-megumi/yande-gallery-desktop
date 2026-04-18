# Electron 桌面行为与通知

## 文档定位

把 `notifications` / `desktop` 两段配置的语义、三级判断和触发时机收口在一处。改通知、关闭行为、托盘、开机自启相关代码时，先对照这里的规则，避免出现"设置页能勾，但行为对不上"的伪能力。

## 配置形态

以 `AppConfig` 为准（[src/main/services/config.ts](../../src/main/services/config.ts)）。两段都顶层挂在 config 下，分域 getter/setter 只触碰各自命名空间，不做整包覆盖。

```ts
notifications: {
  enabled: boolean;                                          // 全局开关
  byStatus: { completed: boolean; failed: boolean; allSkipped: boolean };
  singleDownload: { enabled: boolean };                      // 单图下载（Booru 逐张）是否弹通知
  clickAction: 'focus' | 'openDownloadHub' | 'openSessionDetail';
}

desktop: {
  closeAction: 'hide-to-tray' | 'quit' | 'ask';              // 主窗口点 X 的行为
  autoLaunch: boolean;                                       // 开机自启
  startMinimized: boolean;                                   // 自启时直接隐藏到托盘
}
```

对应 preload 分域：`config.getNotifications` / `setNotifications` / `getDesktop` / `setDesktop`。

## 约定

### 1. 通知触发走三级判断，不要自己短路

批量下载会话终态通知必须同时满足：

1. `notifications.enabled === true`（全局没关）
2. `notifications.byStatus[status] === true`（该终态没关）
3. 任务级 `notifications === true`（该任务没关）

三级任何一层 false 都要静默。单图下载另起一条分支：`notifications.enabled && notifications.singleDownload.enabled`。

**反模式**：

- 只判全局 `enabled` 就发通知 → 关不掉具体终态
- 只判任务级 `notifications` 就发通知 → 全局关了依然弹
- 在 UI 层做条件分支 → 每个入口都要重复，后续新入口漏判

都应由 `notificationService` 统一落地，调用方只传 `status` + `taskNotifications` 两个事实。

### 2. `clickAction` 必须能在运行时定位目标窗口

`focus` / `openDownloadHub` / `openSessionDetail` 在点通知时要能：

- 把主窗口拉到前台（若已最小化要 restore + focus）
- 若主窗口已关闭但应用在托盘，要先创建或显示主窗口再跳转
- 跨窗口跳转（例如从子窗口触发的通知）使用 `system:navigate`，在主进程侧异步定位，避免渲染端阻塞

### 3. `closeAction` 的三态不能省

- `hide-to-tray`：点 X 缩到托盘，托盘图标必须可见才允许设为该值；否则用户会"以为退出了但其实还在跑"。
- `quit`：走正常的 `before-quit` / `will-quit`，保证托管定时器、下载会话状态、托盘图标都被清理。
- `ask`：弹确认框，让用户选本次怎么处理；不要把选择结果又回写成 `hide-to-tray` / `quit`，除非用户明确勾"下次不再询问"。

### 4. `startMinimized` 只在 `autoLaunch` 生效时才应生效

`startMinimized=true` 的默认语义是"随开机自启进入托盘"。手动点应用图标启动时应忽略该字段，让窗口正常可见；否则用户会找不到窗口。

### 5. 托盘图标生命周期要与窗口分离

- 主窗口关闭（hide）不应销毁托盘图标，否则"缩到托盘"立刻失效。
- 应用真正退出（`before-quit`）时再统一清理托盘、子窗口、定时器。
- 不要依赖"主窗口 onClose 时销毁托盘"这类耦合写法——它会在 `closeAction=hide-to-tray` 下出 bug。

### 6. 新增通知入口和桌面行为时必须做能力闭环

参考 `doc/注意事项/下载与批量会话状态机.md` 第 6 节：source of truth、service、IPC + preload、UI 入口、验收用例，五件事缺一不可。通知特别容易出现"底层能力有、UI 入口没兜起来"或"UI 勾上、但 `notificationService` 根本不消费该字段"这类断链。

## 实施自查清单

- [ ] 通知触发点走了 `notificationService`，没有在 UI / IPC 层做本地条件分支。
- [ ] 新增通知开关时，在 `notifications` 结构里新增字段，并保证三级判断把它接上。
- [ ] `closeAction`、`autoLaunch`、`startMinimized` 改动时同步检查托盘、主进程 quit 钩子、窗口显隐逻辑。
- [ ] 点通知后能可靠定位目标窗口，主窗口被隐藏或关闭时仍能 restore + focus。
- [ ] 默认值与迁移路径明确（`undefined` 不会让用户"原本开着的突然关掉"）。

## 实际来源

- `src/main/services/config.ts`（`notifications` / `desktop` 结构与默认值）
- `src/main/services/notificationService.ts`（三级判断与 `clickAction` 消费）
- `src/main/window.ts`（托盘、`closeAction`、`system:navigate`）
- `src/main/index.ts`（`autoLaunch` / `startMinimized` 接入启动路径）
- `src/renderer/pages/SettingsPage.tsx`（通知 / 桌面行为 Tab）

## 相关文档

- `doc/功能总览.md`（桌面行为与通知小节）
- `doc/Renderer API 文档.md`（`config.getNotifications` / `setNotifications` / `getDesktop` / `setDesktop`）
- `doc/注意事项/下载与批量会话状态机.md`（能力闭环五件事）
- `doc/注意事项/导航缓存与页面偏好持久化.md`（主窗口 / 子窗口语义）
