/** @vitest-environment jsdom */

import React from 'react';
import { App as AntdApp } from 'antd';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BooruPostDetailsPage } from '../../../src/renderer/pages/BooruPostDetailsPage';
import type { BooruPost, BooruSite } from '../../../src/shared/types';

vi.mock('../../../src/renderer/components/BooruPostDetails/InformationSection', () => ({
  InformationSection: () => null,
}));

vi.mock('../../../src/renderer/components/BooruPostDetails/Toolbar', () => ({
  Toolbar: () => null,
}));

vi.mock('../../../src/renderer/components/BooruPostDetails/TagsSection', () => ({
  TagsSection: () => null,
}));

vi.mock('../../../src/renderer/components/BooruPostDetails/FileDetailsSection', () => ({
  FileDetailsSection: () => null,
}));

vi.mock('../../../src/renderer/components/BooruPostDetails/RelatedPostsSection', () => ({
  RelatedPostsSection: () => null,
}));

vi.mock('../../../src/renderer/components/BooruPostDetails/CommentSection', () => ({
  CommentSection: () => null,
}));

vi.mock('../../../src/renderer/components/BooruPostDetails/NotesOverlay', () => ({
  NotesOverlay: ({ post }: { post: BooruPost }) => (
    <div data-testid="notes-overlay" data-post-id={post.postId} />
  ),
}));

vi.mock('../../../src/renderer/components/BooruPostDetails/PostHistorySection', () => ({
  PostHistorySection: () => null,
}));

const getCachedImageUrl = vi.fn();
const cacheImage = vi.fn();
const getImageMetadata = vi.fn();
const getAppearancePreferences = vi.fn();

const site: BooruSite = {
  id: 1,
  name: 'yande',
  url: 'https://yande.re',
  type: 'moebooru',
  favoriteSupport: true,
  active: true,
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z',
};

