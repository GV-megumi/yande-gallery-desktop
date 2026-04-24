# 页面事件通道与标签页缺陷修复详细任务规划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复收藏标签下载串页刷新、下载创建反馈慢、标签页无用排序、分页位置、标签搜索入口、最近图片旧时间轴问题，并建立主进程到主页面/子页面可消费的内部事件通道。

**Architecture:** 以主进程为事件事实源，新增 `system.onAppEvent` 订阅。主进程 service 在下载、收藏标签、图库扫描等数据变化后发轻量 typed event；renderer 页面收到事件后只做 debounce 刷新或游标增量查询，不把事件当完整状态。收藏标签下载改成“创建 task/session 后立即返回，dryRun/下载后台启动”。

**Tech Stack:** Electron IPC, React 18, TypeScript, Ant Design, Vitest/jsdom.

---

## 0. 已确认的根因

1. `FavoriteTagsPage.triggerDownload` 等 `startFavoriteTagBulkDownload` 返回后调用点击时闭包里的 `loadFavoriteTags()`。用户点击第 1 页第 3 行后立刻翻页，旧闭包请求返回会把第 1 页数据写入当前第 2 页表格。
2. `booruService.startFavoriteTagBulkDownload` 同步 `await bulkDownloadService.startBulkDownloadSession(sessionId)`；而 `startBulkDownloadSession` 会跑 dryRun/扫描，所以“任务创建成功”提示实际被 dryRun 完成时间拖慢。
3. 当前项目只有散点事件：`CONFIG_CHANGED`、`SYSTEM_NAVIGATE`、`BULK_DOWNLOAD_RECORD_*`、`BOORU_DOWNLOAD_*`。缺少领域级“数据已变化，请页面自行刷新”的内部事件。
4. 标签管理页的标签搜索按钮在主窗口走 `App.navigateToTagSearch`，会在主窗口导航栈打开搜索页；需求是打开已经存在的 tag-search 子窗口。
5. 最近图片右侧日期列表来自 `ImageGrid.showTimeline`，最近图片分支显式传了 `showTimeline`。

## 1. 内部事件总原则

- 事件必须由主进程发出。下载、扫描、图库、收藏标签的 source of truth 在 main service / DB。
- 事件只携带轻量事实，不携带完整列表。页面收到事件后调用现有 API 拉最新数据。
- 事件是刷新提示，不是状态存储。最近图片页收到 `gallery:images-imported` 后仍走 `getRecentImagesAfter`。
- 订阅入口放在 `system.onAppEvent`，因为 `src/preload/shared/createSystemApi.ts` 同时用于主窗口和轻量子窗口。
- 事件消费者必须 debounce，推荐 100-250ms。
- 组件 inactive、suspended 或 unmount 时必须清理 timer 和 unsubscribe。
- 事件名和 payload 类型必须在 `src/shared/types.ts` 统一定义，不在页面散落裸字符串。

## 2. 事件 Envelope 规范

```ts
export type RendererAppEvent =
  | RendererBulkDownloadSessionsChangedEvent
  | RendererFavoriteTagDownloadCreatedEvent
  | RendererFavoriteTagsChangedEvent
  | RendererGalleryImagesImportedEvent
  | RendererGalleriesChangedEvent;

export interface RendererAppEventBase<TType extends string, TPayload> {
  type: TType;
  version: 1;
  occurredAt: string;
  source:
    | 'booruService'
    | 'bulkDownloadService'
    | 'galleryService'
    | 'imageService'
    | 'ipc';
  payload: TPayload;
}
```

审查要求：

- `occurredAt` 使用 `new Date().toISOString()`。
- `version` 首版固定为 `1`。
- `payload` 禁止放函数、Error 实例、Buffer、大数组、完整图片列表、完整配置对象。
- 无窗口时 emit 不抛错。
- destroyed window 必须跳过。

## 3. 事件清单与通知矩阵

