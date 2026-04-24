# 页面内部事件与标签页问题修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复收藏标签页下载刷新串页、启动反馈过慢、搜索入口错误、自定义排序和分页布局问题，并移除最近图片页右侧旧时间刻度；同时补齐一个主进程到页面/子窗口可消费的内部事件通道。

**Architecture:** 新增一个轻量 renderer event bus，由主进程服务在关键数据变化后广播 typed event，preload 通过现有 `system` 域暴露订阅能力，主窗口页面和子窗口都能消费。收藏标签启动下载拆成“创建任务/会话后立即返回 + 后台启动 dryRun/下载”，页面只响应当前查询上下文的刷新，避免旧异步结果写入新分页。

**Tech Stack:** Electron IPC, React 18, TypeScript, Ant Design, Vitest/jsdom.

---

## 已核对的当前实现

- `src/renderer/pages/FavoriteTagsPage.tsx:183-208` 的 `loadFavoriteTags` 依赖当前 `page/pageSize/sort/filter/keyword`，但 `triggerDownload` 在 `src/renderer/pages/FavoriteTagsPage.tsx:558-568` 等待 `startFavoriteTagBulkDownload` 返回后，继续调用点击时闭包里的 `loadFavoriteTags()`。用户点第 3 行后切到下一页时，旧请求会把旧页数据写回当前表格，这是“第三行覆盖”的直接根因。
- `src/main/services/booruService.ts:2397-2415` 在 `startFavoriteTagBulkDownload` 内 `await bulkDownloadService.startBulkDownloadSession(sessionId)`，而 `src/main/services/bulkDownloadService.ts:1220-1229` 里 `startBulkDownloadSession` 会同步等待 dryRun 扫描完成后才返回，所以“任务创建成功”提示被扫描阶段拖慢。
- 下载中心 `src/renderer/pages/BooruBulkDownloadPage.tsx:246-283` 已经采用“createSession 后立即刷新，startSession 放后台”的模式；收藏标签入口应该对齐这个既有模式。
- 当前跨页面事件只有散点式 IPC：`CONFIG_CHANGED`、`SYSTEM_NAVIGATE`、`BULK_DOWNLOAD_RECORD_*`。`src/preload/shared/createSystemApi.ts` 已经被主窗口和轻量子窗口共同复用，是新增内部事件订阅的最小改动位置。
- 标签搜索按钮调用 `FavoriteTagsPage.handleTagClick`，在主窗口中由 `App.tsx:559-561` 的 `navigateToTagSearch` 推入主导航栈；子窗口中 `SubWindowApp.tsx:61-64` 已有 `window.openTagSearch`。主窗口标签管理页应改为直接打开子窗口。
- 最近图片页的右侧时间节点来自 `ImageGrid.showTimeline`，最近图片分支在 `GalleryPage.tsx:1213-1215`、`1251-1253`、`1276-1278` 显式开启；图 2 对应的是 `ImageGrid.tsx:576-608` 的绝对定位 timeline。

## 文件结构

- Modify: `src/shared/types.ts`
  - 增加 renderer 内部事件 payload union 类型，或单独导出 `RendererAppEvent`。
- Create: `src/main/services/rendererEventBus.ts`
  - 封装向所有 BrowserWindow 广播内部事件的逻辑。
- Modify: `src/main/ipc/channels.ts`
  - 新增 `SYSTEM_APP_EVENT: 'system:app-event'`。
- Modify: `src/preload/shared/createSystemApi.ts`
  - 增加 `onAppEvent(callback)` 订阅。
- Modify: `src/preload/index.ts`
  - 补充 Window 类型声明。
- Modify: `src/main/services/booruService.ts`
  - 收藏标签下载创建任务/会话后立即返回，后台启动 session；发出下载会话创建事件。
- Modify: `src/main/services/bulkDownloadService.ts`
  - 会话创建/状态变更时广播下载会话变化事件，用于下载中心主动刷新。
