/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import { BooruCharacterPage } from '../../../src/renderer/pages/BooruCharacterPage';

const getSites = vi.fn();
const searchPosts = vi.fn();
const getFavorites = vi.fn();
const isFavoriteTag = vi.fn();
const addToDownload = vi.fn();
const getAppearancePreference = vi.fn();
const getConfig = vi.fn();

vi.mock('../../../src/renderer/components/BooruGridLayout', () => ({
  BooruGridLayout: ({ posts, onDownload }: { posts: any[]; onDownload: (post: any) => void }) => (
    <div>
      <button onClick={() => onDownload(posts[0])}>触发下载</button>
      <div data-testid="post-count">{posts.length}</div>
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/BooruPageToolbar', () => ({
  BooruPageToolbar: () => <div data-testid="toolbar" />,
}));

vi.mock('../../../src/renderer/components/PaginationControl', () => ({
  PaginationControl: () => null,
}));

vi.mock('../../../src/renderer/components/SkeletonGrid', () => ({
  SkeletonGrid: () => null,
}));

vi.mock('../../../src/renderer/pages/BooruPostDetailsPage', () => ({
  BooruPostDetailsPage: () => null,
}));

vi.mock('../../../src/renderer/hooks/useFavorite', () => ({
  useFavorite: () => ({
    favorites: new Set<number>(),
    toggleFavorite: vi.fn().mockResolvedValue({ success: true }),
    setFavorites: vi.fn(),
  }),
}));

describe('BooruCharacterPage download bridge', () => {
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

    (globalThis as any).ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };

    getAppearancePreference.mockResolvedValue({
      success: true,
      data: {
        gridSize: 330,
        previewQuality: 'auto',
        itemsPerPage: 20,
        paginationPosition: 'bottom',
        pageMode: 'pagination',
        spacing: 16,
        borderRadius: 8,
        margin: 24,
      },
    });

    getSites.mockResolvedValue({
      success: true,
      data: [{ id: 1, name: 'Yande', url: 'https://yande.re' }],
    });

    searchPosts.mockResolvedValue({
      success: true,
      data: [
        {
          id: 101,
          postId: 12345,
          previewUrl: 'https://example.com/preview.jpg',
          fileUrl: 'https://example.com/file.jpg',
          width: 1000,
          height: 1500,
          rating: 'safe',
        },
      ],
    });

    getFavorites.mockResolvedValue({ success: true, data: [] });
    isFavoriteTag.mockResolvedValue({ success: true, data: false });
    addToDownload.mockResolvedValue({ success: true });

    (window as any).electronAPI = {
      booru: {
        getSites,
        searchPosts,
        getFavorites,
        isFavoriteTag,
        addToDownload,
        removeFavoriteTagByName: vi.fn(),
        addFavoriteTag: vi.fn(),
      },
      booruPreferences: {
        appearance: {
          get: getAppearancePreference,
          onChanged: vi.fn(),
        },
      },
      config: {
        get: getConfig,
      },
      window: {
        openTagSearch: vi.fn(),
      },
    };
  });

  it('应通过 booruPreferences.appearance.get 加载外观配置且不再调用 config.get', async () => {
    render(
      <App>
        <BooruCharacterPage characterName="asuka" />
      </App>
    );

    await waitFor(() => {
      expect(getAppearancePreference).toHaveBeenCalledTimes(1);
    });
    expect(getConfig).not.toHaveBeenCalled();
  });

  it('下载角色作品时应调用 booru.addToDownload(postId, siteId)', async () => {
    const user = userEvent.setup();

    render(
      <App>
        <BooruCharacterPage characterName="asuka" />
      </App>
    );

    expect(await screen.findByText('触发下载')).toBeTruthy();

    await waitFor(() => {
      expect(searchPosts).toHaveBeenCalledWith(1, ['asuka'], 1, 20);
    });

    await user.click(screen.getAllByRole('button', { name: '触发下载' })[0]);

    await waitFor(() => {
      expect(addToDownload).toHaveBeenCalledWith(12345, 1);
    });
  });
});
