# Global Domain Events Sync Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `doc/Bug记录.md` Bug5 以及 `doc/全局领域事件与跨窗口状态同步缺陷审查.md` 记录的全局领域事件 / 跨窗口状态同步缺陷，并把领域事件能力沉淀成可复用模块。

**Architecture:** 新增共享事件契约模块、主进程发布器模块、renderer 订阅 hook 三层边界。所有数据库、配置、主进程内存服务或外部站点权威状态变更都在 service 层发布轻量领域事件，renderer 通过常驻订阅 hook 做局部 patch、标脏和必要 reload，API SSE 继续由 `rendererEventBus` 桥接。

**Tech Stack:** Electron IPC, React 18, TypeScript, Vitest/jsdom, existing `rendererEventBus`, existing API SSE `eventHub`.

---

## 0. 当前代码证据

- `src/shared/types.ts:536-658` 的 `RendererAppEvent` 当前只有 6 类事件：批量下载会话、收藏标签下载、收藏标签、图库导入、图库列表、缩略图。
- `src/main/services/rendererEventBus.ts:32-37` 已经把 `booru:` 前缀映射到 API SSE `booru` channel，但 union 里没有任何 `booru:*` 成员，`booru` SSE 频道实际空转。
- `src/main/services/booruService.ts:926`、`:984`、`:1122`、`:2802`、`:2833`、`:2871`、`:3074`、`:3107`、`:3140` 等 Booru 写入点成功后不发事件；API 路由 `src/main/api/routes/booruRoutes.ts:555-600` 也直调这些 service，因此修复必须落在 service 层。
- `src/renderer/hooks/useFavorite.ts:41-95`、`src/renderer/pages/BooruPage.tsx:65-84`、`src/renderer/hooks/useBooruPostActions.ts:143-219` 都维护局部 `Set`，没有消费全局收藏 / 喜欢事件。
- `src/renderer/pages/BooruPage.tsx:160-177` 只在站点变化时拉黑名单；`src/renderer/components/BooruPostDetails/TagsSection.tsx:115-172` 只在 site 变化时重拉收藏标签 / 黑名单，跨窗口变更不会同步。
- `src/preload/subwindow-index.ts:30` 暴露了 `system.onAppEvent`，但 `BooruTagSearchPage`、`BooruArtistPage`、`BooruCharacterPage` 没有订阅事件。
- `src/main/services/imageService.ts:265`、`:305`、`src/main/services/invalidImageService.ts:13`、`:140`、`:170`、`src/main/services/galleryService.ts:454`、`:795`、`:828`、`:853` 等 Gallery 写入点缺事件。
- `src/main/ipc/handlers/configHandlers.ts:49-59` 直接广播旧 `config:changed` IPC，未进入 `RendererAppEvent` 和 API SSE；`src/renderer` 对 `config.onConfigChanged` 零消费。
- `src/main/services/bulkDownloadService.ts` 只有 session 事件；task CRUD、record 终态 / pending reset / retry merge 没有统一失效事件。

## 1. 非目标

- 不把高频字节级进度强行塞进 `RendererAppEvent`。`BOORU_DOWNLOAD_*`、`BULK_DOWNLOAD_RECORD_PROGRESS` 这类高频 raw 通道可保留；只把 queued/completed/failed/removed/reset 等业务事实进总线。
- 不为局部 UI 状态建领域事件，例如弹窗开关、hover、搜索输入草稿、当前详情展开态。
- 不在本计划中引入 Redux/Zustand/React Query。当前缺陷核心是主进程权威状态的跨窗口失效通知，先用现有 IPC + hook 模型修复。
- 不改变外部站点 API 语义。API route 的 like 目前只改本地 `isLiked`、IPC serverFavorite 会调用外部站点，这个语义差异单独记录，不在本轮扩大。

## 2. 文件结构

- Create: `src/shared/appEvents.ts`
  - 负责所有 `RendererAppEvent` payload、union、source、API channel 映射、API-safe DTO 类型。
- Modify: `src/shared/types.ts`
  - 从 `appEvents.ts` re-export 事件类型，删除原地事件定义，保持已有导入路径兼容。
- Create: `src/main/services/appEventPublisher.ts`
  - 负责主进程领域事件发布 helper，例如 `emitBooruPostFavoriteChanged`、`emitGalleryImagesChanged`、`emitConfigChanged`。
- Modify: `src/main/services/rendererEventBus.ts`
  - 使用 `API_EVENT_CHANNEL_BY_TYPE` 显式映射，`toApiSafeRendererAppEvent` 返回 `ApiSafeRendererAppEvent`。
- Create: `src/renderer/hooks/useRendererAppEvent.ts`
  - 封装常驻订阅、最新 callback ref、类型过滤、active/dirty gating。
- Create: `src/renderer/hooks/useBooruDomainEvents.ts`
  - 封装 Booru 收藏、服务端喜欢、黑名单、收藏标签、站点、保存搜索等事件的按站点过滤与常用 patch。
- Create: `src/renderer/hooks/useGalleryDomainEvents.ts`
  - 封装 Gallery 图片删除、无效图片、图库封面 / 统计、忽略文件夹事件消费。
- Modify: `src/main/services/booruService.ts`
  - 在 Booru 收藏、服务端喜欢、黑名单、站点、保存搜索、搜索历史、收藏分组、下载队列、收藏标签下载状态写入成功后发事件。
- Modify: `src/main/ipc/handlers/booruHandlers.ts`
  - 修复 `BOORU_REMOVE_FAVORITE` 参数，新增 `BOORU_SET_ACTIVE_SITE`，投票成功后发事件或下沉到 service helper。
- Modify: `src/preload/shared/createBooruApi.ts` and `src/preload/index.ts`
  - `removeFavorite` 带 `siteId`，新增 `setActiveSite` 类型暴露。
- Modify: `src/main/ipc/channels.ts`
  - 新增 `BOORU_SET_ACTIVE_SITE`。
- Modify: `src/main/api/routes/booruRoutes.ts`
  - 保持 route 调 service，不在 route 层重复发事件。
- Modify: `src/main/services/imageService.ts`, `src/main/services/galleryService.ts`, `src/main/services/invalidImageService.ts`
  - 补 Gallery 图片 / 图库 / 无效图片 / 忽略文件夹事件。
- Modify: `src/main/services/bulkDownloadService.ts`
  - 补 task 和 record 聚合失效事件。
- Modify: `src/main/ipc/handlers/configHandlers.ts`, `src/main/services/backupService.ts`, `src/main/api/apiServiceManager.ts`
  - 让配置、备份恢复、API 服务运行态进入统一事件。
- Modify renderer pages/components:
  - `src/renderer/pages/BooruPage.tsx`
  - `src/renderer/hooks/useFavorite.ts`
  - `src/renderer/hooks/useBooruPostActions.ts`
  - `src/renderer/pages/BooruFavoritesPage.tsx`
  - `src/renderer/pages/BooruServerFavoritesPage.tsx`
  - `src/renderer/pages/BooruTagSearchPage.tsx`
  - `src/renderer/pages/BooruArtistPage.tsx`
  - `src/renderer/pages/BooruCharacterPage.tsx`
  - `src/renderer/pages/BooruPopularPage.tsx`
  - `src/renderer/pages/BooruPoolsPage.tsx`
  - `src/renderer/pages/BlacklistedTagsPage.tsx`
  - `src/renderer/components/BooruPostDetails/TagsSection.tsx`
  - `src/renderer/components/BooruPostDetails/Toolbar.tsx`
  - `src/renderer/pages/BooruSettingsPage.tsx`
  - `src/renderer/pages/BooruSavedSearchesPage.tsx`
  - `src/renderer/pages/BooruDownloadPage.tsx`
  - `src/renderer/pages/BooruBulkDownloadPage.tsx`
  - `src/renderer/pages/FavoriteTagsPage.tsx`
  - `src/renderer/pages/GalleryPage.tsx`
  - `src/renderer/components/ImageGrid.tsx`
  - `src/renderer/pages/InvalidImagesPage.tsx`
  - `src/renderer/pages/SettingsPage.tsx`
  - `src/renderer/App.tsx`
  - `src/renderer/hooks/useTheme.ts`
- Tests:
  - `tests/shared/appEvents.test.ts`
  - `tests/main/services/rendererEventBus.apiEvents.test.ts`
  - `tests/main/services/booruService.appEvents.test.ts`
  - `tests/main/services/galleryDomainEvents.test.ts`
  - `tests/main/services/bulkDownloadService.events.test.ts`
  - `tests/main/ipc/booruDomainEventsHandler.test.ts`
  - `tests/renderer/hooks/useRendererAppEvent.test.tsx`
  - `tests/renderer/hooks/useBooruDomainEvents.test.tsx`
  - `tests/renderer/pages/BooruPage.domainEvents.test.tsx`
  - `tests/renderer/components/TagsSection.domainEvents.test.tsx`
  - `tests/renderer/pages/GalleryPage.domainEvents.test.tsx`
  - `tests/renderer/pages/SettingsPage.configEvents.test.tsx`

## 3. 事件契约

`src/shared/appEvents.ts` 应包含以下事件类型。payload 保持轻量，完整数据由 renderer 收到事件后按需重新拉取。

