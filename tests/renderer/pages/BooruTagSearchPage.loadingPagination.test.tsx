/** @vitest-environment jsdom */

import React from 'react';
import { App as AntApp } from 'antd';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BooruPost } from '../../../src/shared/types';
import { BooruTagSearchPage } from '../../../src/renderer/pages/BooruTagSearchPage';

const getSites = vi.fn();
const searchPosts = vi.fn();
const getFavorites = vi.fn();
const isFavoriteTag = vi.fn();
const autocompleteTags = vi.fn();
const getTagRelationships = vi.fn();
const addFavoriteTag = vi.fn();
const removeFavoriteTagByName = vi.fn();
const addToDownload = vi.fn();
const serverFavorite = vi.fn();
const serverUnfavorite = vi.fn();
const getAppearancePreference = vi.fn();
const setFavorites = vi.fn();
const toggleFavorite = vi.fn();

vi.mock('../../../src/renderer/components/BooruPageToolbar', () => ({
  BooruPageToolbar: (props: any) => (
    <div data-testid="booru-toolbar">
      <button data-testid="toolbar-refresh" onClick={props.onRefresh}>refresh</button>
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/BooruGridLayout', () => ({
  BooruGridLayout: ({ posts }: { posts: BooruPost[] }) => (
    <div data-testid="booru-grid">
      {posts.map((post) => (
        <div data-testid={`booru-card-${post.postId}`} key={post.postId}>
          {post.postId}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/PaginationControl', () => ({
  PaginationControl: (props: any) => (
    <div
      data-current-count={props.currentCount}
      data-current-page={props.currentPage}
      data-disabled={String(Boolean(props.disabled))}
      data-position={props.position}
      data-testid={`pagination-${props.position}`}
    >
      <button
        data-testid={`pagination-next-${props.position}`}
        disabled={Boolean(props.disabled)}
        onClick={() => props.onNext?.()}
      >
        next
      </button>
    </div>
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
    toggleFavorite,
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

function setupElectronApi() {
  getSites.mockResolvedValue({
    success: true,
    data: [{ id: 1, name: 'Yande', url: 'https://yande.re', active: true }],
  });
  getFavorites.mockResolvedValue({ success: true, data: [] });
  isFavoriteTag.mockResolvedValue({ success: true, data: false });
  autocompleteTags.mockResolvedValue({ success: true, data: [] });
  getTagRelationships.mockResolvedValue({ success: true, data: null });
  addFavoriteTag.mockResolvedValue({ success: true });
  removeFavoriteTagByName.mockResolvedValue({ success: true });
  addToDownload.mockResolvedValue({ success: true });
  serverFavorite.mockResolvedValue({ success: true });
  serverUnfavorite.mockResolvedValue({ success: true });
  toggleFavorite.mockResolvedValue({ success: true });
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

  (window as any).electronAPI = {
    booru: {
      getSites,
      searchPosts,
      getFavorites,
      isFavoriteTag,
      autocompleteTags,
      getTagRelationships,
      addFavoriteTag,
      removeFavoriteTagByName,
      addToDownload,
      serverFavorite,
      serverUnfavorite,
    },
    booruPreferences: {
      appearance: {
        get: getAppearancePreference,
      },
    },
    system: {
      onAppEvent: vi.fn(() => () => {}),
    },
    window: {
      openTagSearch: vi.fn(),
      openArtist: vi.fn(),
    },
  };
}

describe('BooruTagSearchPage loading pagination', () => {
  beforeEach(() => {
    cleanup();
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

    setupElectronApi();
  });

  it('keeps tag search pagination clickable while loading and ignores stale responses', async () => {
    const page2 = deferred<{ success: true; data: BooruPost[] }>();
    const page3 = deferred<{ success: true; data: BooruPost[] }>();

    searchPosts.mockImplementation((_siteId: number, _tags: string[], page: number) => {
      if (page === 2) return page2.promise;
      if (page === 3) return page3.promise;
      return Promise.resolve({
        success: true,
        data: [makePost({ postId: 1001 })],
      });
    });

    render(
      <AntApp>
        <BooruTagSearchPage initialTag="tag_a" initialSiteId={1} />
      </AntApp>
    );

    expect(await screen.findByTestId('booru-card-1001')).toBeTruthy();

    fireEvent.click(screen.getByTestId('pagination-next-top'));

    await waitFor(() => {
      expect(searchPosts).toHaveBeenCalledWith(1, ['tag_a'], 2, 60);
    });
    expect(await screen.findByTestId('skeleton-grid')).toBeTruthy();
    expect(screen.getByTestId('pagination-top').dataset.currentPage).toBe('2');
    expect((screen.getByTestId('pagination-next-top') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId('pagination-next-top'));

    await waitFor(() => {
      expect(searchPosts).toHaveBeenCalledWith(1, ['tag_a'], 3, 60);
    });

    await act(async () => {
      page3.resolve({
        success: true,
        data: [makePost({ postId: 3001 })],
      });
      await Promise.resolve();
    });

    expect(await screen.findByTestId('booru-card-3001')).toBeTruthy();
    expect(screen.queryByTestId('skeleton-grid')).toBeNull();

    await act(async () => {
      page2.resolve({
        success: true,
        data: [makePost({ postId: 2001 })],
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId('booru-card-3001')).toBeTruthy();
    expect(screen.queryByTestId('booru-card-2001')).toBeNull();
  });
});
