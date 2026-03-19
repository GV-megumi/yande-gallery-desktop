# TODO - Boorusama 功能对标清单

> 基于 Boorusama (Flutter) 参考项目与本项目的功能差距分析。
> 仅列出 Boorusama 已实现但本项目尚未实现的功能。
> 按优先级和实现难度分级。

---

## P0 - 高优先级（核心体验提升）

### ~~1. 多站点 API 完整对接~~ ✅ 已完成 (2026-03-10)
- **实现**: 统一 `IBooruClient` 接口 + 工厂模式分发
- **新增文件**: `booruClientInterface.ts`, `danbooruClient.ts`, `gelbooruClient.ts`, `booruClientFactory.ts`
- **重构**: handlers.ts 和 bulkDownloadService.ts 中 19 处 MoebooruClient 替换为工厂调用

### ~~2. 高级搜索语法~~ ✅ 已完成 (2026-03-10)
- **实现**:
  - Booru API 原生支持 `-tag` (NOT)、`~tag` (OR)、meta-tags (rating:、score:、order:) 等语法
  - 新增标签自动补全 IPC (`BOORU_AUTOCOMPLETE_TAGS`) —— 输入时从站点 API 实时搜索匹配标签
  - 搜索栏增加语法帮助弹窗 (`SearchSyntaxHelp`)，列出标签操作符、Meta-tags、组合示例
  - 自动补全支持操作符前缀（输入 `-blu` 会剥离 `-` 搜索 `blu` 并在选择后保留 `-` 前缀）
  - 标签自动补全显示标签类型（艺术家/版权/角色/通用）和帖子数量，按类型着色

### ~~3. 高级帖子过滤器~~ ✅ 已完成 (2026-03-10)
- **实现**:
  - 新增 `AdvancedFilterPanel` 组件，提供评分范围、宽度/高度范围、排序方式过滤
  - 过滤条件自动转换为 Booru meta-tags（如 `score:>=100` `width:>=1920` `order:score`）
  - 过滤按钮显示活跃条件数量，带 Popover 弹出面板
  - 过滤条件变更后自动重新搜索，支持与标签搜索组合使用

### ~~4. 标签详情页~~ ✅ 已完成 (2026-03-10)
- **实现**:
  - 增强 `BooruTagSearchPage`，在标签搜索页面顶部显示标签详情卡片
  - 展示标签名称、类型（艺术家/版权/角色/通用/元数据）、帖子数量
  - 标签类型使用彩色 Tag 标识，数据通过标签自动补全 API 获取
  - 显示相关标签推荐（从当前搜索结果高频标签中统计），点击可跳转搜索

### ~~5. 艺术家页面~~ ✅ 已完成 (2026-03-10)
- **实现**:
  - 新增 `BooruArtistData` 统一类型和 `getArtist()` 接口方法
  - Moebooru: `GET /artist.json?name=xxx` 获取艺术家信息（外部链接、别名）
  - Danbooru: `GET /artists.json?search[name]=xxx` + `/artists/{id}.json` 获取详情和 URLs
  - Gelbooru: 不支持艺术家 API（返回 null）
  - 新增 `BooruArtistPage.tsx`：展示艺术家外部链接（Pixiv/Twitter/FANBOX 等自动识别）、别名、社团，以及作品列表
  - 帖子详情页标签区域点击艺术家标签时自动导航到艺术家页面
  - 新增 IPC 通道 `booru:get-artist`

---

## P1 - 中优先级（功能增强）

### ~~6. 收藏夹分组~~ ✅ 已完成 (2026-03-12)
- **实现**:
  - 数据库新增 `booru_favorite_groups` 表，`booru_favorites` 表增加 `groupId` 字段
  - `booruService.ts` 实现分组 CRUD（创建/编辑/删除/移动收藏到分组）
  - `BooruFavoritesPage.tsx` 增加分组筛选栏（全部/未分组/各分组按钮）
  - 支持新建/编辑/删除分组，支持按分组筛选收藏列表

### ~~7. 保存的搜索 (Saved Searches)~~ ✅ 已完成 (2026-03-12)
- **实现**:
  - 数据库新增 `booru_saved_searches` 表
  - `booruService.ts` 实现 CRUD（创建/编辑/删除/列表查询）
  - 新建 `BooruSavedSearchesPage.tsx`，支持按站点筛选、新建/编辑/删除保存的搜索
  - 支持一键执行搜索（跳转到 BooruPage 并带入标签）

### ~~8. 帖子笔记/注释 (Notes)~~ ✅ 已完成 (2026-03-12)
- **实现**:
  - `IBooruClient` 接口新增 `getNotes()` 方法，Moebooru/Danbooru 实现，Gelbooru 返回空数组
  - IPC 通道 `booru:get-notes`，Preload API `booru.getNotes()`
  - 新建 `NotesOverlay.tsx` 组件：在图片上渲染注释框，坐标按原图像素转百分比定位
  - 鼠标悬停显示注释内容（支持 HTML 解析），可隐藏注释层