### `bulk-download:sessions-changed`

**生产者：**

- `src/main/services/bulkDownloadService.ts`
- `src/main/services/booruService.ts` 的收藏标签后台启动分支可复用。

**触发时机：**

- `createBulkDownloadSession` 新建 session 成功。
- `createBulkDownloadSession` 命中活跃 session 去重并返回 existing session。
- `updateBulkDownloadSession` 发生 status 变化。
- pause / cancel / delete session 成功。
- retry all / retry one 拉起或合并 session。

**payload：**

```ts
{
  sessionId?: string;
  taskId?: string;
  siteId?: number | null;
  status?: BulkDownloadSessionStatus;
  previousStatus?: BulkDownloadSessionStatus | null;
  reason:
    | 'created'
    | 'deduplicated'
    | 'statusChanged'
    | 'deleted'
    | 'retryStarted'
    | 'retryMerged';
  originType?: 'favoriteTag' | 'manual' | null;
  originId?: number | null;
}
```

**消费者：**

- `BooruBulkDownloadPage`：debounce 后 `loadSessions()`；`reason === 'created'` 或 `originType === 'favoriteTag'` 时可同时 `loadTasks()`。

**不通知：**

- 单文件 record progress 不发这个事件，继续用已有 `BULK_DOWNLOAD_RECORD_PROGRESS`。
- 纯字节进度不触发 session list 刷新。

### `favorite-tag-download:created`

**生产者：**

- `src/main/services/booruService.ts::startFavoriteTagBulkDownload`

**触发时机：**

- 收藏标签下载成功创建或复用 task，并成功创建或复用 session 后立即触发。
- 必须发生在后台 `startBulkDownloadSession` 等待 dryRun 之前。

**payload：**

```ts
{
  favoriteTagId: number;
  tagName: string;
  siteId: number;
  taskId: string;
  sessionId: string;
  deduplicated?: boolean;
  status: 'starting' | 'pending' | 'queued' | 'dryRun' | 'running';
}
```

**消费者：**

- `FavoriteTagsPage`：如果当前页包含该 id，乐观更新该行状态，再受控刷新当前 query。
- `BooruBulkDownloadPage`：刷新 session/task。

**审查重点：**

- 这是内部页面事件，不是桌面通知，不受 notifications 开关影响。
- 不要在这个事件里弹系统 Notification。

### `favorite-tags:changed`

**生产者：**

- `src/main/services/booruService.ts`

**触发时机：**

- `addFavoriteTag`
- `addFavoriteTagsBatch`
- `removeFavoriteTag`
- `removeFavoriteTagByName`
- `updateFavoriteTag`
- `importFavoriteTagsCommit`
- `upsertFavoriteTagDownloadBinding`
- `deleteFavoriteTagDownloadBinding`
- `addFavoriteTagLabel`
- `removeFavoriteTagLabel`

**payload：**

```ts
{
  action:
    | 'created'
    | 'batchCreated'
    | 'updated'
    | 'deleted'
    | 'imported'
    | 'bindingUpserted'
    | 'bindingDeleted'
    | 'labelCreated'
    | 'labelDeleted';
  favoriteTagId?: number;
  siteId?: number | null;
  tagName?: string;
  affectedCount?: number;
}
```

**消费者：**

- `FavoriteTagsPage`：active 时 debounce 后受控刷新当前 query。
- secondary-menu 子窗口里的标签管理页同样可消费，因为它用主 preload。

**不通知：**

- 保存页面偏好不发该事件，继续用 `CONFIG_CHANGED`。

### `gallery:images-imported`

**生产者：**

- `src/main/services/imageService.ts::scanAndImportFolder`
- `src/main/services/galleryService.ts::syncGalleryFolder`
- `src/main/services/galleryService.ts::scanSubfoldersAndCreateGalleries`

**触发时机：**

