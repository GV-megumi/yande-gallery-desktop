# Renderer API 文档

## 文档定位

本文件描述渲染进程通过 `window.electronAPI` 可以直接调用的 API 面。主来源是 `src/preload/index.ts`，因此当文档与实现不一致时，以 preload 实现为准。

## 总体说明

- 渲染进程不直接访问 Node.js / Electron 主进程能力。
- 所有能力都通过 preload 层暴露到 `window.electronAPI`。
- 当前 API 同时包含两类接口：
  - `invoke` 风格的方法调用
  - 事件订阅 / 取消订阅接口

## 域总览

- `db`
- `gallery`
- `config`
- `image`
- `booru`
- `bulkDownload`
- `window`
- `system`

## `db`

面向较基础的数据库 / 本地图片查询能力。

- `init()`：初始化数据库
- `getImages(page, pageSize)`：分页获取图片
- `addImage(image)`：新增图片记录
- `searchImages(query, page?, pageSize?)`：按关键词搜索图片

## `gallery`

面向图库目录和图库内图片。

- `getRecentImages(count?)`：获取最近图片
- `getGalleries()`：获取图库列表
- `getGallery(id)`：获取单个图库
- `createGallery(galleryData)`：创建图库
- `updateGallery(id, updates)`：更新图库
- `deleteGallery(id)`：删除图库
- `setGalleryCover(id, coverImageId)`：设置图库封面
- `getImagesByFolder(folderPath, page?, pageSize?)`：获取指定目录图片
- `scanAndImportFolder(folderPath, extensions?, recursive?)`：扫描并导入目录
- `scanSubfolders(rootPath, extensions?)`：扫描子目录并批量创建图库

## `config`

面向配置读取、保存和配置事件。

- `get()`：获取当前配置
- `save(newConfig)`：保存配置
- `updateGalleryFolders(folders)`：更新图库目录配置
- `reload()`：重新加载配置
- `onConfigChanged(callback)`：监听配置变更，返回取消订阅函数

## `image`

面向本地图片扫描与缩略图。

- `scanFolder(folderPath)`：扫描目录
- `generateThumbnail(imagePath, force?)`：生成缩略图
- `getThumbnail(imagePath)`：获取缩略图路径
- `deleteThumbnail(imagePath)`：删除缩略图

## `booru`

这是当前最大的 API 域，覆盖站点管理、帖子浏览、收藏、下载、缓存、评论、论坛、Wiki、标签、分组、保存搜索等。

### 站点管理

- `getSites()`
- `addSite(site)`
- `updateSite(id, updates)`
- `deleteSite(id)`
- `getActiveSite()`

### 帖子与搜索

- `getPosts(siteId, page?, tags?, limit?)`
- `getPost(siteId, postId)`
- `searchPosts(siteId, tags, page?, limit?, fetchTagCategories?)`

### 收藏与服务端喜欢

- `getFavorites(siteId, page?, limit?, groupId?)`
- `addFavorite(postId, siteId, syncToServer?)`
- `removeFavorite(postId, syncToServer?)`
- `serverFavorite(siteId, postId)`
- `serverUnfavorite(siteId, postId)`
- `getServerFavorites(siteId, page?, limit?)`
- `getFavoriteUsers(siteId, postId)`

### 下载队列

- `addToDownload(postId, siteId)`
- `retryDownload(postId, siteId)`
- `getDownloadQueue(status?)`
- `clearDownloadRecords(status)`
- `pauseAllDownloads()`
- `resumeAllDownloads()`
- `resumePendingDownloads()`
- `getQueueStatus()`
- `pauseDownload(queueId)`
- `resumeDownload(queueId)`

说明：下载队列相关 Renderer API 使用的 `postId` 均为站点原始帖子 ID；主进程内部入库时会先映射到 `booru_posts.id`，读取队列返回给渲染层时再映射回原始帖子 ID。

### 图片缓存与标签缓存

- `getCachedImageUrl(md5, extension)`
- `cacheImage(url, md5, extension)`
- `getCacheStats()`
- `clearCache()`
- `getTagCacheStats()`
- `cleanExpiredTags(expireDays?)`

### 标签与艺术家相关

- `getTagsCategories(siteId, tagNames)`
- `autocompleteTags(siteId, query, limit?)`
- `getArtist(siteId, name)`
- `getTagRelationships(siteId, name)`

### 元数据 / 举报 / 详情扩展

- `reportPost(siteId, postId, reason)`
- `getImageMetadata(request)`
- `getNotes(siteId, postId)`
- `getPostVersions(siteId, postId)`

### Wiki / Forum / User

- `getWiki(siteId, title)`
- `getForumTopics(siteId, page?, limit?)`
- `getForumPosts(siteId, topicId, page?, limit?)`
- `getProfile(siteId)`
- `getUserProfile(siteId, params)`

### 收藏标签 / 标签分组

