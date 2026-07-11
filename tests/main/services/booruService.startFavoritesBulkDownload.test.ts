import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';

const createBulkDownloadTask = vi.fn();
const createBulkDownloadSession = vi.fn();
const createBulkDownloadRecords = vi.fn();
const startBulkDownloadSession = vi.fn();
const generateBulkDownloadFileName = vi.fn();
const createBooruClient = vi.fn();
const mkdirMock = vi.fn();
const existsSyncMock = vi.fn();
const createGalleryMock = vi.fn();

vi.mock('../../../src/main/services/bulkDownloadService.js', () => ({
  createBulkDownloadTask: (...args: any[]) => createBulkDownloadTask(...args),
  createBulkDownloadSession: (...args: any[]) => createBulkDownloadSession(...args),
  createBulkDownloadRecords: (...args: any[]) => createBulkDownloadRecords(...args),
  startBulkDownloadSession: (...args: any[]) => startBulkDownloadSession(...args),
  generateBulkDownloadFileName: (...args: any[]) => generateBulkDownloadFileName(...args),
}));

vi.mock('../../../src/main/services/booruClientFactory.js', () => ({
  createBooruClient: (...args: any[]) => createBooruClient(...args),
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: (...args: any[]) => mkdirMock(...args),
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: any[]) => existsSyncMock(...args),
  },
  existsSync: (...args: any[]) => existsSyncMock(...args),
}));

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: vi.fn(() => ({ downloads: { path: 'downloads' } })),
  getDownloadsPath: vi.fn(() => 'M:\\downloads'),
  resolveConfigPath: vi.fn((value: string) => value),
}));

vi.mock('../../../src/main/services/galleryService.js', () => ({
  createGallery: (...args: any[]) => createGalleryMock(...args),
  getGallery: vi.fn(),
  updateGalleryStats: vi.fn(),
}));

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));

const getMock = vi.fn();
const allMock = vi.fn();
const runMock = vi.fn();

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  all: (...args: any[]) => allMock(...args),
  run: (...args: any[]) => runMock(...args),
  runWithChanges: (...args: any[]) => runMock(...args),
  runInTransaction: async (_db: any, fn: () => Promise<void>) => fn(),
}));

