# Bug 修复任务清单

基于 DONE1.md 审计结果，按优先级排列。

---

## CRITICAL

### C1. booruService.ts - SQL `IS ?` 语法 -- 非 Bug
- **状态**: SKIP（审计误判）
- **说明**: SQLite 中 `IS ?` 是合法语法，当参数为 null 时等价于 `IS NULL`，非 null 时等价于 `= ?`。这是处理可空 siteId 的正确做法。

### C2. bulkDownloadService.ts - 暂停/取消无法中止进行中的下载 -- 已修复
- **修复**: 将 `activeDownloadSessions` 从 `Set<string>` 改为 `Map<string, AbortController>`，暂停/取消时调用 `controller.abort()`，并将 `abortSignal` 传递给 axios 请求。

### C3. bulkDownloadService.ts - 取消后不清理部分文件 -- 已修复
- **修复**: 在 `cancelBulkDownloadSession` 中查询所有 downloading/pending 状态的记录，清理对应的磁盘文件。

### C4. imageCacheService.ts - 并发缓存竞态条件 -- 已修复
- **修复**: 添加 `inFlightRequests` Map，同一图片的并发请求复用同一个 Promise。同时将 `.pipe()` 替换为 `pipeline()`。

### C5+C6. 未使用的 IPC 频道声明 -- 已修复
- **修复**: 从 `channels.ts` 和 `preload/index.ts` 中删除了 15+ 个无对应 handler 的频道常量（DB_UPDATE_IMAGE, DB_DELETE_IMAGE, DB_GET_TAGS 等）。
- **说明**: 审计中"9 个 API 方法无后端 handler"为误判，preload 并未暴露这些方法。

### C7. BooruDownloadPage.tsx - useEffect 闭包过期 -- 已修复
- **修复**: 将 `loadQueue` 包裹在 `useCallback`，并添加到 useEffect 依赖数组。

---

## HIGH

### H1. moebooruClient.ts - 速率限制过高 -- 已修复
- **修复**: 从 5 req/s 降低到 2 req/s（符合 Yande.re 限制）。

### H2. moebooruClient.ts - 部分方法跳过速率限制 -- 已修复
- **修复**: 在 `getTags()`、`getTagSummary()`、`getPost()` 中添加 `rateLimiter.acquire()`。

### H3. bulkDownloadService.ts - Promise.race() 并发池 bug -- 已修复
- **修复**: 将 `findIndex(p => p === Promise.resolve())` 替换为 `Promise.race(promises.map((p, idx) => p.then(() => idx)))`，正确回收已完成的槽位。

### H4. downloadManager.ts - 事件监听器泄漏 -- 非 Bug
- **状态**: SKIP（审计误判）
- **说明**: `broadcastProgress/broadcastStatus` 每次调用 `BrowserWindow.getAllWindows()` 获取窗口列表并发送消息，不是注册持久监听器，不存在泄漏。

### H5. BooruPage.tsx - 快速切换站点竞态条件 -- 已修复
- **修复**: 添加 `loadRequestIdRef` 计数器，响应到达时检查请求 ID 是否过期，丢弃过期响应。

---

## MEDIUM

### M1. booruService.ts - setActiveBooruSite 缺少事务 -- 已修复
- **修复**: 用 `BEGIN TRANSACTION / COMMIT / ROLLBACK` 包裹两步 UPDATE 操作。

### M2. booruService.ts - addToFavorites 缺少事务 -- 已修复
- **修复**: 用事务包裹 INSERT + UPDATE 操作。

### M3. downloadManager.ts - processQueue 竞态条件 -- 非 Bug
- **状态**: SKIP
- **说明**: `isProcessing` 标志在单线程 Node.js 事件循环中作为互斥锁是有效的，因为 `processQueue` 是 async 但在设置 `isProcessing = true` 时是同步的。

### M4. downloadManager.ts - abort 时 stream 未关闭 -- 非 Bug
- **状态**: SKIP
- **说明**: 代码使用 `pipeline()` 来管理流，`pipeline` 在 signal abort 时会自动关闭所有流。

### M5. filenameGenerator.ts - 文件名长度未验证 MAX_PATH -- 已修复
- **修复**: 在 `generateFileName` 末尾添加 200 字符长度限制，超长时保留扩展名并截断文件名。

### M6+M7. imageCacheService.ts - stream 处理问题 -- 已修复
- **修复**: 在 C4 中一并修复，将 `.pipe()` 替换为 `pipeline()`，自动处理错误传播和流清理。

