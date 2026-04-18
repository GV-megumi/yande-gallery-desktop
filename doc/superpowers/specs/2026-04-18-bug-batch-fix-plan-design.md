# 2026-04-18 根目录 13 份 Bug 文档的分批修复方案

## 背景

仓库根目录存在 13 份 bug 文档（`bug1.md`、`bug2.md`、`bug3.md`、`bug4.md`、`bug5.md`、`bug7.md`、`bug8.md`、`bug9.md`、`bug10.md`、`bug11.md`、`bug12.md`、`bug13.md`、`bug16.md`；bug6 / bug14 / bug15 文件缺失）。用户要求一次性把这 13 个 bug 全部修完，按 A / B / C 三档复杂度分批，**每条 bug 单独一个 PR**。本 spec 确定批次划分、顺序依赖、验证策略。

## 范围

- **修**：13 份 bug 文档中描述的问题 + 必要的修复收口（包含 bug1 的"原 bug"和"追加需求"合并修）。
- **不在本 spec 范围**：
  - 重写其它未提及的模块；
  - 重新设计持久化/IPC 架构（只对齐受影响部分）；
  - 补 bug6 / bug14 / bug15 对应的文档。

## 批次总览

### 批 A — 单点修复（5 个独立 PR，互不依赖）

| 序 | Bug | 关键修复 | 核心文件 |
|---|---|---|---|
| A1 | [bug13.md](../../../bug13.md) | `deleteImage` 去掉 `SELECT thumbnailPath`，改调 `thumbnailService.deleteThumbnail(filepath)` | `src/main/services/imageService.ts` |
| A2 | [bug16.md](../../../bug16.md) | `maxCacheSizeMB` 去掉 `max={5000}`，加 `rules:[{type:'integer',min:100}]` | `src/renderer/pages/BooruSettingsPage.tsx` |
| A3 | [bug3.md](../../../bug3.md) | 删除 `BulkDownloadSessionDetail` 顶部工具栏自绘 "关闭" 按钮 | `src/renderer/components/BulkDownloadSessionDetail.tsx` |
| A4 | [bug4.md](../../../bug4.md) | `FavoriteTagsPage` 下载目录表单改 "外层 label Form.Item + 内层 noStyle Form.Item 包 Input" 模式 | `src/renderer/pages/FavoriteTagsPage.tsx` |
| A5 | [bug2.md](../../../bug2.md) | `handleStartFromTask`：`createSession` 成功后立即 `loadSessions()`；`startSession` 放进后台 IIFE，成功再刷一次 | `src/renderer/pages/BooruBulkDownloadPage.tsx` |

**A 档合计 5 个 PR。** 内部任何顺序均可。唯一外部依赖：A1 必须在 C3（bug12）之前完成。

### 批 B — 功能闭环（4 个独立 PR，可并行）

| 序 | Bug | 关键修复 | 核心文件 |
|---|---|---|---|
| B1 | [bug5.md](../../../bug5.md) | `booruService.startFavoriteTagBulkDownload` 在 `deduplicated=true` 分支先查活跃会话，无活跃会话则 fallthrough 到创建+启动会话；`bulkDownloadService` 新增 `hasActiveSessionForTask(taskId)` | `src/main/services/booruService.ts`、`src/main/services/bulkDownloadService.ts` |
| B2 | [bug8.md](../../../bug8.md) | `downloadManager.handleDownloadError` 去掉 `isAbortError` 字符串匹配，只要 `userInterruptedStatuses` 有值就不覆盖 failed；新增 `cancelDownload(queueId)` + IPC `BOORU_CANCEL_DOWNLOAD` + preload 暴露 + 前端 "删除" 按钮（`pending` / `downloading` / `paused` 可删） | `src/main/services/downloadManager.ts`、`src/main/ipc/channels.ts`、`src/main/ipc/handlers.ts`、`src/preload/shared/createBooruApi.ts`、`src/preload/index.ts`、`src/renderer/pages/BooruDownloadPage.tsx` |
| B3 | [bug10.md](../../../bug10.md) | `GalleryPage` "返回" 按钮 onClick 改为 `await persistPreferences({ galleries: { ..., selectedGalleryId: null } })` 同步落盘；主进程 `pagePreferences.gallery.save` 语义对齐："字段为 null 视作删除" | `src/renderer/pages/GalleryPage.tsx`、`src/main/services/...`（preferences 合并逻辑） |
| B4 | [bug11.md](../../../bug11.md) | `WINDOW_OPEN_SECONDARY_MENU` handler 第四参数 `extra?: Record<string,string\|number>`；preload 同步；`SubWindowApp` 取出 `galleryId` 透传；`GalleryPage` 新增 `initialGalleryId` prop + `disablePreferencesPersistence` prop（子窗口不回写）；右键菜单加 "用单独窗口打开" | `src/main/ipc/channels.ts`（类型注释）、`src/main/window.ts`、`src/preload/shared/createWindowApi.ts`、`src/preload/index.ts`、`src/renderer/SubWindowApp.tsx`、`src/renderer/pages/GalleryPage.tsx` |

