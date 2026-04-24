# Booru 功能实现文档

## 文档定位

本文件描述当前仓库里的 Booru 子系统结构和能力范围，不再保留早期的功能规划性叙述。

## 当前支持的站点类型

- Moebooru
- Danbooru
- Gelbooru

统一接口定义在 `src/main/services/booruClientInterface.ts`，实际实例由 `src/main/services/booruClientFactory.ts` 分发。

## 主进程模块

### 站点客户端

- `moebooruClient.ts`
- `danbooruClient.ts`
- `gelbooruClient.ts`

### 业务服务

- `booruService.ts`：帖子、收藏、标签、搜索历史、保存的搜索、分组、黑名单等本地持久化
- `downloadManager.ts`：单帖下载队列
- `bulkDownloadService.ts`：批量下载任务与会话
- `imageCacheService.ts`：图片缓存与统计
- `backupService.ts`：导出/导入应用数据
- `imageMetadataService.ts`：帖子查看器元数据支持
- `updateService.ts`：GitHub Releases API 版本检查（带短时缓存，错误不缓存）

### IPC / Preload

- `src/main/ipc/channels.ts` 定义通道常量
- `src/preload/index.ts` 暴露 `window.electronAPI.booru.*`

## 渲染层页面

当前仓库中 Booru 相关页面至少包括：

- `BooruPage.tsx`
- `BooruPostDetailsPage.tsx`
- `BooruTagSearchPage.tsx`
- `BooruFavoritesPage.tsx`
- `BooruServerFavoritesPage.tsx`
- `BooruPopularPage.tsx`
- `BooruPoolsPage.tsx`
- `BooruArtistPage.tsx`
- `BooruCharacterPage.tsx`
- `BooruWikiPage.tsx`
- `BooruForumPage.tsx`
- `BooruUserPage.tsx`
- `BooruSavedSearchesPage.tsx`
- `BooruDownloadPage.tsx`
- `BooruBulkDownloadPage.tsx`
- `BooruSettingsPage.tsx`
- `BooruDownloadHubPage.tsx`（Hub：合并下载管理 + 批量下载）
- `BooruTagManagementPage.tsx`（Hub：合并收藏标签 + 黑名单）
- `FavoriteTagsPage.tsx`、`BlacklistedTagsPage.tsx`（由 Hub 页面内嵌）

### 页面合并与页内子导航

部分 Booru 二级菜单已合并为 Hub 页面，通过 Ant Design `Segmented` 组件提供页内 tab 切换：

- **下载中心**（`BooruDownloadHubPage`）：合并"下载管理"和"批量下载"两个 tab
- **标签管理**（`BooruTagManagementPage`）：合并"收藏标签"和"黑名单"两个 tab

Hub 页面同时挂载两个子页面，用 `display:none` 隐藏非活跃页，切换时保持各自状态。这些 Hub 页面也支持在子窗口中打开（通过 `window.openSecondaryMenu`）。

## 当前功能分层

### 浏览与搜索

- 基础帖子搜索
- 标签自动补全
- 高级搜索语法与高级过滤器
- 热门帖子、Pools、随机帖子、相关标签推荐

### 详情与扩展浏览

- 评论、注释覆盖层、版本历史
- 艺术家、角色、Wiki、论坛、用户主页
- 视频帖子支持
- 高级图片查看器（旋转、翻转、对比图、元数据）

### 收藏与组织

- 本地收藏
- 收藏夹分组
- 收藏标签、标签分组
- 黑名单标签
- 保存的搜索

说明：`getFavoriteTags` / `getFavoriteTagsWithDownloadState` / `getBlacklistedTags` 三个 list 接口统一迁移到 `ListQueryParams` → `PaginatedResult<T>` 契约，支持服务端分页和关键词搜索；导入流程拆成 `pickFile` + `commit` 两段式。具体签名见 `doc/Renderer API 文档.md` 的"列表查询与分页约定"章节和 preload 实现。

### 下载与缓存

- 单帖下载队列
- 单图下载 md5 校验：若 Booru post 返回了 `md5`，`downloadManager` 会在临时文件替换目标文件前校验一次，校验失败抛错让队列走失败分支。
- 批量下载任务 / 会话
- 批量下载并发闸门 + 等待队列：`bulkDownload.maxConcurrentSessions` 决定同一时刻允许的运行槽位数（只计 `dryRun` / `running`）；超限的 `startSession` 写入 `queued`，任何会话离开运行槽位后 `promoteNextQueued` 推进队首，进程重启恢复逻辑走同一闸门。配套的状态机约束见 `doc/注意事项/下载与批量会话状态机.md`。
- 批量下载会话去重与重试合并：同 taskId 同时只允许一个存活会话，历史会话重试遇到存活会话时返回 `merged` 语义，避免重复运行同一任务。
- 收藏标签下载绑定：为收藏标签配置下载路径和参数，一键创建批量下载任务；任务 / 会话创建成功后即提示并广播 `favorite-tag-download:created`，扫描和 dryRun 不阻塞按钮反馈
- 批量下载任务去重：按下载路径 + 标签集合去重，避免创建重复任务；复用任务模板时仍会创建新会话，不会被"模板已存在"阻止
- 下载中心监听 `bulk-download:sessions-changed` 和 `favorite-tag-download:created`，收藏标签页触发下载后下载中心会主动刷新。
- 图片缓存统计与清理
- 文件名模板系统
- 数据备份恢复

### 站点能力差异

- Danbooru 支持最完整，包含 DText、标签 alias / implication、举报、Wiki、论坛、用户页、版本历史等。
- Moebooru 支持艺术家、注释、热门等能力，但并不具备 Danbooru 的所有扩展接口。
- Gelbooru 当前更偏基础接入。

## 相关文档

- `doc/功能总览.md`
- `doc/数据库结构文档.md`
- `doc/注意事项/Moebooru开发规范.md`
- `doc/注意事项/API限流与安全约束.md`
- `doc/注意事项/网络访问与CORS解决方案.md`