- `addFavoriteTag(siteId, tagName, options?)`
- `addFavoriteTagsBatch(tagString, siteId, labels?)`：批量添加，`tagString` 按行/逗号/空格切分，返回 `{ added, skipped }`
- `removeFavoriteTag(id)`
- `removeFavoriteTagByName(siteId, tagName)`
- `getFavoriteTags(params?: ListQueryParams)`：返回 `PaginatedResult<FavoriteTag>`，支持 `siteId` / `keyword` / `offset` / `limit`；`limit <= 0` 表示全量
- `getFavoriteTagsWithDownloadState(params?: ListQueryParams)`：同上，返回值带下载状态字段
- `updateFavoriteTag(id, updates)`：`updates.siteId` 只允许把"全局"标签（原 `siteId === null`）指派到某个站点，已绑定站点的标签不可再改
- `isFavoriteTag(siteId, tagName)`
- `getFavoriteTagLabels()`
- `addFavoriteTagLabel(name, color?)`
- `removeFavoriteTagLabel(id)`

### 搜索历史

- `addSearchHistory(siteId, query, resultCount?)`
- `getSearchHistory(siteId?, limit?)`
- `clearSearchHistory(siteId?)`

### 黑名单标签

- `addBlacklistedTag(tagName, siteId?, reason?)`
- `addBlacklistedTags(tagString, siteId?, reason?)`
- `getBlacklistedTags(params?: ListQueryParams)`：返回 `PaginatedResult<BlacklistedTag>`，语义同 `getFavoriteTags`
- `getActiveBlacklistTagNames(siteId?)`
- `toggleBlacklistedTag(id)`
- `updateBlacklistedTag(id, updates)`
- `removeBlacklistedTag(id)`

### 认证与投票

- `login(siteId, username, password)`
- `logout(siteId)`
- `testAuth(siteId)`
- `hashPassword(salt, password)`
- `votePost(siteId, postId, score)`

### 热门与评论

- `getPopularRecent(siteId, period?)`，其中 `period` 取值是 `'1day' | '1week' | '1month'`
- `getPopularByDay(siteId, date)`
- `getPopularByWeek(siteId, date)`
- `getPopularByMonth(siteId, date)`
- `getComments(siteId, postId)`
- `createComment(siteId, postId, body)`

### Pool

- `getPools(siteId, page?)`
- `getPool(siteId, poolId, page?)`
- `searchPools(siteId, query, page?)`

### 导入 / 导出

- `exportFavoriteTags(siteId?)`
- `importFavoriteTagsPickFile()`：只负责弹选择文件 + 解析，返回 `ImportPickFileResult<FavoriteTagImportRecord>`（含标签分组预览），不落库
- `importFavoriteTagsCommit(payload)`：拿 pickFile 的结果 + 用户选中的兜底 siteId 提交，返回 `{ imported, skipped, labelsImported, labelsSkipped }`
- `exportBlacklistedTags(siteId?)`
- `importBlacklistedTagsPickFile()`：同上，用于黑名单
- `importBlacklistedTagsCommit(payload)`：同上，用于黑名单

说明：从 v0.0.2 起一步到位的旧 `importFavoriteTags()` / `importBlacklistedTags()` 已被移除，统一改成两段式以支持预览再确认。

### 收藏夹分组 / 保存的搜索

- `getFavoriteGroups(siteId?)`
- `createFavoriteGroup(name, siteId?, color?)`
- `updateFavoriteGroup(id, updates)`
- `deleteFavoriteGroup(id)`
- `moveFavoriteToGroup(postId, groupId)`
- `getSavedSearches(siteId?)`
- `addSavedSearch(siteId, name, query)`
- `updateSavedSearch(id, updates)`
- `deleteSavedSearch(id)`

### 事件订阅

- `onFavoritesRepairDone(callback)`：收藏修复完成事件
- `onDownloadProgress(callback)`：下载进度事件
- `onDownloadStatus(callback)`：下载状态变化事件
- `onQueueStatus(callback)`：下载队列状态事件

这些事件都返回“取消订阅函数”。

## `bulkDownload`

面向批量下载任务和会话生命周期。

- `createTask(options)`
- `getTasks()`
- `getTask(taskId)`
- `updateTask(taskId, updates)`
- `deleteTask(taskId)`
- `createSession(taskId)`
- `getActiveSessions()`
- `startSession(sessionId)`
- `pauseSession(sessionId)`
- `cancelSession(sessionId)`
- `deleteSession(sessionId)`
- `getSessionStats(sessionId)`
- `getRecords(sessionId, status?, page?, autoFix?)`
- `retryAllFailed(sessionId)`
- `retryFailedRecord(sessionId, recordUrl)`
- `resumeRunningSessions()`

说明：批量下载相关的进度 / 状态事件不挂在这个域下，而是挂在 `system` 域下。

## `window`

面向从其他上下文打开特定 Booru 页面。

注意：这里的 `window.electronAPI.window` 是一个命名空间，不是浏览器原生 `window` API。

