import type { ApiServiceStatus, BulkDownloadRecordStatus, BulkDownloadSessionStatus } from './types.js';

export const API_EVENT_CHANNELS = ['downloads', 'favorite-tags', 'booru', 'api-logs', 'system'] as const;

export type ApiEventChannel = typeof API_EVENT_CHANNELS[number];

const API_EVENT_LOCAL_PATH_KEYS = new Set([
  'folderPath',
  'imagePath',
  'thumbnailPath',
  'localPath',
  'filepath',
]);

export interface ConfigChangedSummary {
  version: number;
  sections: string[];
}

export type RendererAppEventSource =
  | 'booruService'
  | 'bulkDownloadService'
  | 'galleryService'
  | 'galleryRelocateService'
  | 'imageService'
  | 'invalidImageService'
  | 'thumbnailService'
  | 'configService'
  | 'backupService'
  | 'apiService'
  | 'downloadManager'
  | 'imageCacheService'
  | 'ipc';

export interface RendererAppEventBase<TType extends string, TPayload> {
  type: TType;
  version: 1;
  occurredAt: string;
  source: RendererAppEventSource;
  payload: TPayload;
}

export interface RendererBulkDownloadSessionsChangedPayload {
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
  originType?: 'favoriteTag' | 'favorites' | 'manual' | null;
  originId?: number | null;
}

export type RendererBulkDownloadSessionsChangedEvent = RendererAppEventBase<
  'bulk-download:sessions-changed',
  RendererBulkDownloadSessionsChangedPayload
>;

export interface RendererBulkDownloadTasksChangedPayload {
  taskId?: string;
  siteId?: number | null;
  action: 'created' | 'deduplicated' | 'updated' | 'deleted';
  affectedCount?: number;
}

export type RendererBulkDownloadTasksChangedEvent = RendererAppEventBase<
  'bulk-download:tasks-changed',
  RendererBulkDownloadTasksChangedPayload
>;

export interface RendererBulkDownloadRecordsChangedPayload {
  sessionId?: string;
  taskId?: string;
  recordId?: number;
  status?: BulkDownloadRecordStatus | string;
  previousStatus?: BulkDownloadRecordStatus | string;
  affectedCount?: number;
  action: 'created' | 'statusChanged' | 'pendingReset' | 'retryStarted' | 'retryMerged' | 'deleted';
}

export type RendererBulkDownloadRecordsChangedEvent = RendererAppEventBase<
  'bulk-download:records-changed',
  RendererBulkDownloadRecordsChangedPayload
>;

export interface RendererFavoriteTagDownloadCreatedPayload {
  favoriteTagId: number;
  tagName: string;
  siteId: number;
  taskId: string;
  sessionId: string;
  deduplicated?: boolean;
  status: 'starting' | 'pending' | 'queued' | 'dryRun' | 'running';
}

export type RendererFavoriteTagDownloadCreatedEvent = RendererAppEventBase<
  'favorite-tag-download:created',
  RendererFavoriteTagDownloadCreatedPayload
>;

export interface RendererFavoriteTagsChangedPayload {
  action:
    | 'created'
    | 'batchCreated'
    | 'updated'
    | 'deleted'
    | 'imported'
    | 'bindingUpserted'
    | 'bindingDeleted'
    | 'labelCreated'
    | 'labelDeleted'
    | 'downloadStateChanged';
  favoriteTagId?: number;
  siteId?: number | null;
  tagName?: string;
  affectedCount?: number;
}

export type RendererFavoriteTagsChangedEvent = RendererAppEventBase<
  'favorite-tags:changed',
  RendererFavoriteTagsChangedPayload
>;

export interface RendererBooruPostFavoriteChangedPayload {
  action: 'added' | 'removed' | 'repaired' | 'moved';
  siteId: number;
  postId: number;
  dbPostId?: number;
  isFavorited: boolean;
  favoriteId?: number;
  groupId?: number | null;
  affectedCount?: number;
  deletedIds?: number[];
}

export type RendererBooruPostFavoriteChangedEvent = RendererAppEventBase<
  'booru:post-favorite-changed',
  RendererBooruPostFavoriteChangedPayload
>;

export interface RendererBooruPostServerFavoriteChangedPayload {
  action: 'liked' | 'unliked' | 'synced';
  siteId: number;
  postId?: number;
  postIds?: number[];
  isLiked: boolean;
  affectedCount?: number;
}

export type RendererBooruPostServerFavoriteChangedEvent = RendererAppEventBase<
  'booru:post-server-favorite-changed',
  RendererBooruPostServerFavoriteChangedPayload
>;

export interface RendererBooruBlacklistTagsChangedPayload {
  action: 'created' | 'batchCreated' | 'updated' | 'deleted' | 'toggled' | 'imported';
  siteId?: number | null;
  blacklistTagId?: number;
  tagName?: string;
  isActive?: boolean;
  affectedCount?: number;
}

