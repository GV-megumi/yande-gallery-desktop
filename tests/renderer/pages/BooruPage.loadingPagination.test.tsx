/** @vitest-environment jsdom */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { App as AntApp } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BooruPost, RendererAppEvent } from '../../../src/shared/types';
import { BooruPage } from '../../../src/renderer/pages/BooruPage';

const getSites = vi.fn();
const getPosts = vi.fn();
const searchPosts = vi.fn();
const getActiveBlacklistTagNames = vi.fn();
const addToDownload = vi.fn();
const serverFavorite = vi.fn();
const serverUnfavorite = vi.fn();
const getAppearancePreference = vi.fn();
const onAppEvent = vi.fn();
const toolbarHooks = vi.hoisted(() => ({
  afterSiteChange: null as null | (() => void),
}));
const loadFavoritesFromPosts = vi.hoisted(() => vi.fn());
const setFavorites = vi.hoisted(() => vi.fn());
let appEventCallback: ((event: RendererAppEvent) => void) | undefined;

vi.mock('../../../src/renderer/components/BooruPageToolbar', () => ({
  BooruPageToolbar: (props: any) => (
    <div data-testid="booru-toolbar">
      <button data-testid="toolbar-refresh" onClick={props.onRefresh}>refresh</button>
      <button data-testid="toolbar-search" onClick={() => props.onSearch('search_tag')}>search</button>
      {props.sites.map((site: any) => (
        <button
          data-testid={`toolbar-site-${site.id}`}
          key={site.id}
          onClick={() => {
            props.onSiteChange(site.id);
            toolbarHooks.afterSiteChange?.();
          }}
        >
          site {site.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/BooruGridLayout', () => ({
  BooruGridLayout: ({ posts, serverFavorites }: { posts: BooruPost[]; serverFavorites?: Set<number> }) => (
    <div data-testid="booru-grid">
      {posts.map((post) => (
        <div
          data-favorited={String(Boolean(post.isFavorited))}
          data-server-favorited={String(Boolean(serverFavorites?.has(post.postId)))}
          data-testid={`booru-card-${post.postId}`}
          key={post.postId}
        >
          {post.postId}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/PaginationControl', () => ({
  PaginationControl: (props: any) => (
    <>
      <button
        data-current-page={props.currentPage}
        data-testid={`pagination-${props.position}`}
        disabled={props.disabled}
        onClick={props.onNext}
      >
        page {props.currentPage}
      </button>
      <button
        data-testid={`pagination-double-next-${props.position}`}
        disabled={props.disabled}
        onClick={() => {
          props.onNext();
          props.onNext();
        }}
      >
        double next
      </button>
    </>
  ),
}));

vi.mock('../../../src/renderer/components/SkeletonGrid', () => ({
  SkeletonGrid: (props: any) => (
    <div
      data-card-width={props.cardWidth}
      data-count={props.count}
      data-gap={props.gap}
      data-testid="skeleton-grid"
    />
  ),
}));

vi.mock('../../../src/renderer/pages/BooruPostDetailsPage', () => ({
  BooruPostDetailsPage: () => null,
}));

vi.mock('../../../src/renderer/hooks/useFavorite', () => ({
  useFavorite: () => ({
    favorites: new Set<number>(),
    setFavorites,
    loadFavoritesFromPosts,
    toggleFavorite: vi.fn().mockResolvedValue({ success: true }),
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makePost(overrides: Partial<BooruPost> = {}): BooruPost {
  return {
    id: 1,
    siteId: 1,
    siteName: 'Yande',
    postId: 1001,
    fileUrl: 'https://example.com/file.jpg',
    previewUrl: 'https://example.com/preview.jpg',
    sampleUrl: 'https://example.com/sample.jpg',
    tags: 'tag_a tag_b',
    rating: 'safe',
    width: 1000,
    height: 1500,
    score: 10,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    downloaded: false,
    isFavorited: false,
    ...overrides,
  } as BooruPost;
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

function setupElectronApi() {
  getSites.mockResolvedValue({
    success: true,
    data: [{ id: 1, name: 'Yande', url: 'https://yande.re', active: true }],
  });
  getActiveBlacklistTagNames.mockResolvedValue({ success: true, data: [] });
  addToDownload.mockResolvedValue({ success: true });
  serverFavorite.mockResolvedValue({ success: true });
  serverUnfavorite.mockResolvedValue({ success: true });
  searchPosts.mockResolvedValue({ success: true, data: [] });
  getAppearancePreference.mockResolvedValue({
    success: true,
    data: {
      gridSize: 240,
      previewQuality: 'auto',
      itemsPerPage: 60,
      paginationPosition: 'both',
      pageMode: 'pagination',
      spacing: 12,
      borderRadius: 8,
      margin: 24,
    },
  });
  onAppEvent.mockImplementation((callback: (event: RendererAppEvent) => void) => {
    appEventCallback = callback;
    return vi.fn();
  });

  (window as any).electronAPI = {
    booru: {
      getSites,
      getPosts,
      searchPosts,
      getActiveBlacklistTagNames,
      addToDownload,
      serverFavorite,
      serverUnfavorite,
    },
    booruPreferences: {
      appearance: {
        get: getAppearancePreference,
        onChanged: vi.fn(() => () => {}),
      },
    },
    window: {
      openTagSearch: vi.fn(),
      openArtist: vi.fn(),
      openCharacter: vi.fn(),
    },
    system: {
      onAppEvent,
      openExternal: vi.fn(),
    },
  };
}

describe('BooruPage loading pagination', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    toolbarHooks.afterSiteChange = null;
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

    setupElectronApi();
  });

  it('patches favorite and server favorite state and reloads blacklist names from Booru app events', async () => {
    getPosts.mockResolvedValueOnce({
      success: true,
      data: [
        makePost({
          postId: 1001,
          tags: 'blocked_tag keep_tag',
          isFavorited: false,
          isLiked: false,
        }),
      ],
    });

    render(
      <AntApp>
        <BooruPage />
      </AntApp>
    );

    const card = await screen.findByTestId('booru-card-1001');
    expect(card.dataset.favorited).toBe('false');
    expect(card.dataset.serverFavorited).toBe('false');
    expect(onAppEvent).toHaveBeenCalledTimes(1);

    act(() => {
      appEventCallback?.(appEvent('booru:post-favorite-changed', {
        action: 'added',
        siteId: 1,
        postId: 1001,
        isFavorited: true,
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('booru-card-1001').dataset.favorited).toBe('true');
    });

    act(() => {
      appEventCallback?.(appEvent('booru:post-server-favorite-changed', {
        action: 'liked',
        siteId: 1,
        postId: 1001,
        isLiked: true,
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('booru-card-1001').dataset.serverFavorited).toBe('true');
    });

    getActiveBlacklistTagNames.mockResolvedValueOnce({ success: true, data: ['blocked_tag'] });

    act(() => {
      appEventCallback?.(appEvent('booru:blacklist-tags-changed', {
        action: 'created',
        siteId: 1,
        tagName: 'blocked_tag',
      }));
    });

    await waitFor(() => {
      expect(getActiveBlacklistTagNames).toHaveBeenLastCalledWith(1);
      expect(screen.queryByTestId('booru-card-1001')).toBeNull();
    });
  });

  it('keeps pagination and skeleton visible while getPosts is pending, then swaps to the grid after posts resolve', async () => {
    const pendingPosts = deferred<{ success: true; data: BooruPost[] }>();
    getPosts.mockReturnValue(pendingPosts.promise);

    render(
      <AntApp>
        <BooruPage />
      </AntApp>
    );

    await waitFor(() => {
      expect(getPosts).toHaveBeenCalledWith(1, 1, [], 60);
    });

    const skeleton = await screen.findByTestId('skeleton-grid');

    const topPagination = screen.getByTestId('pagination-top') as HTMLButtonElement;
    const bottomPagination = screen.getByTestId('pagination-bottom') as HTMLButtonElement;
    expect(topPagination.disabled).toBe(true);
    expect(bottomPagination.disabled).toBe(true);
    expect(topPagination.dataset.currentPage).toBe('1');
    expect(skeleton.dataset.count).toBe('60');
    expect(skeleton.dataset.cardWidth).toBe('240');
    expect(skeleton.dataset.gap).toBe('12');
    expect(screen.queryByText('暂无图片')).toBeNull();
    expect(screen.queryByTestId('booru-grid')).toBeNull();

    fireEvent.click(screen.getByTestId('pagination-top'));
    expect(getPosts).toHaveBeenCalledTimes(1);

    pendingPosts.resolve({
      success: true,
      data: [makePost({ postId: 1002 }), makePost({ postId: 1001 })],
    });

    expect(await screen.findByTestId('booru-grid')).toBeTruthy();
    expect(screen.getByTestId('booru-card-1002')).toBeTruthy();
    expect(screen.queryByTestId('skeleton-grid')).toBeNull();
    expect((screen.getByTestId('pagination-top') as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not let a stale load cleanup clear the newer pending load state', async () => {
    const firstLoad = deferred<{ success: true; data: BooruPost[] }>();
    const secondLoad = deferred<{ success: true; data: BooruPost[] }>();
    getPosts
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);

    render(
      <AntApp>
        <BooruPage />
      </AntApp>
    );

    await waitFor(() => {
      expect(getPosts).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('toolbar-refresh'));

    await waitFor(() => {
      expect(getPosts).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      firstLoad.resolve({
        success: true,
        data: [makePost({ postId: 9001 })],
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId('skeleton-grid')).toBeTruthy();
    expect(screen.queryByTestId('booru-grid')).toBeNull();

    await act(async () => {
      secondLoad.resolve({
        success: true,
        data: [makePost({ postId: 2002 })],
      });
      await Promise.resolve();
    });

    expect(await screen.findByTestId('booru-card-2002')).toBeTruthy();
    expect(screen.queryByTestId('booru-card-9001')).toBeNull();
  });

  it('invalidates a pending site load synchronously when switching sites', async () => {
    const oldSiteLoad = deferred<{ success: true; data: BooruPost[] }>();
    const newSiteLoad = deferred<{ success: true; data: BooruPost[] }>();

    getSites.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 1, name: 'Yande', url: 'https://yande.re', active: true },
        { id: 2, name: 'Konachan', url: 'https://konachan.com', active: false },
      ],
    });
    getPosts
      .mockReturnValueOnce(oldSiteLoad.promise)
      .mockReturnValueOnce(newSiteLoad.promise);
    toolbarHooks.afterSiteChange = () => {
      oldSiteLoad.resolve({
        success: true,
        data: [makePost({ postId: 9001, siteId: 1 })],
      });
    };

    render(
      <AntApp>
        <BooruPage />
      </AntApp>
    );

    await waitFor(() => {
      expect(getPosts).toHaveBeenCalledWith(1, 1, [], 60);
    });

    (await screen.findByTestId('toolbar-site-2')).click();
    await Promise.resolve();

    expect(loadFavoritesFromPosts).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ postId: 9001 })])
    );
    expect(screen.queryByTestId('booru-card-9001')).toBeNull();

    await waitFor(() => {
      expect(getPosts).toHaveBeenCalledWith(2, 1, [], 60);
    });

    expect(screen.getByTestId('skeleton-grid')).toBeTruthy();

    await act(async () => {
      newSiteLoad.resolve({
        success: true,
        data: [makePost({ postId: 2002, siteId: 2 })],
      });
      await Promise.resolve();
    });

    expect(await screen.findByTestId('booru-card-2002')).toBeTruthy();
    expect(screen.queryByTestId('booru-card-9001')).toBeNull();
  });

  it('does not let a stale blacklist response from the previous site hide current-site cards', async () => {
    const oldBlacklist = deferred<{ success: true; data: string[] }>();

    getSites.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 1, name: 'Yande', url: 'https://yande.re', active: true },
        { id: 2, name: 'Konachan', url: 'https://konachan.com', active: false },
      ],
    });
    getPosts
      .mockResolvedValueOnce({
        success: true,
        data: [makePost({ postId: 1001, siteId: 1, tags: 'old_tag' })],
      })
      .mockResolvedValueOnce({
        success: true,
        data: [makePost({ postId: 2002, siteId: 2, tags: 'blocked_tag keep_tag' })],
      });
    getActiveBlacklistTagNames
      .mockReturnValueOnce(oldBlacklist.promise)
      .mockResolvedValueOnce({ success: true, data: [] });

    render(
      <AntApp>
        <BooruPage />
      </AntApp>
    );

    await waitFor(() => {
      expect(getActiveBlacklistTagNames).toHaveBeenCalledWith(1);
    });

    fireEvent.click(await screen.findByTestId('toolbar-site-2'));

    await waitFor(() => {
      expect(getActiveBlacklistTagNames).toHaveBeenCalledWith(2);
    });
    expect(await screen.findByTestId('booru-card-2002')).toBeTruthy();

    await act(async () => {
      oldBlacklist.resolve({ success: true, data: ['blocked_tag'] });
      await Promise.resolve();
    });

    expect(screen.getByTestId('booru-card-2002')).toBeTruthy();
  });

  it('calls request invalidation before changing the selected site', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/renderer/pages/BooruPage.tsx'), 'utf8');
    const match = source.match(/const handleSiteChange = \(siteId: number\) => \{([\s\S]*?)\n  \};/);
    expect(match).toBeTruthy();

    const body = match?.[1] ?? '';
    const invalidateIndex = body.indexOf('invalidateBooruRequests()');
    const selectedSiteIndex = body.indexOf('setSelectedSiteId(siteId)');

    expect(invalidateIndex).toBeGreaterThanOrEqual(0);
    expect(selectedSiteIndex).toBeGreaterThanOrEqual(0);
    expect(invalidateIndex).toBeLessThan(selectedSiteIndex);
  });

  it('does not let a stale load overwrite newer search results', async () => {
    const staleLoad = deferred<{ success: true; data: BooruPost[] }>();
    const newerSearch = deferred<{ success: true; data: BooruPost[] }>();
    getPosts.mockReturnValueOnce(staleLoad.promise);
    searchPosts.mockReturnValueOnce(newerSearch.promise);

    render(
      <AntApp>
        <BooruPage />
      </AntApp>
    );

    await waitFor(() => {
      expect(getPosts).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('toolbar-search'));

    await waitFor(() => {
      expect(searchPosts).toHaveBeenCalledWith(1, ['search_tag'], 1, 60, true);
    });

    await act(async () => {
      newerSearch.resolve({
        success: true,
        data: [makePost({ postId: 3003 })],
      });
      await Promise.resolve();
    });

    expect(await screen.findByTestId('booru-card-3003')).toBeTruthy();

    await act(async () => {
      staleLoad.resolve({
        success: true,
        data: [makePost({ postId: 9001 })],
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId('booru-card-3003')).toBeTruthy();
    expect(screen.queryByTestId('booru-card-9001')).toBeNull();
  });

  it('starts only one next-page request for rapid pagination double click', async () => {
    const nextPage = deferred<{ success: true; data: BooruPost[] }>();
    getPosts
      .mockResolvedValueOnce({
        success: true,
        data: [makePost({ postId: 1001 }), makePost({ postId: 1002 })],
      })
      .mockReturnValue(nextPage.promise);

    render(
      <AntApp>
        <BooruPage />
      </AntApp>
    );

    expect(await screen.findByTestId('booru-grid')).toBeTruthy();

    fireEvent.click(screen.getByTestId('pagination-double-next-top'));

    const nextPageCalls = getPosts.mock.calls.filter((call) => call[1] === 2);
    expect(nextPageCalls).toHaveLength(1);

    await act(async () => {
      nextPage.resolve({
        success: true,
        data: [makePost({ postId: 2001 })],
      });
      await Promise.resolve();
    });
  });
});
