# Renderer API 文档

## 文档定位

本文件描述渲染进程通过 `window.electronAPI` 可以直接调用的 API 面。主来源是 `src/preload/index.ts` 与 `src/preload/shared/*.ts`，因此当文档与实现不一致时，以 preload 实现为准。

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
- ~~`addImage(image)`~~：**已停用**（绕过 `gallery_images` 成员模型，会产生图集不可见的孤儿图；preload/channels 中仅以注释保留，零调用方）
- `searchImages(query, page?, pageSize?)`：按关键词搜索图片

## `gallery`

面向图库目录和图库内图片。

- `getRecentImages(count?)`：获取最近图片
- `getRecentImagesAfter(updatedAt, id, limit?, beforeUpdatedAt?, beforeId?)`：获取比给定最近图片游标更新的图片，按 `updatedAt DESC, id DESC` 返回。可选 `before*` 游标用于继续拉取下一页新增图片。用于最近图片页缓存恢复时做轻量增量刷新，不能替代完整进入页面时的 `getRecentImages`。
- `getGalleries()`：获取图库列表
- `getGallery(id)`：获取单个图库
- `createGallery(galleryData)`：创建图库
- `updateGallery(id, updates)`：更新图库
- `deleteGallery(id)`：删除图库。基于 `gallery_images` 成员表删除该图集的全部成员图片（一个事务里级联删 `image_tags` / `images`、清缩略图、复位对应 `booru_posts` 的 `downloaded`/`localPath`、做孤儿回收），删除图集行及其全部 `gallery_folders` 绑定，并把每个被删文件夹写入 `gallery_ignored_folders` 防止下次扫描重建。原始图片文件不会被物理删除；多归属图片只在不再属于任何图集时才回收。
- `setGalleryCover(id, coverImageId)`：设置图库封面
- `getImagesByGallery(galleryId, page?, pageSize?)`：获取某图集的图片（按 `gallery_images` 成员表 JOIN；取代旧的 `getImagesByFolder`）
- `syncGalleryFolder(id)`：同步该图集的**全部绑定文件夹**（遍历 `gallery_folders`），重扫并写入 `gallery_images` 成员，返回 `{ imported, skipped, imageCount, lastScannedAt }`
- `planScanFolder(rootPath, extensions?)`：扫描规划（只读，不写库）。仅枚举 `rootPath` 的**一级子文件夹**（含 `rootPath` 自身），把有图片的目录分类为 `newFolders` / `collisions`（同名图集已存在；库内有多个同名图集时确定性取最早创建的那个作为碰撞目标）/ `skipped`（`alreadyBound` / `ignored` / `noImages`）
- `applyScanPlan({ create, merge, extensions? })`：按用户决议落库。`create` 项新建图集（`recursive=true`；图集名与现有图集或同批已建项重名时按 `名称 (2)` / `名称 (3)` 规则自动加后缀）+ 绑定 + 扫描入成员；`merge` 项把文件夹并入既有图集。返回 `{ created, merged, imported, failedFolders, skippedFiles }`——`failedFolders` 为整项失败的**文件夹**数（建集/绑定失败或异常），`skippedFiles` 为扫描时因已在库中被跳过的**文件**数（幂等重扫的正常现象）；两者单位不同，不再混入同一个 `skipped` 计数

> ⚠ 旧接口 `getImagesByFolder` / `scanAndImportFolder` / `scanSubfolders` 已移除或停用：图集与文件夹解耦后，图片归属改由 `gallery_images` 成员表表达，扫描入库改为 `planScanFolder` + `applyScanPlan` 两步。`scanAndImportFolder` 在 preload/channels 中仅以注释保留（零调用方）。
- `reportInvalidImage(imageId)`：标记图片为无效
- `getInvalidImages(page?, pageSize?)`：分页获取无效图片列表
- `getInvalidImageCount()`：获取无效图片总数
- `deleteInvalidImage(id)`：删除单个无效图片记录
- `clearInvalidImages()`：清空所有无效图片记录

### 图集↔文件夹绑定（多文件夹模型）

图集与文件夹解耦后，一个图集可绑定多个文件夹（`gallery_folders` 表，`folderPath` 全局唯一），图片归属走 `gallery_images` 成员表。