### M8. BooruPage.tsx - useEffect 缺少依赖 -- 已修复
- **修复**: 在 `itemsPerPage` 变化的 useEffect 中添加 `isSearchMode` 和 `searchQuery` 依赖。

### M9. BooruFavoritesPage.tsx - 闭包过期 -- 已修复
- **修复**: 使用 `postsLengthRef` 持有最新的 `posts.length`，避免 `onSuccess` 回调中的闭包过期。

### M10. App.tsx - useEffect 缺少依赖 -- 已修复
- **修复**: 添加 `selectedSubKey` 和 `selectedBooruSubKey` 到依赖数组。

---

## LOW（未修复，风险低）

### L1. handlers.ts - 部分 handler 用硬编码字符串
- gallery/config/network 相关的 handler 使用字符串字面量而非 IPC_CHANNELS 常量
- 风险低：字符串与 preload 中的一致，不会导致运行时错误

### L2. BooruPostDetailsPage.tsx - 图片预加载取消不完整
- cancel 标志设置后 Promise 仍继续执行，但不会导致功能问题

### L3. BooruBulkDownloadPage.tsx - 轮询无去重
- 快速操作可能触发重复请求，但不会导致数据错误

---

## 后续修复（2026-03-09）

### F1. booruService.ts - getFavorites() JOIN 条件错误导致收藏列表为空 -- 已修复
- **级别**: CRITICAL
- **现象**: 在主页收藏图片后，收藏列表页面看不到该图片
- **根因**: `getFavorites()` SQL 查询中 JOIN 条件使用了 `p.id = f.postId`，但 `booru_favorites.postId` 存储的是外部 Moebooru postId（如 1234567），而 `booru_posts.id` 是内部自增主键（如 1, 2, 3），导致 JOIN 永远匹配不到
- **修复**: 将 `INNER JOIN booru_favorites f ON p.id = f.postId` 改为 `INNER JOIN booru_favorites f ON p.postId = f.postId AND p.siteId = f.siteId`，同时修复了 `getFavoritesCount()` 的相同问题

### F2. BooruPoolsPage.tsx / BooruPopularPage.tsx - Spin tip 控制台警告 -- 已修复
- **级别**: LOW
- **现象**: 控制台警告 `[antd: Spin] tip only work in nest or fullscreen pattern`
- **根因**: Ant Design 5.x 要求使用 `tip` 属性时，Spin 必须包裹子元素（嵌套模式）
- **修复**: 将 `<Spin tip="..."/>` 改为 `<Spin tip="..."><div style={{ padding: 60 }} /></Spin>`

### F3. TagsSection.tsx - 静态 message API 控制台警告 -- 已修复
- **级别**: LOW
- **现象**: 控制台警告 `[antd: message] Static function can not consume context`
- **根因**: 直接 import 的 `message` 是静态方法，无法访问 Ant Design 的 ConfigProvider 上下文
- **修复**: 将 `import { message } from 'antd'` 改为使用 `App.useApp()` 获取 `message` 实例

---

## 修复统计

| 级别 | 总数 | 已修复 | 非 Bug | 未修复 |
|------|------|--------|--------|--------|
| CRITICAL | 8 | 6 | 2 | 0 |
| HIGH | 5 | 3 | 1 | 0 |
| MEDIUM | 10 | 7 | 2 | 0 |
| LOW | 5 | 2 | 0 | 3 |
| **合计** | **28** | **18** | **5** | **3** |

### 修改的文件

1. `src/main/services/imageCacheService.ts` - 并发缓存防重 + pipeline
2. `src/main/services/moebooruClient.ts` - 速率限制修正
3. `src/main/services/bulkDownloadService.ts` - abort 机制 + 文件清理 + 并发池修复
4. `src/main/services/booruService.ts` - 事务包裹 + getFavorites JOIN 修复
5. `src/main/services/filenameGenerator.ts` - MAX_PATH 验证
6. `src/main/ipc/channels.ts` - 删除未实现频道
7. `src/preload/index.ts` - 同步清理
8. `src/renderer/pages/BooruDownloadPage.tsx` - 闭包修复
9. `src/renderer/pages/BooruPage.tsx` - 竞态条件 + 依赖修复
10. `src/renderer/pages/BooruFavoritesPage.tsx` - 闭包修复
11. `src/renderer/App.tsx` - useEffect 依赖修复
12. `src/renderer/pages/BooruPoolsPage.tsx` - Spin tip 嵌套模式修复
13. `src/renderer/pages/BooruPopularPage.tsx` - Spin tip 嵌套模式修复
14. `src/renderer/components/BooruPostDetails/TagsSection.tsx` - 静态 message 改为 App.useApp()