- Modify: `src/main/services/galleryService.ts` and `src/main/services/imageService.ts`
  - 扫描/同步导入新图片后广播图片导入事件；最近图片页消费它后做增量刷新。
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx`
  - 加请求序号/当前查询 ref，阻止旧请求写入新分页；移除自定义排序 UI/DnD；分页居中；搜索按钮打开子窗口；下载成功只做本行乐观状态或受控刷新。
- Modify: `src/renderer/pages/BooruTagManagementPage.tsx` and `src/renderer/App.tsx`
  - 主窗口标签管理页传入 `window.electronAPI.window.openTagSearch`，而不是主导航栈跳转。
- Modify: `src/renderer/pages/BooruBulkDownloadPage.tsx`
  - 订阅内部事件，收到收藏标签创建的 bulk session 后主动 `loadSessions()` / `loadTasks()`。
- Modify: `src/renderer/pages/GalleryPage.tsx`
  - 最近图片页订阅图片导入事件，活跃/缓存恢复时执行已有 `getRecentImagesAfter` 增量路径；关闭最近图片 timeline。
- Modify: `src/renderer/components/ImageGrid.tsx`
  - 若彻底不用右侧时间刻度，删除 timeline 相关 prop/渲染；若其它页面仍需保留，只让最近图片不传 `showTimeline`。
- Modify: `doc/Renderer API 文档.md`, `doc/开发与配置指南.md`, `doc/图库功能文档.md`, `doc/注意事项/下载与批量会话状态机.md`
  - 同步记录内部事件通道和收藏标签启动反馈语义。

## Task 1: 加内部页面事件通道

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/shared/types.ts`
- Create: `src/main/services/rendererEventBus.ts`
- Modify: `src/preload/shared/createSystemApi.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/preload/subwindow-exposure.test.ts`
- Test: `tests/main/services/rendererEventBus.test.ts`

- [ ] **Step 1: 写类型和通道测试**
  - 增加测试断言 `system.onAppEvent` 在主 preload 和 subwindow preload 都存在。
  - 增加主进程广播测试：只向未 destroyed 的窗口发送 `SYSTEM_APP_EVENT`，payload 保持原样。

- [ ] **Step 2: 定义事件 union**
  - 推荐事件名：
    - `bulk-download:sessions-changed`
    - `favorite-tag-download:created`
    - `gallery:images-imported`
    - `favorite-tags:changed`
  - payload 必须带 `type`, `version`, `occurredAt`, `source`，领域字段放 `payload`。

- [ ] **Step 3: 实现广播服务**
  - `emitRendererAppEvent(event)` 内部用 `BrowserWindow.getAllWindows()`，跳过 destroyed window。
  - 日志前缀使用 `[rendererEventBus]`。

- [ ] **Step 4: preload 暴露**
  - 在 `createSystemApi` 增加 `onAppEvent(callback)`，返回 unsubscribe。
  - 在 `Window.electronAPI.system` 类型声明补齐签名。

- [ ] **Step 5: 运行验证**
  - `npm run test -- tests/preload/subwindow-exposure.test.ts tests/main/services/rendererEventBus.test.ts`

## Task 2: 收藏标签下载创建立即反馈，且不串页刷新