describe('booruService.startFavoritesBulkDownload', () => {
  beforeEach(() => {
    vi.resetModules();
    createBulkDownloadTask.mockReset();
    createBulkDownloadSession.mockReset();
    createBulkDownloadRecords.mockReset();
    startBulkDownloadSession.mockReset();
    generateBulkDownloadFileName.mockReset();
    createBooruClient.mockReset();
    mkdirMock.mockReset();
    existsSyncMock.mockReset();
    createGalleryMock.mockReset();
    getMock.mockReset();
    allMock.mockReset();
    runMock.mockReset();

    getMock.mockImplementation(async (_db: unknown, sql: string) => {
      if (/FROM booru_sites/.test(sql)) {
        return {
          id: 3,
          name: 'Yande:/Unsafe',
          type: 'moebooru',
          url: 'https://yande.re',
          active: 1,
          favoriteSupport: 1,
          createdAt: '2026-06-20T00:00:00.000Z',
          updatedAt: '2026-06-20T00:00:00.000Z',
        };
      }
      return undefined;
    });

    allMock.mockImplementation(async (_db: unknown, sql: string) => {
      if (/FROM booru_posts p/.test(sql) && /INNER JOIN booru_favorites f/.test(sql)) {
        return [
          {
            id: 101,
            siteId: 3,
            postId: 9001,
            md5: 'aaaabbbbccccdddd',
            fileUrl: 'https://img.example/9001.jpg',
            previewUrl: 'https://img.example/preview-9001.jpg',
            sampleUrl: null,
            width: 1000,
            height: 800,
            rating: 'safe',
            score: 10,
            source: 'https://source.example/9001',
            tags: 'tag_a tag_b',
            downloaded: 0,
            isFavorited: 1,
            favoriteGroupId: null,
          },
          {
            id: 102,
            siteId: 3,
            postId: 9002,
            md5: 'downloaded',
            fileUrl: 'https://img.example/9002.jpg',
            previewUrl: 'https://img.example/preview-9002.jpg',
            tags: 'tag_c',
            rating: 'safe',
            downloaded: 1,
            isFavorited: 1,
            favoriteGroupId: null,
          },
          {
            id: 103,
            siteId: 3,
            postId: 9003,
            md5: 'exists',
            fileUrl: 'https://img.example/9003.png',
            previewUrl: 'https://img.example/preview-9003.jpg',
            tags: 'tag_d',
            rating: 'safe',
            downloaded: 0,
            isFavorited: 1,
            favoriteGroupId: null,
          },
        ];
      }
      return [];
    });

    createBulkDownloadTask.mockResolvedValue({
      success: true,
      data: { id: 'task-favorites' },
    });
    createBulkDownloadSession.mockResolvedValue({
      success: true,
      data: { id: 'session-favorites', status: 'pending' },
    });
    startBulkDownloadSession.mockResolvedValue({ success: true });
    createGalleryMock.mockResolvedValue({ success: true, data: 77 });
    generateBulkDownloadFileName.mockImplementation(async (post: any) => (
      post.id === 9003 ? 'already-exists.png' : `${post.id}.jpg`
    ));
    existsSyncMock.mockImplementation((value: string) => value.endsWith(`${path.sep}already-exists.png`));
  });

  it('创建独立目录、favorites origin 会话，并只用本地收藏预生成待下载记录', async () => {
    const { startFavoritesBulkDownload } = await import('../../../src/main/services/booruService.js');

    const result = await startFavoritesBulkDownload({
      siteId: 3,
      groupId: null,
      rating: 'safe',
    });

    expect(result).toEqual({ taskId: 'task-favorites', sessionId: 'session-favorites' });
    expect(createBooruClient).not.toHaveBeenCalled();
    const expectedDownloadPath = path.join('M:\\downloads', 'Yande__Unsafe_favorites');
    expect(mkdirMock).toHaveBeenCalledWith(expectedDownloadPath, { recursive: true });
    expect(createGalleryMock).toHaveBeenCalledWith({
      folderPath: expectedDownloadPath,
      name: 'Yande:/Unsafe 收藏相册',
      isWatching: true,
      recursive: true,
    });
    expect(mkdirMock.mock.invocationCallOrder[0]).toBeLessThan(createGalleryMock.mock.invocationCallOrder[0]);
    expect(createBulkDownloadTask).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 3,
      path: expectedDownloadPath,
      tags: [],
      skipIfExists: true,
    }));
    expect(runMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('SET originType = ?, originId = ?'),
      ['favorites', 3, 'session-favorites'],
    );
    expect(generateBulkDownloadFileName).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 9001,
        file_url: 'https://img.example/9001.jpg',
        preview_url: 'https://img.example/preview-9001.jpg',
      }),
      expect.objectContaining({ id: 'task-favorites' }),
      'Yande:/Unsafe',
    );
    expect(createBulkDownloadRecords).toHaveBeenCalledWith([
      expect.objectContaining({
        sessionId: 'session-favorites',
        url: 'https://img.example/9001.jpg',
        status: 'pending',
        fileName: '9001.jpg',
        extension: 'jpg',
        thumbnailUrl: 'https://img.example/preview-9001.jpg',
        sourceUrl: 'https://source.example/9001',
      }),
    ]);
    expect(startBulkDownloadSession).toHaveBeenCalledWith('session-favorites');

    const favoriteQuery = allMock.mock.calls.find((call) => /FROM booru_posts p/.test(String(call[1])));
    expect(String(favoriteQuery?.[1])).toContain('f.groupId IS NULL');
    expect(String(favoriteQuery?.[1])).toContain('p.rating = ?');
  });
});
