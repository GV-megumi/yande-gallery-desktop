/** @vitest-environment jsdom */

/**
 * BooruServerFavoritesPage 域事件回归测试：
 *   1. booru:post-server-favorite-changed 的 synced 事件不得触发再次拉取——
 *      该事件由本页面自身的 getServerFavorites 拉取（主进程同步 isLiked）产生，
 *      若响应它再次拉取会形成 拉取 → 事件 → 拉取 的远端请求死循环
 *   2. 真实的 liked 事件应刷新当前页，而不是把分页位置弹回第 1 页
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import { App as AntApp } from 'antd';
import type { BooruPost, RendererAppEvent } from '../../../src/shared/types';
import { BooruServerFavoritesPage } from '../../../src/renderer/pages/BooruServerFavoritesPage';

// ——————————————————————————————————————————
// Mocks
// ——————————————————————————————————————————

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

// 分页控件 mock：暴露跳转到第 3 页的按钮，用于验证"刷新当前页"行为
vi.mock('../../../src/renderer/components/PaginationControl', () => ({
  PaginationControl: (props: any) => (
    <div data-testid={`pagination-${props.position}`}>
      <button
        data-testid={`goto-page-3-${props.position}`}
        onClick={() => props.onPageChange(3)}
      >
        page 3
      </button>
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/SkeletonGrid', () => ({
  SkeletonGrid: () => <div data-testid="skeleton-grid" />,
}));

vi.mock('../../../src/renderer/pages/BooruPostDetailsPage', () => ({
  BooruPostDetailsPage: () => null,
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
    isFavorited: false,
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
  getActiveSite: vi.fn(),
  getServerFavorites: vi.fn(),
  serverFavorite: vi.fn(),
  serverUnfavorite: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  addToDownload: vi.fn(),
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

  booruApi.getActiveSite.mockResolvedValue({
    success: true,
    data: { id: 1, name: 'Yande', username: 'alice', authenticated: true },
  });
  booruApi.getServerFavorites.mockResolvedValue({ success: true, data: [makePost()] });

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
            paginationPosition: 'both',
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

describe('BooruServerFavoritesPage · 服务端喜欢域事件', () => {
  it('忽略 synced 事件，不触发再次拉取（防止拉取-事件-拉取死循环）', async () => {
    render(
      <AntApp>
        <BooruServerFavoritesPage />
      </AntApp>
    );

    await waitFor(() => {
      expect(booruApi.getServerFavorites).toHaveBeenCalled();
    });
    expect(await screen.findByTestId('booru-card-101')).toBeTruthy();

    const callsBefore = booruApi.getServerFavorites.mock.calls.length;

    // 模拟主进程在喜欢列表拉取后广播的 synced 事件（曾导致无限循环）
    act(() => {
      appEventCallback?.(appEvent('booru:post-server-favorite-changed', {
        action: 'synced',
        siteId: 1,
        postIds: [101],
        isLiked: true,
        affectedCount: 1,
      }));
    });

    // 排空微任务链，确认没有任何新的拉取被触发
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(booruApi.getServerFavorites.mock.calls.length).toBe(callsBefore);
  });

  it('liked 事件刷新当前页而不是跳回第 1 页', async () => {
    render(
      <AntApp>
        <BooruServerFavoritesPage />
      </AntApp>
    );

    expect(await screen.findByTestId('booru-card-101')).toBeTruthy();

    // 用户翻到第 3 页
    fireEvent.click(screen.getByTestId('goto-page-3-top'));
    await waitFor(() => {
      expect(booruApi.getServerFavorites).toHaveBeenCalledWith(1, 3, 20);
    });

    const callsBefore = booruApi.getServerFavorites.mock.calls.length;

    // 其他页面对帖子点了喜欢：广播真实的 liked 事件
    act(() => {
      appEventCallback?.(appEvent('booru:post-server-favorite-changed', {
        action: 'liked',
        siteId: 1,
        postId: 999,
        isLiked: true,
        affectedCount: 1,
      }));
    });

    // 应刷新当前页（第 3 页），分页位置不被弹回第 1 页
    await waitFor(() => {
      expect(booruApi.getServerFavorites.mock.calls.length).toBe(callsBefore + 1);
    });
    expect(booruApi.getServerFavorites.mock.calls[callsBefore]).toEqual([1, 3, 20]);
  });
});