### ~~9. 幻灯片模式 (Slideshow)~~ ✅ 已完成 (2026-03-10)
- **实现**: 帖子详情页底部新增播放/暂停控制条，支持 2-15 秒间隔调节，自动循环播放

### ~~10. 视频帖子支持~~ ✅ 已完成 (2026-03-12)
- **实现**:
  - `BooruImageCard.tsx` 增加视频格式检测（MP4/WebM/MKV/MOV/AVI），视频帖子显示格式标签
  - `BooruPostDetailsPage.tsx` 增加 `<video>` 播放器（controls, loop），视频帖子不走图片缓存
  - 视频帖子预览使用缩略图，详情页直接播放原始视频 URL

### ~~11. 帖子版本历史~~ ✅ 已完成 (2026-03-12)
- **实现**:
  - `IBooruClient` 接口新增 `getPostVersions()` 方法（Danbooru 实现，其他返回空数组）
  - IPC 通道 `booru:get-post-versions`，Preload API `booru.getPostVersions()`
  - 新建 `PostHistorySection.tsx`：可展开/折叠的版本历史 Timeline
  - 展示标签增删（绿色/红色 Tag）、评级变更、来源变更，按版本号排列

### ~~12. 相关标签推荐~~ ✅ 已完成 (2026-03-10)
- **实现**: 搜索模式下从当前结果标签中统计高频标签（前 15 个），点击直接搜索

### ~~13. 随机帖子~~ ✅ 已完成 (2026-03-10)
- **实现**: BooruPage 工具栏新增闪电按钮，基于当前搜索条件附加 `order:random` 标签

---

## P2 - 低优先级（锦上添花）

### ~~14. Wiki 页面浏览~~ ✅ 已完成 (2026-03-18)
- **现状**: 已完成（支持基础 Wiki 浏览，当前优先支持 Danbooru）
- **目标**: 浏览 Booru 站点的 Wiki 页面（标签说明、使用指南等）
- **涉及文件**: `src/renderer/pages/BooruWikiPage.tsx`、`src/main/services/danbooruClient.ts`
- **Boorusama 参考**: `lib/core/wikis/`
- **工作量**: 中（已完成 MVP，后续可继续增强 DText/HTML 渲染）

### ~~15. 论坛浏览~~ ✅ 已完成 (2026-03-18)
- **现状**: 已完成（支持只读论坛浏览，当前仅 Danbooru）
- **目标**: 浏览 Booru 站点的论坛帖子和讨论
- **涉及文件**: `src/renderer/pages/BooruForumPage.tsx`、`src/main/services/danbooruClient.ts`
- **Boorusama 参考**: `lib/core/forums/`
- **工作量**: 中（已完成 MVP，当前仅 Danbooru）

### ~~16. 用户主页~~ ✅ 已完成 (2026-03-18)
- **现状**: 已完成（支持基础用户主页，当前优先支持 Danbooru）
- **目标**: 增加用户主页（上传列表、收藏列表、基本信息）
- **涉及文件**: `src/renderer/pages/BooruUserPage.tsx`、`src/main/services/danbooruClient.ts`
- **Boorusama 参考**: `lib/core/users/`
- **工作量**: 中（已完成 MVP，支持查看资料并跳转 `user:username` 上传搜索）

### 17. 角色页面（部分完成 / MVP）
- **现状**: 部分完成 / MVP（已有独立角色页面 `src/renderer/pages/BooruCharacterPage.tsx`，可浏览角色相关帖子）
- **目标**: 增加角色详情页（相关帖子、出处作品）
- **涉及文件**: `src/renderer/pages/BooruCharacterPage.tsx`
- **Boorusama 参考**: `lib/core/characters/`
- **工作量**: 小（后续补齐角色详情信息与出处作品）

### ~~18. 高级图片查看器~~ ✅ 已完成 (2026-03-15)
- **实现**:
  - `BooruPostDetailsPage.tsx` 增加旋转、水平/垂直翻转、重置和原图/对比图模式
  - 新增 `imageMetadataService.ts` + IPC `booru:get-image-metadata`，详情页可读取格式、色彩空间、DPI、方向与 EXIF 是否存在
  - 对比模式优先使用 sample/preview 资源，方便快速比较原图与较低质量预览

### ~~19. 多选批量操作~~ ✅ 已完成 (2026-03-15)
- **实现**:
  - `BooruPage.tsx` 增加多选模式、选择统计、批量收藏、批量下载和共同标签快速追加到当前搜索
  - `BooruGridLayout.tsx` / `BooruImageCard.tsx` 增加选择态与勾选框，保留原有预览/下载/收藏交互
  - 新增 `multiSelect.ts` 纯函数用于共同标签提取和选择状态切换

### ~~20. 分享功能~~ ✅ 已完成 (2026-03-15)
- **实现**:
  - 帖子详情工具栏支持复制帖子链接与复制原图链接
  - 统一复用系统外链能力打开目标站点页面

