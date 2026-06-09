import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: state.emitBuiltRendererAppEvent,
}));

describe('appEventPublisher', () => {
  beforeEach(() => {
    vi.resetModules();
    state.emitBuiltRendererAppEvent.mockReset();
  });

  it('publishes Booru domain events with booruService source', async () => {
    const publisher = await import('../../../src/main/services/appEventPublisher.js');

    publisher.emitBooruPostFavoriteChanged({ action: 'added', siteId: 1, postId: 101, isFavorited: true, favoriteId: 7 });
    publisher.emitBooruPostServerFavoriteChanged({ action: 'liked', siteId: 1, postId: 101, isLiked: true });
    publisher.emitBooruBlacklistTagsChanged({ action: 'toggled', siteId: 1, blacklistTagId: 9, isActive: false });
    publisher.emitBooruSitesChanged({ action: 'activeChanged', activeSiteId: 2 });
    publisher.emitBooruFavoriteGroupsChanged({ action: 'favoriteMoved', siteId: 1, groupId: 3, favoriteId: 7 });
    publisher.emitBooruSavedSearchesChanged({ action: 'deleted', siteId: 1, searchId: 4 });
    publisher.emitBooruSearchHistoryChanged({ action: 'cleared', siteId: 1, affectedCount: 5 });
    publisher.emitBooruPostDownloadStateChanged({ action: 'completed', siteId: 1, postId: 101, status: 'completed', localImageId: 12 });
    publisher.emitBooruPostVoteChanged({ siteId: 1, postId: 101, vote: 1, score: 42 });

    const cases = [
      { type: 'booru:post-favorite-changed', payload: { action: 'added', siteId: 1, postId: 101, isFavorited: true, favoriteId: 7 } },
      { type: 'booru:post-server-favorite-changed', payload: { action: 'liked', siteId: 1, postId: 101, isLiked: true } },
      { type: 'booru:blacklist-tags-changed', payload: { action: 'toggled', siteId: 1, blacklistTagId: 9, isActive: false } },
      { type: 'booru:sites-changed', payload: { action: 'activeChanged', activeSiteId: 2 } },
      { type: 'booru:favorite-groups-changed', payload: { action: 'favoriteMoved', siteId: 1, groupId: 3, favoriteId: 7 } },
      { type: 'booru:saved-searches-changed', payload: { action: 'deleted', siteId: 1, searchId: 4 } },
      { type: 'booru:search-history-changed', payload: { action: 'cleared', siteId: 1, affectedCount: 5 } },
      { type: 'booru:post-download-state-changed', payload: { action: 'completed', siteId: 1, postId: 101, status: 'completed', localImageId: 12 } },
      { type: 'booru:post-vote-changed', payload: { siteId: 1, postId: 101, vote: 1, score: 42 } },
    ];
    expect(state.emitBuiltRendererAppEvent).toHaveBeenCalledTimes(cases.length);
    cases.forEach((item, index) => {
      expect(state.emitBuiltRendererAppEvent).toHaveBeenNthCalledWith(index + 1, {
        type: item.type,
        source: 'booruService',
        payload: item.payload,
      });
    });
  });

  it('publishes image cache events with imageCacheService source', async () => {
    const { emitBooruImageCacheCleared } = await import('../../../src/main/services/appEventPublisher.js');

    emitBooruImageCacheCleared({ action: 'cleared', affectedCount: 3 });

    expect(state.emitBuiltRendererAppEvent).toHaveBeenCalledWith({
      type: 'booru:image-cache-cleared',
      source: 'imageCacheService',
      payload: { action: 'cleared', affectedCount: 3 },
    });
  });

  it('publishes Gallery domain events with service-specific sources', async () => {
    const publisher = await import('../../../src/main/services/appEventPublisher.js');

    publisher.emitGalleryImagesChanged({ action: 'deleted', imageId: 12, affectedImageIds: [12], affectedCount: 1 });
    publisher.emitGalleryImagesChanged({ action: 'invalidated', imageId: 13, affectedImageIds: [13], affectedCount: 1 }, 'invalidImageService');
    publisher.emitGalleryInvalidImagesChanged({ action: 'reported', originalImageId: 12, galleryId: 2, affectedCount: 1 });
    publisher.emitGalleryIgnoredFoldersChanged({ action: 'created', ignoredFolderId: 5, folderPath: 'D:/gallery/ignore' });
    publisher.emitGalleryGalleriesChanged({ action: 'statsUpdated', galleryId: 2, affectedCount: 1 });

    const cases = [
      { type: 'gallery:images-changed', source: 'imageService', payload: { action: 'deleted', imageId: 12, affectedImageIds: [12], affectedCount: 1 } },
      { type: 'gallery:images-changed', source: 'invalidImageService', payload: { action: 'invalidated', imageId: 13, affectedImageIds: [13], affectedCount: 1 } },
      { type: 'gallery:invalid-images-changed', source: 'invalidImageService', payload: { action: 'reported', originalImageId: 12, galleryId: 2, affectedCount: 1 } },
      { type: 'gallery:ignored-folders-changed', source: 'galleryService', payload: { action: 'created', ignoredFolderId: 5, folderPath: 'D:/gallery/ignore' } },
      { type: 'gallery:galleries-changed', source: 'galleryService', payload: { action: 'statsUpdated', galleryId: 2, affectedCount: 1 } },
    ];
    expect(state.emitBuiltRendererAppEvent).toHaveBeenCalledTimes(cases.length);
    cases.forEach((item, index) => {
      expect(state.emitBuiltRendererAppEvent).toHaveBeenNthCalledWith(index + 1, {
        type: item.type,
        source: item.source,
        payload: item.payload,
      });
    });
  });

  it('publishes bulk download events with bulkDownloadService source', async () => {
    const { emitBulkDownloadTasksChanged, emitBulkDownloadRecordsChanged } = await import('../../../src/main/services/appEventPublisher.js');

    emitBulkDownloadTasksChanged({ action: 'created', taskId: 'task-1', siteId: 1, affectedCount: 1 });
    emitBulkDownloadRecordsChanged({ action: 'statusChanged', sessionId: 'session-1', recordId: 8, status: 'completed' });

    expect(state.emitBuiltRendererAppEvent).toHaveBeenNthCalledWith(1, {
      type: 'bulk-download:tasks-changed',
      source: 'bulkDownloadService',
      payload: { action: 'created', taskId: 'task-1', siteId: 1, affectedCount: 1 },
    });
    expect(state.emitBuiltRendererAppEvent).toHaveBeenNthCalledWith(2, {
      type: 'bulk-download:records-changed',
      source: 'bulkDownloadService',
      payload: { action: 'statusChanged', sessionId: 'session-1', recordId: 8, status: 'completed' },
    });
  });

  it('publishes system events with config backup and api service sources', async () => {
    const publisher = await import('../../../src/main/services/appEventPublisher.js');

    publisher.emitConfigChanged({ version: 123, sections: ['apiService'] });
    publisher.emitAppDataRestored({ mode: 'replace', restoredTables: [{ table: 'booru_posts', count: 2 }] });
    publisher.emitApiServiceStatusChanged({
      enabled: true,
      running: true,
      mode: 'localhost',
      port: 37210,
      bindAddress: '127.0.0.1',
      baseUrl: 'http://127.0.0.1:37210',
      startedAt: '2026-06-09T00:00:00.000Z',
      lastError: null,
    });

    expect(state.emitBuiltRendererAppEvent).toHaveBeenNthCalledWith(1, {
      type: 'config:changed',
      source: 'configService',
      payload: { version: 123, sections: ['apiService'] },
    });
    expect(state.emitBuiltRendererAppEvent).toHaveBeenNthCalledWith(2, {
      type: 'app:data-restored',
      source: 'backupService',
      payload: { mode: 'replace', restoredTables: [{ table: 'booru_posts', count: 2 }] },
    });
    expect(state.emitBuiltRendererAppEvent).toHaveBeenNthCalledWith(3, {
      type: 'api-service:status-changed',
      source: 'apiService',
      payload: {
        enabled: true,
        running: true,
        mode: 'localhost',
        port: 37210,
        bindAddress: '127.0.0.1',
        baseUrl: 'http://127.0.0.1:37210',
        startedAt: '2026-06-09T00:00:00.000Z',
        lastError: null,
      },
    });
  });
});
