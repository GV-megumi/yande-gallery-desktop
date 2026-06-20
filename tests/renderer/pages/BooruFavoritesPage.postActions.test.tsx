/** @vitest-environment jsdom */

/**
 * TW-04 验收测试：BooruFavoritesPage 通过 useBooruPostActions 执行 post 操作，
 * 不再直接调用 window.electronAPI.booru.serverFavorite/serverUnfavorite/addToDownload。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
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
  BooruPageToolbar: (props: any) => (
    <div data-testid="page-toolbar">
      <button data-testid="rating-explicit" onClick={() => props.onRatingChange('explicit')}>
        explicit
      </button>
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/PaginationControl', () => ({
  PaginationControl: (props: any) => (
    <div
      data-testid="pagination-control"
      data-position={props.position}
      data-current-page={props.currentPage}
      data-current-count={props.currentCount}
      data-total={props.total ?? ''}
      data-disabled={String(Boolean(props.disabled))}
    >
      <button
        data-testid={`pagination-prev-${props.position}`}
        disabled={Boolean(props.disabled)}
        onClick={() => props.onPrevious?.()}
      >
        prev
      </button>
      <button
        data-testid={`pagination-next-${props.position}`}
        disabled={Boolean(props.disabled)}
        onClick={() => props.onNext?.()}
      >
        next
      </button>
      <button data-testid={`pagination-page-3-${props.position}`} onClick={() => props.onPageChange?.(3)}>
        page 3
      </button>
    </div>
  ),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ——————————————————————————————————————————
// electronAPI stubs
// ——————————————————————————————————————————
const booruApi = {
  getSites: vi.fn(),
  getFavoriteGroups: vi.fn(),
  getFavorites: vi.fn(),
  startFavoritesBulkDownload: vi.fn(),
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
    data: { items: [makePost()], total: 101 },
  });
  booruApi.startFavoritesBulkDownload.mockResolvedValue({
    success: true,
    data: { taskId: 'task-favorites', sessionId: 'session-favorites' },
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
  it('显示后端返回的收藏总数并传给分页控件', async () => {
    render(
      <AntApp>
        <BooruFavoritesPage />
      </AntApp>
    );

    expect(await screen.findByText('共 101 张收藏图')).toBeTruthy();

    await waitFor(() => {
      expect(booruApi.getFavorites).toHaveBeenCalledWith(1, 1, expect.any(Number), undefined, 'all');
    });

    const paginationControls = await screen.findAllByTestId('pagination-control');
    expect(paginationControls).toHaveLength(2);
    expect(paginationControls.every(control => control.getAttribute('data-total') === '101')).toBe(true);
  });

  it('点击一键下载时按当前站点、分组和评级创建收藏批量下载任务', async () => {
    render(
      <AntApp>
        <BooruFavoritesPage />
      </AntApp>
    );

    expect(await screen.findByTestId('grid-download-101')).toBeTruthy();

    fireEvent.click(screen.getByTestId('rating-explicit'));
    await waitFor(() => {
      expect(booruApi.getFavorites).toHaveBeenCalledWith(1, 1, expect.any(Number), undefined, 'explicit');
    });

    const downloadAllButton = await screen.findByRole('button', { name: /一键下载/ });
    fireEvent.click(downloadAllButton);

    await waitFor(() => {
      expect(booruApi.startFavoritesBulkDownload).toHaveBeenCalledWith({
        siteId: 1,
        groupId: undefined,
        rating: 'explicit',
      });
    });
  });

  it('loading page changes keep favorites pagination clickable and stale responses ignored', async () => {
    const page3 = deferred<{ success: true; data: { items: BooruPost[]; total: number } }>();
    const page4 = deferred<{ success: true; data: { items: BooruPost[]; total: number } }>();

    booruApi.getFavorites.mockImplementation((_siteId: number, page: number) => {
      if (page === 3) return page3.promise;
      if (page === 4) return page4.promise;
      return Promise.resolve({
        success: true,
        data: { items: [makePost({ id: 1, postId: 101 })], total: 101 },
      });
    });

    render(
      <AntApp>
        <BooruFavoritesPage />
      </AntApp>
    );

    expect(await screen.findByTestId('grid-download-101')).toBeTruthy();

    fireEvent.click(screen.getByTestId('pagination-page-3-bottom'));

    await waitFor(() => {
      expect(booruApi.getFavorites).toHaveBeenCalledWith(1, 3, 20, undefined, 'all');
    });
    expect(await screen.findByTestId('skeleton-grid')).toBeTruthy();
    const pendingControls = screen.getAllByTestId('pagination-control');
    expect(pendingControls).toHaveLength(2);
    expect(pendingControls[0].getAttribute('data-current-page')).toBe('3');

    const nextButton = screen.getByTestId('pagination-next-bottom') as HTMLButtonElement;
    expect(nextButton.disabled).toBe(false);
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(booruApi.getFavorites).toHaveBeenCalledWith(1, 4, 20, undefined, 'all');
    });

    await act(async () => {
      page4.resolve({
        success: true,
        data: { items: [makePost({ id: 4, postId: 401 })], total: 101 },
      });
      await Promise.resolve();
    });

    expect(await screen.findByTestId('grid-download-401')).toBeTruthy();

    await act(async () => {
      page3.resolve({
        success: true,
        data: { items: [makePost({ id: 3, postId: 301 })], total: 101 },
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId('grid-download-401')).toBeTruthy();
    expect(screen.queryByTestId('grid-download-301')).toBeNull();
  });

  it('已知总数请求到越界空页时应重载尾页而不是提交空状态', async () => {
    booruPreferencesApi.appearance.get.mockResolvedValueOnce({
      success: true,
      data: {
        gridSize: 330,
        previewQuality: 'auto',
        itemsPerPage: 30,
        paginationPosition: 'bottom',
        pageMode: 'pagination',
        spacing: 16,
        borderRadius: 8,
        margin: 24,
      },
    });
    booruApi.getFavorites.mockImplementation(async (_siteId: number, page: number) => {
      if (page === 3) {
        return { success: true, data: { items: [], total: 41 } };
      }
      if (page === 2) {
        return { success: true, data: { items: [makePost({ id: 2, postId: 102 })], total: 41 } };
      }
      return { success: true, data: { items: [makePost()], total: 41 } };
    });

    render(
      <AntApp>
        <BooruFavoritesPage />
      </AntApp>
    );

    expect(await screen.findByTestId('grid-download-101')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('pagination-page-3-bottom'));

    await waitFor(() => {
      expect(booruApi.getFavorites).toHaveBeenCalledWith(1, 3, 30, undefined, 'all');
    });
    await waitFor(() => {
      expect(booruApi.getFavorites).toHaveBeenCalledWith(1, 2, 30, undefined, 'all');
    });

    expect(await screen.findByTestId('grid-download-102')).toBeTruthy();
    expect(screen.queryByText('暂无收藏的图片')).toBeNull();
    expect(screen.getAllByTestId('pagination-control').some(control => control.getAttribute('data-current-page') === '2')).toBe(true);
  });

  it('评级切换后的加载失败不应继续显示旧列表和旧总数', async () => {
    booruApi.getFavorites.mockImplementation(async (_siteId: number, _page: number, _limit: number, _groupId: number | null | undefined, rating: string) => {
      if (rating === 'explicit') {
        return { success: false, error: 'load failed' };
      }
      return { success: true, data: { items: [makePost()], total: 101 } };
    });

    render(
      <AntApp>
        <BooruFavoritesPage />
      </AntApp>
    );

    expect(await screen.findByTestId('grid-download-101')).toBeTruthy();
    expect(await screen.findByText('共 101 张收藏图')).toBeTruthy();

    fireEvent.click(screen.getByTestId('rating-explicit'));

    await waitFor(() => {
      expect(booruApi.getFavorites).toHaveBeenCalledWith(1, 1, expect.any(Number), undefined, 'explicit');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('grid-download-101')).toBeNull();
    });
    expect(screen.queryByText('共 101 张收藏图')).toBeNull();
    expect(screen.getByText('共 0 张收藏图')).toBeTruthy();
  });

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

    // 精确断言：初始 serverFavorites 为空集合，首次点击应是 serverFavorite(1, 101)，
    // 不应错误地调用 serverUnfavorite（防止 wrong-dispatch 误报通过）
    await waitFor(() => {
      expect(booruApi.serverFavorite).toHaveBeenCalledWith(1, 101);
    });
    expect(booruApi.serverUnfavorite).not.toHaveBeenCalled();
  });
});
