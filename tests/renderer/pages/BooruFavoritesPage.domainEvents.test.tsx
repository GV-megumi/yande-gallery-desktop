/** @vitest-environment jsdom */

/**
 * BooruFavoritesPage 域事件回归测试：
 *   1. booru:sites-changed 重载站点列表时，必须保留用户手动选中的站点（不重置回第一个站点）
 *   2. 连续的 booru:post-favorite-changed 事件（如收藏修复逐条派发 removed）必须防抖合并，
 *      只触发一次收藏列表全量重查，避免 N 次刷新与乱序覆盖
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import { App as AntApp } from 'antd';
import type { BooruPost, RendererAppEvent } from '../../../src/shared/types';
import { BooruFavoritesPage } from '../../../src/renderer/pages/BooruFavoritesPage';

// ——————————————————————————————————————————
// Mocks
// ——————————————————————————————————————————

// Toolbar mock：暴露站点切换按钮与当前选中站点，便于断言选中状态
vi.mock('../../../src/renderer/components/BooruPageToolbar', () => ({
  BooruPageToolbar: (props: any) => (
    <div data-testid="page-toolbar">
      <span data-testid="selected-site">{String(props.selectedSiteId)}</span>
      {props.sites.map((site: any) => (
        <button
          data-testid={`toolbar-site-${site.id}`}
          key={site.id}
          onClick={() => props.onSiteChange(site.id)}
        >
          site {site.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/BooruGridLayout', () => ({
  BooruGridLayout: (props: any) => (
    <div data-testid="booru-grid">
      {props.posts.map((post: BooruPost) => (
        <div data-testid={`booru-card-${post.postId}`} key={post.postId}>
          {post.postId}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/PaginationControl', () => ({
  PaginationControl: () => <div data-testid="pagination-control" />,
}));

vi.mock('../../../src/renderer/components/SkeletonGrid', () => ({
  SkeletonGrid: () => <div data-testid="skeleton-grid" />,
}));

vi.mock('../../../src/renderer/pages/BooruPostDetailsPage', () => ({
  BooruPostDetailsPage: () => null,
}));

vi.mock('../../../src/renderer/hooks/useFavorite', () => ({
  useFavorite: () => ({
    toggleFavorite: vi.fn().mockResolvedValue({ success: true, isFavorited: false }),
    favorites: new Set<number>(),
    setFavorites: vi.fn(),
  }),
}));

// ——————————————————————————————————————————
// Helpers
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
    isFavorited: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function appEvent<TType extends RendererAppEvent['type']>(
  type: TType,
  payload: Extract<RendererAppEvent, { type: TType }>['payload'],
): Extract<RendererAppEvent, { type: TType }> {
  return {
    type,
    version: 1,
    occurredAt: '2026-06-09T00:00:00.000Z',
    source: 'booruService',
    payload,
  } as Extract<RendererAppEvent, { type: TType }>;
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

const onAppEvent = vi.fn();
let appEventCallback: ((event: RendererAppEvent) => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  appEventCallback = undefined;

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

  booruApi.getSites.mockResolvedValue({
    success: true,
    data: [
      { id: 1, name: 'SiteA', baseUrl: 'https://site-a' },
      { id: 2, name: 'SiteB', baseUrl: 'https://site-b' },
    ],
  });
  booruApi.getFavoriteGroups.mockResolvedValue({ success: true, data: [] });
  booruApi.getFavorites.mockResolvedValue({ success: true, data: [makePost()] });
  booruApi.onFavoritesRepairDone.mockImplementation(() => () => {});

  onAppEvent.mockImplementation((callback: (event: RendererAppEvent) => void) => {
    appEventCallback = callback;
    return vi.fn();
  });

  (window as any).electronAPI = {
    booru: booruApi,
    booruPreferences: {
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
    },
    window: {
      openTagSearch: vi.fn(),
      openArtist: vi.fn(),
    },
    system: {
      onAppEvent,
    },
  };
});

afterEach(() => {
  cleanup();
});

// ——————————————————————————————————————————
// Tests
// ——————————————————————————————————————————

describe('BooruFavoritesPage · booru:sites-changed 站点选择保持', () => {
  it('sites-changed 重载站点列表时保留用户手动选中的站点，不重置回第一个', async () => {
    render(
      <AntApp>
        <BooruFavoritesPage />
      </AntApp>
    );

    // 初始默认选中第一个站点
    await waitFor(() => {
      expect(screen.getByTestId('selected-site').textContent).toBe('1');
    });

    // 用户手动切换到站点 2
    fireEvent.click(screen.getByTestId('toolbar-site-2'));
    await waitFor(() => {
      expect(screen.getByTestId('selected-site').textContent).toBe('2');
    });

    // 排空切站触发的 loadFavorites 调用链后，再记录基准调用次数
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const favoriteCallsBefore = booruApi.getFavorites.mock.calls.length;

    // 模拟设置页修改站点信息触发 sites-changed：选中站点必须保留
    act(() => {
      appEventCallback?.(appEvent('booru:sites-changed', {
        action: 'updated',
        siteId: 1,
        changedFields: ['name'],
      }));
    });

    await waitFor(() => {
      expect(booruApi.getSites).toHaveBeenCalledTimes(2);
    });

    // 排空 loadSites 的 then 链，让任何（错误的）选中重置有机会生效
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('selected-site').textContent).toBe('2');
    // 选中未变化 → 不应触发额外的收藏列表重载
    expect(booruApi.getFavorites.mock.calls.length).toBe(favoriteCallsBefore);
  });
});

describe('BooruFavoritesPage · 收藏域事件防抖刷新', () => {
  it('连续多条 post-favorite-changed 事件只触发一次收藏列表重查', async () => {
    render(
      <AntApp>
        <BooruFavoritesPage />
      </AntApp>
    );

    await waitFor(() => {
      expect(booruApi.getFavorites).toHaveBeenCalled();
    });
    expect(await screen.findByTestId('booru-card-101')).toBeTruthy();

    const callsBefore = booruApi.getFavorites.mock.calls.length;

    // 模拟收藏修复逐条派发 removed 事件（同一站点，短时间内连续 3 条）
    act(() => {
      for (const postId of [101, 102, 103]) {
        appEventCallback?.(appEvent('booru:post-favorite-changed', {
          action: 'removed',
          siteId: 1,
          postId,
          isFavorited: false,
        }));
      }
    });

    // 防抖窗口结束后只应有一次重查
    await waitFor(() => {
      expect(booruApi.getFavorites.mock.calls.length).toBe(callsBefore + 1);
    });

    // 再等待一段时间，确认没有滞后的重复请求
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 120));
    });
    expect(booruApi.getFavorites.mock.calls.length).toBe(callsBefore + 1);
  });
});
