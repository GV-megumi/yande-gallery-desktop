import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();
const runMock = vi.fn();
const runWithChangesMock = vi.fn();
const allMock = vi.fn();
const scanAndImportFolderMock = vi.fn();
const emitBuiltRendererAppEvent = vi.fn();

// Phase 4：syncGalleryFolder 扫描 gallery_folders 的全部绑定文件夹。统一入口内部：
//   scanAndImportFolder → ensureMembershipForFolder(runWithChanges) →
//   COUNT(*) gallery_images → updateGalleryStats(run) → emit；syncGalleryFolder 再 COUNT 一次聚合。
// 故 db mock：all 返回该图集的 gallery_folders 绑定行；get 对任意 gallery_images COUNT 返回固定 cnt，
// 首个非 COUNT 的 get 返回图集行。事件 reason 为 'scanFolderIntoGallery'。
// 行为契约不变：type=gallery:images-imported、imported/skipped/imageCount/recursive 正确，
// 且 imported=0 时不广播。
vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
  runWithChanges: (...args: any[]) => runWithChangesMock(...args),
  all: (...args: any[]) => allMock(...args),
  runInTransaction: async (_db: any, fn: () => Promise<any>) => fn(),
}));

vi.mock('../../../src/main/utils/path.js', () => ({
  normalizePath: (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, ''),
  // ensureMembershipForFolder 现会调用 escapeLike 转义 LIKE 前缀；mock 须导出它（与真实实现一致）。
  escapeLike: (s: string) => s.replace(/[\\%_]/g, (c: string) => '\\' + c),
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
    runWithChangesMock.mockResolvedValue({ changes: 0 });
    allMock.mockResolvedValue([]);
  });

  it('同步图集导入新图片后应广播 gallery:images-imported', async () => {
    const folderPath = 'D:\\gallery';
    // get：COUNT(*) gallery_images 一律返回 cnt:3（scanFolderIntoGallery 内 + 聚合各一次）；
    // 其余（getGallery）返回图集行。
    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (typeof sql === 'string' && sql.includes('COUNT(*) as cnt FROM gallery_images')) {
        return { cnt: 3 };
      }
      return {
        id: 7,
        folderPath,
        name: 'synced-gallery',
        imageCount: 0,
        isWatching: 1,
        recursive: 1,
        extensions: JSON.stringify(['.jpg']),
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      };
    });
    // all：返回该图集的 gallery_folders 绑定行（递归、扩展名 .jpg）
    allMock.mockImplementation(async (_db: any, sql: string) => {
      if (typeof sql === 'string' && sql.includes('FROM gallery_folders')) {
        return [{ folderPath, recursive: 1, extensions: JSON.stringify(['.jpg']) }];
      }
      return [];
    });
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
    // COUNT 现在以成员表为准
    expect(getMock).toHaveBeenCalledWith(
      {},
      'SELECT COUNT(*) as cnt FROM gallery_images WHERE galleryId = ?',
      [7],
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
        reason: 'scanFolderIntoGallery',
      }),
    }));
  });

  it('同步图集没有导入新图片时不应广播 gallery:images-imported', async () => {
    const folderPath = 'D:\\gallery';
    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (typeof sql === 'string' && sql.includes('COUNT(*) as cnt FROM gallery_images')) {
        return { cnt: 1 };
      }
      return {
        id: 7,
        folderPath,
        name: 'synced-gallery',
        imageCount: 1,
        isWatching: 1,
        recursive: 0,
        extensions: JSON.stringify(['.png']),
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      };
    });
    allMock.mockImplementation(async (_db: any, sql: string) => {
      if (typeof sql === 'string' && sql.includes('FROM gallery_folders')) {
        return [{ folderPath, recursive: 0, extensions: JSON.stringify(['.png']) }];
      }
      return [];
    });
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
