import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = {
  favoriteTags: [
    { id: 1, siteId: 1, tagName: 'tag_a', labels: '[]', queryType: 'tag', notes: null, sortOrder: 1, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
    { id: 2, siteId: 1, tagName: 'tag_b', labels: '[]', queryType: 'tag', notes: null, sortOrder: 2, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
  ],
  bindings: [
    {
      id: 1,
      favoriteTagId: 1,
      galleryId: 10,
      downloadPath: 'D:/gallery/a',
      enabled: 1,
      autoCreateGallery: 0,
      autoSyncGalleryAfterDownload: 0,
      quality: 'original',
      perPage: 20,
      concurrency: 3,
      skipIfExists: 1,
      notifications: 1,
      blacklistedTags: '[]',
      lastTaskId: 'task-1',
      lastSessionId: 'session-1',
      lastStartedAt: '2024-01-02',
      lastCompletedAt: '2024-01-03',
      lastStatus: 'completed',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-03',
      galleryName: 'Gallery A',
    },
  ],
  galleries: [
    { id: 10, name: 'Gallery A', folderPath: 'D:/gallery/a' },
  ],
  sessions: [
    { id: 'session-1', taskId: 'task-1', status: 'completed', startedAt: '2024-01-02', completedAt: '2024-01-03', error: null, originType: 'favoriteTag', originId: 1, deletedAt: null },
  ],
};

vi.mock('../../../src/main/services/database', () => ({
  getDatabase: vi.fn(async () => ({})),
  run: vi.fn(async () => undefined),
  runWithChanges: vi.fn(async () => ({ changes: 1 })),
  runInTransaction: vi.fn(async (_db, fn) => fn()),
  get: vi.fn(async (_db, sql: string, params?: any[]) => {
    if (sql.includes('FROM booru_favorite_tags WHERE id = ?')) {
      return state.favoriteTags.find(tag => tag.id === params?.[0]);
    }
    if (sql.includes('FROM booru_favorite_tag_download_bindings b') && sql.includes('WHERE b.favoriteTagId = ?')) {
      return state.bindings.find(binding => binding.favoriteTagId === params?.[0]);
    }
    if (sql.includes('FROM galleries WHERE id = ?')) {
      return state.galleries.find(gallery => gallery.id === params?.[0]);
    }
    if (sql.includes('FROM bulk_download_sessions') && sql.includes('WHERE id = ?')) {
      return state.sessions.find(session => session.id === params?.[0]);
    }
    if (sql.includes('SUM(CASE WHEN r.status =')) {
      return { status: 'completed', completed: 1, failed: 0, total: 1, completedAt: '2024-01-03' };
    }
    return undefined;
  }),
  all: vi.fn(async (_db, sql: string, params?: any[]) => {
    if (sql.startsWith('SELECT * FROM booru_favorite_tags')) {
      return state.favoriteTags;
    }
    if (sql.includes('FROM booru_favorite_tag_download_bindings b')) {
      return state.bindings;
    }
    if (sql.includes('FROM galleries') && sql.includes('WHERE id IN')) {
      return state.galleries;
    }
    if (sql.includes('FROM bulk_download_sessions') && sql.includes("originType = 'favoriteTag'")) {
      return state.sessions
        .filter(session => session.originId === params?.[0])
        .map(session => ({
          sessionId: session.id,
          taskId: session.taskId,
          status: session.status,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
          error: session.error,
        }));
    }
    return [];
  }),
}));

vi.mock('../../../src/main/services/galleryService', () => ({
  createGallery: vi.fn(async () => ({ success: true, data: 10 })),
  getGallery: vi.fn(async () => ({ success: true, data: { id: 10, imageCount: 1 } })),
  updateGalleryStats: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../../src/main/services/imageService', () => ({
  scanAndImportFolder: vi.fn(async () => ({ success: true, data: { imported: 1, skipped: 0 } })),
}));

vi.mock('../../../src/main/services/bulkDownloadService', () => ({
  createBulkDownloadTask: vi.fn(async () => ({ success: true, data: { id: 'task-1' } })),
  createBulkDownloadSession: vi.fn(async () => ({ success: true, data: { id: 'session-1' } })),
  startBulkDownloadSession: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../../src/main/services/config', () => ({
  getConfig: vi.fn(() => ({ downloads: { path: 'downloads' } })),
  resolveConfigPath: vi.fn((p: string) => `C:/config/${p}`),
}));

describe('booruService integration-ish behavior', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('getFavoriteTagsWithDownloadState 应返回带 binding 和 galleryName 的 enriched 结果', async () => {
    const service = await import('../../../src/main/services/booruService');
    const result = await service.getFavoriteTagsWithDownloadState(1);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].downloadBinding?.favoriteTagId).toBe(1);
    expect(result[0].galleryName).toBe('Gallery A');
    expect(result[1].resolvedDownloadPath?.replace(/\\/g, '/')).toBe('C:/config/downloads/tag_b');
  });

  it('getFavoriteTagDownloadHistory 应返回 favoriteTag 来源会话', async () => {
    const service = await import('../../../src/main/services/booruService');
    const history = await service.getFavoriteTagDownloadHistory(1);

    expect(history).toHaveLength(1);
    expect(history[0].sessionId).toBe('session-1');
  });

  it('getGallerySourceFavoriteTags 应反查绑定到 gallery 的 favorite tags', async () => {
    const service = await import('../../../src/main/services/booruService');
    const tags = await service.getGallerySourceFavoriteTags(10);

    expect(tags).toHaveLength(1);
    expect(tags[0].tagName).toBe('tag_a');
  });
});