```ts
import type {
  ApiServiceStatus,
  BulkDownloadSessionStatus,
  ConfigChangedSummary,
} from './types.js';

export type RendererAppEventSource =
  | 'booruService'
  | 'bulkDownloadService'
  | 'galleryService'
  | 'imageService'
  | 'invalidImageService'
  | 'thumbnailService'
  | 'configService'
  | 'backupService'
  | 'apiService'
  | 'downloadManager'
  | 'imageCacheService';

export interface RendererAppEventBase<TType extends string, TPayload> {
  type: TType;
  version: 1;
  occurredAt: string;
  source: RendererAppEventSource;
  payload: TPayload;
}

export interface RendererBooruPostFavoriteChangedPayload {
  action: 'added' | 'removed' | 'repaired' | 'moved';
  siteId: number;
  postId: number;
  dbPostId?: number;
  favoriteId?: number;
  groupId?: number | null;
  isFavorited: boolean;
  affectedCount?: number;
  deletedIds?: number[];
}

export interface RendererBooruPostServerFavoriteChangedPayload {
  action: 'liked' | 'unliked' | 'synced';
  siteId: number;
  postId: number;
  isLiked: boolean;
  affectedCount?: number;
}

export interface RendererBooruBlacklistTagsChangedPayload {
  action: 'created' | 'batchCreated' | 'updated' | 'deleted' | 'toggled' | 'imported';
  siteId?: number | null;
  blacklistTagId?: number;
  tagName?: string;
  isActive?: boolean;
  affectedCount?: number;
}

export interface RendererBooruSitesChangedPayload {
  action: 'created' | 'updated' | 'deleted' | 'activeChanged' | 'authChanged';
  siteId?: number;
  activeSiteId?: number | null;
  changedFields?: string[];
  affectedCount?: number;
}

export interface RendererBooruFavoriteGroupsChangedPayload {
  action: 'created' | 'updated' | 'deleted' | 'favoriteMoved';
  siteId?: number | null;
  groupId?: number;
  favoriteId?: number;
  postId?: number;
  affectedCount?: number;
}

export interface RendererBooruSavedSearchesChangedPayload {
  action: 'created' | 'updated' | 'deleted';
  siteId?: number | null;
  searchId?: number;
  affectedCount?: number;
}

export interface RendererBooruSearchHistoryChangedPayload {
  action: 'created' | 'cleared';
  siteId?: number | null;
  affectedCount?: number;
}

export interface RendererBooruPostDownloadStateChangedPayload {
  action: 'queued' | 'completed' | 'failed' | 'removed' | 'cleared' | 'markedDownloaded';
  queueId?: number;
  siteId?: number;
  postId?: number;
  status?: string;
  previousStatus?: string;
  downloaded?: boolean;
  localImageId?: number;
  affectedCount?: number;
}

export interface RendererBooruPostVoteChangedPayload {
  siteId: number;
  postId: number;
  vote: -1 | 0 | 1;
  score?: number;
}

export interface RendererBooruImageCacheClearedPayload {
  action: 'cleared';
  affectedCount?: number;
}

export interface RendererGalleryImagesChangedPayload {
  action: 'created' | 'deleted' | 'tagsUpdated' | 'invalidated' | 'batchImported';
  imageId?: number;
  galleryId?: number | null;
  affectedGalleryIds?: number[];
  affectedImageIds?: number[];
  affectedCount?: number;
  reason?: 'userDelete' | 'scan' | 'sync' | 'invalidReported';
}

export interface RendererGalleryInvalidImagesChangedPayload {
  action: 'reported' | 'deleted' | 'cleared';
  invalidImageId?: number;
  originalImageId?: number;
  galleryId?: number | null;
  affectedCount?: number;
}

export interface RendererGalleryIgnoredFoldersChangedPayload {
  action: 'created' | 'updated' | 'deleted';
  ignoredFolderId?: number;
  folderPath?: string;
  affectedCount?: number;
}

export interface RendererBulkDownloadTasksChangedPayload {
  action: 'created' | 'deduplicated' | 'updated' | 'deleted';
  taskId?: string;
  siteId?: number | null;
  affectedCount?: number;
}

export interface RendererBulkDownloadRecordsChangedPayload {
  action: 'created' | 'statusChanged' | 'pendingReset' | 'retryStarted' | 'retryMerged' | 'deleted';
  sessionId?: string;
  taskId?: string;
  recordId?: number;
  status?: string;
  previousStatus?: string;
  affectedCount?: number;
}

export interface RendererAppDataRestoredPayload {
  mode: 'merge' | 'replace';
  restoredTables: Array<{ table: string; count: number }>;
}

export type RendererBooruSitesChangedEvent = RendererAppEventBase<'booru:sites-changed', RendererBooruSitesChangedPayload>;
export type RendererBooruPostFavoriteChangedEvent = RendererAppEventBase<'booru:post-favorite-changed', RendererBooruPostFavoriteChangedPayload>;
export type RendererBooruPostServerFavoriteChangedEvent = RendererAppEventBase<'booru:post-server-favorite-changed', RendererBooruPostServerFavoriteChangedPayload>;
export type RendererBooruBlacklistTagsChangedEvent = RendererAppEventBase<'booru:blacklist-tags-changed', RendererBooruBlacklistTagsChangedPayload>;
export type RendererBooruFavoriteGroupsChangedEvent = RendererAppEventBase<'booru:favorite-groups-changed', RendererBooruFavoriteGroupsChangedPayload>;
export type RendererBooruSavedSearchesChangedEvent = RendererAppEventBase<'booru:saved-searches-changed', RendererBooruSavedSearchesChangedPayload>;
export type RendererBooruSearchHistoryChangedEvent = RendererAppEventBase<'booru:search-history-changed', RendererBooruSearchHistoryChangedPayload>;
export type RendererBooruPostDownloadStateChangedEvent = RendererAppEventBase<'booru:post-download-state-changed', RendererBooruPostDownloadStateChangedPayload>;
export type RendererBooruPostVoteChangedEvent = RendererAppEventBase<'booru:post-vote-changed', RendererBooruPostVoteChangedPayload>;
export type RendererBooruImageCacheClearedEvent = RendererAppEventBase<'booru:image-cache-cleared', RendererBooruImageCacheClearedPayload>;
export type RendererGalleryImagesChangedEvent = RendererAppEventBase<'gallery:images-changed', RendererGalleryImagesChangedPayload>;
export type RendererGalleryInvalidImagesChangedEvent = RendererAppEventBase<'gallery:invalid-images-changed', RendererGalleryInvalidImagesChangedPayload>;
export type RendererGalleryIgnoredFoldersChangedEvent = RendererAppEventBase<'gallery:ignored-folders-changed', RendererGalleryIgnoredFoldersChangedPayload>;
export type RendererBulkDownloadTasksChangedEvent = RendererAppEventBase<'bulk-download:tasks-changed', RendererBulkDownloadTasksChangedPayload>;
export type RendererBulkDownloadRecordsChangedEvent = RendererAppEventBase<'bulk-download:records-changed', RendererBulkDownloadRecordsChangedPayload>;
export type RendererConfigChangedEvent = RendererAppEventBase<'config:changed', ConfigChangedSummary>;
export type RendererAppDataRestoredEvent = RendererAppEventBase<'app:data-restored', RendererAppDataRestoredPayload>;
export type RendererApiServiceStatusChangedEvent = RendererAppEventBase<'api-service:status-changed', ApiServiceStatus>;
```

The final `RendererAppEvent` union must include all existing events plus the new events above. Existing events stay source-compatible:

```ts
export type RendererAppEvent =
  | RendererBulkDownloadSessionsChangedEvent
  | RendererBulkDownloadTasksChangedEvent
  | RendererBulkDownloadRecordsChangedEvent
  | RendererFavoriteTagDownloadCreatedEvent
  | RendererFavoriteTagsChangedEvent
  | RendererBooruSitesChangedEvent
  | RendererBooruPostFavoriteChangedEvent
  | RendererBooruPostServerFavoriteChangedEvent
  | RendererBooruBlacklistTagsChangedEvent
  | RendererBooruFavoriteGroupsChangedEvent
  | RendererBooruSavedSearchesChangedEvent
  | RendererBooruSearchHistoryChangedEvent
  | RendererBooruPostDownloadStateChangedEvent
  | RendererBooruPostVoteChangedEvent
  | RendererBooruImageCacheClearedEvent
  | RendererGalleryImagesImportedEvent
  | RendererGalleryImagesChangedEvent
  | RendererGalleryInvalidImagesChangedEvent
  | RendererGalleryIgnoredFoldersChangedEvent
  | RendererGalleriesChangedEvent
  | RendererThumbnailGeneratedEvent
  | RendererConfigChangedEvent
  | RendererAppDataRestoredEvent
  | RendererApiServiceStatusChangedEvent;
```

Channel mapping should be explicit:

```ts
export type ApiEventChannel = 'downloads' | 'favorite-tags' | 'booru' | 'api-logs' | 'system';

export const API_EVENT_CHANNELS = ['downloads', 'favorite-tags', 'booru', 'api-logs', 'system'] as const;

export function resolveRendererAppEventApiChannel(type: RendererAppEvent['type']): ApiEventChannel {
  if (type.startsWith('bulk-download:') || type.startsWith('download:')) return 'downloads';
  if (type === 'favorite-tags:changed' || type === 'favorite-tag-download:created') return 'favorite-tags';
  if (type.startsWith('booru:')) return 'booru';
  return 'system';
}

export type ApiSafeRendererAppEvent = Omit<RendererAppEvent, 'payload'> & { payload: unknown };
```

## 4. Task 1: 共享事件模块和总线类型

**Files:**
- Create: `src/shared/appEvents.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/rendererEventBus.ts`
- Modify: `src/main/api/events/eventHub.ts`
- Modify: `src/main/api/routes/eventRoutes.ts`
- Modify: `src/main/api/permissions.ts`
- Test: `tests/shared/appEvents.test.ts`
- Test: `tests/main/services/rendererEventBus.apiEvents.test.ts`

- [ ] **Step 1: 写共享事件契约失败测试**

Add `tests/shared/appEvents.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  API_EVENT_CHANNELS,
  resolveRendererAppEventApiChannel,
  type RendererAppEvent,
} from '../../src/shared/types';

describe('RendererAppEvent contract', () => {
  it('routes domain events to stable API SSE channels', () => {
    expect(API_EVENT_CHANNELS).toEqual(['downloads', 'favorite-tags', 'booru', 'api-logs', 'system']);
    expect(resolveRendererAppEventApiChannel('booru:post-favorite-changed')).toBe('booru');
    expect(resolveRendererAppEventApiChannel('bulk-download:records-changed')).toBe('downloads');
    expect(resolveRendererAppEventApiChannel('favorite-tags:changed')).toBe('favorite-tags');
    expect(resolveRendererAppEventApiChannel('gallery:images-changed')).toBe('system');
    expect(resolveRendererAppEventApiChannel('config:changed')).toBe('system');
  });

  it('accepts all bug5 event types in RendererAppEvent union', () => {
    const events: Array<RendererAppEvent['type']> = [
      'booru:post-favorite-changed',
      'booru:post-server-favorite-changed',
      'booru:blacklist-tags-changed',
      'booru:sites-changed',
      'booru:favorite-groups-changed',
      'booru:saved-searches-changed',
      'booru:search-history-changed',
      'booru:post-download-state-changed',
      'booru:post-vote-changed',
      'bulk-download:tasks-changed',
      'bulk-download:records-changed',
      'gallery:images-changed',
      'gallery:invalid-images-changed',
      'gallery:ignored-folders-changed',
      'config:changed',
      'app:data-restored',
      'api-service:status-changed',
      'booru:image-cache-cleared',
    ];
    expect(events).toHaveLength(18);
  });
});
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
npm run test -- tests/shared/appEvents.test.ts
```