### ~~21. 备份与恢复~~ ✅ 已完成 (2026-03-15)
- **实现**:
  - 新增 `backupService.ts`，支持导出/导入站点配置、帖子缓存索引、收藏、标签、分组、保存的搜索和搜索历史
  - 主进程新增 `system:export-backup` / `system:import-backup`，支持合并恢复和完全替换恢复
  - `SettingsPage.tsx` 增加备份导出、合并恢复、完全替换恢复入口

### ~~22. 缓存管理界面~~ ✅ 已完成 (2026-03-15)
- **实现**:
  - `SettingsPage.tsx` 已增加缓存统计、缓存文件数展示和一键清理入口
  - 与 `imageCacheService.ts` 的缓存统计/清理接口联动

### ~~23. DText / BBCode 渲染~~ ✅ 已完成 (2026-03-15)
- **实现**:
  - 新增 `DTextRenderer.tsx`，统一处理 DText / BBCode 的基础富文本展示
  - `CommentSection.tsx` 根据站点类型分别启用 Danbooru DText 与 Moebooru BBCode 渲染
  - `BooruForumPage.tsx` 改为使用 DText 渲染论坛帖子正文

### ~~24. 帖子举报~~ ✅ 已完成 (2026-03-15)
- **实现**:
  - `Toolbar.tsx` 增加 Danbooru 专属“举报”入口，要求登录后提交原因
  - 新增 IPC `booru:report-post`，Danbooru 客户端对接 `/post_flags.json`
  - Moebooru / Gelbooru 保持显式不支持，避免误导用户

### ~~25. 标签别名与关联~~ ✅ 已完成 (2026-03-15)
- **实现**:
  - Danbooru 客户端新增标签别名与关联查询，使用 `/tag_aliases.json` 与 `/tag_implications.json`
  - `BooruTagSearchPage.tsx` 展示别名展开结果和关联标签，并在搜索时自动使用 canonical tag
  - 新增 `tagRelationships.ts` 纯函数，封装 canonical tag 解析与 implication 提取逻辑

---

## P3 - 未来规划

### 26. 自动标签 (AI)
- 使用本地模型或 API 自动为图片生成标签
- 辅助本地图库的标签管理

### 27. 数据统计面板
- 本地图库统计（标签分布、文件格式、大小分布）
- 下载统计（按站点、按日期、按标签）
- **Boorusama 参考**: `lib/core/statistics/`

---

## 实现建议

### 开发顺序建议
1. ~~**先完成 P0**: 多站点 API -> 高级搜索语法 -> 高级过滤器 -> 标签详情页 -> 艺术家页面~~ ✅ 全部完成
2. ~~**再做 P1 中的小任务**: 随机帖子、幻灯片、相关标签推荐~~ ✅ 全部完成
3. ~~**然后做 P1 中的中等任务**: 收藏分组、保存的搜索、视频支持、帖子笔记、版本历史~~ ✅ 全部完成
4. **P2 按需实现**: 根据使用频率决定优先级

### 架构建议
- 多站点 API 应采用策略模式（Strategy Pattern），为每种 Booru 类型定义统一接口
- 新增页面复用现有组件（`BooruImageCard`、`BooruGridLayout`、`PaginationControl`）
- 数据库表结构变更需要写迁移脚本（ALTER TABLE），不能直接修改 CREATE TABLE

---

## 已实现功能对照（无需重复开发）

以下 Boorusama 功能本项目**已实现**，仅供参考：

| 功能 | Boorusama | 本项目 |
|------|-----------|--------|
| 多站点配置 | 16 种 | 3 种（Moebooru + Danbooru + Gelbooru 完整实现） |
| 帖子搜索 | tag + meta-tag | tag 搜索 |
| 随机帖子 | 有 | 有（order:random） |
| 幻灯片 | 有 | 有（2-15 秒可调） |
| 相关标签推荐 | 有 | 有（搜索结果高频标签） |
| 标签自动补全 | 有 | 有 |
| 搜索历史 | 有 | 有 |
| 帖子详情页 | 有 | 有（含标签分类、文件信息、相关帖子） |
| 热门帖子 | 有 | 有（日/周/月） |
| Pools 浏览 | 有 | 有 |
| 收藏系统 | 本地 + 服务端 | 本地 + 服务端 |
| 收藏标签 | 有 | 有（含分组标签） |
| 黑名单标签 | 有 | 有（含启用/禁用） |
| 标签导入导出 | 有 | 有 |
| 评论系统 | 有 | 有（查看 + 发表） |
| 投票 | 有 | 有 |
| 登录认证 | 有 | 有（SHA1 哈希） |
| 单张下载 | 有 | 有 |
| 批量下载 | 有 | 有（任务模板 + 会话管理） |
| 下载队列管理 | 有 | 有（暂停/恢复/重试） |
| 文件名模板 | 有 | 有 |
| 代理设置 | 有 | 有 |
| 深色模式 | 有 | 有 |
| 多语言 | 有 | 有（中/英） |
| 快捷键 | 有 | 有 |
| 图片缓存 | 有 | 有 |
| 缩略图系统 | 有 | 有（WebP） |

---

*最后更新: 2026-03-18*
*基于 Boorusama commit: master 分支*