- 扫描/同步成功且 `imported > 0`。
- 如果上层批量扫描多个目录，允许底层每个目录 emit，页面用 debounce 合并刷新。

**payload：**

```ts
{
  folderPath: string;
  galleryId?: number;
  imported: number;
  skipped: number;
  recursive?: boolean;
  imageCount?: number;
  lastScannedAt?: string;
  reason: 'scanAndImportFolder' | 'syncGalleryFolder' | 'scanSubfolders';
}
```

**消费者：**

- `GalleryPage` recent 子页：active 且未 suspended 时 debounce 后执行已有游标增量刷新。

**不通知：**

- `imported === 0` 不发。
- 缩略图生成完成不发。

### `gallery:galleries-changed`

**生产者：**

- `src/main/services/galleryService.ts`

**触发时机：**

- `createGallery`
- `updateGallery`
- `deleteGallery`
- `scanSubfoldersAndCreateGalleries` 创建新图集
- `syncGalleryFolder` 更新统计
- `updateGalleryStats`

**payload：**

```ts
{
  galleryId?: number;
  action:
    | 'created'
    | 'updated'
    | 'deleted'
    | 'statsUpdated'
    | 'batchCreated';
  affectedCount?: number;
  folderPath?: string;
}
```

**消费者：**

- `GalleryPage` galleries 子页：active 时刷新图集列表或当前详情。
- 本轮以定义和关键 emit 为主，如实现范围要收敛，消费端可作为二阶段。

## 4. 不新增事件的场景

- 配置变化：继续用 `CONFIG_CHANGED`。
- 主进程要求页面导航：继续用 `SYSTEM_NAVIGATE`。
- Booru 单图下载：继续用 `BOORU_DOWNLOAD_PROGRESS`、`BOORU_DOWNLOAD_STATUS`、`BOORU_DOWNLOAD_QUEUE_STATUS`。
- 批量下载 record 进度：继续用 `BULK_DOWNLOAD_RECORD_PROGRESS`、`BULK_DOWNLOAD_RECORD_STATUS`。

## 5. 文件变更任务

### Task 1: 新增内部事件通道

**Files:**

- Modify: `src/main/ipc/channels.ts`
- Modify: `src/shared/types.ts`
- Create: `src/main/services/rendererEventBus.ts`
- Modify: `src/preload/shared/createSystemApi.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/main/services/rendererEventBus.test.ts`
- Test: `tests/preload/subwindow-exposure.test.ts`
- Test: `tests/shared/types.test.ts`

- [ ] Add `SYSTEM_APP_EVENT: 'system:app-event'`.
- [ ] Add `RendererAppEvent` union and every event payload type.
- [ ] Implement `emitRendererAppEvent(event)`.
- [ ] In `createSystemApi`, expose `onAppEvent(callback)` and return unsubscribe.
- [ ] Update global `Window.electronAPI.system` type.
- [ ] Add tests for main preload and subwindow preload exposure.
- [ ] Add tests that destroyed windows are skipped and no-window emit does not throw.

### Task 2: 收藏标签下载快速返回

**Files:**

- Modify: `src/main/services/booruService.ts`
- Test: `tests/main/services/booruService.favoriteTagRedownload.test.ts`
- Test: `tests/main/ipc/handlers.favoriteTagDownload.test.ts`
- Doc: `doc/注意事项/下载与批量会话状态机.md`

- [ ] Keep validation, mkdir, task creation, session creation, origin write, binding snapshot write in the synchronous path.
- [ ] Move `startBulkDownloadSession(sessionId)` into background IIFE.
- [ ] Return `{ taskId, sessionId, deduplicated? }` immediately after session creation.
- [ ] Emit `favorite-tag-download:created`.
- [ ] Emit or rely on `bulk-download:sessions-changed` after session changes.
- [ ] On background success, update binding snapshot from runtime progress.
- [ ] On background failure, write `lastStatus: 'failed'` and emit session changed.
- [ ] Test that return happens before mocked start promise resolves.
- [ ] Test background failure updates snapshot.
- [ ] Test deduplicated active session still returns fast and does not double start.

