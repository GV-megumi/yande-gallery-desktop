/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { FavoriteTagsPage } from '../../../src/renderer/pages/FavoriteTagsPage';

const getFavoriteTagsWithDownloadState = vi.fn();
const getSites = vi.fn();
const getGalleries = vi.fn();
const getFavoriteTagsPagePreferences = vi.fn();
const saveFavoriteTagsPagePreferences = vi.fn();

vi.mock('../../../src/renderer/locales', () => ({
  useLocale: () => ({
    locale: 'zh-CN',
    setLocale: vi.fn(),
    t: (key: string, params?: Record<string, any>) => {
      if (params?.count !== undefined) return `${key}:${params.count}`;
      if (params?.name) return `${key}:${params.name}`;
      return key;
    },
  }),
}));

function renderPage() {
  return render(
    <AntdApp>
      <FavoriteTagsPage />
    </AntdApp>
  );
}

describe('FavoriteTagsPage sorting controls', () => {
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

    getSites.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Yande' }] });
    getGalleries.mockResolvedValue({ success: true, data: [] });
    getFavoriteTagsWithDownloadState.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 1,
            siteId: 1,
            tagName: 'tag_a',
            labels: [],
            queryType: 'tag',
            notes: null,
            sortOrder: 1,
            createdAt: '2024-01-01',
            updatedAt: '2024-01-01',
            galleryName: 'Gallery A',
            galleryBindingConsistent: true,
            runtimeProgress: null,
          },
        ],
        total: 1,
      },
    });
    getFavoriteTagsPagePreferences.mockResolvedValue({
      success: true,
      data: {
        sortKey: 'galleryName',
        sortOrder: 'desc',
        page: 1,
        pageSize: 20,
      },
    });
    saveFavoriteTagsPagePreferences.mockResolvedValue({ success: true });

    (window as any).electronAPI = {
      booru: {
        getFavoriteTagsWithDownloadState,
        getSites,
        addFavoriteTag: vi.fn(),
        updateFavoriteTag: vi.fn(),
        removeFavoriteTag: vi.fn(),
        exportFavoriteTags: vi.fn(),
        importFavoriteTagsPickFile: vi.fn(),
        importFavoriteTagsCommit: vi.fn(),
        startFavoriteTagBulkDownload: vi.fn(),
        upsertFavoriteTagDownloadBinding: vi.fn(),
        removeFavoriteTagDownloadBinding: vi.fn(),
        getFavoriteTagDownloadHistory: vi.fn(),
        getGallerySourceFavoriteTags: vi.fn(),
      },
      gallery: {
        getGalleries,
      },
      pagePreferences: {
        favoriteTags: {
          get: getFavoriteTagsPagePreferences,
          save: saveFavoriteTagsPagePreferences,
        },
      },
      system: {
        onBulkDownloadRecordProgress: vi.fn(() => () => {}),
        onBulkDownloadRecordStatus: vi.fn(() => () => {}),
        onAppEvent: vi.fn(() => () => {}),
        selectFolder: vi.fn(),
      },
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps normal sort controls and sends selected sort to the paginated API', async () => {
    renderPage();

    await waitFor(() => {
      expect(getFavoriteTagsWithDownloadState).toHaveBeenCalledWith(expect.objectContaining({
        sortKey: 'galleryName',
        sortOrder: 'desc',
      }));
    });

    expect(await screen.findByText('favoriteTags.sortByGalleryName')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'favoriteTags.sortDescending' })).toBeTruthy();
  });
});
