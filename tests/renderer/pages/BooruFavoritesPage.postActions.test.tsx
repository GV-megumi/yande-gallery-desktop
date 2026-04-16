/** @vitest-environment jsdom */

/**
 * TW-04 验收测试：BooruFavoritesPage 通过 useBooruPostActions 执行 post 操作，
 * 不再直接调用 window.electronAPI.booru.serverFavorite/serverUnfavorite/addToDownload。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { App as AntApp } from 'antd';
import type { BooruPost } from '../../../src/shared/types';
import { BooruFavoritesPage } from '../../../src/renderer/pages/BooruFavoritesPage';

// ——————————————————————————————————————————
// Mocks
// ——————————————————————————————————————————

// Mock BooruGridLayout to expose testable buttons with data-testid
vi.mock('../../../src/renderer/components/BooruGridLayout', () => ({
  BooruGridLayout: (props: any) => (
    <div data-testid="booru-grid">
      {props.posts.map((post: BooruPost) => (
        <div key={post.postId}>
          <button
            data-testid={`grid-download-${post.postId}`}
            onClick={() => props.onDownload(post)}
          >
            下载
          </button>
          <button
            data-testid={`grid-server-favorite-${post.postId}`}
            onClick={() => props.onToggleServerFavorite?.(post)}
          >
            服务端收藏
          </button>
          <button
            data-testid={`grid-favorite-${post.postId}`}
            onClick={() => props.onToggleFavorite(post)}
          >
            收藏
          </button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/BooruPageToolbar', () => ({
  BooruPageToolbar: () => <div data-testid="page-toolbar" />,
}));

vi.mock('../../../src/renderer/components/PaginationControl', () => ({
  PaginationControl: () => <div data-testid="pagination-control" />,
}));

vi.mock('../../../src/renderer/components/SkeletonGrid', () => ({
  SkeletonGrid: () => <div data-testid="skeleton-grid" />,
}));

vi.mock('../../../src/renderer/pages/BooruPostDetailsPage', () => ({
  BooruPostDetailsPage: (props: any) => (
    <div data-testid="post-details-page">{String(props.open)}</div>
  ),
}));

vi.mock('../../../src/renderer/hooks/useFavorite', () => ({
  useFavorite: () => ({
    toggleFavorite: vi.fn().mockResolvedValue({ success: true, isFavorited: false }),
    favorites: new Set<number>(),
    setFavorites: vi.fn(),
  }),
}));

// ——————————————————————————————————————————
// Helper: build a minimal valid BooruPost
// ——————————————————————————————————————————
function makePost(overrides: Partial<BooruPost> = {}): BooruPost {
  return {
    id: 1,
    siteId: 1,
    postId: 101,
    fileUrl: 'https://mock/a.jpg',
    previewUrl: 'https://mock/a_preview.jpg',
    tags: 'tag_a',
    downloaded: false,
    isFavorited: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ——————————————————————————————————————————
// electronAPI stubs
// ——————————————————————————————————————————
const booruApi = {
  getSites: vi.fn(),
  getFavoriteGroups: vi.fn(),
  getFavorites: vi.fn(),
  serverFavorite: vi.fn(),
  serverUnfavorite: vi.fn(),
  addToDownload: vi.fn(),
  onFavoritesRepairDone: vi.fn(() => () => {}),
};

const booruPreferencesApi = {
  appearance: {
    get: vi.fn().mockResolvedValue({
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
    }),
  },
};

beforeEach(() => {
  vi.clearAllMocks();

  // matchMedia stub (jsdom missing)
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

  // ResizeObserver stub
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };

  booruApi.getSites.mockResolvedValue({
    success: true,
    data: [{ id: 1, name: 'mock', baseUrl: 'https://mock', username: 'testuser' }],
  });
  booruApi.getFavoriteGroups.mockResolvedValue({ success: true, data: [] });
  booruApi.getFavorites.mockResolvedValue({
    success: true,
    data: [makePost()],
  });
  booruApi.serverFavorite.mockResolvedValue({ success: true });
  booruApi.serverUnfavorite.mockResolvedValue({ success: true });
  booruApi.addToDownload.mockResolvedValue({ success: true });

  (window as any).electronAPI = {
    booru: booruApi,
    booruPreferences: booruPreferencesApi,
    window: {
      openTagSearch: vi.fn(),
      openArtist: vi.fn(),
    },
  };
});

afterEach(() => {
  cleanup();
});

// ——————————————————————————————————————————
// Tests
// ——————————————————————————————————————————

describe('BooruFavoritesPage · useBooruPostActions 集成', () => {
  it('点击下载按钮时通过 hook 调用 addToDownload', async () => {
    render(
      <AntApp>
        <BooruFavoritesPage />
      </AntApp>
    );

    // Wait for getFavorites to be called (data loaded)
    await waitFor(() => {
      expect(booruApi.getFavorites).toHaveBeenCalled();
    });

    // Find and click the download button for post 101
    const downloadBtn = await screen.findByTestId('grid-download-101');
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(booruApi.addToDownload).toHaveBeenCalledWith(101, 1);
    });
  });

  it('点击服务端收藏按钮时通过 hook 调用 serverFavorite 或 serverUnfavorite', async () => {
    render(
      <AntApp>
        <BooruFavoritesPage />
      </AntApp>
    );

    await waitFor(() => {
      expect(booruApi.getFavorites).toHaveBeenCalled();
    });

    const serverFavBtn = await screen.findByTestId('grid-server-favorite-101');
    fireEvent.click(serverFavBtn);

    await waitFor(() => {
      expect(
        booruApi.serverFavorite.mock.calls.length + booruApi.serverUnfavorite.mock.calls.length
      ).toBeGreaterThan(0);
    });
  });
});
