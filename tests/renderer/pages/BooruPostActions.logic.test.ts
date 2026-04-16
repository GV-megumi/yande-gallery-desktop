/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { BooruPost } from '../../../src/shared/types';
import { createBooruPostActions, useBooruPostActions } from '../../../src/renderer/hooks/useBooruPostActions';

function createPost(overrides: Partial<BooruPost> = {}): BooruPost {
  return {
    postId: 1,
    id: 1,
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
    siteName: 'test',
    ...overrides,
  } as BooruPost;
}

function HookHarness({
  siteId,
  onReady,
}: {
  siteId: number | null;
  onReady: (actions: ReturnType<typeof useBooruPostActions>) => void;
}) {
  const actions = useBooruPostActions({
    siteId,
    updatePosts: updater => updater([]),
    toggleLocalFavorite: vi.fn().mockResolvedValue({ success: true, isFavorited: true }),
    addToDownload: vi.fn().mockResolvedValue({ success: true }),
    serverFavorite: vi.fn().mockResolvedValue(undefined),
    serverUnfavorite: vi.fn().mockResolvedValue(undefined),
    message: { success: vi.fn(), error: vi.fn() },
  });

  React.useEffect(() => {
    onReady(actions);
  }, [actions, onReady]);

  return React.createElement('div', { 'data-testid': 'hook-ready' }, 'ready');
}

function HookHarnessWithPosts({
  siteId,
  initialPosts,
  serverFavorite,
  serverUnfavorite,
  onReady,
}: {
  siteId: number | null;
  initialPosts: BooruPost[];
  serverFavorite: (siteId: number, postId: number) => Promise<unknown>;
  serverUnfavorite: (siteId: number, postId: number) => Promise<unknown>;
  onReady: (payload: { actions: ReturnType<typeof useBooruPostActions>; posts: BooruPost[] }) => void;
}) {
  const [posts, setPosts] = React.useState(initialPosts);
  const actions = useBooruPostActions({
    siteId,
    updatePosts: updater => setPosts(prev => updater(prev)),
    toggleLocalFavorite: vi.fn().mockResolvedValue({ success: true, isFavorited: true }),
    addToDownload: vi.fn().mockResolvedValue({ success: true }),
    serverFavorite,
    serverUnfavorite,
    message: { success: vi.fn(), error: vi.fn() },
  });

  React.useEffect(() => {
    onReady({ actions, posts });
  }, [actions, posts, onReady]);

  return React.createElement('div', { 'data-testid': 'hook-ready-with-posts' }, 'ready');
}

