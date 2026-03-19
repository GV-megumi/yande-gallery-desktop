/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FavoriteTagsPage } from '../../../src/renderer/pages/FavoriteTagsPage';

const getFavoriteTagsWithDownloadState = vi.fn();
const getSites = vi.fn();
const getGalleries = vi.fn();

vi.mock('../../../src/renderer/locales', () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (params?.name) return `${key}:${params.name}`;
      if (params?.count !== undefined) return `${key}:${params.count}`;
      return key;
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(window, 'getComputedStyle', {
    writable: true,
    value: (element: Element, pseudoElt?: string | null) => originalGetComputedStyle(element, pseudoElt || undefined),
  });

  (window as any).electronAPI = {
    booru: {
      getFavoriteTagsWithDownloadState,
      getSites,
      addFavoriteTag: vi.fn(),
      updateFavoriteTag: vi.fn(),
      removeFavoriteTag: vi.fn(),
      exportFavoriteTags: vi.fn(),
      importFavoriteTags: vi.fn(),
      startFavoriteTagBulkDownload: vi.fn(),
      upsertFavoriteTagDownloadBinding: vi.fn(),
      removeFavoriteTagDownloadBinding: vi.fn(),
      getFavoriteTagDownloadHistory: vi.fn(),
      getGallerySourceFavoriteTags: vi.fn(),
    },
    gallery: {
      getGalleries,
    },
    system: {
      onBulkDownloadRecordProgress: vi.fn(() => () => {}),
      onBulkDownloadRecordStatus: vi.fn(() => () => {}),
      selectFolder: vi.fn(),
    },
  };
});

describe('FavoriteTagsPage render behavior', () => {
  it('应渲染下载相关列和收藏标签数据', async () => {
    getSites.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Yande' }] });
    getGalleries.mockResolvedValue({ success: true, data: [] });
    getFavoriteTagsWithDownloadState.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          siteId: 1,
          tagName: 'tag_a',
          labels: ['group1'],
          queryType: 'tag',
          notes: 'note',
          sortOrder: 1,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          galleryName: 'Gallery A',
          galleryBindingConsistent: true,
          downloadBinding: {
            id: 1,
            favoriteTagId: 1,
            galleryId: 1,
            downloadPath: 'D:/gallery/a',
            enabled: true,
            createdAt: '2024-01-01',
            updatedAt: '2024-01-01',
            lastStatus: 'completed',
          },
          runtimeProgress: null,
        },
      ],
    });

    render(<FavoriteTagsPage />);

    await waitFor(() => {
      expect(getFavoriteTagsWithDownloadState).toHaveBeenCalled();
    });

    expect(screen.getByText('favoriteTags.count:1')).toBeTruthy();
    expect(screen.getByText('tag a')).toBeTruthy();
    expect(screen.getByText('favoriteTags.completed')).toBeTruthy();
    expect(screen.getByText('common.export')).toBeTruthy();
    expect(screen.getByText('common.import')).toBeTruthy();
  });

  it('图集绑定不一致时应显示 warning 提示', async () => {
    getSites.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Yande' }] });
    getGalleries.mockResolvedValue({ success: true, data: [] });
    getFavoriteTagsWithDownloadState.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          siteId: 1,
          tagName: 'tag_b',
          labels: [],
          queryType: 'tag',
          notes: null,
          sortOrder: 1,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          galleryName: 'Gallery B',
          galleryBindingConsistent: false,
          galleryBindingMismatchReason: 'pathMismatch',
          downloadBinding: {
            id: 2,
            favoriteTagId: 1,
            galleryId: 2,
            downloadPath: 'D:/wrong',
            enabled: true,
            createdAt: '2024-01-01',
            updatedAt: '2024-01-01',
            lastStatus: 'ready',
          },
          runtimeProgress: null,
        },
      ],
    });

    render(<FavoriteTagsPage />);

    expect(await screen.findByText('favoriteTags.galleryBindingMismatchAlert')).toBeTruthy();
  });
});