### Task 3: 收藏标签页防串页刷新

**Files:**

- Modify: `src/renderer/pages/FavoriteTagsPage.tsx`
- Test: `tests/renderer/pages/FavoriteTagsPage.render.test.tsx`

- [ ] Add `requestSeqRef`.
- [ ] Add `latestQueryKeyRef` generated from `filterSiteId`, `debouncedKeyword`, `page`, `pageSize`.
- [ ] Update `loadFavoriteTags` so only latest matching request can call `setFavoriteTags` and `setTotal`.
- [ ] After download success, do not call stale closure `loadFavoriteTags()`.
- [ ] Optimistically update current visible row by `favoriteTagId`.
- [ ] Trigger a current-query refresh through a stable helper using refs.
- [ ] Subscribe to `favorite-tag-download:created` and `favorite-tags:changed` only when active.
- [ ] Test click row 3, turn page, then resolve old request; page 2 remains intact.
- [ ] Test inactive page does not refresh on event.

### Task 4: 下载中心消费事件

**Files:**

- Modify: `src/renderer/pages/BooruBulkDownloadPage.tsx`
- Test: `tests/renderer/pages/BooruBulkDownloadPage.test.tsx`

- [ ] Subscribe to `system.onAppEvent` when active.
- [ ] On `bulk-download:sessions-changed`, debounce `loadSessions()`.
- [ ] On `favorite-tag-download:created`, debounce `loadSessions()` and `loadTasks()`.
- [ ] Cleanup debounce timer and unsubscribe on inactive/unmount.
- [ ] Test high-frequency events only refresh once after debounce.
- [ ] Test inactive page ignores events.

### Task 5: 最近图片页消费图库导入事件

**Files:**

- Modify: `src/renderer/pages/GalleryPage.tsx`
- Modify: `src/main/services/imageService.ts`
- Modify: `src/main/services/galleryService.ts`
- Test: `tests/renderer/pages/GalleryPage.test.tsx`
- Test: `tests/main/services/imageService.test.ts`
- Test: `tests/main/services/galleryService.test.ts`

- [ ] Emit `gallery:images-imported` from `scanAndImportFolder` when `imported > 0`.
- [ ] Emit `gallery:images-imported` from `syncGalleryFolder` when `imported > 0`.
- [ ] Do not emit when `imported === 0`.
- [ ] In `GalleryPage` recent active state, debounce event and call incremental refresh.
- [ ] Reuse existing `getRecentImagesAfter` logic; do not full reload on event.
- [ ] If scroll is near top, merge new images to top.
- [ ] If not near top, add to pending banner.
- [ ] Test event path calls `getRecentImagesAfter`, not `getRecentImages(2000)`.
- [ ] Test suspended page does not refresh immediately.

### Task 6: 标签页 UI 清理

**Files:**

