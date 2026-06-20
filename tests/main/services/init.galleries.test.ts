import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

/** 每个测试里动态 import 登记表，确保与 init.js 同一模块实例 */
async function getSnapshot(): Promise<string[]> {
  const { getGalleryRootsSnapshot } = await import('../../../src/main/services/galleryRootRegistry.js');
  return getGalleryRootsSnapshot();
}

/** 在每个测试里注册所有 init.ts 的重依赖 */
function mockHeavyDeps(): void {
  vi.doMock('../../../src/main/services/database.js', () => ({
    initDatabase: vi.fn(async () => ({ success: true })),
    closeDatabase: vi.fn(async () => {}),
  }));
  vi.doMock('../../../src/main/services/downloadManager.js', () => ({
    downloadManager: {
      resumePendingDownloads: vi.fn(async () => ({ resumed: 0 })),
      pauseAll: vi.fn(async () => true),
    },
  }));
  vi.doMock('../../../src/main/services/bulkDownloadService.js', () => ({
    resumeRunningSessions: vi.fn(async () => ({ success: true, data: { resumed: 0 } })),
    getActiveBulkDownloadSessions: vi.fn(async () => []),
    pauseBulkDownloadSession: vi.fn(async () => ({ success: true })),
  }));
  vi.doMock('../../../src/main/services/booruService.js', () => ({
    cleanExpiredTags: vi.fn(async () => 0),
  }));
  vi.doMock('../../../src/main/api/apiServiceManager.js', () => ({
    stopApiService: vi.fn(async () => {}),
  }));
}

describe('initGalleriesFromConfig 迁移 + 装载登记表', () => {
  it('DB 已有图库时跳过迁移，但仍按 DB 装载登记表', async () => {
    vi.doMock('../../../src/main/services/config.js', () => ({
      getConfig: vi.fn(() => ({ galleries: { folders: [{ path: 'M:/seed', name: 's', autoScan: true, recursive: true, extensions: ['.jpg'] }] } })),
    }));
    const createGallery = vi.fn(async () => ({ success: true, data: 1 }));
    const getGalleries = vi.fn(async () => ({ success: true, data: [{ id: 9, folderPath: 'M:/existing' }] }));
    vi.doMock('../../../src/main/services/galleryService.js', () => ({ createGallery, getGalleries }));
    vi.doMock('../../../src/main/utils/path.js', () => ({ normalizePath: (p: string) => p }));
    mockHeavyDeps();

    const { initGalleriesFromConfig } = await import('../../../src/main/services/init.js');
    await initGalleriesFromConfig();

    expect(createGallery).not.toHaveBeenCalled();
    expect(await getSnapshot()).toEqual(['M:/existing']);
  });

  it('DB 为空时从旧 config.folders 迁移建库，并装载登记表', async () => {
    const cfg: any = { galleries: { folders: [{ path: 'M:/seed', name: 's', autoScan: true, recursive: true, extensions: ['.jpg'] }] } };
    vi.doMock('../../../src/main/services/config.js', () => ({ getConfig: vi.fn(() => cfg) }));
    const createGallery = vi.fn(async () => ({ success: true, data: 1 }));
    const getGalleries = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [{ id: 1, folderPath: 'M:/seed' }] });
    vi.doMock('../../../src/main/services/galleryService.js', () => ({ createGallery, getGalleries }));
    vi.doMock('../../../src/main/utils/path.js', () => ({ normalizePath: (p: string) => p }));
    mockHeavyDeps();

    const { initGalleriesFromConfig } = await import('../../../src/main/services/init.js');
    await initGalleriesFromConfig();

    expect(createGallery).toHaveBeenCalledTimes(1);
    expect(await getSnapshot()).toEqual(['M:/seed']);
    expect(cfg.galleries).toBeUndefined();
  });
});