- `getGalleryFolders(galleryId)`：读取某图集的全部绑定文件夹（每项含 `folderPath` / `recursive` / `extensions`）
- `bindFolder(galleryId, folderPath, recursive?, extensions?)`：给图集新增一个绑定文件夹并扫描入成员。绑定成功后会移除忽略名单中该路径的**精确条目**（显式绑定意图覆盖"删除图集自动忽略"的拉黑），并广播 `gallery:ignored-folders-changed{action:'deleted'}`
- `unbindFolder(galleryId, folderPath)`：解除某文件夹绑定，删除其带来的成员并回收孤儿（保留图集记录、不写黑名单）。覆盖感知：仍被该图集其它绑定文件夹覆盖的图片不会被移除
- `changeFolderPath(galleryId, oldPath, newPath, recursive?, extensions?)`：更改某绑定文件夹路径（先绑新、成功后再解旧；新路径失败则旧绑定与成员零损失）。`recursive` / `extensions` 未显式传入时**继承旧绑定行的配置**（改路径不改变绑定语义，非递归绑定不会被翻转为递归、自定义扩展名不被重置）；显式传入优先；旧绑定行不存在时回退默认（递归 + 默认扩展名）

### 跨机器重定位与丢失文件夹检测

- `previewRelocateRoot(mappings)`：重定位预检（dry-run，不写库）。`mappings: { oldPrefix, newPrefix }[]`，返回 `{ affected: {table,column,count}[], collisions: {table,column,path}[], warnings: {table,column,newPrefix,existingPrefix,count}[] }`。`collisions` 非空则禁止 apply；`warnings` 为**非阻断**提示——某映射规范化后的 `newPrefix` 与库内既有路径前缀仅大小写不同（字节不同），应用后库内会出现同一物理目录的两种大小写形态（后续按字节精确比较的绑定/去重判定会把它们当成不同目录），建议把新前缀改成与库内一致的大小写
- `applyRelocateRoot(mappings)`：应用重定位。单事务内按 `旧前缀→新前缀` 边界感知地无损改写库内全部路径列（`gallery_folders.folderPath` / `images.filepath` / `booru_posts.localPath` / `booru_favorite_tag_download_bindings.downloadPath` / `gallery_ignored_folders.folderPath`）；有 UNIQUE 冲突则整体中止、零写入。用于"文件随库一起搬到新机器"。**写入侧大小写归一（win32）**：preview 与 apply 都会先把 `oldPrefix`/`newPrefix` 走同一规范化（盘符统一大写；路径在磁盘上存在时用 `fs.realpathSync.native` 取真实目录项大小写形态，同时展开 8.3 短名、会解析符号链接；不存在则回退归一化输入），preview 展示的目标路径字节 == apply 实际写入的字节，避免手输小写前缀（如 `d:\art`）以非规范字节整库落盘后，与系统对话框返回的 `D:\art` 字节不等导致重复绑定、整目录重复导入。成功提交且改写行数 > 0 时，在刷新 `app://` 白名单后广播 `gallery:paths-relocated` 全量失效事件（见「事件订阅」），常驻缓存的图库页据此整页重载——重定位不动 `updatedAt`，否则增量游标感知不到任何变化
- `getMissingGalleryFolders()`：返回绑定文件夹在磁盘上不存在的项 `{ galleryId, folderPath }[]`（只读检测，供 UI 标记"文件夹丢失"）。**注意：直接返回数组，不是 `{ success }` 包裹**，调用方应 `try/catch`

### 图集忽略名单

- `listIgnoredFolders()`：列出所有被加入忽略名单的目录
- `addIgnoredFolder(folderPath, note?)`：把目录加入忽略名单，下次扫描不会再创建图集
- `updateIgnoredFolder(id, patch)`：更新忽略记录（当前主要是修改 `note`）
- `removeIgnoredFolder(id)`：从忽略名单中移除（允许下次扫描再次创建）

忽略名单存储在 `gallery_ignored_folders` 表；`deleteGallery` 会自动把被删图集的全部绑定文件夹追加进来。消费语义：`planScanFolder` 对候选路径做精确匹配跳过（不重建图集）；扫描/同步链路（`scanFolderIntoGallery`）对严格位于扫描目标内部的条目整棵剪枝——磁盘扫描不深入、库中已有图片也不会被按前缀收编，父级文件夹重扫不会复活已拉黑子树；`bindFolder` 显式绑定成功后移除该路径的精确条目（显式意图优先）。

### 最近图片游标查询

`getRecentImagesAfter(updatedAt, id, limit?, beforeUpdatedAt?, beforeId?)` 的游标语义是：

- 返回满足 `(image.updatedAt > updatedAt) || (image.updatedAt === updatedAt && image.id > id)` 的图片。
- 如果传入 `beforeUpdatedAt + beforeId`，还会限制结果必须排在该 before 游标之后，也就是 `(image.updatedAt < beforeUpdatedAt) || (image.updatedAt === beforeUpdatedAt && image.id < beforeId)`。
- 默认排序必须和最近图片主列表一致：`updatedAt DESC, id DESC`。
- 调用方应传当前最近图片页顶部第一张图片的 `updatedAt` 与 `id`。
- 当返回数量等于 `limit` 时，调用方应使用本页最后一张图片作为 `before*` 游标继续查询，直到返回数量小于 `limit`，避免缓存期间新增超过一页时漏图。
- 该接口只用于“页面实例仍在缓存层中”的增量刷新；如果最近图片页已经卸载或缓存被释放，应重新调用 `getRecentImages(count)`。
- 渲染层要负责去重，避免新增块、待查看队列和原始最近列表中出现同一 `image.id`。