**Files:**
- Modify: `src/main/services/booruService.ts`
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx`
- Test: `tests/main/services/booruService.favoriteTagRedownload.test.ts`
- Test: `tests/renderer/pages/FavoriteTagsPage.render.test.tsx`
- Test: `doc/注意事项/下载与批量会话状态机.md`

- [ ] **Step 1: 写服务层回归测试**
  - mock `bulkDownloadService.startBulkDownloadSession` 为可控 promise。
  - 调用 `startFavoriteTagBulkDownload(1)` 后应在 start promise 未 resolve 时就返回 `{ taskId, sessionId }`。
  - 验证 binding snapshot 已进入 `starting` 或 `queued/running` 前置状态。

- [ ] **Step 2: 改服务层启动语义**
  - 保留验证、建目录、建任务、建 session、写 origin、写 binding snapshot 的同步路径。
  - `startBulkDownloadSession(sessionId)` 放入后台 IIFE。
  - 后台成功后更新 binding runtime snapshot 并 emit `bulk-download:sessions-changed`。
  - 后台失败时写 `lastStatus: 'failed'` 并 emit 同一类事件。

- [ ] **Step 3: 写 UI 串页回归测试**
  - 第 1 页 mock 两次 `getFavoriteTagsWithDownloadState`。
  - 点击第 3 行下载后立即切第 2 页。
  - 旧下载请求 resolve 后，第 2 页表格仍只显示第 2 页数据。

- [ ] **Step 4: 改 UI 刷新保护**
  - 给 `loadFavoriteTags` 增加 `requestSeqRef` 和 `latestQueryRef`。
  - 发起请求时记录 query key，返回时只有 request id 仍最新且 query key 仍匹配才 `setFavoriteTags/setTotal`。
  - `triggerDownload` 成功后不要无条件调用旧闭包 `loadFavoriteTags()`；优先对当前可见行按 `favoriteTagId` 乐观写入 `downloadBinding.lastTaskId/lastSessionId/lastStatus='starting'`，再调一次“当前 ref 查询”的刷新。

- [ ] **Step 5: 文档同步**
  - 在下载状态机文档里注明收藏标签入口也遵循“session 创建即反馈，start/dryRun 后台执行”。

- [ ] **Step 6: 运行验证**
  - `npm run test -- tests/main/services/booruService.favoriteTagRedownload.test.ts tests/renderer/pages/FavoriteTagsPage.render.test.tsx`

## Task 3: 下载中心和最近图片页消费内部事件

**Files:**
- Modify: `src/main/services/bulkDownloadService.ts`
- Modify: `src/main/services/galleryService.ts`
- Modify: `src/main/services/imageService.ts`
- Modify: `src/renderer/pages/BooruBulkDownloadPage.tsx`
- Modify: `src/renderer/pages/GalleryPage.tsx`
- Test: `tests/renderer/pages/GalleryPage.test.tsx`
- Test: `tests/main/services/booruService.favoriteTagRedownload.test.ts`

- [ ] **Step 1: 服务 emit 点**
  - `createBulkDownloadSession` 创建或复用活跃 session 后 emit `bulk-download:sessions-changed`。
  - `updateBulkDownloadSession` 状态变化后 emit `bulk-download:sessions-changed`。
  - `scanAndImportFolder` 成功且 `imported > 0` 后 emit `gallery:images-imported`，payload 至少包含 `folderPath`, `imported`, `skipped`。
  - `syncGalleryFolder` 成功且 `imported > 0` 后 emit `gallery:images-imported`，payload 包含 `galleryId`, `folderPath`, `imported`, `imageCount`, `lastScannedAt`。

- [ ] **Step 2: 下载中心消费**
  - `BooruBulkDownloadPage` active 时订阅 `system.onAppEvent`。
  - 收到 `bulk-download:sessions-changed` 或 `favorite-tag-download:created` 时 debounce 100-250ms 后调用 `loadSessions()`；必要时调用 `loadTasks()`。

- [ ] **Step 3: 最近图片消费**
  - `GalleryPage` 在 `subTab === 'recent' && !suspended` 时订阅 `gallery:images-imported`。
  - 复用现有 `checkRecentImagesAfterCacheResume()` 或抽出 `refreshRecentImagesIncrementally(reason)`，避免完整重载。
  - 若页面不在顶部，保持现有 pending banner 行为。

- [ ] **Step 4: 运行验证**
  - `npm run test -- tests/renderer/pages/GalleryPage.test.tsx tests/renderer/pages/FavoriteTagsPage.render.test.tsx`

## Task 4: 标签管理页 UI 清理

**Files:**
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx`
- Modify: `src/main/services/config.ts`
- Modify: `src/shared/types.ts`
- Modify: `tests/renderer/pages/FavoriteTagsPage.component.contract.test.ts`
- Modify: `tests/main/services/config.test.ts`

- [ ] **Step 1: 移除无用自定义排序 UI**
  - 去掉 `@dnd-kit/*` imports、`SortableRow`、`DragHandle`、`DndContext`、`SortableContext`、`handleDragEnd`。
  - 去掉 `sortKey/sortOrder` 状态和工具栏里的两个排序控件。
  - 默认列表保持一个稳定排序，建议服务端固定 `tagName COLLATE NOCASE ASC` 或保留 `sortOrder ASC, createdAt DESC`，由产品确认。当前用户明确说“自定义排序无用”，计划倾向于删 UI，不做 DB 迁移。

- [ ] **Step 2: 清理偏好字段**
  - `FavoriteTagsPagePreference` 中移除或忽略 `sortKey/sortOrder`。
  - 配置读取保持兼容：老配置里有这两个字段也不报错；保存时不再写入。

- [ ] **Step 3: 分页居中**
  - Ant Table pagination 加 `position: ['bottomCenter']`。
  - 两个 table 分支应合并为一个普通 Table 后统一设置，避免重复。

- [ ] **Step 4: 测试**
  - contract test 不再期待排序按钮/DnD。
  - render test 验证分页配置或 DOM class 在底部居中。

