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
- `booruPreferences`
- `pagePreferences`
- `image`
- `booru`
- `bulkDownload`
- `window`
- `system`

> 轻量子窗口（`tag-search` / `artist` / `character`）加载的精简 preload 只暴露 `window` / `booru` / `booruPreferences` / `system` 四个域；其余域在这类子窗口中为 `undefined`，调用会在运行时抛 `TypeError`。二级菜单子窗口仍然使用主 preload。参见 [src/preload/subwindow-index.ts](../src/preload/subwindow-index.ts)。

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
- `deleteGallery(id)`：删除图库。按 `galleries.recursive` 字段决定清理范围：`recursive=1` 级联删图集下整棵子树的 `images` / 缩略图 / `booru_posts.localImageId` / `invalid_images` 等关联数据，并把 `folderPath` 写入 `gallery_ignored_folders` 防止下次扫描重建；`recursive=0` 只清理图集目录下直接子文件。原始图片文件不会被物理删除。
- `setGalleryCover(id, coverImageId)`：设置图库封面
- `getImagesByFolder(folderPath, page?, pageSize?)`：获取指定目录图片
- `scanAndImportFolder(folderPath, extensions?, recursive?)`：扫描并导入目录
- `syncGalleryFolder(id)`：同步指定图库的文件夹，重新扫描并导入新文件，返回 `{ imported, skipped, imageCount, lastScannedAt }`
- `scanSubfolders(rootPath, extensions?)`：扫描子目录并批量创建图库
- `reportInvalidImage(imageId)`：标记图片为无效
- `getInvalidImages(page?, pageSize?)`：分页获取无效图片列表
- `getInvalidImageCount()`：获取无效图片总数
- `deleteInvalidImage(id)`：删除单个无效图片记录
- `clearInvalidImages()`：清空所有无效图片记录

### 图集忽略名单（v0.0.2 起）

- `listIgnoredFolders()`：列出所有被加入忽略名单的目录
- `addIgnoredFolder(folderPath, note?)`：把目录加入忽略名单，下次扫描不会再创建图集
- `updateIgnoredFolder(id, patch)`：更新忽略记录（当前主要是修改 `note`）
- `removeIgnoredFolder(id)`：从忽略名单中移除（允许下次扫描再次创建）

忽略名单存储在 `gallery_ignored_folders` 表；`deleteGallery` 会自动把被删图集的 `folderPath` 追加进来。

## `config`

面向配置读取、保存和配置事件。

- `get()`：获取当前去敏 `RendererSafeAppConfig`
- `save(newConfig)`：保存配置
- `updateGalleryFolders(folders)`：更新图库目录配置
- `reload()`：重新加载配置
- `getNotifications()` / `setNotifications(patch)`：桌面通知分域读写（v0.0.2 起）
- `getDesktop()` / `setDesktop(patch)`：桌面行为分域读写（v0.0.2 起）
- `onConfigChanged(callback)`：监听配置变更，返回取消订阅函数
  - 回调签名：`(config: RendererSafeAppConfig, summary: ConfigChangedSummary) => void`
  - 主进程只广播摘要 `{ version, sections }`，preload 层在收到摘要后会自动重新调用 `config.get()` 拉取最新去敏配置并传入回调的第一个参数，**不会**通过事件通道下发敏感字段
  - `summary.sections` 给出受影响的路径集合（例如 `'network'`、`'ui.pagePreferences.favoriteTags'`），可用于按区块选择性更新 UI
  - `summary.version` 是单调递增的时间戳，异步订阅者可用来识别是否收到过期事件

### 通知与桌面行为的配置结构（v0.0.2 起）

`notifications` 和 `desktop` 是 `AppConfig` 顶层字段；分域 getter/setter 只写入这两个命名空间，避免整包覆盖。

```ts
// notifications
{
  enabled: boolean;                                    // 全局开关
  byStatus: {
    completed: boolean;
    failed: boolean;
    allSkipped: boolean;
  };
  singleDownload: { enabled: boolean };                // 单图下载是否弹通知
  clickAction: 'focus' | 'openDownloadHub' | 'openSessionDetail';
}

// desktop
{
  closeAction: 'hide-to-tray' | 'quit' | 'ask';       // 主窗口点 X 的行为
  autoLaunch: boolean;                                 // 开机自启
  startMinimized: boolean;                             // 自启时隐藏到托盘
}
```

三级判断语义（批量下载通知）：`notifications.enabled && notifications.byStatus[status] && 任务级 notifications`。单图下载只看 `notifications.enabled && singleDownload.enabled`。

## `booruPreferences`

面向 Booru 外观偏好的读取与订阅。主 / 子窗口 preload 共用同一工厂。

