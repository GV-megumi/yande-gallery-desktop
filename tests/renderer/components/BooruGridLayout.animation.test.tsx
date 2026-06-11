/** @vitest-environment jsdom */

/**
 * BooruGridLayout 入场动画语义测试
 *
 * 入场动画（ios-card-appear）只应在内容集合变化（翻页/搜索/换站点）时播放；
 * 收藏/喜欢等单帖字段更新会产生新的 posts 数组引用但 ID 序列不变，
 * 不应整格重播动画（表现为全网格波浪式闪烁，像图片全部重新加载）。
 */

import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BooruGridLayout } from '../../../src/renderer/components/BooruGridLayout';
import type { BooruPost } from '../../../src/shared/types';

vi.mock('../../../src/renderer/components/BooruImageCard', () => ({
  BooruImageCard: ({ post }: { post: BooruPost }) => (
    <div data-testid={`card-${post.postId}`} />
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function post(id: number, overrides: Partial<BooruPost> = {}): BooruPost {
  return {
    id,
    siteId: 1,
    postId: id,
    md5: `md5-${id}`,
    fileUrl: `https://cdn.example.test/${id}.jpg`,
    previewUrl: `https://cdn.example.test/${id}-preview.jpg`,
    sampleUrl: `https://cdn.example.test/${id}-sample.jpg`,
    fileExt: 'jpg',
    tags: '',
    width: 100,
    height: 150,
    downloaded: false,
    isFavorited: false,
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
    ...overrides,
  } as BooruPost;
}

const baseProps = {
  gridSize: 220,
  spacing: 8,
  borderRadius: 8,
  selectedSite: null,
  onPreview: vi.fn(),
  onDownload: vi.fn(),
  onToggleFavorite: vi.fn(),
  favorites: new Set<number>(),
  getPreviewUrl: (p: BooruPost) => p.previewUrl || '',
};

function appearCount(container: HTMLElement): number {
  return container.querySelectorAll('.ios-card-appear').length;
}

describe('BooruGridLayout 入场动画语义', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('内容集合变化（翻页/搜索）时播放入场动画', () => {
    const pageOne = [post(1), post(2)];
    const view = render(<BooruGridLayout {...baseProps} posts={pageOne} />);

    const pageTwo = [post(3), post(4)];
    view.rerender(<BooruGridLayout {...baseProps} posts={pageTwo} />);

    expect(appearCount(view.container)).toBe(2);
  });

  it('同一批帖子仅字段更新（收藏/喜欢）时不重播入场动画', () => {
    const pageOne = [post(1), post(2)];
    const view = render(<BooruGridLayout {...baseProps} posts={pageOne} />);

    // 模拟收藏成功后的 setPosts(prev.map(...))：相同 ID 序列、新数组引用、新对象引用
    const favorited = pageOne.map(p =>
      p.postId === 1 ? { ...p, isFavorited: true } : { ...p }
    );
    view.rerender(<BooruGridLayout {...baseProps} posts={favorited} />);

    expect(appearCount(view.container)).toBe(0);
  });

  it('播放过入场动画后，字段更新也不会再次触发动画', () => {
    const pageOne = [post(1), post(2)];
    const view = render(<BooruGridLayout {...baseProps} posts={pageOne} />);

    // 翻页：播放动画
    const pageTwo = [post(3), post(4)];
    view.rerender(<BooruGridLayout {...baseProps} posts={pageTwo} />);
    expect(appearCount(view.container)).toBe(2);

    // 领域事件回传喜欢状态：仅字段更新，不应重播
    const liked = pageTwo.map(p => ({ ...p, isLiked: true }));
    view.rerender(<BooruGridLayout {...baseProps} posts={liked} />);
    expect(appearCount(view.container)).toBe(0);
  });
});
