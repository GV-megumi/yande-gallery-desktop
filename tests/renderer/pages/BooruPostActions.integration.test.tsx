/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { App } from 'antd';
import type { BooruPost } from '../../../src/shared/types';
import { BooruArtistPage } from '../../../src/renderer/pages/BooruArtistPage';
import { BooruPopularPage } from '../../../src/renderer/pages/BooruPopularPage';
import { BooruPoolsPage } from '../../../src/renderer/pages/BooruPoolsPage';
import { BooruTagSearchPage } from '../../../src/renderer/pages/BooruTagSearchPage';

const getActiveSite = vi.fn();
const getPopularRecent = vi.fn();
const getPools = vi.fn();
const searchPools = vi.fn();
const getPool = vi.fn();
const getSites = vi.fn();
const getArtist = vi.fn();
const searchPosts = vi.fn();
const getFavorites = vi.fn();
const addToDownload = vi.fn();
const serverFavorite = vi.fn();
const serverUnfavorite = vi.fn();
const toggleLocalFavorite = vi.fn();
const openDetails = vi.fn();
const closeDetails = vi.fn();
const toggleFavorite = vi.fn();
const toggleServerFavorite = vi.fn();
const download = vi.fn();
const isServerFavorited = vi.fn();
const configGet = vi.fn();
const isFavoriteTag = vi.fn();
const addFavoriteTag = vi.fn();
const removeFavoriteTagByName = vi.fn();
const openExternal = vi.fn();
const getAppearancePreference = vi.fn();

const postActionsView = {
  selectedPost: null as BooruPost | null,
  detailOpen: true,
  serverFavorites: new Set<number>(),
};

const detailsRenderSpy = vi.fn();

function createPost(overrides: Partial<BooruPost> = {}): BooruPost {
  return {
    id: 1,
    postId: 1001,
    md5: 'md5',
    fileUrl: 'https://example.com/file.jpg',
    previewUrl: 'https://example.com/preview.jpg',
    sampleUrl: 'https://example.com/sample.jpg',
    tags: 'tag_a tag_b',
    rating: 's',
    width: 100,
    height: 100,
    score: 1,
    createdAt: new Date().toISOString(),
    isFavorited: false,
    siteId: 1,
    siteName: 'Yande',
    ...overrides,
  } as BooruPost;
}