export type RendererBooruBlacklistTagsChangedEvent = RendererAppEventBase<
  'booru:blacklist-tags-changed',
  RendererBooruBlacklistTagsChangedPayload
>;

export interface RendererBooruSitesChangedPayload {
  action: 'created' | 'updated' | 'deleted' | 'activeChanged' | 'authChanged';
  siteId?: number;
  activeSiteId?: number | null;
  changedFields?: string[];
  affectedCount?: number;
}

export type RendererBooruSitesChangedEvent = RendererAppEventBase<
  'booru:sites-changed',
  RendererBooruSitesChangedPayload
>;

export interface RendererBooruFavoriteGroupsChangedPayload {
  action: 'created' | 'updated' | 'deleted' | 'favoriteMoved';
  siteId?: number | null;
  groupId?: number | null;
  favoriteId?: number;
  postId?: number;
  affectedCount?: number;
}

export type RendererBooruFavoriteGroupsChangedEvent = RendererAppEventBase<
  'booru:favorite-groups-changed',
  RendererBooruFavoriteGroupsChangedPayload
>;

export interface RendererBooruSavedSearchesChangedPayload {
  action: 'created' | 'updated' | 'deleted';
  searchId?: number;
  siteId?: number | null;
  /** 保存的搜索跨站点移动时的原站点 id（仅 action === 'updated' 且站点变更时存在） */
  previousSiteId?: number | null;
  affectedCount?: number;
}

export type RendererBooruSavedSearchesChangedEvent = RendererAppEventBase<
  'booru:saved-searches-changed',
  RendererBooruSavedSearchesChangedPayload
>;

export interface RendererBooruSearchHistoryChangedPayload {
  action: 'created' | 'cleared';
  siteId?: number | null;
  affectedCount?: number;
}

export type RendererBooruSearchHistoryChangedEvent = RendererAppEventBase<
  'booru:search-history-changed',
  RendererBooruSearchHistoryChangedPayload
>;

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

export type RendererBooruPostDownloadStateChangedEvent = RendererAppEventBase<
  'booru:post-download-state-changed',
  RendererBooruPostDownloadStateChangedPayload
>;

export interface RendererBooruPostVoteChangedPayload {
  siteId: number;
  postId: number;
  vote: 1 | 0 | -1;
  score?: number;
}

export type RendererBooruPostVoteChangedEvent = RendererAppEventBase<
  'booru:post-vote-changed',
  RendererBooruPostVoteChangedPayload
>;

export interface RendererBooruImageCacheClearedPayload {
  action: 'cleared';
  affectedCount?: number;
}

export type RendererBooruImageCacheClearedEvent = RendererAppEventBase<
  'booru:image-cache-cleared',
  RendererBooruImageCacheClearedPayload
>;

export interface RendererGalleryImagesImportedPayload {
  folderPath: string;
  galleryId?: number;
  imported: number;
  skipped: number;
  recursive?: boolean;
  imageCount?: number;
  lastScannedAt?: string;
  reason: 'scanAndImportFolder' | 'syncGalleryFolder' | 'scanSubfolders' | 'scanFolderIntoGallery';
}

export type RendererGalleryImagesImportedEvent = RendererAppEventBase<
  'gallery:images-imported',
  RendererGalleryImagesImportedPayload
>;

export interface RendererGalleryImagesChangedPayload {
  action: 'created' | 'deleted' | 'tagsUpdated' | 'invalidated' | 'batchImported' | 'membershipChanged';
  imageId?: number;
  galleryId?: number | null;
  affectedGalleryIds?: number[];
  affectedImageIds?: number[];
  affectedCount?: number;
  reason?: 'userDelete' | 'scan' | 'sync' | 'invalidReported';
  folderPath?: string;
  filepath?: string;
}

export type RendererGalleryImagesChangedEvent = RendererAppEventBase<
  'gallery:images-changed',
  RendererGalleryImagesChangedPayload
>;

export interface RendererGalleriesChangedPayload {
  galleryId?: number;
  action: 'created' | 'updated' | 'deleted' | 'statsUpdated' | 'coverChanged' | 'batchCreated';
  affectedCount?: number;
  folderPath?: string;
}

export type RendererGalleriesChangedEvent = RendererAppEventBase<
  'gallery:galleries-changed',
  RendererGalleriesChangedPayload
>;

export interface RendererGalleryInvalidImagesChangedPayload {
  invalidImageId?: number;
  originalImageId?: number;
  galleryId?: number | null;
  action: 'reported' | 'deleted' | 'cleared';
  affectedCount?: number;
  filepath?: string;
}

export type RendererGalleryInvalidImagesChangedEvent = RendererAppEventBase<
  'gallery:invalid-images-changed',
  RendererGalleryInvalidImagesChangedPayload