- [ ] **Step 5: 运行验证**
  - `npm run test -- tests/renderer/pages/FavoriteTagsPage.component.contract.test.ts tests/renderer/pages/FavoriteTagsPage.render.test.tsx tests/main/services/config.test.ts`

## Task 5: 标签搜索按钮改为打开子窗口

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/pages/BooruTagManagementPage.tsx` if needed
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx`
- Test: `tests/renderer/pages/BooruTagManagementPage.test.tsx`
- Test: `tests/renderer/pages/FavoriteTagsPage.render.test.tsx`

- [ ] **Step 1: 写测试**
  - 主窗口下渲染 tag-management 时，FavoriteTagsPage 收到的 `onTagClick` 应调用 `window.electronAPI.window.openTagSearch(tag, siteId)`。
  - 点击收藏标签页搜索按钮后不应触发主导航栈 push 行为。

- [ ] **Step 2: 改主窗口传参**
  - 在 `App.tsx` 增加 `openTagSearchWindow` callback，内部调用 `window.electronAPI?.window?.openTagSearch(tag, siteId)`。
  - 仅 `key === 'tag-management'` 使用这个 callback；Booru 浏览页点击标签仍可保持主导航叠加搜索，除非后续统一改交互。

- [ ] **Step 3: 错误反馈**
  - `FavoriteTagsPage.handleTagClick` 若无 `onTagClick` 或 `openTagSearch` 调用失败，应 `message.error`。

- [ ] **Step 4: 运行验证**
  - `npm run test -- tests/renderer/pages/BooruTagManagementPage.test.tsx tests/renderer/pages/FavoriteTagsPage.render.test.tsx`

## Task 6: 最近图片页移除右侧时间节点

**Files:**
- Modify: `src/renderer/pages/GalleryPage.tsx`
- Optional Modify: `src/renderer/components/ImageGrid.tsx`
- Test: `tests/renderer/pages/GalleryPage.test.tsx`

- [ ] **Step 1: 写回归测试**
  - 渲染 `GalleryPage subTab="recent"` 后，不应出现右侧 timeline 的日期按钮。
  - 保留日期分组标题本身，不影响图片按天分段。

- [ ] **Step 2: 实现**
  - 最小改法：删除最近图片分支传给 `ImageListWrapper` 的 `showTimeline`。
  - 如果确认全项目不需要右侧时间刻度，再删除 `ImageGrid.showTimeline` prop 和渲染块。

- [ ] **Step 3: 运行验证**
  - `npm run test -- tests/renderer/pages/GalleryPage.test.tsx`

## Task 7: 集成验证和人工验收

**Files:**
- No direct code ownership.

- [ ] **Step 1: 全量测试**
  - Run: `npm run test`
  - Expected: 所有 Vitest 通过。

- [ ] **Step 2: 构建**
  - Run: `npm run build`
  - Expected: main/preload/renderer build 全部通过。

- [ ] **Step 3: 手动验证**
  - Run: `npm run dev`
  - 收藏标签第 1 页第 3 行点下载，立即切第 2 页；第 2 页不被第 1 页数据覆盖。
  - 下载提示应在创建 session 后快速出现，不等待 dryRun 扫描完成。
  - 下载中心在收藏标签启动下载后自动出现/刷新对应会话。
  - 图集同步导入新图片后，最近图片页活跃时出现新增提示或顶部增量块。
  - 标签管理页无自定义排序控件和拖拽把手，分页位于底部居中。
  - 收藏标签搜索按钮打开标签搜索子窗口。
  - 最近图片页右侧不再出现时间节点列表。

## 风险与边界

- 不建议用 renderer 本地事件总线替代主进程广播。收藏标签下载、图库扫描、批量会话变化的 source of truth 都在主进程，事件应由主进程发出，页面只消费。
- `startFavoriteTagBulkDownload` 改为快速返回后，后台启动失败必须仍写 binding snapshot 并发事件，否则页面会长期显示“启动中”。
- 图片导入事件不要携带完整图片数组，避免大批量扫描时 IPC payload 过大；最近图片页收到事件后用已有游标接口拉取。
- 删除标签页排序 UI 时不急着迁移 DB 的 `sortOrder` 字段。它可能仍服务历史导入/稳定排序，后续单独清理更安全。
- 轻量子窗口当前只暴露 `window / booru / booruPreferences / system`。把事件订阅放在 `system` 域可避免扩大子窗口域数量。