- Modify: `src/renderer/pages/FavoriteTagsPage.tsx`
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/config.ts`
- Test: `tests/renderer/pages/FavoriteTagsPage.component.contract.test.ts`
- Test: `tests/renderer/pages/FavoriteTagsPage.render.test.tsx`
- Test: `tests/main/services/config.test.ts`

- [ ] Remove `@dnd-kit/*` imports.
- [ ] Remove `SortableRow`, `DragHandle`, `handleDragEnd`, `DndContext`, `SortableContext`.
- [ ] Remove toolbar sort select and sort direction button.
- [ ] Stop saving `sortKey/sortOrder` in favoriteTags page preferences.
- [ ] Keep reading old config safely; old fields should not crash.
- [ ] Use one normal Ant Table branch.
- [ ] Set pagination `position: ['bottomCenter']`.
- [ ] Test no drag handle column.
- [ ] Test no custom sort controls.
- [ ] Test pagination is bottom center.

### Task 7: 标签搜索打开子窗口

**Files:**

- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx`
- Test: `tests/renderer/pages/BooruTagManagementPage.test.tsx`
- Test: `tests/renderer/pages/FavoriteTagsPage.render.test.tsx`

- [ ] Add `openTagSearchWindow` callback in `App.tsx`.
- [ ] For `key === 'tag-management'`, pass `openTagSearchWindow` into `BooruTagManagementPage`.
- [ ] Keep normal Booru browsing tag click behavior unchanged unless explicitly requested.
- [ ] In `FavoriteTagsPage.handleTagClick`, handle missing callback or rejected promise with `message.error`.
- [ ] Test search button calls `window.electronAPI.window.openTagSearch(tag, siteId)`.
- [ ] Test main navigation stack is not pushed by this button.

### Task 8: 最近图片页移除右侧时间节点

**Files:**

- Modify: `src/renderer/pages/GalleryPage.tsx`
- Optional Modify: `src/renderer/components/ImageGrid.tsx`
- Test: `tests/renderer/pages/GalleryPage.test.tsx`

- [ ] Remove `showTimeline` from recent loading/content/empty branches.
- [ ] Keep day group titles.
- [ ] If all pages no longer need timeline, remove `showTimeline` prop and render block from `ImageGrid`.
- [ ] Test recent page no longer renders timeline date buttons.
- [ ] Test group title remains visible.

### Task 9: 文档同步

**Files:**

- Modify: `doc/Renderer API 文档.md`
- Modify: `doc/开发与配置指南.md`
- Modify: `doc/图库功能文档.md`
- Modify: `doc/Booru功能实现文档.md`
- Modify: `doc/注意事项/下载与批量会话状态机.md`

- [ ] Document `system.onAppEvent(callback)` signature.
- [ ] Document event list and payload shape.
- [ ] Document that lightweight subwindows still expose only `window / booru / booruPreferences / system`.
- [ ] Document recent images event-triggered incremental refresh.
- [ ] Document favorite tag download quick feedback semantics.
- [ ] Do not document future/unimplemented behavior.

## 6. 必须新增或修改的测试清单

### Main service tests

- `tests/main/services/rendererEventBus.test.ts`
  - Sends to every live BrowserWindow.
  - Skips destroyed BrowserWindow.
  - Keeps payload unchanged.
  - No windows does not throw.

- `tests/main/services/booruService.favoriteTagRedownload.test.ts`
  - Fast return before start promise resolves.
  - Background success updates snapshot.
  - Background failure updates snapshot to failed.
  - Emits `favorite-tag-download:created`.
  - Deduplicated active session does not double start.

- `tests/main/services/bulkDownloadService.*.test.ts`
  - Session created emits `bulk-download:sessions-changed`.
  - Status change emits with previous and next status.
  - No status change does not emit.

- `tests/main/services/imageService.test.ts`
  - `scanAndImportFolder` imported > 0 emits `gallery:images-imported`.
  - imported = 0 does not emit.

- `tests/main/services/galleryService.test.ts`
  - `syncGalleryFolder` imported > 0 emits `gallery:images-imported`.
  - `createGallery/deleteGallery/updateGalleryStats` emit `gallery:galleries-changed`.

### Preload tests

- `tests/preload/subwindow-exposure.test.ts`
  - main preload system has `onAppEvent`.
  - subwindow preload system has `onAppEvent`.
  - unsubscribe removes `SYSTEM_APP_EVENT` listener.

### Renderer tests

- `tests/renderer/pages/FavoriteTagsPage.render.test.tsx`
  - Old download request cannot overwrite new page.
  - Download success message appears on fast API return.
  - Event updates only matching current visible row.
  - `favorite-tags:changed` refreshes active page.
  - inactive page ignores events.
  - no custom sort controls.
  - no DnD handle.
  - pagination bottom center.
  - search opens tag-search subwindow.

- `tests/renderer/pages/BooruBulkDownloadPage.test.tsx`
  - `bulk-download:sessions-changed` triggers debounced `getActiveSessions`.
  - `favorite-tag-download:created` triggers debounced `getActiveSessions` and `getTasks`.
  - inactive page ignores events.

- `tests/renderer/pages/GalleryPage.test.tsx`
  - `gallery:images-imported` calls `getRecentImagesAfter`.
  - It does not call full `getRecentImages(2000)`.
  - Top scroll merges new images.
  - Non-top scroll shows pending banner.
  - suspended page delays refresh.
  - no recent timeline date buttons.
  - day group title remains.

- `tests/renderer/pages/BooruTagManagementPage.test.tsx`
  - `FavoriteTagsPage` receives subwindow-opening tag click handler in main tag-management.

### Shared/contract tests

- `tests/shared/types.test.ts`
  - Each `RendererAppEvent` variant has `type/version/occurredAt/source/payload`.
  - Event type strings are unique.

- `tests/renderer/pages/FavoriteTagsPage.component.contract.test.ts`
  - Required columns still exist: bound gallery, download status, download progress, last download time, actions.
  - Removed expectations for DnD/sort controls.
  - Adds expectation for event subscription and `openTagSearch` path.

## 7. 代码审查规范要求

Review 必须检查：

- 跨进程边界：renderer 不直接访问主进程状态，不绕过 preload。
- 事件定义：事件名和 payload 类型统一在 shared types，不散落裸字符串。
- 事件粒度：session list、record progress、config changed、navigation 各走自己的通道。
- payload 大小：不广播完整图片列表、完整 session list、完整 favorite tag list。
- 刷新防抖：所有事件驱动刷新都有 debounce 和 cleanup。
- 旧请求保护：列表请求返回前验证 request id/query key。
- 快速反馈：收藏标签下载只等待 task/session 创建，不等待 dryRun。
- 失败可见：后台启动失败写 snapshot 并发事件。
- 子窗口安全：不要为轻量 tag-search 子窗口暴露 `db/gallery/config/bulkDownload`。
- 文档同步：preload API、事件列表、下载状态机、图库刷新语义必须同步文档。
- 提交规范：后续 commit message 描述部分用中文。

## 8. 手工验收路径

1. 收藏标签第 1 页第 3 行点击下载，立刻切到第 2 页。预期：第 2 页不被第 1 页数据覆盖。
2. 收藏标签点击下载后快速出现“任务创建成功”。预期：不等待 dryRun 扫描完成。
3. 下载中心 bulk tab 已打开时，从收藏标签启动下载。预期：下载中心自动出现新 session。
4. 下载中心页面 mounted 但不在当前 tab 时，切回后看到最新 session，且后台没有高频刷新。
5. 图集同步新增图片，最近图片页在顶部。预期：新增图片进入顶部增量块。
6. 图集同步新增图片，最近图片页不在顶部。预期：出现“新增 N 张，点击查看”。
7. 最近图片页右侧不再出现日期节点列表，正文日期分组标题仍在。
8. 标签管理页无拖拽把手、无排序 Select、无升降序按钮。
9. 标签管理页分页位于底部居中。
10. 收藏标签搜索按钮打开 tag-search 子窗口，不改变主窗口导航栈。
11. 轻量 tag-search 子窗口仍只暴露既定四个域；新增能力只在 `system.onAppEvent`。

## 9. 执行顺序

1. Task 1：事件通道和类型。
2. Task 2：收藏标签下载快速返回。
3. Task 3：收藏标签页防串页刷新。
4. Task 4：下载中心消费事件。
5. Task 5：最近图片消费图库事件。
6. Task 6、7、8：UI 清理和搜索子窗口。
7. Task 9：文档同步。
8. 最后运行 `npm run test` 和 `npm run build`。

每个任务完成后先跑对应 targeted tests。全部完成后再跑全量验证。
