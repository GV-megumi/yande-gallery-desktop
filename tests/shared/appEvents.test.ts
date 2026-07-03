import { describe, expect, it } from 'vitest';
import {
  API_EVENT_CHANNELS,
  type ApiSafeRendererAppEvent,
  resolveRendererAppEventApiChannel,
  toApiSafeRendererAppEvent,
  type RendererAppEvent,
  type RendererAppEventSource,
} from '../../src/shared/types';

describe('RendererAppEvent contract', () => {
  it('routes domain events to stable API SSE channels', () => {
    expect(API_EVENT_CHANNELS).toEqual(['downloads', 'favorite-tags', 'booru', 'api-logs', 'system']);
    expect(resolveRendererAppEventApiChannel('booru:post-favorite-changed')).toBe('booru');
    expect(resolveRendererAppEventApiChannel('bulk-download:records-changed')).toBe('downloads');
    expect(resolveRendererAppEventApiChannel('favorite-tags:changed')).toBe('favorite-tags');
    expect(resolveRendererAppEventApiChannel('gallery:images-changed')).toBe('system');
    expect(resolveRendererAppEventApiChannel('config:changed')).toBe('system');
    // LAN 客户端图库事件频道契约（安卓相册 spec §5.5）：M2 移动端订阅 system 频道
    // 感知图库变更与数据恢复，防未来分支特判把这些事件挪出 system。
    expect(resolveRendererAppEventApiChannel('gallery:galleries-changed')).toBe('system');
    expect(resolveRendererAppEventApiChannel('app:data-restored')).toBe('system');
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

  it('keeps the planned event source contract available to service publishers', () => {
    const sources: RendererAppEventSource[] = [
      'booruService',
      'bulkDownloadService',
      'galleryService',
      'imageService',
      'invalidImageService',
      'thumbnailService',
      'configService',
      'backupService',
      'apiService',
      'downloadManager',
      'imageCacheService',
      'ipc',
    ];
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('locks representative planned payload contracts', () => {
    const events: RendererAppEvent[] = [
      {
        type: 'booru:sites-changed',
        version: 1,
        occurredAt: '2026-06-09T00:00:00.000Z',
        source: 'booruService',
        payload: { action: 'authChanged', siteId: 1, changedFields: ['passwordHash'] },
      },
      {
        type: 'bulk-download:records-changed',
        version: 1,
        occurredAt: '2026-06-09T00:00:00.000Z',
        source: 'bulkDownloadService',
        payload: { action: 'statusChanged', sessionId: 's1', recordId: 2, previousStatus: 'downloading', status: 'completed' },
      },
      {
        type: 'booru:post-download-state-changed',
        version: 1,
        occurredAt: '2026-06-09T00:00:00.000Z',
        source: 'booruService',
        payload: { action: 'removed', queueId: 3, siteId: 1, postId: 101, previousStatus: 'pending' },
      },
      {
        type: 'app:data-restored',
        version: 1,
        occurredAt: '2026-06-09T00:00:00.000Z',
        source: 'backupService',
        payload: { mode: 'replace', restoredTables: [{ table: 'booru_posts', count: 2 }] },
      },
      {
        type: 'api-service:status-changed',
        version: 1,
        occurredAt: '2026-06-09T00:00:00.000Z',
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
      },
    ];

    expect(events.map(event => event.type)).toEqual([
      'booru:sites-changed',
      'bulk-download:records-changed',
      'booru:post-download-state-changed',
      'app:data-restored',
      'api-service:status-changed',
    ]);
  });

  it('redacts local paths from API-safe event DTOs without mutating renderer events', () => {
    const event: RendererAppEvent = {
      type: 'gallery:images-changed',
      version: 1,
      occurredAt: '2026-06-09T00:00:00.000Z',
      source: 'galleryService',
      payload: {
        action: 'deleted',
        imageId: 12,
        affectedImageIds: [12],
        galleryId: 3,
        folderPath: 'D:/private/gallery',
        filepath: 'D:/private/gallery/a.jpg',
      },
    };

    const apiEvent: ApiSafeRendererAppEvent = toApiSafeRendererAppEvent(event);

    expect(apiEvent).toEqual({
      ...event,
      payload: {
        action: 'deleted',
        imageId: 12,
        affectedImageIds: [12],
        galleryId: 3,
      },
    });
    expect(event.payload).toHaveProperty('folderPath', 'D:/private/gallery');
  });
});