**B 档合计 4 个 PR。** 内部独立可并行，但 B3 / B4 都触及 `selectedGalleryId` 的持久化语义，建议同一个人前后做或提前对齐。

### 批 C — 系统性改造（4 个独立 PR，有强顺序）

**顺序**：C1 与 C2 互不依赖，可先后或并行；C3 只依赖 A1；C4 依赖 C1 + C2。推荐执行顺序 C1 → C2 → C3 → C4（线性），或 (C1‖C2‖C3) → C4（三线并行后汇聚），具体看人手。

| 序 | Bug | 关键修复 | 核心文件 |
|---|---|---|---|
| C1 | [bug1.md](../../../bug1.md) 原 bug + 追加需求 | ①一级菜单 `onSelect`：切完 section 后，若目标 section 的当前 subKey 命中 `pinnedItems` → 调 `handlePinnedClick` 恢复 pin；②引入 `mountedPageIds: Set<string>`（`${section}:${subKey}`）统一 pin 与基础页缓存；③渲染层 `App.tsx:1037-1075` 重构为单一 `.map(mountedPageIds)` 叠加层；④二级菜单切换：旧 subKey 若非 pin 则出集合，新 subKey 入集合；⑤外层 div `key` 去掉 `selectedKey` 依赖 | `src/renderer/App.tsx` |
| C2 | [bug7.md](../../../bug7.md) | ①`BulkDownloadSessionStatus` 加 `'queued'`；②`StatusTag.STATUS_PRESETS` 加映射；③`startBulkDownloadSession` 加并发闸门（默认 3，可配置）+ 内存 mutex；④`bulkDownloadService` 新增 `countActiveSessions` / `promoteNextQueued`；⑤所有离开 `dryRun`/`running` 的分支 finally 调 `promoteNextQueued`；⑥`init.ts` 启动恢复套同一闸门；⑦活跃会话过滤集合扩成 `pending\|queued\|dryRun\|running\|paused`；⑧`config.yaml` 加 `bulkDownload.maxConcurrentSessions` | `src/shared/types.ts`、`src/main/services/bulkDownloadService.ts`、`src/main/services/init.ts`、`src/main/services/config.ts`、`src/renderer/components/StatusTag.tsx`、`src/renderer/pages/BooruBulkDownloadPage.tsx` |
| C3 | [bug12.md](../../../bug12.md) | ①新表 `gallery_ignored_folders(id,folderPath UNIQUE,note,createdAt,updatedAt)` + 索引；②`deleteGallery` 事务内：查 `folderPath/recursive` → 遍历图片 `deleteThumbnail` → `DELETE images/image_tags/invalid_images/booru_posts.downloaded 清理` → `DELETE galleries` → `INSERT OR REPLACE gallery_ignored_folders`；③`scanSubfoldersAndCreateGalleries` 预加载忽略名单，命中则跳过（含整棵子树）；④新增 IPC `GALLERY_LIST/ADD/UPDATE/REMOVE_IGNORED_FOLDER` + handler + preload；⑤`SettingsPage` 文件夹分组底部加 "已忽略文件夹" 按钮；⑥新组件 `IgnoredFoldersModal.tsx` 做 CRUD；⑦删除图集文案明确 "同时忽略，不删磁盘原图" | `src/main/services/database.ts`、`src/main/services/galleryService.ts`、`src/main/services/thumbnailService.ts`、`src/main/ipc/channels.ts`、`src/main/ipc/handlers.ts`、`src/preload/index.ts`、`src/renderer/pages/SettingsPage.tsx`、`src/renderer/components/IgnoredFoldersModal.tsx`（新建） |
| C4 | [bug9.md](../../../bug9.md) | ①`config.yaml` 加 `notifications.{enabled,byStatus,singleDownload.enabled,clickAction}` 与 `desktop.{closeAction,autoLaunch,startMinimized}`；②新建 `notificationService.ts` 统一通知（全局 AND 类别 AND 任务级）；③`bulkDownloadService.showDesktopNotificationForSession` 改调 notificationService；④`downloadManager` 完成/失败分支补 notificationService 调用；⑤`Notification click` → IPC `system:navigate` → `App.tsx` 监听切 section+subKey；⑥`SettingsPage` 加两组：通知（开关 + Select + 单次下载开关）与桌面行为（Segmented closeAction + Switch autoLaunch + Switch startMinimized）；⑦`app.setLoginItemSettings` 对接 autoLaunch | `src/main/services/config.ts`、`src/main/services/notificationService.ts`（新建）、`src/main/services/bulkDownloadService.ts`、`src/main/services/downloadManager.ts`、`src/main/ipc/channels.ts`、`src/main/ipc/handlers.ts`、`src/main/window.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/App.tsx`、`src/renderer/pages/SettingsPage.tsx` |

**C 档合计 4 个 PR。**