Expected: FAIL because `src/shared/appEvents.ts`, `API_EVENT_CHANNELS`, and new event union types do not exist.

- [ ] **Step 3: 新增 `src/shared/appEvents.ts`**

Move existing event interfaces from `src/shared/types.ts:536-658` into the new file, add the new payloads from section 3, and export:

```ts
export {
  API_EVENT_CHANNELS,
  resolveRendererAppEventApiChannel,
};
```

Because `appEvents.ts` needs `BulkDownloadSessionStatus`, `ConfigChangedSummary`, and `ApiServiceStatus`, keep those base data types in `types.ts` and import them using `import type`.

- [ ] **Step 4: Re-export from `src/shared/types.ts`**

Replace the old event block in `types.ts` with:

```ts
export * from './appEvents.js';
```

Do not remove `ConfigChangedSummary`, `BulkDownloadSessionStatus`, or `ApiServiceStatus`; `appEvents.ts` depends on them.

- [ ] **Step 5: Update `rendererEventBus`**

Replace its private `resolveApiEventChannel` and return type cast:

```ts
import type { ApiSafeRendererAppEvent, RendererAppEvent } from '../../shared/types.js';
import { resolveRendererAppEventApiChannel } from '../../shared/types.js';

function toApiSafeRendererAppEvent(event: RendererAppEvent): ApiSafeRendererAppEvent {
  return {
    ...event,
    payload: sanitizeApiEventPayload(event.payload),
  };
}
```

Then publish using:

```ts
apiEventHub.publish(resolveRendererAppEventApiChannel(event.type), {
  type: event.type,
  timestamp: event.occurredAt,
  data: apiEvent,
});
```

- [ ] **Step 6: De-duplicate API channels**

In `src/main/api/events/eventHub.ts`, replace the local union with:

```ts
import type { ApiEventChannel } from '../../../shared/types.js';
```

In `src/main/api/routes/eventRoutes.ts`, import `API_EVENT_CHANNELS` and build the set from it:

```ts
import { API_EVENT_CHANNELS, type ApiEventChannel } from '../../../shared/types.js';

const ALLOWED_CHANNELS = new Set<ApiEventChannel>(API_EVENT_CHANNELS);
```

In `src/main/api/permissions.ts`, replace the hard-coded events regex with:

```ts
const API_EVENT_CHANNEL_PATTERN = API_EVENT_CHANNELS.join('|');
{ method: 'GET', path: new RegExp(`^/api/v1/events/(?:${API_EVENT_CHANNEL_PATTERN})/?$`), permissionKey: 'eventsSubscribe' },
```

- [ ] **Step 7: Run targeted tests**

Run:

```bash
npm run test -- tests/shared/appEvents.test.ts tests/main/services/rendererEventBus.apiEvents.test.ts tests/main/api/eventHub.test.ts tests/main/api/routes.logsEvents.test.ts tests/main/api/permissions.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/appEvents.ts src/shared/types.ts src/main/services/rendererEventBus.ts src/main/api/events/eventHub.ts src/main/api/routes/eventRoutes.ts src/main/api/permissions.ts tests/shared/appEvents.test.ts tests/main/services/rendererEventBus.apiEvents.test.ts tests/main/api/eventHub.test.ts tests/main/api/routes.logsEvents.test.ts tests/main/api/permissions.test.ts
git commit -m "feat: 抽取全局领域事件契约"
```

## 5. Task 2: 主进程事件发布器模块

**Files:**
- Create: `src/main/services/appEventPublisher.ts`
- Test: `tests/main/services/appEventPublisher.test.ts`

- [ ] **Step 1: 写失败测试**

Add `tests/main/services/appEventPublisher.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitBuiltRendererAppEvent = vi.fn();

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: (...args: unknown[]) => emitBuiltRendererAppEvent(...args),
}));

describe('appEventPublisher', () => {
  beforeEach(() => emitBuiltRendererAppEvent.mockReset());

  it('publishes Booru favorite changes with booruService source', async () => {
    const { emitBooruPostFavoriteChanged } = await import('../../../src/main/services/appEventPublisher.js');
    emitBooruPostFavoriteChanged({ action: 'added', siteId: 1, postId: 101, isFavorited: true, favoriteId: 7 });
    expect(emitBuiltRendererAppEvent).toHaveBeenCalledWith({
      type: 'booru:post-favorite-changed',
      source: 'booruService',
      payload: { action: 'added', siteId: 1, postId: 101, isFavorited: true, favoriteId: 7 },
    });
  });

  it('publishes config changed with configService source', async () => {
    const { emitConfigChanged } = await import('../../../src/main/services/appEventPublisher.js');
    emitConfigChanged({ version: 123, sections: ['apiService'] });
    expect(emitBuiltRendererAppEvent).toHaveBeenCalledWith({
      type: 'config:changed',
      source: 'configService',
      payload: { version: 123, sections: ['apiService'] },
    });
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm run test -- tests/main/services/appEventPublisher.test.ts
```

Expected: FAIL because publisher module does not exist.

- [ ] **Step 3: Implement publisher helpers**

Create `src/main/services/appEventPublisher.ts`:

```ts
import type {
  ApiServiceStatus,
  ConfigChangedSummary,
  RendererAppDataRestoredPayload,
  RendererBooruBlacklistTagsChangedPayload,
  RendererBooruFavoriteGroupsChangedPayload,
  RendererBooruImageCacheClearedPayload,
  RendererBooruPostDownloadStateChangedPayload,
  RendererBooruPostFavoriteChangedPayload,
  RendererBooruPostServerFavoriteChangedPayload,
  RendererBooruPostVoteChangedPayload,
  RendererBooruSavedSearchesChangedPayload,
  RendererBooruSearchHistoryChangedPayload,
  RendererBooruSitesChangedPayload,
  RendererBulkDownloadRecordsChangedPayload,
  RendererBulkDownloadTasksChangedPayload,
  RendererConfigChangedEvent,
  RendererGalleryIgnoredFoldersChangedPayload,
  RendererGalleryImagesChangedPayload,
  RendererGalleryInvalidImagesChangedPayload,
  RendererGalleriesChangedPayload,
} from '../../shared/types.js';
import { emitBuiltRendererAppEvent } from './rendererEventBus.js';

export function emitBooruPostFavoriteChanged(payload: RendererBooruPostFavoriteChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'booru:post-favorite-changed', source: 'booruService', payload });
}

export function emitBooruPostServerFavoriteChanged(payload: RendererBooruPostServerFavoriteChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'booru:post-server-favorite-changed', source: 'booruService', payload });
}

export function emitBooruBlacklistTagsChanged(payload: RendererBooruBlacklistTagsChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'booru:blacklist-tags-changed', source: 'booruService', payload });
}

export function emitBooruSitesChanged(payload: RendererBooruSitesChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'booru:sites-changed', source: 'booruService', payload });
}

export function emitBooruFavoriteGroupsChanged(payload: RendererBooruFavoriteGroupsChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'booru:favorite-groups-changed', source: 'booruService', payload });
}

export function emitBooruSavedSearchesChanged(payload: RendererBooruSavedSearchesChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'booru:saved-searches-changed', source: 'booruService', payload });
}

export function emitBooruSearchHistoryChanged(payload: RendererBooruSearchHistoryChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'booru:search-history-changed', source: 'booruService', payload });
}

export function emitBooruPostDownloadStateChanged(payload: RendererBooruPostDownloadStateChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'booru:post-download-state-changed', source: 'booruService', payload });
}

export function emitBooruPostVoteChanged(payload: RendererBooruPostVoteChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'booru:post-vote-changed', source: 'booruService', payload });
}

export function emitBooruImageCacheCleared(payload: RendererBooruImageCacheClearedPayload): void {
  emitBuiltRendererAppEvent({ type: 'booru:image-cache-cleared', source: 'imageCacheService', payload });
}

export function emitGalleryImagesChanged(payload: RendererGalleryImagesChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'gallery:images-changed', source: 'imageService', payload });
}

export function emitGalleryInvalidImagesChanged(payload: RendererGalleryInvalidImagesChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'gallery:invalid-images-changed', source: 'invalidImageService', payload });
}

export function emitGalleryIgnoredFoldersChanged(payload: RendererGalleryIgnoredFoldersChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'gallery:ignored-folders-changed', source: 'galleryService', payload });
}

export function emitGalleryGalleriesChanged(payload: RendererGalleriesChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'gallery:galleries-changed', source: 'galleryService', payload });
}

export function emitBulkDownloadTasksChanged(payload: RendererBulkDownloadTasksChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'bulk-download:tasks-changed', source: 'bulkDownloadService', payload });
}

export function emitBulkDownloadRecordsChanged(payload: RendererBulkDownloadRecordsChangedPayload): void {
  emitBuiltRendererAppEvent({ type: 'bulk-download:records-changed', source: 'bulkDownloadService', payload });
}

export function emitConfigChanged(payload: ConfigChangedSummary): void {
  emitBuiltRendererAppEvent<RendererConfigChangedEvent>({ type: 'config:changed', source: 'configService', payload });
}

export function emitAppDataRestored(payload: RendererAppDataRestoredPayload): void {
  emitBuiltRendererAppEvent({ type: 'app:data-restored', source: 'backupService', payload });
}

export function emitApiServiceStatusChanged(payload: ApiServiceStatus): void {
  emitBuiltRendererAppEvent({ type: 'api-service:status-changed', source: 'apiService', payload });
}
```

