# 网络访问与 CORS 解决方案

## 核心原则

所有外部网络请求统一走主进程，不让渲染进程直接访问第三方站点。

## 为什么这样设计

- Electron 渲染进程本质上仍受浏览器同源策略影响。
- 代理、认证、限流、错误处理集中在主进程更容易维护。
- 外部请求统一走 IPC，安全边界更清晰。

## 推荐模式

1. 渲染进程通过 `window.electronAPI.*` 调用。
2. Preload 层用 `ipcRenderer.invoke` 转发。
3. 主进程在 IPC handler 或 service 中完成真实网络请求。

## 不建议的做法

- 在 React 页面里直接 `fetch` 第三方 Booru 站点。
- 把需要代理或认证的请求分散到多个页面临时处理。

## 相关位置

- `src/preload/index.ts`
- `src/main/ipc/handlers.ts`
- `doc/注意事项/代理配置指南.md`