## `config`

面向配置读取、保存和配置事件。

> 注：本地图库不再走配置层，改由 `gallery` 域 CRUD（`createGallery` / `deleteGallery` / `updateGallery`）管理。

- `get()`：获取当前去敏 `RendererSafeAppConfig`
- `save(newConfig)`：保存配置
- `reload()`：重新加载配置
- `getNotifications()` / `setNotifications(patch)`：桌面通知分域读写
- `getDesktop()` / `setDesktop(patch)`：桌面行为分域读写
- `onConfigChanged(callback)`：监听配置变更，返回取消订阅函数
  - 回调签名：`(config: RendererSafeAppConfig, summary: ConfigChangedSummary) => void`
  - 主进程只广播摘要 `{ version, sections }`，preload 层在收到摘要后会自动重新调用 `config.get()` 拉取最新去敏配置并传入回调的第一个参数，**不会**通过事件通道下发敏感字段
  - `summary.sections` 给出受影响的路径集合（例如 `'network'`、`'ui.pagePreferences.favoriteTags'`），可用于按区块选择性更新 UI
  - `summary.version` 是单调递增的时间戳，异步订阅者可用来识别是否收到过期事件

### 通知与桌面行为的配置结构

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
- `appShell.get()` / `appShell.save(preferences)`：应用外壳偏好。字段：`menuOrder`（各级菜单排序）、`pinnedItems`（固定/保活页面，数量不限）、`quickAccessItems`（底部快捷访问入口）、`sidebarWidth`（侧边栏宽度）。`save` 为字段级合并，可只传变更字段

`GalleryPagePreferencesBySubTab.galleries` 中的排序字段分两类：`gallerySortKey` / `gallerySortOrder` 只用于图集列表排序；`gallerySort` / `galleryDetailSortOrder` 只用于已打开图集内的图片排序。两者不能复用同一个状态，否则图集列表排序会污染图片预览排序。

使用这些偏好时须同时参考 `doc/注意事项/导航缓存与页面偏好持久化.md`，避免"用户返回后被自动还原"这类交互 bug。

## `image`

面向本地图片扫描与缩略图。

- ~~`scanFolder(folderPath)`~~：**已停用**（同 `gallery.scanAndImportFolder`：绕过 `gallery_images` 成员模型；仅注释保留，零调用方。扫描入库请用 `gallery.planScanFolder` + `applyScanPlan`）
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

- `getFavorites(siteId, page?, limit?, groupId?, rating?)`：返回 `PaginatedResult<BooruPost>`，`rating` 取 `'safe' | 'questionable' | 'explicit' | 'all'`；调用方应优先使用 `items / total / page / limit` 展示总数和尾页，旧数组形态只作为兼容分支处理
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
- `cancelDownload(queueId)`：取消 / 删除单条下载任务；正在下载时会 abort 并清理 `.part` 临时文件，用户主动取消不会被错误分支覆盖为 `failed`

说明：下载队列相关 Renderer API 使用的 `postId` 均为站点原始帖子 ID；主进程内部入库时会先映射到 `booru_posts.id`，读取队列返回给渲染层时再映射回原始帖子 ID。

### 图片缓存与标签缓存

- `getCachedImageUrl(md5, extension)`
- `cacheImage(url, md5, extension)`
- `getCacheStats()`：只统计 Booru 原图缓存目录，不统计本地图库缩略图或数据库标签缓存
- `clearCache()`：只清理 Booru 原图缓存目录；标签缓存清理由 `cleanExpiredTags()` 负责
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
- `startFavoriteTagBulkDownload(favoriteTagId)`：基于收藏标签启动批量下载，返回 `{ taskId, sessionId, deduplicated? }`；会话创建后即返回，扫描 / dryRun 在后台继续；当检测到重复任务且已有存活会话时 `deduplicated` 为 `true`
- `startFavoritesBulkDownload(input)`：基于“我的收藏”当前过滤条件启动批量下载，`input` 包含 `{ siteId, groupId?, rating? }`；目标目录固定为当前下载目录下的站点收藏目录，主进程会跳过已下载 / 已存在文件，并确保目录对应本地图集存在
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