## 依赖关系图

```
A1 ─────────────────────────> C3
A2, A3, A4, A5              (独立)

B1, B2, B3, B4              (独立)

C1 ──> C4
C2 ──> C4
C3 只依赖 A1
```

**关键依赖**：
- **A1 → C3**：`deleteGallery` 内部会按图逐张调 `deleteImage`；`deleteImage` 先修好才能级联清理。
- **C1 → C4**：通知点击跳转依赖一级菜单/pin 缓存恢复正确。
- **C2 → C4**：通知服务按会话状态机分派，`queued` 状态必须先就位。

## PR / commit 策略

- **总计 13 个 PR**（批 A 5 个 + 批 B 4 个 + 批 C 4 个），不合并。
- 每个 PR 对应一条 bug，分支命名 `fix/bugN-<slug>`（基于当前 `feat/refactor-todo-full`）。
- commit message 统一中文（CLAUDE.md §11），类型前缀保留英文：
  - A 档：`fix(bugN):`
  - B 档：`fix(bugN):` 或 `feat(bugN):`（B2/B4 有新功能）
  - C 档：`feat(bugN):` 或 `refactor(bugN):`
- PR 合并后**同步删除或归档对应 `bugN.md`**：推荐归档到 `doc/done/` 而不是直接删。

## 验证策略

每个 PR 合并前必须：

1. **自动化**：
   - `npm run test` 全量通过；
   - 为新增分支补单测（B1 `hasActiveSessionForTask`；B2 `handleDownloadError` 三分支；C1 `mountedPageIds` 切换；C2 并发闸门 + `promoteNextQueued`；C3 级联删除 + 忽略名单过滤；C4 通知 AND 三级组合）；
   - `npm run build` 不报 TS 错误。
2. **人工**：对照 `bugN.md` 中的 "复现步骤" 实跑一遍，确认 "实际行为" 已与 "预期行为" 一致。
3. **回归**：
   - A5、B1、B2、C2 同属 "批量下载" 模块，每次合完跑一遍 "新建任务→开始→暂停→取消→删除" 全链路；
   - B3、B4、C1 同属 "图库导航/缓存"，每次合完跑一遍 "一级菜单切换→二级菜单切换→图集打开/返回/子窗口打开"；
   - C4 合并后跑 TP-10 测试用例（`重构文档/测试用例/TP-10-*`）中 TC-001 / TC-007 / TC-008 / TC-009 / TC-012。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| C1 渲染层重构影响面大（App.tsx 500+ 行涉及 section 切换、pin、基础页、embed 页多层并存） | ①单独一个 PR；②补 `mountedPageIds` 相关单测；③人工回归覆盖所有一级/二级菜单切换路径；④embed 页（webview）先跳过新机制，保持原 absolute 层 |
| C2 `queued` 状态遗留 "死会话"（DB 是 queued 但无调度器推进） | ①启动时 `init.ts` 扫一遍 `queued`，全部按并发闸门重新进入；②所有从 active 离开的分支都在 finally 调 `promoteNextQueued`；③写集成测试模拟 "并发闸门打满 + 一个 complete → 下一个 queued 推进" |
| C3 删除图片+删缩略图非原子，中途失败半残 | 先删 DB 记录，再异步 best-effort 清磁盘；ENOENT 吞掉；失败记 warn 日志，下次由缓存管理清理任务兜底 |
| C4 通知服务与配置默认值不同步，用户升级后 "默认弹了一堆通知" 或 "一条也不弹" | `config.ts` 字段定义时给明确默认值（enabled:true、byStatus 全 true、singleDownload.enabled:false、clickAction:'openDownloadHub'）；读取时 `?? default` 兜底；Settings 页初次进入时若字段缺失先写一次默认值 |
| B3 / B4 / C1 对 `selectedGalleryId` 语义认知不一致 | 在 B3 的 commit 里把 "null=删除" 的合并语义写进 preferences 服务注释；B4 依赖该语义 + 新增 `disablePreferencesPersistence` 开关；C1 不再依赖该字段（mountedPageIds 统一管理） |
| A 档 5 个 PR 拆得太碎，review 疲劳 | 每个 PR 保持单文件/单目的，review 速度快；A 档合计预期 0.5–1 天完成，不会阻塞下游 |

## 时间估算

- 批 A：0.5–1 天（5 个 PR）
- 批 B：2–3 天（4 个 PR）
- 批 C：6–10 天（4 个 PR，C1/C4 较重）
- **总计：约 9–14 个工作日**

## 后续步骤

本 spec 通过后，进入 writing-plans 阶段：
1. 为 **每个 PR** 生成一份独立的实施计划（plan），放到 `doc/superpowers/plans/2026-04-18-bugN-*.md`。
2. 计划文件按 `executing-plans` 规格分步（read→design→implement→test→verify），每步留 review checkpoint。
3. 按 A → B → C 的批次顺序执行；批内按表格顺序或并行均可。
