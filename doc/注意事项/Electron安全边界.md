# Electron 安全边界

## 文档定位

约束 Electron 主窗口、子窗口、外链、`app://` 文件协议和 webview 的安全边界。改主进程窗口、外部链接、Google webview 或 preload 暴露面时，先对照这里，避免重新引入任意路径读取、任意协议打开或高权限 preload 下放。

## 核心规则

### 1. `app://` 只能映射受控根目录

`app://` 文件协议由主进程注册，解析逻辑在 `src/main/index.ts`。允许根目录来自：

- 已配置的图库目录
- 下载目录
- `dataPath` 数据目录

解析后必须使用路径归一化和“是否位于受控根内”的检查。不能把 URL path 直接交给 `callback({ path })`，否则会退回任意本地文件读取风险。

### 2. 外链只允许安全的 https 目标

`system.openExternal(url)` 在主进程中先走 `validateExternalUrl`：

- 只允许 `https:`
- 不允许 URL 中携带 username / password
- 不允许 localhost、内网、回环、链路本地等目标
- DNS 解析后的地址也要做本机 / 内网检查

Renderer 页面不应绕过 `system.openExternal` 直接使用 Electron shell 能力，也不要为了兼容把 `http:`、`file:`、自定义协议临时放开。

### 3. 主窗口和子窗口导航必须白名单化

窗口级安全守卫在 `src/main/window.ts`：

- `setWindowOpenHandler` 只允许可信 app URL，其余新窗口请求拒绝。
- `will-navigate` 只允许开发环境 renderer origin 或打包后的 renderer `index.html`，其余导航阻止。
- 子窗口按 hash 前缀选择 preload：`tag-search` / `artist` / `character` 使用精简 preload，`secondary-menu` 使用主 preload。

新增窗口类型时必须明确它属于轻量窗口还是完整二级菜单窗口，并同步检查 preload 暴露面。

### 4. webview 只允许白名单 HTTPS 主机

`will-attach-webview` 只允许以下 HTTPS 主机：

- `drive.google.com`
- `photos.google.com`
- `gemini.google.com`

附着前要删除 webview 自带 preload，并强制：

- `nodeIntegration = false`
- `contextIsolation = true`
- `webSecurity = true`
- `allowRunningInsecureContent = false`
- `sandbox = true`

新增 webview 站点时必须先扩展白名单和人工验证清单，不能在页面组件里用 `allowpopups` 或宽松 webPreferences 兜过去。

### 5. Renderer 只能拿去敏 DTO

配置和站点凭证只在主进程使用。Renderer 可见对象必须是 renderer-safe DTO：

- `config.get()` 返回 `RendererSafeAppConfig`，代理账号密码、Google `clientSecret` 等敏感字段不得下发。
- Booru 站点返回给 Renderer 时要走 `toRendererSafeBooruSite(s)`，不要把 API key / password hash 原样交出去。
- `config:changed` 事件只广播 `{ version, sections }` 摘要，Renderer 收到后再主动拉取去敏数据。

如果新增配置字段或站点字段，必须同时判断它是否能下发到 Renderer；默认按敏感处理，确认安全后再加入 DTO。

### 6. preload 暴露面按窗口类型最小化

主窗口 preload 暴露完整域；轻量子窗口只暴露：

- `window`
- `booru`
- `booruPreferences`
- `system`

新增轻量子窗口页面时，不要直接复用主 preload 解决缺 API 的问题。优先把确实需要的能力抽到 `src/preload/shared/` 工厂，并让主 / 子窗口按需组合。

## 实施自查清单

- [ ] 新增 `app://` 用法时，目标路径位于受控根目录内，且路径检查覆盖 Windows / POSIX。
- [ ] 新增外链入口时，仍走 `system.openExternal`，没有放开非 https 或本机 / 内网目标。
- [ ] 新增窗口或子窗口时，明确 preload 暴露域，并通过测试覆盖被剔除 API 不存在。
- [ ] 新增 webview 站点时，更新白名单并确认不会携带 preload / Node 能力。
- [ ] 新增配置或站点字段时，确认 renderer-safe DTO、事件摘要和备份导出策略不会泄露敏感字段。
- [ ] 所有外部网络访问仍由主进程发起，Renderer 不直接请求外部站点。

## 实际来源

- `src/main/index.ts`（`app://` 受控路径映射）
- `src/main/window.ts`（窗口导航、webview、子窗口 preload 分流）
- `src/main/ipc/handlers.ts`（`validateExternalUrl`、renderer-safe Booru DTO）
- `src/main/services/config.ts`（`RendererSafeAppConfig`）
- `src/preload/index.ts`
- `src/preload/subwindow-index.ts`
- `src/preload/shared/`

## 相关文档

- `doc/注意事项/网络访问与CORS解决方案.md`
- `doc/注意事项/API限流与安全约束.md`
- `doc/注意事项/Electron桌面行为与通知.md`
- `doc/Renderer API 文档.md`