说明：一步到位的旧 `importFavoriteTags()` / `importBlacklistedTags()` 已被移除，统一改成两段式以支持预览再确认。

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
- `startSession(sessionId)`：返回值可能带 `queued: true`，表示会话已进入等待队列而非立即占用运行槽位
- `pauseSession(sessionId)`
- `cancelSession(sessionId)`
- `deleteSession(sessionId)`
- `getSessionStats(sessionId)`
- `getRecords(sessionId, status?, page?, autoFix?)`
- `retryAllFailed(sessionId)`：同 taskId 已有存活会话时可能返回 `merged: true`
- `retryFailedRecord(sessionId, recordUrl)`：同 taskId 已有存活会话时可能返回 `merged: true`
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
- `onSystemNavigate(callback)`：订阅主进程发来的系统导航事件（通知点击 / 托盘入口等），payload 为 `{ section, subKey, sessionId? }`
- `onAppEvent(callback)`：订阅主进程广播给一个或多个页面消费的应用内事件，返回取消订阅函数

### 事件订阅

- `onBulkDownloadRecordProgress(callback)`
- `onBulkDownloadRecordStatus(callback)`
- `onSystemNavigate(callback)`
- `onAppEvent(callback)`：订阅统一 `RendererAppEvent`，事件结构以 `src/shared/appEvents.ts` 为准。当前事件类型包括：
  - `bulk-download:sessions-changed`：批量下载会话创建、去重、状态变化、删除或重试合并
  - `bulk-download:tasks-changed`：批量下载任务创建、去重、更新或删除
  - `bulk-download:records-changed`：批量下载 record 创建、终态变化、pending reset、重试合并或删除
  - `favorite-tag-download:created`：收藏标签下载任务 / 会话创建完成
  - `favorite-tags:changed`：收藏标签、标签分组或下载绑定变更
  - `booru:post-favorite-changed`：本地帖子收藏新增、移除、修复或移动分组
  - `booru:post-server-favorite-changed`：服务端喜欢 / 取消喜欢 / 同步结果变化
  - `booru:blacklist-tags-changed`：黑名单新增、批量新增、导入、编辑、启停或删除
  - `booru:sites-changed`：站点新增、编辑、删除、active site 或认证状态变化
  - `booru:favorite-groups-changed`：收藏分组创建、更新、删除或收藏移动分组
  - `booru:saved-searches-changed`：保存搜索创建、更新或删除
  - `booru:search-history-changed`：搜索历史新增或清空
  - `booru:post-download-state-changed`：帖子下载状态入队、完成、失败、移除、清空或标记已下载
  - `booru:post-vote-changed`：帖子投票状态 / 分数变化
  - `booru:image-cache-cleared`：Booru 图片缓存清空
  - `gallery:images-imported`：图库扫描 / 同步导入新图片
  - `gallery:images-changed`：图库图片新增、删除、标签更新、无效化或批量导入
  - `gallery:galleries-changed`：图集创建、更新、删除、统计或封面变化
  - `gallery:invalid-images-changed`：无效图片上报、删除或清空
  - `gallery:ignored-folders-changed`：忽略文件夹新增、编辑或删除
  - `gallery:paths-relocated`：重定位根目录（`applyRelocateRoot`）成功改写库内路径（改写行数 > 0 才发）。payload 只含统计（`affected` 各表列改写行数 + `totalCount`），不带本地路径。语义为**全量失效**（与 `app:data-restored` 同强度）：重定位不动 `updatedAt`，增量游标/按 id 补丁感知不到变化，常驻缓存的图库页据此整页重新初始化（图集列表、网格图片、「最近」游标、「文件夹丢失」标记）
  - `thumbnail:generated`：缩略图生成、缺失或失败状态变化
  - `config:changed`：配置 section 变更，旧 `config.onConfigChanged` 兼容通道仍保留
  - `app:data-restored`：备份导入恢复成功
  - `api-service:status-changed`：本地 API 服务运行状态变化

页面侧不要直接散写 `window.electronAPI.system.onAppEvent`，应通过 `useRendererAppEvent`、`useBooruDomainEvents` 或 `useGalleryDomainEvents` 消费；高频下载进度仍使用 `onBulkDownloadRecordProgress` / `onBulkDownloadRecordStatus` 专用通道。

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

### 列表查询与分页约定

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
- `system.onSystemNavigate`
- `system.onAppEvent`

## 说明与边界

- 这份文档描述的是 preload 暴露给渲染进程的 API，不等同于应用的全部功能面
- Google Drive、Google Photos、Gemini 等页面均通过 webview 嵌入对应 Google 网站，不依赖 preload API
- 因此”页面存在”不一定等于”有同名 `window.electronAPI` 域”

## 使用建议

- 想找“页面能不能调这个能力”，先看这里。
- 想找“这个能力在主进程哪处理”，再顺着 `src/preload/index.ts` / `src/preload/shared/*.ts` 的通道常量去看对应 handler。
- 想核对某个通道是否完整接上，不要只看 `src/main/ipc/channels.ts`，也要看 preload 暴露和 handler 实现。

## 相关文档

- `doc/架构总览.md`
- `doc/开发与配置指南.md`
- `doc/功能总览.md`