>;

export interface RendererGalleryIgnoredFoldersChangedPayload {
  ignoredFolderId?: number;
  folderPath?: string;
  action: 'created' | 'updated' | 'deleted';
  affectedCount?: number;
}

export type RendererGalleryIgnoredFoldersChangedEvent = RendererAppEventBase<
  'gallery:ignored-folders-changed',
  RendererGalleryIgnoredFoldersChangedPayload
>;

/**
 * 重定位根目录（applyRelocateRoot）成功提交后的全量失效事件。
 * 语义与 app:data-restored 同强度：整库路径前缀已被改写（不动 updatedAt），
 * 常驻缓存页面的既有增量事件（updatedAt 游标 / 按 id 补丁）感知不到变化，
 * 订阅方应整体重载（图集列表 / 网格图片 / 「最近」游标 / 文件夹丢失标记）。
 * payload 只带统计不带路径，避免本地路径经 API 事件桥外泄。
 */
export interface RendererGalleryPathsRelocatedPayload {
  /** 每个 (表, 列) 实际改写的行数（与 applyRelocateRoot 返回的 affected 一致） */
  affected: Array<{ table: string; column: string; count: number }>;
  /** 全部站点合计改写行数（0 改写的幂等重跑不发事件，故恒 > 0） */
  totalCount: number;
}

export type RendererGalleryPathsRelocatedEvent = RendererAppEventBase<
  'gallery:paths-relocated',
  RendererGalleryPathsRelocatedPayload
>;

export interface RendererThumbnailGeneratedPayload {
  imagePath: string;
  thumbnailPath?: string;
  success: boolean;
  error?: string;
  missing?: boolean;
}

export type RendererThumbnailGeneratedEvent = RendererAppEventBase<
  'thumbnail:generated',
  RendererThumbnailGeneratedPayload
>;

export type RendererConfigChangedEvent = RendererAppEventBase<'config:changed', ConfigChangedSummary>;

export interface RendererAppDataRestoredPayload {
  mode: 'merge' | 'replace';
  restoredTables: Array<{ table: string; count: number }>;
}

export type RendererAppDataRestoredEvent = RendererAppEventBase<
  'app:data-restored',
  RendererAppDataRestoredPayload
>;

export type RendererApiServiceStatusChangedPayload = ApiServiceStatus;

export type RendererApiServiceStatusChangedEvent = RendererAppEventBase<
  'api-service:status-changed',
  RendererApiServiceStatusChangedPayload
>;

export type RendererAppEvent =
  | RendererBulkDownloadSessionsChangedEvent
  | RendererBulkDownloadTasksChangedEvent
  | RendererBulkDownloadRecordsChangedEvent
  | RendererFavoriteTagDownloadCreatedEvent
  | RendererFavoriteTagsChangedEvent
  | RendererBooruPostFavoriteChangedEvent
  | RendererBooruPostServerFavoriteChangedEvent
  | RendererBooruBlacklistTagsChangedEvent
  | RendererBooruSitesChangedEvent
  | RendererBooruFavoriteGroupsChangedEvent
  | RendererBooruSavedSearchesChangedEvent
  | RendererBooruSearchHistoryChangedEvent
  | RendererBooruPostDownloadStateChangedEvent
  | RendererBooruPostVoteChangedEvent
  | RendererBooruImageCacheClearedEvent
  | RendererGalleryImagesImportedEvent
  | RendererGalleryImagesChangedEvent
  | RendererGalleriesChangedEvent
  | RendererGalleryInvalidImagesChangedEvent
  | RendererGalleryIgnoredFoldersChangedEvent
  | RendererGalleryPathsRelocatedEvent
  | RendererThumbnailGeneratedEvent
  | RendererConfigChangedEvent
  | RendererAppDataRestoredEvent
  | RendererApiServiceStatusChangedEvent;

export type ApiSafeRendererAppEvent = Omit<RendererAppEvent, 'payload'> & { payload: unknown };

export function resolveRendererAppEventApiChannel(type: RendererAppEvent['type']): ApiEventChannel {
  if (type.startsWith('booru:')) return 'booru';
  if (type.startsWith('bulk-download:') || type.startsWith('download:')) return 'downloads';
  if (type === 'favorite-tags:changed' || type === 'favorite-tag-download:created') return 'favorite-tags';
  return 'system';
}

function sanitizeApiEventPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeApiEventPayload);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (API_EVENT_LOCAL_PATH_KEYS.has(key)) {
      continue;
    }
    sanitized[key] = sanitizeApiEventPayload(item);
  }

  return sanitized;
}

export function toApiSafeRendererAppEvent(event: RendererAppEvent): ApiSafeRendererAppEvent {
  return {
    ...event,
    payload: sanitizeApiEventPayload(event.payload),
  } as ApiSafeRendererAppEvent;
}
