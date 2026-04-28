import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';

const getMock = vi.fn();
const runMock = vi.fn();
const allMock = vi.fn();
const scanAndImportFolderMock = vi.fn();
const emitBuiltRendererAppEvent = vi.fn();

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
  all: (...args: any[]) => allMock(...args),
  runInTransaction: async (_db: any, fn: () => Promise<any>) => fn(),
}));

vi.mock('../../../src/main/utils/path.js', () => ({
  normalizePath: (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, ''),
}));

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: (...args: any[]) => scanAndImportFolderMock(...args),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent,
}));

describe('galleryService.syncGalleryFolder app event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    runMock.mockResolvedValue(undefined);
    allMock.mockResolvedValue([]);
  });

  it('同步图集导入新图片后应广播 gallery:images-imported', async () => {
    const folderPath = 'D:\\gallery';
    getMock
      .mockResolvedValueOnce({
        id: 7,
        folderPath,
        name: 'synced-gallery',
        imageCount: 0,
        isWatching: 1,
        recursive: 1,
        extensions: JSON.stringify(['.jpg']),
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      })
      .mockResolvedValueOnce({ cnt: 3 });
    scanAndImportFolderMock.mockResolvedValueOnce({
      success: true,
      data: { imported: 2, skipped: 1 },
    });

    const { syncGalleryFolder } = await import('../../../src/main/services/galleryService.js');
    const result = await syncGalleryFolder(7);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({
      imported: 2,
      skipped: 1,
      imageCount: 3,
    }));
    expect(scanAndImportFolderMock).toHaveBeenCalledWith(folderPath, ['.jpg'], true);
    expect(getMock).toHaveBeenCalledWith(
      {},
      'SELECT COUNT(*) as cnt FROM images WHERE filepath LIKE ?',
      [`${folderPath}${path.sep}%`],
    );
    expect(emitBuiltRendererAppEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'gallery:images-imported',
      source: 'galleryService',
      payload: expect.objectContaining({
        folderPath,
        galleryId: 7,
        imported: 2,
        skipped: 1,
        recursive: true,
        imageCount: 3,
        reason: 'syncGalleryFolder',
      }),
    }));
  });

  it('同步图集没有导入新图片时不应广播 gallery:images-imported', async () => {
    const folderPath = 'D:\\gallery';
    getMock
      .mockResolvedValueOnce({
        id: 7,
        folderPath,
        name: 'synced-gallery',
        imageCount: 1,
        isWatching: 1,
        recursive: 0,
        extensions: JSON.stringify(['.png']),
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      })
      .mockResolvedValueOnce({ cnt: 1 });
    scanAndImportFolderMock.mockResolvedValueOnce({
      success: true,
      data: { imported: 0, skipped: 1 },
    });

    const { syncGalleryFolder } = await import('../../../src/main/services/galleryService.js');
    const result = await syncGalleryFolder(7);

    expect(result.success).toBe(true);
    const appEventTypes = emitBuiltRendererAppEvent.mock.calls.map((call) => call[0]?.type);
    expect(appEventTypes).not.toContain('gallery:images-imported');
  });
});
