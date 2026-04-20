import { describe, it, expect, vi } from 'vitest';
import type { AppConfig } from '../../../src/main/services/config.js';

// 与 config.test.ts 保持一致：mock 掉 fs/promises 与 js-yaml，避免真实 I/O
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
  },
}));

vi.mock('js-yaml', () => ({
  load: vi.fn(),
  dump: vi.fn(() => 'mocked yaml'),
}));

/**
 * 构造一份带 ui.pagePreferences.galleryBySubTab.galleries.selectedGalleryId=42 的完整 AppConfig。
 * 字段形态参考 tests/main/services/config.test.ts 已有的 base config。
 */
function baseConfigWithGalleryId(selectedGalleryId: number = 42): AppConfig {
  return {
    dataPath: 'data',
    database: { path: 'gallery.db', logging: true },
    downloads: { path: 'downloads', createSubfolders: true, subfolderFormat: ['tags'] },
    galleries: { folders: [] },
    thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp' },
    app: { recentImagesCount: 100, pageSize: 50, defaultViewMode: 'grid', showImageInfo: true, autoScan: true, autoScanInterval: 30 },
    yande: { apiUrl: 'https://yande.re/post.json', pageSize: 20, downloadTimeout: 60, maxConcurrentDownloads: 5 },
    logging: { level: 'info', filePath: 'app.log', consoleOutput: true, maxFileSize: 10, maxFiles: 5 },
    network: {
      proxy: {
        enabled: false,
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
      },
    },
    ui: {
      pagePreferences: {
        galleryBySubTab: {
          galleries: {
            gallerySearchQuery: 'cat',
            gallerySortKey: 'updatedAt',
            gallerySortOrder: 'desc',
            selectedGalleryId,
            gallerySort: 'time',
          },
        },
      },
    },
  } as AppConfig;
}

describe('normalizeConfigSaveInput - selectedGalleryId 三值合并语义', () => {
  it('selectedGalleryId = null 视为"显式删除"，合并结果中字段为 undefined', async () => {
    const { normalizeConfigSaveInput } = await import('../../../src/main/services/config.js');
    const current = baseConfigWithGalleryId(42);

    const merged = normalizeConfigSaveInput(current, {
      ui: {
        pagePreferences: {
          galleryBySubTab: {
            galleries: { selectedGalleryId: null as any },
          },
        },
      },
    } as any);

    const result = merged.ui?.pagePreferences?.galleryBySubTab?.galleries?.selectedGalleryId;
    expect(result).toBeUndefined();
  });

  it('selectedGalleryId = undefined（字段缺失）应保留旧值', async () => {
    const { normalizeConfigSaveInput } = await import('../../../src/main/services/config.js');
    const current = baseConfigWithGalleryId(42);

    const merged = normalizeConfigSaveInput(current, {
      ui: {
        pagePreferences: {
          galleryBySubTab: {
            // 只传其它字段，不提 selectedGalleryId
            galleries: { gallerySortKey: 'name' as any },
          },
        },
      },
    } as any);

    expect(merged.ui?.pagePreferences?.galleryBySubTab?.galleries?.selectedGalleryId).toBe(42);
  });

  it('selectedGalleryId = 具体 number 应覆盖旧值', async () => {
    const { normalizeConfigSaveInput } = await import('../../../src/main/services/config.js');
    const current = baseConfigWithGalleryId(42);

    const merged = normalizeConfigSaveInput(current, {
      ui: {
        pagePreferences: {
          galleryBySubTab: {
            galleries: { selectedGalleryId: 99 },
          },
        },
      },
    } as any);

    expect(merged.ui?.pagePreferences?.galleryBySubTab?.galleries?.selectedGalleryId).toBe(99);
  });
});