- [ ] **Step 4: Run publisher test**

Run:

```bash
npm run test -- tests/main/services/appEventPublisher.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/appEventPublisher.ts tests/main/services/appEventPublisher.test.ts
git commit -m "feat: 增加领域事件发布器"
```

## 6. Task 3: Booru P0 发布端事件和 `removeFavorite(siteId)`

**Files:**
- Modify: `src/main/services/booruService.ts`
- Modify: `src/main/ipc/handlers/booruHandlers.ts`
- Modify: `src/preload/shared/createBooruApi.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/main/services/booruService.appEvents.test.ts`
- Test: `tests/main/ipc/booruDomainEventsHandler.test.ts`
- Test: `tests/preload/main-exposure.test.ts`
- Test: `tests/preload/subwindow-exposure.test.ts`
- Test: `tests/renderer/hooks/useFavorite.test.ts`

- [ ] **Step 1: 写 service 失败测试**

Add focused tests in `tests/main/services/booruService.appEvents.test.ts` with mocked database helpers and publisher:

```ts
it('addToFavorites emits booru:post-favorite-changed after insert', async () => {
  const service = await import('../../../src/main/services/booruService.js');
  const favoriteId = await service.addToFavorites(101, 1);
  expect(favoriteId).toBe(7001);
  expect(emitBooruPostFavoriteChanged).toHaveBeenCalledWith({
    action: 'added',
    siteId: 1,
    postId: 101,
    dbPostId: 501,
    favoriteId: 7001,
    isFavorited: true,
    affectedCount: 1,
  });
});

it('removeFromFavorites requires siteId and emits removed for the matching site only', async () => {
  const service = await import('../../../src/main/services/booruService.js');
  await service.removeFromFavorites(101, 2);
  expect(getMock).toHaveBeenCalledWith(expect.anything(), 'SELECT id FROM booru_posts WHERE postId = ? AND siteId = ?', [101, 2]);
  expect(emitBooruPostFavoriteChanged).toHaveBeenCalledWith({
    action: 'removed',
    siteId: 2,
    postId: 101,
    dbPostId: 502,
    isFavorited: false,
    affectedCount: 1,
  });
});

it('setPostLiked throws on database failure and emits only after successful write', async () => {
  const service = await import('../../../src/main/services/booruService.js');
  await service.setPostLiked(1, 101, true);
  expect(emitBooruPostServerFavoriteChanged).toHaveBeenCalledWith({
    action: 'liked',
    siteId: 1,
    postId: 101,
    isLiked: true,
    affectedCount: 1,
  });
});

it('blacklist writes emit created, batchCreated, toggled, updated, deleted, and imported events', async () => {
  const service = await import('../../../src/main/services/booruService.js');
  await service.addBlacklistedTag('tag_a', 1);
  await service.addBlacklistedTags('tag_b\ntag_c', 1);
  await service.toggleBlacklistedTag(9);
  await service.updateBlacklistedTag(9, { reason: 'noise' });
  await service.removeBlacklistedTag(9);
  await service.importBlacklistedTagsCommit({ records: [{ tagName: 'tag_d' }], fallbackSiteId: 1 });
  expect(emitBooruBlacklistTagsChanged.mock.calls.map(call => call[0].action)).toEqual([
    'created',
    'batchCreated',
    'toggled',
    'updated',
    'deleted',
    'imported',
  ]);
});
```

- [ ] **Step 2: Run failing service test**

Run:

```bash
npm run test -- tests/main/services/booruService.appEvents.test.ts
```

Expected: FAIL because events are not emitted and `setPostLiked` swallows DB errors.

- [ ] **Step 3: Implement Booru event emits in service**

Import publisher helpers:

```ts
import {
  emitBooruBlacklistTagsChanged,
  emitBooruPostFavoriteChanged,
  emitBooruPostServerFavoriteChanged,
} from './appEventPublisher.js';
```

In `addToFavorites`, emit after `favoriteId` is known:

```ts
emitBooruPostFavoriteChanged({
  action: existing ? 'repaired' : 'added',
  siteId,
  postId: apiPostId,
  dbPostId: dbId,
  favoriteId,
  isFavorited: true,
  affectedCount: existing ? 0 : 1,
});
```

In `removeFromFavorites`, require `siteId` from all public callers. Keep a guarded fallback only for background repair until its caller is fixed:

```ts
export async function removeFromFavorites(apiPostId: number, siteId: number): Promise<void> {
  const dbPost = await get<{ id: number }>(
    db,
    'SELECT id FROM booru_posts WHERE postId = ? AND siteId = ?',
    [apiPostId, siteId],
  );
  if (!dbPost) return;
  await run(db, 'DELETE FROM booru_favorites WHERE postId = ?', [dbPost.id]);
  await run(db, 'UPDATE booru_posts SET isFavorited = 0 WHERE id = ?', [dbPost.id]);
  emitBooruPostFavoriteChanged({
    action: 'removed',
    siteId,
    postId: apiPostId,
    dbPostId: dbPost.id,
    isFavorited: false,
    affectedCount: 1,
  });
}
```

In the background repair path in `booruHandlers.ts:749`, pass the known `siteId`:

```ts
await booruService.removeFromFavorites(postId, siteId);
```

In `setPostLiked`, stop swallowing errors and emit only after write:

```ts
export async function setPostLiked(siteId: number, apiPostId: number, liked: boolean): Promise<void> {
  const db = await getDatabase();
  const result = await runWithChanges(
    db,
    'UPDATE booru_posts SET isLiked = ? WHERE siteId = ? AND postId = ?',
    [liked ? 1 : 0, siteId, apiPostId],
  );
  emitBooruPostServerFavoriteChanged({
    action: liked ? 'liked' : 'unliked',
    siteId,
    postId: apiPostId,
    isLiked: liked,
    affectedCount: result.changes,
  });
}
```

For blacklist, create an internal helper to avoid per-tag storms:

```ts
async function addBlacklistedTagInternal(
  tagName: string,
  siteId?: number | null,
  reason?: string,
  options: { emit?: boolean } = { emit: true },
): Promise<BlacklistedTag> {
  // existing INSERT + SELECT body
  const tag = { ...inserted, isActive: Boolean(inserted.isActive) };
  if (options.emit !== false) {
    emitBooruBlacklistTagsChanged({
      action: 'created',
      siteId: tag.siteId ?? null,
      blacklistTagId: tag.id,
      tagName: tag.tagName,
      isActive: tag.isActive,
      affectedCount: 1,
    });
  }
  return tag;
}
```

Use it from:

```ts
export async function addBlacklistedTag(tagName: string, siteId?: number | null, reason?: string): Promise<BlacklistedTag> {
  return addBlacklistedTagInternal(tagName, siteId, reason, { emit: true });
}
```

For `addBlacklistedTags`, call internal with `{ emit: false }` and emit once:

```ts
if (added > 0) {
  emitBooruBlacklistTagsChanged({
    action: 'batchCreated',
    siteId: siteId ?? null,
    affectedCount: added,
  });
}
```

For `importBlacklistedTagsCommit`, call internal with `{ emit: false }` and emit once:

```ts
if (imported > 0) {
  emitBooruBlacklistTagsChanged({
    action: 'imported',
    siteId: fallbackSiteId,
    affectedCount: imported,
  });
}
```

For toggle/update/remove, capture the row before writing and emit:

```ts
emitBooruBlacklistTagsChanged({
  action: 'toggled',
  siteId: tag.siteId ?? null,
  blacklistTagId: id,
  tagName: tag.tagName,
  isActive: Boolean(newIsActive),
  affectedCount: 1,
});
```

- [ ] **Step 4: Fix IPC/preload removeFavorite signature**

In `booruHandlers.ts`:

```ts
ipcMain.handle(IPC_CHANNELS.BOORU_REMOVE_FAVORITE, async (_event, postId: number, siteId: number, syncToServer = false) => {
  await booruService.removeFromFavorites(postId, siteId);
  return { success: true };
});
```

In `createBooruApi.ts`:

```ts
removeFavorite: (postId: number, siteId: number, syncToServer: boolean = false) =>
  ipcRenderer.invoke(IPC_CHANNELS.BOORU_REMOVE_FAVORITE, postId, siteId, syncToServer),
```

In `preload/index.ts` type declarations:

```ts
removeFavorite: (postId: number, siteId: number, syncToServer?: boolean) => Promise<{ success: boolean; error?: string }>;
```

In renderer direct calls:

```ts
await window.electronAPI.booru.removeFavorite(post.postId, siteId);
```

`useFavorite.ts` must use the hook `siteId`:

```ts
const result = await window.electronAPI.booru.removeFavorite(post.postId, siteId, false);
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test -- tests/main/services/booruService.appEvents.test.ts tests/main/ipc/booruDomainEventsHandler.test.ts tests/preload/main-exposure.test.ts tests/preload/subwindow-exposure.test.ts tests/renderer/hooks/useFavorite.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/booruService.ts src/main/ipc/handlers/booruHandlers.ts src/preload/shared/createBooruApi.ts src/preload/index.ts tests/main/services/booruService.appEvents.test.ts tests/main/ipc/booruDomainEventsHandler.test.ts tests/preload/main-exposure.test.ts tests/preload/subwindow-exposure.test.ts tests/renderer/hooks/useFavorite.test.ts
git commit -m "fix: 补齐 Booru 核心状态事件"
```

## 7. Task 4: Renderer 常驻订阅 hook 和 Booru P0 消费

**Files:**
- Create: `src/renderer/hooks/useRendererAppEvent.ts`
- Create: `src/renderer/hooks/useBooruDomainEvents.ts`
- Modify: `src/renderer/hooks/useFavorite.ts`
- Modify: `src/renderer/hooks/useBooruPostActions.ts`
- Modify: `src/renderer/pages/BooruPage.tsx`
- Modify: `src/renderer/components/BooruPostDetails/TagsSection.tsx`
- Modify: `src/renderer/pages/BlacklistedTagsPage.tsx`
- Test: `tests/renderer/hooks/useRendererAppEvent.test.tsx`
- Test: `tests/renderer/hooks/useBooruDomainEvents.test.tsx`
- Test: `tests/renderer/pages/BooruPage.domainEvents.test.tsx`
- Test: `tests/renderer/components/TagsSection.domainEvents.test.tsx`