- `appearance.get()`：读取 `BooruAppearancePreference`（网格大小、预览质量、分页位置、页面模式、缓存上限等）
- `appearance.onChanged(callback)`：订阅外观偏好变更，基于 `config:changed` 摘要事件，preload 自动拉取最新 DTO；返回取消订阅函数

## `pagePreferences`

面向页面维度偏好的读写（主 preload 独占，轻量子窗口不暴露）。

- `favoriteTags.get()` / `favoriteTags.save(preferences)`
- `blacklistedTags.get()` / `blacklistedTags.save(preferences)`
- `gallery.get()` / `gallery.save(preferences)`：存储形态为 `GalleryPagePreferencesBySubTab`，按子 Tab（recent / all / galleries / invalid-images）分别记忆
- `appShell.get()` / `appShell.save(preferences)`：应用外壳偏好（菜单展开、顶部标签栏等）

使用这些偏好时须同时参考 `doc/注意事项/导航缓存与页面偏好持久化.md`，避免"用户返回后被自动还原"这类交互 bug。

## `image`

面向本地图片扫描与缩略图。

- `scanFolder(folderPath)`：扫描目录
- `generateThumbnail(imagePath, force?)`：生成缩略图
- `getThumbnail(imagePath)`：获取缩略图路径
- `deleteThumbnail(imagePath)`：删除缩略图
- `deleteImage(imageId)`：删除图片（包括数据库记录、磁盘文件和缩略图）

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
- `getFavoriteTagDownloadBinding(favoriteTagId)`：获取收藏标签的下载绑定配置
- `getFavoriteTagDownloadHistory(favoriteTagId)`：获取收藏标签的下载历史
- `getGallerySourceFavoriteTags(galleryId)`：获取图库关联的来源收藏标签
- `upsertFavoriteTagDownloadBinding(input)`：创建或更新收藏标签的下载绑定
- `removeFavoriteTagDownloadBinding(favoriteTagId)`：删除收藏标签的下载绑定
- `startFavoriteTagBulkDownload(favoriteTagId)`：基于收藏标签启动批量下载，返回 `{ taskId, sessionId, deduplicated? }`；当检测到重复任务时 `deduplicated` 为 `true`
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

面向子窗口管理：从主窗口或子窗口中打开新的子窗口页面。

注意：这里的 `window.electronAPI.window` 是一个命名空间，不是浏览器原生 `window` API。

子窗口分为两类：
- **专用子窗口**：`openTagSearch` / `openArtist` / `openCharacter`，以 URL hash 参数指定页面类型和查询参数
- **二级菜单子窗口**：`openSecondaryMenu`，可在独立窗口中打开主窗口侧边栏的任意二级菜单页面，由 `SubWindowApp.tsx` 通过 `secondary-menu` 路由类型渲染

- `openTagSearch(tag, siteId?)`
- `openArtist(name, siteId?)`
- `openCharacter(name, siteId?)`
- `openSecondaryMenu(section, key, tab?, extra?)`：在新子窗口中打开指定的二级菜单页面
  - `section`：顶层区域（`gallery` / `booru` / `google`）
  - `key`：页面标识
  - `tab`：可选的页内子导航初始 tab
  - `extra`：可选的附加 query（`Record<string, string | number>`），用于把必要上下文显式带进子窗口（例如 `{ galleryId: 5 }` 让子窗口直接进入某个图集详情）
  - 约束：`extra` 中保留键 `section` / `key` / `tab` 会被主进程屏蔽，不会传入子窗口；附加参数走 URL query 而非共享的 `pagePreferences`，避免子窗口写回污染主窗口记忆

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

## 主 / 子窗口 preload 暴露面差异

主窗口和二级菜单子窗口加载的是 `build/preload/index.js`（源文件：[src/preload/index.ts](../src/preload/index.ts)），暴露上述全部域。

轻量子窗口（`tag-search` / `artist` / `character`）加载的是 `build/preload/subwindow.js`（源文件：[src/preload/subwindow-index.ts](../src/preload/subwindow-index.ts)），只暴露：

- `window`
- `booru`
- `booruPreferences`
- `system`

其他域（`db` / `gallery` / `image` / `config` / `bulkDownload` / `pagePreferences`）在轻量子窗口里为 `undefined`，在 TS 层通过编译但运行时调用会抛 `TypeError`。新增轻量子窗口页面或其依赖的 hooks / 组件时，必须避开这些域；确实需要的新能力要么挪到主 preload 再打开主窗口页面，要么把对应工厂加进 [src/preload/shared/](../src/preload/shared/) 并在两个入口都挂上。

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

- `config.onConfigChanged`（事件仅包含 `{ version, sections }` 摘要，preload 会自动回调去敏 config，详见 `config` 小节）
- `booruPreferences.appearance.onChanged`（同样基于 `config:changed` 摘要事件，preload 自动拉取最新 appearance DTO）
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