function post(overrides: Partial<BooruPost>): BooruPost {
  return {
    id: overrides.id ?? overrides.postId ?? 1,
    siteId: 1,
    postId: overrides.postId ?? 1,
    md5: overrides.md5 ?? `md5-${overrides.postId ?? 1}`,
    fileUrl: overrides.fileUrl ?? `https://cdn.example.test/${overrides.postId ?? 1}.jpg`,
    previewUrl: overrides.previewUrl ?? `https://cdn.example.test/${overrides.postId ?? 1}-preview.jpg`,
    sampleUrl: overrides.sampleUrl ?? `https://cdn.example.test/${overrides.postId ?? 1}-sample.jpg`,
    fileExt: overrides.fileExt ?? 'jpg',
    tags: overrides.tags ?? '',
    downloaded: overrides.downloaded ?? false,
    isFavorited: overrides.isFavorited ?? false,
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function renderDetails(currentPost: BooruPost) {
  return render(
    <AntdApp>
      <BooruPostDetailsPage
        open
        post={currentPost}
        site={site}
        onClose={() => undefined}
      />
    </AntdApp>
  );
}

function rerenderDetails(view: ReturnType<typeof render>, currentPost: BooruPost) {
  view.rerender(
    <AntdApp>
      <BooruPostDetailsPage
        open
        post={currentPost}
        site={site}
        onClose={() => undefined}
      />
    </AntdApp>
  );
}

function imageSrcs(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('img')).map((img) => img.getAttribute('src') ?? '');
}

function firstImage(root: ParentNode): HTMLImageElement {
  const img = root.querySelector('img');
  if (!img) {
    throw new Error('Expected an image to be rendered');
  }
  return img;
}

describe('BooruPostDetailsPage image loading', () => {
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

    getImageMetadata.mockResolvedValue({ success: true, data: null });
    getAppearancePreferences.mockResolvedValue({
      success: true,
      data: { previewQuality: 'auto' },
    });

    (window as any).electronAPI = {
      booru: {
        getCachedImageUrl,
        cacheImage,
        getImageMetadata,
      },
      booruPreferences: {
        appearance: {
          get: getAppearancePreferences,
        },
      },
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as any).electronAPI;
  });

  it('clears the previous cached image while the next uncached post is still loading', async () => {
    const postA = post({ postId: 101, md5: 'a', fileUrl: 'https://cdn.example.test/a.jpg' });
    const postB = post({ postId: 102, md5: 'b', fileUrl: 'https://cdn.example.test/b.jpg' });
    const pendingCache = deferred<{ success: boolean; data?: string; error?: string }>();

    getCachedImageUrl.mockImplementation(async (md5: string) => {
      if (md5 === 'a') return { success: true, data: 'app://cache/a.jpg' };
      return { success: false };
    });
    cacheImage.mockReturnValue(pendingCache.promise);

    const view = renderDetails(postA);

    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('app://cache/a.jpg');
    });

    rerenderDetails(view, postB);

    await waitFor(() => {
      expect(cacheImage).toHaveBeenCalledWith('https://cdn.example.test/b.jpg', 'b', 'jpg');
    });

    expect(imageSrcs(view.baseElement)).not.toContain('app://cache/a.jpg');
  });

  it('keeps the committed image when the same post image refreshes with unrelated field changes', async () => {
    const postA = post({
      postId: 151,
      md5: 'same-image',
      fileUrl: 'https://cdn.example.test/same-image.jpg',
      tags: 'first',
      isFavorited: false,
      score: 1,
    });
    const refreshedPostA = {
      ...postA,
      tags: 'first refreshed-tag',
      isFavorited: true,
      score: 99,
    };

    getCachedImageUrl.mockResolvedValue({ success: true, data: 'app://cache/same-image.jpg' });

    const view = renderDetails(postA);

    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('app://cache/same-image.jpg');
    });
    expect(getCachedImageUrl).toHaveBeenCalledTimes(1);

    rerenderDetails(view, refreshedPostA);

    expect(imageSrcs(view.baseElement)).toContain('app://cache/same-image.jpg');
    expect(getCachedImageUrl).toHaveBeenCalledTimes(1);
  });

  it('does not render notes overlay while a switched post image is still loading', async () => {
    const postA = post({ postId: 181, md5: 'a', fileUrl: 'https://cdn.example.test/a.jpg' });
    const postB = post({ postId: 182, md5: 'b', fileUrl: 'https://cdn.example.test/b.jpg' });
    const pendingCache = deferred<{ success: boolean; data?: string; error?: string }>();

    getCachedImageUrl.mockImplementation(async (md5: string) => {
      if (md5 === 'a') return { success: true, data: 'app://cache/a.jpg' };
      return { success: false };
    });
    cacheImage.mockReturnValue(pendingCache.promise);

    const view = renderDetails(postA);

    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('app://cache/a.jpg');
    });
    expect(view.baseElement.querySelector('[data-testid="notes-overlay"]')).not.toBeNull();

    rerenderDetails(view, postB);

    await waitFor(() => {
      expect(cacheImage).toHaveBeenCalledWith('https://cdn.example.test/b.jpg', 'b', 'jpg');
    });

    expect(view.baseElement.querySelector('[data-testid="notes-overlay"]')).toBeNull();
  });

  it('ignores a late cache result from an older post after switching to a newer post', async () => {
    const postA = post({ postId: 201, md5: 'a', fileUrl: 'https://cdn.example.test/a.jpg' });
    const postB = post({ postId: 202, md5: 'b', fileUrl: 'https://cdn.example.test/b.jpg' });
    const postC = post({ postId: 203, md5: 'c', fileUrl: 'https://cdn.example.test/c.jpg' });
    const postBCache = deferred<{ success: boolean; data?: string; error?: string }>();

    getCachedImageUrl.mockImplementation(async (md5: string) => {
      if (md5 === 'a') return { success: true, data: 'app://cache/a.jpg' };
      return { success: false };
    });

    cacheImage.mockImplementation((url: string) => {
      if (url.endsWith('/b.jpg')) return postBCache.promise;
      return Promise.resolve({ success: true, data: 'app://cache/c.jpg' });
    });

    const view = renderDetails(postA);

    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('app://cache/a.jpg');
    });

    rerenderDetails(view, postB);
    await waitFor(() => {
      expect(cacheImage).toHaveBeenCalledWith('https://cdn.example.test/b.jpg', 'b', 'jpg');
    });

    rerenderDetails(view, postC);
    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('app://cache/c.jpg');
    });

    await act(async () => {
      postBCache.resolve({ success: true, data: 'app://cache/b.jpg' });
      await postBCache.promise;
    });

    expect(imageSrcs(view.baseElement)).toContain('app://cache/c.jpg');
    expect(imageSrcs(view.baseElement)).not.toContain('app://cache/b.jpg');
  });

  it('remounts the image when a new post commits the same cached URL', async () => {
    const postA = post({ postId: 301, md5: 'a', fileUrl: 'https://cdn.example.test/a.jpg' });
    const postB = post({ postId: 302, md5: 'b', fileUrl: 'https://cdn.example.test/b.jpg' });

    getCachedImageUrl.mockResolvedValue({ success: true, data: 'app://cache/shared.jpg' });

    const view = renderDetails(postA);

    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('app://cache/shared.jpg');
    });
    const firstRenderedImage = firstImage(view.baseElement);

    rerenderDetails(view, postB);

    await waitFor(() => {
      expect(getCachedImageUrl).toHaveBeenCalledWith('b', 'jpg');
      expect(firstImage(view.baseElement)).not.toBe(firstRenderedImage);
    });
    expect(imageSrcs(view.baseElement)).toContain('app://cache/shared.jpg');
  });

  it('stops retrying after every fallback URL has failed instead of ping-ponging sample/preview', async () => {
    const brokenPost = post({
      postId: 501,
      md5: 'broken',
      fileUrl: 'https://cdn.example.test/broken-file.jpg',
      sampleUrl: 'https://cdn.example.test/broken-sample.jpg',
      previewUrl: 'https://cdn.example.test/broken-preview.jpg',
    });

    // 缓存查询与下载均失败，组件会回退为直接使用原图 URL
    getCachedImageUrl.mockResolvedValue({ success: false });
    cacheImage.mockResolvedValue({ success: false, error: 'network error' });

    const view = renderDetails(brokenPost);

    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('https://cdn.example.test/broken-file.jpg');
    });

    // 原图失败 → 回退 sampleUrl
    await act(async () => {
      fireEvent.error(firstImage(view.baseElement));
    });
    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('https://cdn.example.test/broken-sample.jpg');
    });

    // sampleUrl 失败 → 回退 previewUrl
    await act(async () => {
      fireEvent.error(firstImage(view.baseElement));
    });
    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('https://cdn.example.test/broken-preview.jpg');
    });

    // previewUrl 也失败 → 回退链耗尽，进入加载失败终态：渲染错误占位，不再往返重试或发起新请求
    const cacheCallsBeforeExhaustion = cacheImage.mock.calls.length;
    await act(async () => {
      fireEvent.error(firstImage(view.baseElement));
    });
    await waitFor(() => {
      expect(view.baseElement.textContent).toContain('图片加载失败');
    });
    expect(view.baseElement.querySelector('img')).toBeNull();
    expect(cacheImage.mock.calls.length).toBe(cacheCallsBeforeExhaustion);

    // 点击重试应清空失败记录并重新发起一次完整加载
    const retryButton = Array.from(view.baseElement.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('重试')
    );
    expect(retryButton).toBeTruthy();
    await act(async () => {
      fireEvent.click(retryButton!);
    });
    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('https://cdn.example.test/broken-file.jpg');
    });
    expect(cacheImage.mock.calls.length).toBe(cacheCallsBeforeExhaustion + 1);
  });

  it('resets the failed URL record when switching posts so fallback works again', async () => {
    const brokenPost = post({
      postId: 511,
      md5: 'broken-a',
      fileUrl: 'https://cdn.example.test/a-file.jpg',
      sampleUrl: 'https://cdn.example.test/a-sample.jpg',
      previewUrl: 'https://cdn.example.test/a-preview.jpg',
    });
    const nextPost = post({
      postId: 512,
      md5: 'broken-b',
      fileUrl: 'https://cdn.example.test/b-file.jpg',
      sampleUrl: 'https://cdn.example.test/b-sample.jpg',
      previewUrl: 'https://cdn.example.test/b-preview.jpg',
    });

    getCachedImageUrl.mockResolvedValue({ success: false });
    cacheImage.mockResolvedValue({ success: false, error: 'network error' });

    const view = renderDetails(brokenPost);

    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('https://cdn.example.test/a-file.jpg');
    });

    // 第一张图耗尽所有候选 URL
    for (const expected of ['https://cdn.example.test/a-sample.jpg', 'https://cdn.example.test/a-preview.jpg']) {
      await act(async () => {
        fireEvent.error(firstImage(view.baseElement));
      });
      await waitFor(() => {
        expect(imageSrcs(view.baseElement)).toContain(expected);
      });
    }
    await act(async () => {
      fireEvent.error(firstImage(view.baseElement));
    });
    // 回退链耗尽后进入加载失败终态
    await waitFor(() => {
      expect(view.baseElement.textContent).toContain('图片加载失败');
    });

    // 切换帖子后失败记录与失败终态应重置，新帖子的回退链可正常工作
    rerenderDetails(view, nextPost);
    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('https://cdn.example.test/b-file.jpg');
    });
    await act(async () => {
      fireEvent.error(firstImage(view.baseElement));
    });
    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('https://cdn.example.test/b-sample.jpg');
    });
  });

  it('clears the terminal error state when the async load later commits successfully', async () => {
    const racePost = post({
      postId: 601,
      md5: 'race',
      fileUrl: 'https://cdn.example.test/race-file.jpg',
      sampleUrl: 'https://cdn.example.test/race-sample.jpg',
      previewUrl: 'https://cdn.example.test/race-preview.jpg',
    });
    const pendingCache = deferred<{ success: boolean; data?: string; error?: string }>();

    getCachedImageUrl.mockResolvedValue({ success: false });
    cacheImage.mockReturnValue(pendingCache.promise);

    const view = renderDetails(racePost);

    // 主进程缓存加载期间先挂载 previewUrl 占位图
    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('https://cdn.example.test/race-preview.jpg');
    });

    // 占位图直连失败 → 回退 sample → 再失败 → 候选耗尽进入失败终态
    await act(async () => {
      fireEvent.error(firstImage(view.baseElement));
    });
    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('https://cdn.example.test/race-sample.jpg');
    });
    await act(async () => {
      fireEvent.error(firstImage(view.baseElement));
    });
    await waitFor(() => {
      expect(view.baseElement.textContent).toContain('图片加载失败');
    });

    // 主进程缓存随后成功提交 → 必须清除失败终态并显示缓存图，不能被错误占位永久遮住
    await act(async () => {
      pendingCache.resolve({ success: true, data: 'app://cache/race.jpg' });
      await pendingCache.promise;
    });
    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('app://cache/race.jpg');
    });
    expect(view.baseElement.textContent).not.toContain('图片加载失败');
  });

  it('enters the terminal error state without re-requesting when the only candidate URL fails', async () => {
    const fallbackPost = post({
      postId: 401,
      fileUrl: '',
      sampleUrl: 'https://cdn.example.test/fallback-sample.jpg',
      previewUrl: '',
    });

    const view = renderDetails(fallbackPost);

    await waitFor(() => {
      expect(imageSrcs(view.baseElement)).toContain('https://cdn.example.test/fallback-sample.jpg');
    });

    await act(async () => {
      fireEvent.error(firstImage(view.baseElement));
    });

    // 唯一候选 URL 失败后进入加载失败终态：渲染错误占位，不再循环重挂载或重新请求
    await waitFor(() => {
      expect(view.baseElement.textContent).toContain('图片加载失败');
    });
    expect(view.baseElement.querySelector('img')).toBeNull();
    expect(cacheImage).not.toHaveBeenCalled();
  });
});