- [ ] **Step 1: 写 hook 失败测试**

Add tests that prove subscription stays mounted while `active=false`, and queued dirty events flush when active becomes true:

```tsx
it('keeps subscription active and marks dirty while inactive', async () => {
  let callback!: (event: RendererAppEvent) => void;
  const unsubscribe = vi.fn();
  (window as any).electronAPI = { system: { onAppEvent: vi.fn((cb) => { callback = cb; return unsubscribe; }) } };
  const onEvent = vi.fn();
  const { rerender, unmount } = renderHook(({ active }) =>
    useRendererAppEvent('booru:blacklist-tags-changed', onEvent, { active }),
    { initialProps: { active: false } },
  );

  callback(appEvent('booru:blacklist-tags-changed', { action: 'created', siteId: 1, tagName: 'tag_a', isActive: true }));
  expect(onEvent).not.toHaveBeenCalled();

  rerender({ active: true });
  expect(onEvent).toHaveBeenCalledTimes(1);

  unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Implement `useRendererAppEvent`**

```ts
import { useEffect, useRef } from 'react';
import type { RendererAppEvent } from '../../shared/types';

type EventType = RendererAppEvent['type'];
type EventOf<TType extends EventType> = Extract<RendererAppEvent, { type: TType }>;

export function useRendererAppEvent<TType extends EventType>(
  type: TType | readonly TType[],
  onEvent: (event: EventOf<TType>) => void,
  options: { active?: boolean; replayDirtyOnActive?: boolean } = {},
): void {
  const active = options.active ?? true;
  const replayDirtyOnActive = options.replayDirtyOnActive ?? true;
  const onEventRef = useRef(onEvent);
  const activeRef = useRef(active);
  const dirtyEventsRef = useRef<Array<EventOf<TType>>>([]);
  const types = Array.isArray(type) ? type : [type];
  const typeKey = types.join('|');

  onEventRef.current = onEvent;
  activeRef.current = active;

  useEffect(() => {
    if (!active || !replayDirtyOnActive || dirtyEventsRef.current.length === 0) return;
    const events = dirtyEventsRef.current;
    dirtyEventsRef.current = [];
    for (const event of events) onEventRef.current(event);
  }, [active, replayDirtyOnActive]);

  useEffect(() => {
    const allowed = new Set<EventType>(types);
    const unsubscribe = window.electronAPI?.system?.onAppEvent?.((event: RendererAppEvent) => {
      if (!allowed.has(event.type)) return;
      const typedEvent = event as EventOf<TType>;
      if (!activeRef.current) {
        if (replayDirtyOnActive) dirtyEventsRef.current.push(typedEvent);
        return;
      }
      onEventRef.current(typedEvent);
    });
    return () => unsubscribe?.();
  }, [typeKey, replayDirtyOnActive]);
}
```

- [ ] **Step 3: Implement `useBooruDomainEvents`**

Expose a focused hook:

```ts
export function useBooruDomainEvents(options: {
  siteId: number | null;
  active?: boolean;
  onPostFavoriteChanged?: (payload: RendererBooruPostFavoriteChangedPayload) => void;
  onServerFavoriteChanged?: (payload: RendererBooruPostServerFavoriteChangedPayload) => void;
  onBlacklistTagsChanged?: (payload: RendererBooruBlacklistTagsChangedPayload) => void;
  onFavoriteTagsChanged?: (payload: RendererFavoriteTagsChangedPayload) => void;
  onSitesChanged?: (payload: RendererBooruSitesChangedPayload) => void;
}): void {
  const matchesSite = (eventSiteId?: number | null) => (
    options.siteId === null ||
    eventSiteId === undefined ||
    eventSiteId === null ||
    eventSiteId === options.siteId
  );
  useRendererAppEvent([
    'booru:post-favorite-changed',
    'booru:post-server-favorite-changed',
    'booru:blacklist-tags-changed',
    'favorite-tags:changed',
    'booru:sites-changed',
  ] as const, (event) => {
    if (event.type === 'booru:post-favorite-changed' && matchesSite(event.payload.siteId)) options.onPostFavoriteChanged?.(event.payload);
    if (event.type === 'booru:post-server-favorite-changed' && matchesSite(event.payload.siteId)) options.onServerFavoriteChanged?.(event.payload);
    if (event.type === 'booru:blacklist-tags-changed' && matchesSite(event.payload.siteId)) options.onBlacklistTagsChanged?.(event.payload);
    if (event.type === 'favorite-tags:changed' && matchesSite(event.payload.siteId)) options.onFavoriteTagsChanged?.(event.payload);
    if (event.type === 'booru:sites-changed') options.onSitesChanged?.(event.payload);
  }, { active: options.active });
}
```

- [ ] **Step 4: Connect `BooruPage`**

Use event patch helpers:

```ts
const applyPostFavoriteEvent = useCallback((payload: RendererBooruPostFavoriteChangedPayload) => {
  setPosts(prev => prev.map(post => post.postId === payload.postId ? { ...post, isFavorited: payload.isFavorited } : post));
}, []);

const applyServerFavoriteEvent = useCallback((payload: RendererBooruPostServerFavoriteChangedPayload) => {
  setServerFavorites(prev => {
    const next = new Set(prev);
    if (payload.isLiked) next.add(payload.postId); else next.delete(payload.postId);
    return next;
  });
  setPosts(prev => prev.map(post => post.postId === payload.postId ? { ...post, isLiked: payload.isLiked } : post));
}, []);

useBooruDomainEvents({
  siteId: selectedSiteId,
  active: !suspended,
  onPostFavoriteChanged: applyPostFavoriteEvent,
  onServerFavoriteChanged: applyServerFavoriteEvent,
  onBlacklistTagsChanged: () => {
    loadBlacklistTagNames();
    setDisabledBlacklistTags(new Set());
  },
});
```

This must make a newly blacklisted tag immediately update `blacklistTagNames`, which recomputes `blacklistHitStats` and `filteredSortedPosts`.

- [ ] **Step 5: Connect `TagsSection`**

Reload favorite tag and blacklist maps on matching event:

```ts
useBooruDomainEvents({
  siteId: currentSiteId,
  onFavoriteTagsChanged: () => loadFavoriteStatus(),
  onBlacklistTagsChanged: async () => {
    if (currentSiteId === null) return;
    const token = getCurrentSiteToken();
    const tagMap = await fetchBlacklistedTagMap(currentSiteId);
    if (isCurrentSiteRequest(token)) setBlacklistedTagsByName(tagMap);
  },
});
```

`loadFavoriteStatus` should be extracted from the current effect into `useCallback`.

- [ ] **Step 6: Connect `BlacklistedTagsPage`**

Use the hook even when the tab is mounted in a hidden container:

```ts
useBooruDomainEvents({
  siteId: filterSiteId ?? null,
  active,
  onBlacklistTagsChanged: () => {
    loadBlacklistedTags();
  },
  onSitesChanged: () => {
    loadSites();
    loadBlacklistedTags();
  },
});
```

- [ ] **Step 7: Run renderer tests**

Run:

```bash
npm run test -- tests/renderer/hooks/useRendererAppEvent.test.tsx tests/renderer/hooks/useBooruDomainEvents.test.tsx tests/renderer/pages/BooruPage.domainEvents.test.tsx tests/renderer/components/TagsSection.domainEvents.test.tsx tests/renderer/pages/BlacklistedTagsPage.test.tsx tests/renderer/components/TagsSection.blacklist.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/hooks/useRendererAppEvent.ts src/renderer/hooks/useBooruDomainEvents.ts src/renderer/hooks/useFavorite.ts src/renderer/hooks/useBooruPostActions.ts src/renderer/pages/BooruPage.tsx src/renderer/components/BooruPostDetails/TagsSection.tsx src/renderer/pages/BlacklistedTagsPage.tsx tests/renderer/hooks/useRendererAppEvent.test.tsx tests/renderer/hooks/useBooruDomainEvents.test.tsx tests/renderer/pages/BooruPage.domainEvents.test.tsx tests/renderer/components/TagsSection.domainEvents.test.tsx tests/renderer/pages/BlacklistedTagsPage.test.tsx tests/renderer/components/TagsSection.blacklist.test.tsx
git commit -m "fix: 接入 Booru 核心状态跨窗口同步"
```

## 8. Task 5: Booru P1/P2 发布和消费补齐

**Files:**
- Modify: `src/main/services/booruService.ts`
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/handlers/booruHandlers.ts`
- Modify: `src/preload/shared/createBooruApi.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/pages/BooruSettingsPage.tsx`
- Modify: `src/renderer/pages/BooruSavedSearchesPage.tsx`
- Modify: `src/renderer/pages/BooruFavoritesPage.tsx`
- Modify: `src/renderer/pages/BooruServerFavoritesPage.tsx`
- Modify: `src/renderer/pages/BooruTagSearchPage.tsx`
- Modify: `src/renderer/pages/BooruArtistPage.tsx`
- Modify: `src/renderer/pages/BooruCharacterPage.tsx`
- Modify: `src/renderer/pages/BooruPopularPage.tsx`
- Modify: `src/renderer/pages/BooruPoolsPage.tsx`
- Modify: `src/renderer/components/BooruPostDetails/Toolbar.tsx`
- Modify: `src/renderer/pages/BooruDownloadPage.tsx`
- Test: existing Booru page tests plus new domain event tests

- [ ] **Step 1: Add service emits**

Add publisher calls:

```ts
emitBooruSitesChanged({ action: 'created', siteId: id, activeSiteId: site.active ? id : undefined, affectedCount: 1 });
emitBooruSitesChanged({ action: updates.active !== undefined ? 'activeChanged' : 'updated', siteId: id, activeSiteId: updates.active ? id : undefined, changedFields: Object.keys(updates), affectedCount: 1 });
emitBooruSitesChanged({ action: 'deleted', siteId: id, affectedCount: 1 });
emitBooruSitesChanged({ action: 'activeChanged', siteId: id, activeSiteId: id, affectedCount: 1 });
```

For login/logout, after `updateBooruSite` emits `updated`, also emit auth-specific:

```ts
emitBooruSitesChanged({ action: 'authChanged', siteId, changedFields: ['username', 'passwordHash'], affectedCount: 1 });
```

For saved searches:

```ts
emitBooruSavedSearchesChanged({ action: 'created', siteId, searchId: row?.id ?? 0, affectedCount: 1 });
emitBooruSavedSearchesChanged({ action: 'updated', siteId: updates.siteId ?? existing.siteId ?? null, searchId: id, affectedCount: 1 });
emitBooruSavedSearchesChanged({ action: 'deleted', siteId: existing.siteId ?? null, searchId: id, affectedCount: 1 });
```

For search history:

```ts
emitBooruSearchHistoryChanged({ action: 'created', siteId, affectedCount: 1 });
emitBooruSearchHistoryChanged({ action: 'cleared', siteId: siteId ?? null, affectedCount: result.changes });
```

For favorite groups:

```ts
emitBooruFavoriteGroupsChanged({ action: 'created', siteId: group.siteId ?? null, groupId: group.id, affectedCount: 1 });
emitBooruFavoriteGroupsChanged({ action: 'updated', siteId: existing.siteId ?? null, groupId: id, affectedCount: 1 });
emitBooruFavoriteGroupsChanged({ action: 'deleted', siteId: existing.siteId ?? null, groupId: id, affectedCount: 1 });
emitBooruFavoriteGroupsChanged({ action: 'favoriteMoved', siteId, groupId, postId: apiPostId, affectedCount: 1 });
emitBooruPostFavoriteChanged({ action: 'moved', siteId, postId: apiPostId, groupId, isFavorited: true, affectedCount: 1 });
```

For download queue:

```ts
emitBooruPostDownloadStateChanged({ action: 'queued', queueId, siteId, postId, status: 'pending', affectedCount: 1 });
emitBooruPostDownloadStateChanged({ action: 'markedDownloaded', siteId, postId: apiPostId, downloaded: true, localImageId, affectedCount: 1 });
emitBooruPostDownloadStateChanged({ action: 'removed', queueId: id, affectedCount: 1 });
emitBooruPostDownloadStateChanged({ action: 'cleared', status, affectedCount: result.changes });
```

- [ ] **Step 2: Add atomic active-site IPC**

In `channels.ts`:

```ts
BOORU_SET_ACTIVE_SITE: 'booru:set-active-site',
```

In `booruHandlers.ts`:

```ts
ipcMain.handle(IPC_CHANNELS.BOORU_SET_ACTIVE_SITE, async (_event, siteId: number) => {
  try {
    await booruService.setActiveBooruSite(siteId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
```

In `createBooruApi.ts`:

```ts
setActiveSite: (siteId: number) => ipcRenderer.invoke(IPC_CHANNELS.BOORU_SET_ACTIVE_SITE, siteId),
```

Change `BooruSettingsPage.handleSetActive` to call only:

```ts
const result = await window.electronAPI.booru.setActiveSite(site.id);
```

- [ ] **Step 3: Connect remaining Booru consumers**

Use `useBooruDomainEvents` in these pages:

- `BooruFavoritesPage`: favorite removed/moved reloads list and groups; server favorite patch updates buttons.
- `BooruServerFavoritesPage`: server favorite removed removes from `serverFavorites` and list if current page is server-favorites.
- `BooruTagSearchPage`, `BooruArtistPage`, `BooruCharacterPage`: patch local favorites and serverFavorites; reload favorite tags in detail tags.
- `BooruPopularPage`, `BooruPoolsPage`: patch via `useBooruPostActions` so cards do not drift.
- `BooruSavedSearchesPage`: `booru:saved-searches-changed` reloads list.
- `BooruDownloadPage`: `booru:post-download-state-changed` reloads queue lists.
- `Toolbar`: `booru:post-vote-changed` patches vote state when `siteId/postId` match.
- `BooruSettingsPage`: `booru:sites-changed` reloads site table.

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test -- tests/main/services/booruService.appEvents.test.ts tests/main/ipc/favoriteGroupsHandler.test.ts tests/main/ipc/savedSearchesHandler.test.ts tests/renderer/pages/BooruFavoritesPage.domainEvents.test.tsx tests/renderer/pages/BooruServerFavoritesPage.domainEvents.test.tsx tests/renderer/pages/BooruSecondaryPages.domainEvents.test.tsx tests/renderer/pages/BooruSavedSearchesPage.domainEvents.test.tsx tests/renderer/pages/BooruDownloadPage.domainEvents.test.tsx tests/renderer/pages/BooruCharacterPage.test.tsx tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx tests/renderer/pages/BooruDownloadPage.test.tsx
```

Expected: PASS. The new `*.domainEvents.test.tsx` files must be created in this task and must drive the page-level event consumption changes.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/booruService.ts src/main/ipc/channels.ts src/main/ipc/handlers/booruHandlers.ts src/preload/shared/createBooruApi.ts src/preload/index.ts src/renderer/pages/BooruSettingsPage.tsx src/renderer/pages/BooruSavedSearchesPage.tsx src/renderer/pages/BooruFavoritesPage.tsx src/renderer/pages/BooruServerFavoritesPage.tsx src/renderer/pages/BooruTagSearchPage.tsx src/renderer/pages/BooruArtistPage.tsx src/renderer/pages/BooruCharacterPage.tsx src/renderer/pages/BooruPopularPage.tsx src/renderer/pages/BooruPoolsPage.tsx src/renderer/components/BooruPostDetails/Toolbar.tsx src/renderer/pages/BooruDownloadPage.tsx tests
git commit -m "fix: 补齐 Booru 领域事件消费"
```

## 9. Task 6: Gallery 图片、无效图片、封面、忽略文件夹事件

**Files:**
- Modify: `src/main/services/imageService.ts`
- Modify: `src/main/services/galleryService.ts`
- Modify: `src/main/services/invalidImageService.ts`
- Create: `src/renderer/hooks/useGalleryDomainEvents.ts`
- Modify: `src/renderer/pages/GalleryPage.tsx`
- Modify: `src/renderer/components/ImageGrid.tsx`
- Modify: `src/renderer/pages/InvalidImagesPage.tsx`
- Test: `tests/main/services/galleryDomainEvents.test.ts`
- Test: `tests/renderer/pages/GalleryPage.domainEvents.test.tsx`
- Test: `tests/renderer/pages/InvalidImagesPage.test.tsx`

- [ ] **Step 1: Write failing service tests**

Assert:

- `deleteImage(id)` emits `gallery:images-changed` action `deleted`.
- `updateImageTags(imageId, tags)` emits action `tagsUpdated`.
- `setGalleryCover(id, coverImageId)` emits `gallery:galleries-changed` action `coverChanged`.
- ignored folder add/update/remove emit `gallery:ignored-folders-changed`.
- `reportInvalidImage(imageId)` emits `gallery:invalid-images-changed(reported)`, `gallery:images-changed(invalidated)`, and `gallery:galleries-changed(statsUpdated)` when gallery exists.

- [ ] **Step 2: Add service emits**

In `deleteImage`, query gallery id before delete:

```ts
const row = await get<{ filepath: string; galleryId?: number | null }>(db, 'SELECT filepath, galleryId FROM images WHERE id = ?', [id]);
```

Emit on success:

```ts
emitGalleryImagesChanged({ action: 'deleted', imageId: id, galleryId: row?.galleryId ?? null, affectedImageIds: [id], affectedCount: 1, reason: 'userDelete' });
```

In `updateImageTags`:

```ts
emitGalleryImagesChanged({ action: 'tagsUpdated', imageId, affectedImageIds: [imageId], affectedCount: 1 });
```

In `setGalleryCover`:

```ts
emitGalleryGalleriesChanged({ galleryId: id, action: 'coverChanged', affectedCount: 1 });
```

In ignored folder methods:

```ts
emitGalleryIgnoredFoldersChanged({ action: 'created', folderPath: normalized, affectedCount: 1 });
emitGalleryIgnoredFoldersChanged({ action: 'updated', ignoredFolderId: id, affectedCount: 1 });
emitGalleryIgnoredFoldersChanged({ action: 'deleted', ignoredFolderId: id, affectedCount: 1 });
```

In `reportInvalidImage`, after transaction:

```ts
emitGalleryInvalidImagesChanged({ action: 'reported', originalImageId: image.id, galleryId: gallery?.id ?? null, affectedCount: 1 });
emitGalleryImagesChanged({ action: 'invalidated', imageId: image.id, galleryId: gallery?.id ?? null, affectedImageIds: [image.id], affectedCount: 1, reason: 'invalidReported' });
if (gallery) emitGalleryGalleriesChanged({ galleryId: gallery.id, action: 'statsUpdated', affectedCount: 1 });
```

For delete/clear invalid images:

```ts
emitGalleryInvalidImagesChanged({ action: 'deleted', invalidImageId: id, affectedCount: 1 });
emitGalleryInvalidImagesChanged({ action: 'cleared', affectedCount: rows.length });
```

- [ ] **Step 3: Implement Gallery domain hook**

`useGalleryDomainEvents` should subscribe to:

- `gallery:images-changed`
- `gallery:invalid-images-changed`
- `gallery:galleries-changed`
- `gallery:ignored-folders-changed`
- `thumbnail:generated`

Expose callbacks:

```ts
export function useGalleryDomainEvents(options: {
  active?: boolean;
  onImagesChanged?: (payload: RendererGalleryImagesChangedPayload) => void;
  onInvalidImagesChanged?: (payload: RendererGalleryInvalidImagesChangedPayload) => void;
  onGalleriesChanged?: (payload: RendererGalleriesChangedPayload) => void;
  onIgnoredFoldersChanged?: (payload: RendererGalleryIgnoredFoldersChangedPayload) => void;
  onThumbnailGenerated?: (payload: RendererThumbnailGeneratedPayload) => void;
}): void { /* useRendererAppEvent implementation */ }
```

