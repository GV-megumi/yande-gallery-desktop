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

### 下载与缓存

- 单帖下载队列
- 批量下载任务 / 会话
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
