import type {
  RendererApiServiceStatusChangedEvent,
  RendererAppDataRestoredEvent,
  RendererBooruBlacklistTagsChangedEvent,
  RendererBooruFavoriteGroupsChangedEvent,
  RendererBooruImageCacheClearedEvent,
  RendererBooruPostDownloadStateChangedEvent,
  RendererBooruPostFavoriteChangedEvent,
  RendererBooruPostServerFavoriteChangedEvent,
  RendererBooruPostVoteChangedEvent,
  RendererBooruSavedSearchesChangedEvent,
  RendererBooruSearchHistoryChangedEvent,
  RendererBooruSitesChangedEvent,
  RendererBulkDownloadRecordsChangedEvent,
  RendererBulkDownloadTasksChangedEvent,
  RendererConfigChangedEvent,
  RendererGalleriesChangedEvent,
  RendererGalleryIgnoredFoldersChangedEvent,
  RendererGalleryImagesChangedEvent,
  RendererGalleryInvalidImagesChangedEvent,
  RendererGalleryPathsRelocatedEvent,
  RendererAppEventSource,
} from '../../shared/types.js';
import { emitBuiltRendererAppEvent } from './rendererEventBus.js';

export function emitBooruPostFavoriteChanged(payload: RendererBooruPostFavoriteChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererBooruPostFavoriteChangedEvent>({
    type: 'booru:post-favorite-changed',
    source: 'booruService',
    payload,
  });
}

export function emitBooruPostServerFavoriteChanged(payload: RendererBooruPostServerFavoriteChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererBooruPostServerFavoriteChangedEvent>({
    type: 'booru:post-server-favorite-changed',
    source: 'booruService',
    payload,
  });
}

export function emitBooruBlacklistTagsChanged(payload: RendererBooruBlacklistTagsChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererBooruBlacklistTagsChangedEvent>({
    type: 'booru:blacklist-tags-changed',
    source: 'booruService',
    payload,
  });
}

export function emitBooruSitesChanged(payload: RendererBooruSitesChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererBooruSitesChangedEvent>({
    type: 'booru:sites-changed',
    source: 'booruService',
    payload,
  });
}

export function emitBooruFavoriteGroupsChanged(payload: RendererBooruFavoriteGroupsChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererBooruFavoriteGroupsChangedEvent>({
    type: 'booru:favorite-groups-changed',
    source: 'booruService',
    payload,
  });
}

export function emitBooruSavedSearchesChanged(payload: RendererBooruSavedSearchesChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererBooruSavedSearchesChangedEvent>({
    type: 'booru:saved-searches-changed',
    source: 'booruService',
    payload,
  });
}

export function emitBooruSearchHistoryChanged(payload: RendererBooruSearchHistoryChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererBooruSearchHistoryChangedEvent>({
    type: 'booru:search-history-changed',
    source: 'booruService',
    payload,
  });
}

export function emitBooruPostDownloadStateChanged(payload: RendererBooruPostDownloadStateChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererBooruPostDownloadStateChangedEvent>({
    type: 'booru:post-download-state-changed',
    source: 'booruService',
    payload,
  });
}

export function emitBooruPostVoteChanged(payload: RendererBooruPostVoteChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererBooruPostVoteChangedEvent>({
    type: 'booru:post-vote-changed',
    source: 'booruService',
    payload,
  });
}

export function emitBooruImageCacheCleared(payload: RendererBooruImageCacheClearedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererBooruImageCacheClearedEvent>({
    type: 'booru:image-cache-cleared',
    source: 'imageCacheService',
    payload,
  });
}

export function emitGalleryImagesChanged(
  payload: RendererGalleryImagesChangedEvent['payload'],
  source: RendererAppEventSource = 'imageService',
): void {
  emitBuiltRendererAppEvent<RendererGalleryImagesChangedEvent>({
    type: 'gallery:images-changed',
    source,
    payload,
  });
}

export function emitGalleryInvalidImagesChanged(payload: RendererGalleryInvalidImagesChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererGalleryInvalidImagesChangedEvent>({
    type: 'gallery:invalid-images-changed',
    source: 'invalidImageService',
    payload,
  });
}

export function emitGalleryIgnoredFoldersChanged(payload: RendererGalleryIgnoredFoldersChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererGalleryIgnoredFoldersChangedEvent>({
    type: 'gallery:ignored-folders-changed',
    source: 'galleryService',
    payload,
  });
}

export function emitGalleryGalleriesChanged(payload: RendererGalleriesChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererGalleriesChangedEvent>({
    type: 'gallery:galleries-changed',
    source: 'galleryService',
    payload,
  });
}

export function emitGalleryPathsRelocated(payload: RendererGalleryPathsRelocatedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererGalleryPathsRelocatedEvent>({
    type: 'gallery:paths-relocated',
    source: 'galleryRelocateService',
    payload,
  });
}

export function emitBulkDownloadTasksChanged(payload: RendererBulkDownloadTasksChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererBulkDownloadTasksChangedEvent>({
    type: 'bulk-download:tasks-changed',
    source: 'bulkDownloadService',
    payload,
  });
}

export function emitBulkDownloadRecordsChanged(payload: RendererBulkDownloadRecordsChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererBulkDownloadRecordsChangedEvent>({
    type: 'bulk-download:records-changed',
    source: 'bulkDownloadService',
    payload,
  });
}

export function emitConfigChanged(payload: RendererConfigChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererConfigChangedEvent>({
    type: 'config:changed',
    source: 'configService',
    payload,
  });
}

export function emitAppDataRestored(payload: RendererAppDataRestoredEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererAppDataRestoredEvent>({
    type: 'app:data-restored',
    source: 'backupService',
    payload,
  });
}

export function emitApiServiceStatusChanged(payload: RendererApiServiceStatusChangedEvent['payload']): void {
  emitBuiltRendererAppEvent<RendererApiServiceStatusChangedEvent>({
    type: 'api-service:status-changed',
    source: 'apiService',
    payload,
  });
}