- [ ] **Step 4: Connect Gallery consumers**

`GalleryPage`:

```ts
const removeImageIds = useCallback((ids: number[]) => {
  setRecentImages(prev => prev.filter(image => !ids.includes(image.id)));
  setGalleryImages(prev => prev.filter(image => !ids.includes(image.id)));
  setAllImages(prev => prev.filter(image => !ids.includes(image.id)));
}, []);

useGalleryDomainEvents({
  active: !suspended,
  onImagesChanged: (payload) => {
    if (payload.action === 'deleted' || payload.action === 'invalidated') {
      removeImageIds(payload.affectedImageIds ?? (payload.imageId ? [payload.imageId] : []));
    }
    if (payload.action === 'created' || payload.action === 'batchImported') {
      checkRecentImagesAfterCacheResume();
    }
  },
  onInvalidImagesChanged: () => {
    if (subTab === 'invalid') loadInvalidImages();
  },
  onGalleriesChanged: () => {
    loadGalleries();
  },
});
```

`ImageGrid`:

- Add optional prop `onImagesRemoved?: (imageIds: number[]) => void`.
- On `gallery:images-changed(deleted|invalidated)`, call `onImagesRemoved(ids)` and clear matching thumbnail paths.

`InvalidImagesPage`:

```ts
useGalleryDomainEvents({
  active,
  onInvalidImagesChanged: () => {
    loadInvalidImages();
  },
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test -- tests/main/services/galleryDomainEvents.test.ts tests/main/services/imageService.deleteImage.test.ts tests/main/services/galleryService.appEvent.test.ts tests/renderer/pages/GalleryPage.domainEvents.test.tsx tests/renderer/pages/GalleryPage.test.tsx tests/renderer/pages/InvalidImagesPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/imageService.ts src/main/services/galleryService.ts src/main/services/invalidImageService.ts src/renderer/hooks/useGalleryDomainEvents.ts src/renderer/pages/GalleryPage.tsx src/renderer/components/ImageGrid.tsx src/renderer/pages/InvalidImagesPage.tsx tests/main/services/galleryDomainEvents.test.ts tests/renderer/pages/GalleryPage.domainEvents.test.tsx tests/renderer/pages/InvalidImagesPage.test.tsx
git commit -m "fix: 补齐图库领域事件同步"
```

## 10. Task 7: 批量下载 task/record 和收藏标签下载状态事件

**Files:**
- Modify: `src/main/services/bulkDownloadService.ts`
- Modify: `src/main/services/booruService.ts`
- Modify: `src/renderer/pages/BooruBulkDownloadPage.tsx`
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx`
- Modify: `src/renderer/components/BulkDownloadSessionDetail.tsx`
- Test: `tests/main/services/bulkDownloadService.events.test.ts`
- Test: `tests/renderer/pages/BooruBulkDownloadPage.test.tsx`
- Test: `tests/renderer/pages/FavoriteTagsPage.test.tsx`

- [ ] **Step 1: Add failing tests**

Assert:

- `createBulkDownloadTask` emits `bulk-download:tasks-changed(created)` when a new task is inserted and `deduplicated` when existing task is reused.
- `updateBulkDownloadTask` emits `updated`.
- `deleteBulkDownloadTask` emits `deleted`.
- `createBulkDownloadRecord` emits `bulk-download:records-changed(created)` with `sessionId`.
- record completed/failed emits `statusChanged`.
- retry / pause / resume pending reset emits `pendingReset` with `affectedCount`.
- favorite-tag download binding snapshot status changes to running/queued/failed/completed emit `favorite-tags:changed(downloadStateChanged)`.

- [ ] **Step 2: Extend favorite tag event action**

Add `downloadStateChanged` to `RendererFavoriteTagsChangedPayload['action']`.

Update `emitFavoriteTagsChanged` action union in `booruService.ts`.

- [ ] **Step 3: Add bulk download emits**

At new task insert:

```ts
emitBulkDownloadTasksChanged({ action: 'created', taskId, siteId: options.siteId, affectedCount: 1 });
```

On dedupe:

```ts
emitBulkDownloadTasksChanged({ action: 'deduplicated', taskId: existing.id, siteId: existing.siteId, affectedCount: 0 });
```

On task update/delete:

```ts
emitBulkDownloadTasksChanged({ action: 'updated', taskId, siteId: updatedTask.siteId, affectedCount: 1 });
emitBulkDownloadTasksChanged({ action: 'deleted', taskId, affectedCount: 1 });
```

For record-level changes, emit aggregate invalidation rather than high-frequency bytes:

```ts
emitBulkDownloadRecordsChanged({ action: 'created', sessionId: record.sessionId, status: record.status, affectedCount: 1 });
emitBulkDownloadRecordsChanged({ action: 'statusChanged', sessionId, recordId, status: nextStatus, previousStatus, affectedCount: 1 });
emitBulkDownloadRecordsChanged({ action: 'pendingReset', sessionId, status: 'pending', previousStatus: 'failed', affectedCount: failedRecords.length });
```

When retry merge occurs, also use the existing session reason:

```ts
emitBulkDownloadSessionsChanged({ sessionId, taskId, siteId, status: nextStatus, previousStatus, reason: 'retryMerged' });
emitBulkDownloadRecordsChanged({ action: 'retryMerged', sessionId, taskId, affectedCount: mergedCount });
```

- [ ] **Step 4: Connect renderer consumers**

`BooruBulkDownloadPage` should subscribe to:

- `bulk-download:sessions-changed`
- `bulk-download:tasks-changed`
- `bulk-download:records-changed`
- `favorite-tag-download:created`

Keep existing debounced session reload, add task/record reload:

```ts
if (event.type === 'bulk-download:tasks-changed') scheduleTaskReload();
if (event.type === 'bulk-download:records-changed') scheduleSessionDetailReload(event.payload.sessionId);
```

`FavoriteTagsPage` should reload download state on:

```ts
event.type === 'favorite-tags:changed' && event.payload.action === 'downloadStateChanged'
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test -- tests/main/services/bulkDownloadService.events.test.ts tests/main/services/booruService.favoriteTagRedownload.test.ts tests/renderer/pages/BooruBulkDownloadPage.test.tsx tests/renderer/pages/FavoriteTagsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/appEvents.ts src/main/services/bulkDownloadService.ts src/main/services/booruService.ts src/renderer/pages/BooruBulkDownloadPage.tsx src/renderer/pages/FavoriteTagsPage.tsx src/renderer/components/BulkDownloadSessionDetail.tsx tests/main/services/bulkDownloadService.events.test.ts tests/main/services/booruService.favoriteTagRedownload.test.ts tests/renderer/pages/BooruBulkDownloadPage.test.tsx tests/renderer/pages/FavoriteTagsPage.test.tsx
git commit -m "fix: 同步批量下载任务和记录状态"
```

## 11. Task 8: 配置、备份恢复、API 服务状态事件

**Files:**
- Modify: `src/main/ipc/handlers/configHandlers.ts`
- Modify: `src/main/services/backupService.ts`
- Modify: `src/main/api/apiServiceManager.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: `src/preload/shared/createBooruPreferencesApi.ts`
- Test: `tests/main/ipc/apiServiceHandlers.test.ts`
- Test: `tests/main/services/backupService.test.ts`
- Test: `tests/main/api/apiServiceManager.test.ts`
- Test: `tests/renderer/pages/SettingsPage.configEvents.test.tsx`
- Test: `tests/renderer/App.mountedPageIds.test.tsx`

- [ ] **Step 1: Make `config:changed` dual-publish**

In `broadcastConfigChanged`, keep legacy IPC send for compatibility and add unified event:

```ts
const summary: ConfigChangedSummary = {
  version: Date.now(),
  sections: Array.from(new Set(sections.filter(section => section.length > 0))),
};
emitConfigChanged(summary);
for (const win of windows) {
  win.webContents.send(IPC_CHANNELS.CONFIG_CHANGED, summary);
}
```

For `CONFIG_UPDATE_GALLERY_FOLDERS`, add:

```ts
const result = await updateGalleryFolders(folders);
if (result.success) broadcastConfigChanged(['galleries']);
return result;
```

- [ ] **Step 2: Consume config events**

`App.tsx` should subscribe to `config:changed` and reload app shell page preferences when `sections` contains `ui.pagePreferences.appShell` or `appShell`:

```ts
useRendererAppEvent('config:changed', (event) => {
  if (event.payload.sections.some(section => section === 'ui.pagePreferences.appShell')) {
    loadAppShellPreferences();
  }
});
```

`SettingsPage.tsx` should reload config and API service status/logs when:

```ts
event.payload.sections.includes('apiService')
```

`createBooruPreferencesApi.ts` should filter before refetch:

```ts
if (!summary.sections.some(section => section.startsWith('booru') || section.includes('appearance'))) return;
```

- [ ] **Step 3: Backup restore emits `app:data-restored`**

In `restoreAppBackupData`, after successful table restore and config save:

```ts
emitAppDataRestored({
  mode,
  restoredTables: Object.entries(backupData.tables).map(([table, rows]) => ({ table, count: rows.length })),
});
emitConfigChanged({ version: Date.now(), sections: ['database', 'galleries', 'booru', 'apiService', 'ui'] });
```

Renderer consumers should treat `app:data-restored` as full invalidation:

- `App`: reload app shell preferences and active menus.
- `BooruPage` and Booru child pages: reload active site and current list if active.
- `GalleryPage`: reload galleries/recent/all as applicable.
- `SettingsPage`: reload config and API status.

- [ ] **Step 4: API service status emits**

In `apiServiceManager.ts`, add a local helper:

```ts
function setApiServiceStatus(nextStatus: ApiServiceStatus): ApiServiceStatus {
  status = nextStatus;
  emitApiServiceStatusChanged(status);
  return status;
}
```

Replace every direct lifecycle `status = statusObject` assignment with `setApiServiceStatus(statusObject)`, using the same complete status object currently built in that branch. Cover runtime error handler, stop success/failure, generated-key failure, listen success, and listen failure.