- `openTagSearch(tag, siteId?)`
- `openArtist(name, siteId?)`
- `openCharacter(name, siteId?)`

## `system`

面向系统级能力、外链、备份和网络测试。

- `selectFolder()`：打开系统目录选择器
- `openExternal(url)`：用系统浏览器打开链接
- `showItem(path)`：在系统文件管理器中定位文件
- `exportBackup()`：导出应用备份
- `importBackup(mode?)`：导入应用备份
- `testBaidu()`：测试百度连通性
- `testGoogle()`：测试 Google 连通性
- `checkForUpdate()`：通过 GitHub Releases API 查询最新发布版本，返回 `UpdateCheckResult`（含当前版本、最新版本、`hasUpdate`、`releaseUrl` 等）。主进程侧对成功结果做短时缓存（约 60s），错误响应不缓存以便重试。

### 事件订阅

- `onBulkDownloadRecordProgress(callback)`
- `onBulkDownloadRecordStatus(callback)`

## 返回值约定

当前大多数 API 返回结构遵循这一模式：

```ts
{
  success: boolean;
  data?: unknown;
  error?: string;
}
```

但不同域的 `data` 结构差异很大；如果需要严格类型，优先参考 `src/preload/index.ts` 里的全局 TypeScript 声明。

## 参数约定与常见含义

- 一部分接口允许 `siteId?: number | null`
- 当 `siteId` 为 `null` 或省略时，通常表示“全局项”或“不绑定特定站点”
- 这类接口主要包括：
  - `booru.addFavoriteTag`、`booru.removeFavoriteTagByName`、`booru.isFavoriteTag`
  - `booru.addBlacklistedTag`、`booru.addBlacklistedTags`、`booru.getActiveBlacklistTagNames`
  - `booru.exportFavoriteTags`、`booru.exportBlacklistedTags`
  - `booru.getFavoriteGroups`、`booru.createFavoriteGroup`
  - `booru.getSavedSearches`、`booru.addSavedSearch`
  - `window.openTagSearch`、`window.openArtist`、`window.openCharacter`
- 一部分方法在 preload 中带默认参数，例如：
  - `booru.getPosts(..., page = 1, ...)`
  - `booru.searchPosts(..., page = 1, ..., fetchTagCategories = true)`
  - `booru.getFavorites(..., page = 1, limit = 20, ...)`
  - `booru.addFavorite(..., syncToServer = false)`
  - `booru.removeFavorite(..., syncToServer = false)`
  - `system.importBackup(mode = 'merge')`

### 列表查询与分页约定（v0.0.2 起）

`getFavoriteTags` / `getFavoriteTagsWithDownloadState` / `getBlacklistedTags` 三个 list 接口统一接收 `ListQueryParams`，返回 `PaginatedResult<T>`：

```ts
interface ListQueryParams {
  /** undefined = 不过滤站点；null = 只查全局；number = 过滤该站点并含全局 */
  siteId?: number | null;
  /** 空字符串或 undefined 不搜索；非空走 COLLATE NOCASE 模糊匹配 */
  keyword?: string;
  /** 默认 0 */
  offset?: number;
  /** 默认 50；传 0 或负数 = 无分页全量（导出场景使用） */
  limit?: number;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
}
```

调用模式：

- 页面表格走分页：传 `{ siteId, keyword, offset, limit }`，根据 `total` 渲染分页控件
- 导出 / 批量计算：传 `{ limit: 0 }` 拿全量，再从 `items` 里取数组

## 事件订阅使用模式

所有订阅型 API 都会返回一个“取消订阅函数”，推荐在页面卸载时调用。

```ts
const unsubscribe = window.electronAPI.booru.onDownloadProgress((data) => {
  console.log(data);
});

// unmount 时调用
unsubscribe();
```

当前完整的订阅型接口包括：

- `config.onConfigChanged`
- `booru.onFavoritesRepairDone`
- `booru.onDownloadProgress`
- `booru.onDownloadStatus`
- `booru.onQueueStatus`
- `system.onBulkDownloadRecordProgress`
- `system.onBulkDownloadRecordStatus`

## 说明与边界

- 这份文档描述的是 preload 暴露给渲染进程的 API，不等同于应用的全部功能面
- Google Drive、Google Photos、Gemini 等页面均通过 webview 嵌入对应 Google 网站，不依赖 preload API
- 因此”页面存在”不一定等于”有同名 `window.electronAPI` 域”

## 使用建议

- 想找“页面能不能调这个能力”，先看这里。
- 想找“这个能力在主进程哪处理”，再顺着 `src/preload/index.ts` 的通道名去看对应 handler。
- 想核对某个通道是不是常量化了，不要只看 `src/main/ipc/channels.ts`，也要看 preload 里的字符串字面量调用。

## 相关文档

- `doc/架构总览.md`
- `doc/开发与配置指南.md`
- `doc/功能总览.md`