vi.mock('../../../src/renderer/components/BooruImageCard', () => ({
  BooruImageCard: (props: any) => (
    <div>
      <button data-testid={`card-favorite-${props.post.postId}`} onClick={props.onToggleFavorite}>favorite</button>
      <button data-testid={`card-download-${props.post.postId}`} onClick={props.onDownload}>download</button>
      <button data-testid={`card-server-favorite-${props.post.postId}`} onClick={props.onToggleServerFavorite}>server-favorite</button>
      <div data-testid={`card-server-state-${props.post.postId}`}>{String(props.isServerFavorited)}</div>
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/BooruGridLayout', () => ({
  BooruGridLayout: (props: any) => (
    <div>
      {props.posts.map((post: BooruPost) => (
        <div key={post.postId}>
          <button data-testid={`grid-favorite-${post.postId}`} onClick={() => props.onToggleFavorite(post)}>favorite</button>
          <button data-testid={`grid-download-${post.postId}`} onClick={() => props.onDownload(post)}>download</button>
          <button data-testid={`grid-server-favorite-${post.postId}`} onClick={() => props.onToggleServerFavorite?.(post)}>server-favorite</button>
          <button data-testid={`grid-tag-${post.postId}`} onClick={() => props.onTagClick?.('tag_from_grid')}>tag</button>
          <div data-testid={`grid-server-state-${post.postId}`}>{String(props.serverFavorites?.has(post.postId))}</div>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/BooruPageToolbar', () => ({
  BooruPageToolbar: () => <div data-testid="artist-toolbar" />,
}));

vi.mock('../../../src/renderer/components/PaginationControl', () => ({
  PaginationControl: () => <div data-testid="pagination-control" />,
}));

vi.mock('../../../src/renderer/components/SkeletonGrid', () => ({
  SkeletonGrid: () => <div data-testid="skeleton-grid" />,
}));

vi.mock('../../../src/renderer/pages/BooruPostDetailsPage', () => ({
  BooruPostDetailsPage: (props: any) => {
    detailsRenderSpy(props);
    return <div data-testid="details-open">{String(props.open)}</div>;
  },
}));

vi.mock('../../../src/renderer/hooks/useFavorite', () => ({
  useFavorite: () => ({
    toggleFavorite: toggleLocalFavorite,
    favorites: new Set<number>(),
    setFavorites: vi.fn(),
  }),
}));

vi.mock('../../../src/renderer/hooks/useBooruPostActions', () => ({
  useBooruPostActions: () => ({
    selectedPost: postActionsView.selectedPost,
    detailOpen: postActionsView.detailOpen,
    serverFavorites: postActionsView.serverFavorites,
    openDetails,
    closeDetails,
    toggleFavorite,
    toggleServerFavorite,
    download,
    isServerFavorited,
  }),
}));

describe('TP-11 试点页面动作桥接', () => {
  afterEach(() => {
    cleanup();
  });

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

    postActionsView.selectedPost = createPost({ postId: 2002 });
    postActionsView.detailOpen = true;
    postActionsView.serverFavorites = new Set([2002]);

    isServerFavorited.mockImplementation((post: BooruPost) => post.postId === 2002);
    getActiveSite.mockResolvedValue({
      success: true,
      data: { id: 1, name: 'Yande', url: 'https://yande.re', username: 'tester' },
    });
    getPopularRecent.mockResolvedValue({
      success: true,
      data: [createPost({ postId: 2002 })],
    });
    getSites.mockResolvedValue({
      success: true,
      data: [{ id: 1, name: 'Yande', url: 'https://yande.re', username: 'tester' }],
    });
    getArtist.mockResolvedValue({
      success: true,
      data: { id: 1, name: 'artist_name', aliases: [], urls: [] },
    });
    searchPosts.mockResolvedValue({
      success: true,
      data: [createPost({ postId: 2002 })],
    });
    getFavorites.mockResolvedValue({
      success: true,
      data: [{ postId: 2002 }],
    });
    getPools.mockResolvedValue({
      success: true,
      data: [{ id: 88, name: 'pool_name', postCount: 20, createdAt: new Date().toISOString() }],
    });
    getPool.mockImplementation(async (_siteId: number, _poolId: number, page: number) => ({
      success: true,
      data: {
        posts: Array.from({ length: 20 }, (_, index) => createPost({ postId: page * 1000 + index })),
      },
    }));
    configGet.mockResolvedValue({ success: true, data: { booru: { appearance: {} } } });
    getAppearancePreference.mockResolvedValue({
      success: true,
      data: {
        gridSize: 330,
        previewQuality: 'auto',
        itemsPerPage: 20,
        paginationPosition: 'bottom',
        spacing: 16,
        borderRadius: 8,
        margin: 24,
      },
    });
    isFavoriteTag.mockResolvedValue({ success: true, data: false });
    addFavoriteTag.mockResolvedValue({ success: true });
    removeFavoriteTagByName.mockResolvedValue({ success: true });

    (window as any).electronAPI = {
      booru: {
        getActiveSite,
        getPopularRecent,
        getPopularByDay: vi.fn(),
        getPopularByWeek: vi.fn(),
        getPopularByMonth: vi.fn(),
        getSites,
        getArtist,
        searchPosts,
        getFavorites,
        isFavoriteTag,
        addFavoriteTag,
        removeFavoriteTagByName,
        getPools,
        searchPools,
        getPool,
        addToDownload,
        serverFavorite,
        serverUnfavorite,
      },
      config: {
        get: configGet,
      },
      booruPreferences: {
        appearance: {
          get: getAppearancePreference,
          onChanged: vi.fn(),
        },
      },
      system: {
        openExternal,
      },
      window: {
        openTagSearch: vi.fn(),
        openArtist: vi.fn(),
      },
    };
  });

  it('BooruArtistPage 应把本地收藏与下载桥接到统一 postActions', async () => {
    render(
      <App>
        <BooruArtistPage artistName="artist_name" />
      </App>
    );

    await waitFor(() => {
      expect(searchPosts).toHaveBeenCalledWith(1, ['artist_name'], 1, 20);
    });

    fireEvent.click(await screen.findByTestId('grid-favorite-2002'));
    expect(toggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ postId: 2002 }));

    fireEvent.click(screen.getByTestId('grid-download-2002'));
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ postId: 2002 }));
  });

  it('BooruArtistPage 应把持久化 isLiked 状态桥接到卡片服务端喜欢显示', async () => {
    isServerFavorited.mockImplementation((post: BooruPost) => !!post.isLiked);
    searchPosts.mockResolvedValueOnce({
      success: true,
      data: [createPost({ postId: 3003, isLiked: true })],
    });

    render(
      <App>
        <BooruArtistPage artistName="artist_name" />
      </App>
    );

    await waitFor(() => {
      expect(searchPosts).toHaveBeenCalledWith(1, ['artist_name'], 1, 20);
    });

    expect((await screen.findByTestId('grid-server-state-3003')).textContent).toBe('true');
  });

  it('BooruArtistPage 挂起时应关闭详情弹层 open 以保持试点页语义一致', async () => {
    render(
      <App>
        <BooruArtistPage artistName="artist_name" suspended />
      </App>
    );

    await waitFor(() => {
      const detailProps = detailsRenderSpy.mock.calls.at(-1)?.[0];
      expect(detailProps).toBeTruthy();
      expect(detailProps.open).toBe(false);
      expect(screen.getByTestId('details-open').textContent).toBe('false');
    });
  });

  it('BooruPopularPage 应把本地收藏与下载桥接到统一 postActions', async () => {
    render(
      <App>
        <BooruPopularPage />
      </App>
    );

    await waitFor(() => {
      expect(getPopularRecent).toHaveBeenCalledWith(1, '1day');
    });

    fireEvent.click(await screen.findByTestId('card-favorite-2002'));
    expect(toggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ postId: 2002 }));

    fireEvent.click(screen.getByTestId('card-download-2002'));
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ postId: 2002 }));
  });

  it('BooruPopularPage 应把详情页和卡片服务端喜欢桥接到 postActions', async () => {
    render(
      <App>
        <BooruPopularPage />
      </App>
    );

    await waitFor(() => {
      expect(getPopularRecent).toHaveBeenCalledWith(1, '1day');
    });

    fireEvent.click(await screen.findByTestId('card-server-favorite-2002'));
    expect(toggleServerFavorite).toHaveBeenCalledWith(expect.objectContaining({ postId: 2002 }));
    expect(screen.getByTestId('card-server-state-2002').textContent).toBe('true');

    const detailProps = detailsRenderSpy.mock.calls.at(-1)?.[0];
    expect(detailProps).toBeTruthy();
    expect(detailProps.isServerFavorited(postActionsView.selectedPost)).toBe(true);
    expect(typeof detailProps.onToggleServerFavorite).toBe('function');
    await detailProps.onToggleServerFavorite(postActionsView.selectedPost);
    expect(toggleServerFavorite).toHaveBeenCalledWith(postActionsView.selectedPost);
    expect(isServerFavorited).toHaveBeenCalledWith(postActionsView.selectedPost);
    expect(screen.getByTestId('details-open').textContent).toBe('true');
  });

  it('BooruPoolsPage 翻页时应使用最新 poolPage 加载详情并保持详情桥接', async () => {
    render(
      <App>
        <BooruPoolsPage />
      </App>
    );

    fireEvent.click(await screen.findByText('pool name'));

    await waitFor(() => {
      expect(getPool).toHaveBeenCalledWith(1, 88, 1);
    });

    const callCountBeforeNextPage = getPool.mock.calls.length;
    fireEvent.click((await screen.findAllByText('下一页'))[1]);

    await waitFor(() => {
      expect(getPool.mock.calls.length).toBeGreaterThan(callCountBeforeNextPage);
      expect(getPool.mock.calls.some(call => call[0] === 1 && call[1] === 88 && call[2] === 2)).toBe(true);
    });

    const detailProps = detailsRenderSpy.mock.calls.at(-1)?.[0];
    expect(detailProps).toBeTruthy();
    expect(detailProps.isServerFavorited(postActionsView.selectedPost)).toBe(true);

    await detailProps.onToggleFavorite(postActionsView.selectedPost);
    expect(toggleFavorite).toHaveBeenCalledWith(postActionsView.selectedPost);

    await detailProps.onDownload(postActionsView.selectedPost);
    expect(download).toHaveBeenCalledWith(postActionsView.selectedPost);

    await detailProps.onToggleServerFavorite(postActionsView.selectedPost);
    expect(toggleServerFavorite).toHaveBeenCalledWith(postActionsView.selectedPost);
    expect(isServerFavorited).toHaveBeenCalledWith(postActionsView.selectedPost);
  });

  it('BooruPoolsPage 切换到新 pool 时应以第 1 页重新加载详情', async () => {
    getPools.mockResolvedValue({
      success: true,
      data: [
        { id: 88, name: 'pool_name', postCount: 20, createdAt: new Date().toISOString() },
        { id: 99, name: 'pool_name_2', postCount: 20, createdAt: new Date().toISOString() },
      ],
    });

    render(
      <App>
        <BooruPoolsPage />
      </App>
    );

    fireEvent.click(await screen.findByText('pool name'));

    await waitFor(() => {
      expect(getPool).toHaveBeenCalledWith(1, 88, 1);
    });

    fireEvent.click((await screen.findAllByText('下一页'))[1]);

    await waitFor(() => {
      expect(getPool.mock.calls.some(call => call[0] === 1 && call[1] === 88 && call[2] === 2)).toBe(true);
    });

    fireEvent.click(screen.getByText('返回列表'));
    fireEvent.click(await screen.findByText('pool name 2'));

    await waitFor(() => {
      expect(getPool).toHaveBeenCalledWith(1, 99, 1);
    });
  });

  it('BooruPoolsPage 输入搜索词时不应立即发起 Pool 搜索', async () => {
    searchPools.mockResolvedValue({ success: true, data: [] });

    render(
      <App>
        <BooruPoolsPage />
      </App>
    );

    await screen.findByText('pool name');
    const searchInput = screen.getByPlaceholderText('搜索 Pool...');

    fireEvent.change(searchInput, { target: { value: 'abc' } });

    expect(searchPools).not.toHaveBeenCalled();
    expect(getPools).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(searchPools).toHaveBeenCalledWith(1, 'abc', 1);
    });
  });

  it('BooruTagSearchPage 在父层提供 onTagClick 时应把网格标签点击委托给父层导航', async () => {
    const onTagClick = vi.fn();

    render(
      <App>
        <BooruTagSearchPage initialTag="tag_a" initialSiteId={1} onTagClick={onTagClick} />
      </App>
    );

    await waitFor(() => {
      expect(searchPosts).toHaveBeenCalledWith(1, ['tag_a'], 1, 20);
    });

    fireEvent.click(await screen.findByTestId('grid-tag-2002'));

    expect(onTagClick).toHaveBeenCalledWith('tag_from_grid', 1);
  });
});