Do not emit on read-only `getApiServiceStatus()`.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test -- tests/main/ipc/apiServiceHandlers.test.ts tests/main/services/backupService.test.ts tests/main/api/apiServiceManager.test.ts tests/renderer/pages/SettingsPage.configEvents.test.tsx tests/renderer/pages/SettingsPage.test.tsx tests/renderer/App.mountedPageIds.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/handlers/configHandlers.ts src/main/services/backupService.ts src/main/api/apiServiceManager.ts src/preload/shared/createBooruPreferencesApi.ts src/renderer/App.tsx src/renderer/pages/SettingsPage.tsx tests/main/ipc/apiServiceHandlers.test.ts tests/main/services/backupService.test.ts tests/main/api/apiServiceManager.test.ts tests/renderer/pages/SettingsPage.configEvents.test.tsx tests/renderer/pages/SettingsPage.test.tsx tests/renderer/App.mountedPageIds.test.tsx
git commit -m "fix: 统一配置备份和 API 服务事件"
```

## 12. Task 9: 低优先跨窗口补齐和文档

**Files:**
- Modify: `src/main/services/imageCacheService.ts`
- Modify: `src/main/ipc/handlers/booruHandlers.ts`
- Modify: `src/renderer/hooks/useTheme.ts`
- Modify: `doc/Renderer API 文档.md`
- Modify: `doc/Booru功能实现文档.md`
- Modify: `doc/图库功能文档.md`
- Modify: `doc/全局领域事件与跨窗口状态同步缺陷审查.md`
- Test: `tests/renderer/hooks/useTheme.test.ts`
- Test: `tests/main/services/imageCacheService.test.ts`

- [ ] **Step 1: Image cache clear event**

When `clearAllCache` succeeds, emit:

```ts
emitBooruImageCacheCleared({ action: 'cleared', affectedCount: deletedCount });
```

Booru detail/list pages do not need full reload; they can clear visible cached URL only if current URL points at the cleared cache.

- [ ] **Step 2: Theme storage sync**

In `useTheme.ts`, add:

```ts
useEffect(() => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    const next = event.newValue;
    if (next === 'light' || next === 'dark' || next === 'system') {
      setThemeModeState(next);
    }
  };
  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
}, []);
```

This intentionally does not use `RendererAppEvent` because theme is still `localStorage` state, not main-process authority.

- [ ] **Step 3: Update docs**

Update docs with:

- Full `RendererAppEvent` type list, including `thumbnail:generated`.
- Event source rule: mutation success in service layer, payload lightweight, no replay guarantee.
- API SSE channel list from `API_EVENT_CHANNELS`.
- Booru event table: favorite, server favorite, blacklist, sites, groups, saved searches, search history, vote, download state, image cache cleared.
- Gallery event table: images changed, invalid images changed, ignored folders changed, galleries changed `coverChanged`.
- Consumer rule: use `useRendererAppEvent`, `useBooruDomainEvents`, or `useGalleryDomainEvents`; do not hand-roll `window.electronAPI.system.onAppEvent` in pages.

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test -- tests/renderer/hooks/useTheme.test.ts tests/main/services/imageCacheService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/imageCacheService.ts src/main/ipc/handlers/booruHandlers.ts src/renderer/hooks/useTheme.ts "doc/Renderer API 文档.md" doc/Booru功能实现文档.md doc/图库功能文档.md doc/全局领域事件与跨窗口状态同步缺陷审查.md tests/renderer/hooks/useTheme.test.ts tests/main/services/imageCacheService.test.ts
git commit -m "docs: 补齐领域事件规范文档"
```

## 13. Task 10: 全量验证

**Files:**
- No new files unless failures require fixes.

- [ ] **Step 1: Typecheck and full test**

Run:

```bash
npm run build:main
npm run build:preload
npm run test
```

Expected: all commands PASS.

- [ ] **Step 2: Manual smoke in dev app**

Run:

```bash
npm run dev
```

Manual checks:

- Open two Booru windows/pages on the same site and same visible posts.
- Favorite a post in one page; the other page and detail toolbar update without reload.
- Server favorite/unfavorite a post; search page, server favorites page, and detail toolbar update.
- Add a blacklisted tag from `TagsSection`; current `BooruPage` immediately hides matching cards and blacklist hit stats updates.
- Add/edit/delete/import blacklist entries from `BlacklistedTagsPage`; open detail tag context menu updates.
- Open tag-search/artist/character subwindow; favorite/server favorite changes from main window update there.
- Delete a local image; recent/all/gallery detail and `ImageGrid` remove it from visible arrays.
- Trigger invalid image reporting by missing thumbnail/file; invalid list, gallery cover/count, and visible grids update.
- Save API service config in Settings; another Settings window refreshes config/status.
- Restore backup; already-open Booru/Gallery/Settings pages reload relevant data.
- Subscribe to `/api/v1/events/booru`; favorite, like, blacklist events arrive.
- Subscribe to `/api/v1/events/system`; config, gallery, api-service events arrive.

- [ ] **Step 3: Final status check**

Run:

```bash
git status --short
```

Expected: only intentional changes remain, all committed if using the commit-per-task flow.

## 14. Self-review checklist

- Spec coverage: covers Bug5 P0 and audit P0/P1/P2/P3 items, including NF1-NF20. Excluded items are explicitly non-events or low-priority local sync.
- Placeholder scan: forbidden placeholder keywords are absent; every event has a concrete type and publisher/consumer placement.
- Type consistency: event names use one canonical spelling:
  - `booru:post-favorite-changed`
  - `booru:post-server-favorite-changed`
  - `booru:blacklist-tags-changed`
  - `bulk-download:records-changed`
  - `gallery:images-changed`
  - `config:changed`
  - `app:data-restored`
  - `api-service:status-changed`
- Boundary consistency: service layer publishes, renderer hook consumes, high-frequency progress remains on raw channels.


## 15. Execution Result - 2026-06-09

Implemented in this workspace:

- Created reusable event modules: `src/shared/appEvents.ts`, `src/main/services/appEventPublisher.ts`, `src/renderer/hooks/useRendererAppEvent.ts`, `src/renderer/hooks/useBooruDomainEvents.ts`, `src/renderer/hooks/useGalleryDomainEvents.ts`.
- Extended `rendererEventBus` and API SSE channel mapping so the same `RendererAppEvent` reaches BrowserWindow consumers and API `/events/:channel` subscribers.
- Added Booru domain events for local favorites, server favorites, blacklist tags, sites, favorite groups, saved searches, search history, post download state, votes, and image cache clearing.
- Fixed site-scoped favorite operations: `removeFavorite` and `moveFavoriteToGroup` now carry `siteId`; favorite group moves reject cross-site group mismatches.
- Added aggregated server favorite sync for `getServerFavorites`: per-post DB updates stay silent, then one `booru:post-server-favorite-changed(action: synced)` event broadcasts the real changed `postIds`.
- Added Gallery domain events for image changes, invalid images, gallery changes, ignored folders, and thumbnail generation; connected Gallery consumers and `ImageGrid` through domain hooks.
- Added bulk download task and record invalidation events while keeping high-frequency progress on the raw channel.
- Added system events for `config:changed`, `app:data-restored`, and `api-service:status-changed`; connected App and Settings consumers.
- Migrated `BooruBulkDownloadPage` and `FavoriteTagsPage` from page-level `system.onAppEvent` subscriptions to `useRendererAppEvent`; high-frequency record progress/status remains on dedicated raw channels.
- Added active gating for `ImageGrid` domain-event consumption so suspended Gallery caches do not reload from hidden component subscriptions.
- Updated docs: `doc/Bug记录.md`, `doc/Renderer API 文档.md`, `doc/Booru功能实现文档.md`, `doc/图库功能文档.md`, `doc/开发与配置指南.md`, `doc/全局领域事件与跨窗口状态同步缺陷审查.md`, and this spec/plan pair.

Verification completed:

```bash
npm run test -- tests/main/services/appEventPublisher.test.ts tests/shared/appEvents.test.ts tests/main/services/bulkDownloadService.events.test.ts tests/renderer/pages/BooruBulkDownloadPage.test.tsx tests/main/api/apiServiceManager.test.ts tests/main/services/backupService.test.ts tests/main/ipc/apiServiceHandlers.test.ts
npm run test -- tests/renderer/App.mountedPageIds.test.tsx tests/renderer/App.navigation.test.tsx tests/renderer/pages/SettingsPage.test.tsx tests/renderer/pages/BooruPage.loadingPagination.test.tsx tests/renderer/pages/BooruCharacterPage.test.tsx tests/renderer/pages/BooruPostActions.integration.test.tsx tests/renderer/pages/BooruFavoritesPage.postActions.test.tsx tests/renderer/hooks/useBooruDomainEvents.test.tsx
npm run test -- tests/main/services/booruService.appEvents.test.ts tests/main/ipc/booruDomainEventsHandler.test.ts tests/main/ipc/favoriteGroupsHandler.test.ts
npm run test -- tests/main/services/galleryService.appEvent.test.ts tests/main/services/imageService.appEvent.test.ts tests/renderer/pages/GalleryPage.source.contract.test.ts tests/renderer/pages/GalleryPage.test.tsx tests/renderer/pages/InvalidImagesPage.test.tsx
npm run test -- tests/main/services/booruService.appEvents.test.ts tests/main/services/imageCacheService.atomic.test.ts tests/main/services/bulkDownloadService.eventIntegrity.test.ts tests/renderer/components/ImageGrid.domainEvents.test.tsx
npm run test -- tests/renderer/pages/BooruBulkDownloadPage.component.contract.test.ts tests/renderer/pages/FavoriteTagsPage.component.contract.test.ts
npm run test -- tests/main/services/appEventPublisher.test.ts tests/renderer/components/ImageGrid.domainEvents.test.tsx
npm run test
npm run build:main
npm run build:preload
npm run build:renderer
```

Known follow-up cleanup:

- Keep high-frequency progress IPC separate from domain events unless a future feature needs coarse business-state invalidation.