describe('createBooruPostActions', () => {
  afterEach(() => {
    cleanup();
  });

  it('openDetails 和 closeDetails 应通过顶层契约暴露详情状态', () => {
    const actions = createBooruPostActions({
      siteId: 1,
      updatePosts: () => {},
      toggleLocalFavorite: vi.fn(),
      addToDownload: vi.fn(),
      serverFavorite: vi.fn(),
      serverUnfavorite: vi.fn(),
      message: { success: vi.fn(), error: vi.fn() },
    });
    const post = createPost({ postId: 10 });

    actions.openDetails(post);
    expect(actions.selectedPost?.postId).toBe(10);
    expect(actions.detailOpen).toBe(true);

    actions.closeDetails();
    expect(actions.selectedPost).toBeNull();
    expect(actions.detailOpen).toBe(false);
  });

  it('toggleFavorite 成功后应通过 updatePosts 回填指定 postId 的收藏状态', async () => {
    let posts = [createPost({ postId: 1, isFavorited: false }), createPost({ postId: 2, isFavorited: false })];
    const updatePosts = vi.fn((updater: (posts: BooruPost[]) => BooruPost[]) => {
      posts = updater(posts);
    });

    const actions = createBooruPostActions({
      siteId: 1,
      updatePosts,
      toggleLocalFavorite: vi.fn().mockResolvedValue({ success: true, isFavorited: true }),
      addToDownload: vi.fn(),
      serverFavorite: vi.fn(),
      serverUnfavorite: vi.fn(),
      message: { success: vi.fn(), error: vi.fn() },
    });

    await actions.toggleFavorite(posts[1]);

    expect(updatePosts).toHaveBeenCalledTimes(1);
    expect(posts.map(post => ({ postId: post.postId, isFavorited: post.isFavorited }))).toEqual([
      { postId: 1, isFavorited: false },
      { postId: 2, isFavorited: true },
    ]);
  });

  it('toggleServerFavorite 成功后应更新 Set', async () => {
    const serverFavorite = vi.fn().mockResolvedValue(undefined);
    const message = { success: vi.fn(), error: vi.fn() };
    const actions = createBooruPostActions({
      siteId: 1,
      updatePosts: () => {},
      toggleLocalFavorite: vi.fn(),
      addToDownload: vi.fn(),
      serverFavorite,
      serverUnfavorite: vi.fn(),
      message,
    });
    const post = createPost({ postId: 22 });

    await actions.toggleServerFavorite(post);

    expect(serverFavorite).toHaveBeenCalledWith(1, 22);
    expect(actions.serverFavorites.has(22)).toBe(true);
    expect(actions.isServerFavorited(post)).toBe(true);
    expect(message.success).toHaveBeenCalledWith('已喜欢');
  });

  it('toggleServerFavorite 应基于持久化 isLiked 取消喜欢并回填帖子状态', async () => {
    let posts = [createPost({ postId: 22, isLiked: true })];
    const updatePosts = vi.fn((updater: (posts: BooruPost[]) => BooruPost[]) => {
      posts = updater(posts);
    });
    const serverUnfavorite = vi.fn().mockResolvedValue(undefined);
    const message = { success: vi.fn(), error: vi.fn() };
    const actions = createBooruPostActions({
      siteId: 1,
      updatePosts,
      toggleLocalFavorite: vi.fn(),
      addToDownload: vi.fn(),
      serverFavorite: vi.fn(),
      serverUnfavorite,
      message,
    });

    await actions.toggleServerFavorite(posts[0]);

    expect(serverUnfavorite).toHaveBeenCalledWith(1, 22);
    expect(posts[0].isLiked).toBe(false);
    expect(actions.isServerFavorited(posts[0])).toBe(false);
    expect(message.success).toHaveBeenCalledWith('已取消喜欢');
  });

  it('useBooruPostActions 应通过顶层契约暴露 selectedPost detailOpen 和 serverFavorites', async () => {
    const handleReady = vi.fn();

    render(React.createElement(HookHarness, { siteId: 1, onReady: handleReady }));

    await waitFor(() => {
      const actions = handleReady.mock.calls.at(-1)?.[0] as ReturnType<typeof useBooruPostActions>;
      expect(actions.selectedPost).toBeNull();
      expect(actions.detailOpen).toBe(false);
      expect(actions.serverFavorites).toBeInstanceOf(Set);
    });
  });

  it('useBooruPostActions 在 siteId 变化后应隔离旧站点的服务端喜欢状态', async () => {
    const handleReady = vi.fn();
    const post = createPost({ postId: 22 });

    const { rerender } = render(React.createElement(HookHarness, { siteId: 1, onReady: handleReady }));
    expect(screen.getByTestId('hook-ready').textContent).toBe('ready');

    await waitFor(() => {
      expect(handleReady).toHaveBeenCalled();
    });

    const firstActions = handleReady.mock.calls.at(-1)?.[0] as ReturnType<typeof useBooruPostActions>;
    await firstActions.toggleServerFavorite(post);

    await waitFor(() => {
      const latestActions = handleReady.mock.calls.at(-1)?.[0] as ReturnType<typeof useBooruPostActions>;
      expect(latestActions.isServerFavorited(post)).toBe(true);
    });

    rerender(React.createElement(HookHarness, { siteId: 2, onReady: handleReady }));

    await waitFor(() => {
      const latestActions = handleReady.mock.calls.at(-1)?.[0] as ReturnType<typeof useBooruPostActions>;
      expect(latestActions.isServerFavorited(post)).toBe(false);
      expect(latestActions.serverFavorites.size).toBe(0);
    });
  });

  it('useBooruPostActions 应基于帖子 isLiked 恢复服务端喜欢状态并在取消后回填', async () => {
    const handleReady = vi.fn();
    const post = createPost({ postId: 22, isLiked: true });
    const serverUnfavorite = vi.fn().mockResolvedValue(undefined);

    render(React.createElement(HookHarnessWithPosts, {
      siteId: 1,
      initialPosts: [post],
      serverFavorite: vi.fn().mockResolvedValue(undefined),
      serverUnfavorite,
      onReady: handleReady,
    }));

    await waitFor(() => {
      const latest = handleReady.mock.calls.at(-1)?.[0] as { actions: ReturnType<typeof useBooruPostActions>; posts: BooruPost[] };
      expect(latest.actions.isServerFavorited(latest.posts[0])).toBe(true);
    });

    const latestBeforeToggle = handleReady.mock.calls.at(-1)?.[0] as { actions: ReturnType<typeof useBooruPostActions>; posts: BooruPost[] };
    await latestBeforeToggle.actions.toggleServerFavorite(latestBeforeToggle.posts[0]);

    await waitFor(() => {
      const latest = handleReady.mock.calls.at(-1)?.[0] as { actions: ReturnType<typeof useBooruPostActions>; posts: BooruPost[] };
      expect(serverUnfavorite).toHaveBeenCalledWith(1, 22);
      expect(latest.posts[0].isLiked).toBe(false);
      expect(latest.actions.isServerFavorited(latest.posts[0])).toBe(false);
    });
  });

  it('download 成功和失败时应保持现有反馈语义', async () => {
    const successMessage = { success: vi.fn(), error: vi.fn() };
    const successActions = createBooruPostActions({
      siteId: 9,
      updatePosts: () => {},
      toggleLocalFavorite: vi.fn(),
      addToDownload: vi.fn().mockResolvedValue({ success: true }),
      serverFavorite: vi.fn(),
      serverUnfavorite: vi.fn(),
      message: successMessage,
    });

    await successActions.download(createPost({ postId: 30 }));
    expect(successMessage.success).toHaveBeenCalledWith('已添加到下载队列');
    expect(successMessage.error).not.toHaveBeenCalled();

    const failureMessage = { success: vi.fn(), error: vi.fn() };
    const failureActions = createBooruPostActions({
      siteId: 9,
      updatePosts: () => {},
      toggleLocalFavorite: vi.fn(),
      addToDownload: vi.fn().mockResolvedValue({ success: false, error: 'boom' }),
      serverFavorite: vi.fn(),
      serverUnfavorite: vi.fn(),
      message: failureMessage,
    });

    await failureActions.download(createPost({ postId: 31 }));
    expect(failureMessage.error).toHaveBeenCalledWith('下载失败: boom');
  });
});
