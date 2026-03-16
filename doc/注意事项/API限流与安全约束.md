# API 限流与安全约束

## 限流

不同站点的 API 容量不同，批量请求、标签查询和下载都需要受控。

## 重点约束

- 不要把批量查询写成无上限并发。
- 429 或 Retry-After 需要被尊重。
- 高并发下载和高并发标签请求要分开考虑。

## 安全约束

- 密钥、密码哈希等敏感信息只在主进程使用。
- 渲染进程通过 preload 暴露安全 API，不直接持有底层凭证。
- 文件路径和用户输入要做边界校验。

## 站点差异

- 并不是每个站点都支持举报、标签关系、Wiki、论坛、用户主页等接口。
- 能力差异应在客户端实现层显式分支，而不是在 UI 层假设一致。

## 参考位置

- `src/main/services/booruClientInterface.ts`
- `src/main/services/moebooruClient.ts`
- `src/main/services/danbooruClient.ts`
- `src/main/services/gelbooruClient.ts`
