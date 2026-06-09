/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { TagsSection } from '../../../src/renderer/components/BooruPostDetails/TagsSection';
import type { BlacklistedTag, BooruPost, BooruSite, RendererAppEvent } from '../../../src/shared/types';

const getTagsCategories = vi.fn();
const getFavoriteTags = vi.fn();
const getBlacklistedTags = vi.fn();
const addBlacklistedTag = vi.fn();
const removeBlacklistedTag = vi.fn();
const onAppEvent = vi.fn();
let appEventCallback: ((event: RendererAppEvent) => void) | undefined;

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

const post: BooruPost = {
  id: 1,
  siteId: 1,
  postId: 100,
  fileUrl: 'https://example.test/image.jpg',
  tags: 'sunpe ass',
  downloaded: false,
  isFavorited: false,
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z',
};

function blacklistedTag(overrides: Partial<BlacklistedTag>): BlacklistedTag {
  return {
    id: 7,
    siteId: 1,
    tagName: 'sunpe',
    isActive: true,
    createdAt: '2026-06-08T00:00:00.000Z',
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

function renderTagsSection(
  props: Partial<React.ComponentProps<typeof TagsSection>> = {}
) {
  const view = render(
    <AntdApp>
      <TagsSection post={props.post ?? post} site={props.site ?? site} />
    </AntdApp>
  );

  const header = view.container.querySelector('.ant-collapse-header');
  if (!header) {
    throw new Error('Tags collapse header was not rendered');
  }
  fireEvent.click(header);

  return view;
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

async function openTagMenu(tagName: string) {
  const tag = await screen.findByText(tagName);
  fireEvent.contextMenu(tag);
}

describe('TagsSection blacklist context menu', () => {
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

    (globalThis as any).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    getTagsCategories.mockResolvedValue({
      success: true,
      data: {
        sunpe: 'artist',
        ass: 'general',
      },
    });
    getFavoriteTags.mockResolvedValue({
      success: true,
      data: {
        items: [],
        total: 0,
      },
    });
    getBlacklistedTags.mockResolvedValue({
      success: true,
      data: {
        items: [],
        total: 0,
      },
    });
    addBlacklistedTag.mockResolvedValue({
      success: true,
      data: blacklistedTag({ id: 9, tagName: 'ass' }),
    });
    removeBlacklistedTag.mockResolvedValue({ success: true });
    onAppEvent.mockImplementation((callback: (event: RendererAppEvent) => void) => {
      appEventCallback = callback;
      return vi.fn();
    });

    (window as any).electronAPI = {
      booru: {
        getTagsCategories,
        getFavoriteTags,
        getBlacklistedTags,
        addBlacklistedTag,
        removeBlacklistedTag,
        addFavoriteTag: vi.fn(),
        removeFavoriteTagByName: vi.fn(),
      },
      system: {
        onAppEvent,
      },
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('treats prototype property tag names as unblacklisted when no matching blacklist record exists', async () => {
    renderTagsSection({
      post: {
        ...post,
        tags: 'constructor',
      },
    });

    await waitFor(() => {
      expect(getBlacklistedTags).toHaveBeenCalledWith({ siteId: 1, limit: 0 });
    });

    await openTagMenu('constructor');
    expect(await screen.findByText('加入黑名单')).toBeTruthy();
    expect(screen.queryByText('移除黑名单')).toBeNull();
  });

  it('shows remove action for an initially blacklisted tag and removes by blacklist id', async () => {
    getBlacklistedTags.mockResolvedValueOnce({
      success: true,
      data: {
        items: [blacklistedTag({ id: 7, tagName: 'sunpe' })],
        total: 1,
      },
    });

    renderTagsSection();

    await waitFor(() => {
      expect(getBlacklistedTags).toHaveBeenCalledWith({ siteId: 1, limit: 0 });
    });

    await openTagMenu('sunpe');
    fireEvent.click(await screen.findByText('移除黑名单'));

    await waitFor(() => {
      expect(removeBlacklistedTag).toHaveBeenCalledWith(7);
    });
  });

  it('adds a missing tag to blacklist and updates the next context menu state locally', async () => {
    renderTagsSection();

    await waitFor(() => {
      expect(getBlacklistedTags).toHaveBeenCalledWith({ siteId: 1, limit: 0 });
    });

    await openTagMenu('ass');
    fireEvent.click(await screen.findByText('加入黑名单'));

    await waitFor(() => {
      expect(addBlacklistedTag).toHaveBeenCalledWith('ass', 1);
    });

    await openTagMenu('ass');
    expect(await screen.findByText('移除黑名单')).toBeTruthy();
  });

  it('does not apply a pending add result after switching to another site', async () => {
    let resolveAdd: (value: unknown) => void = () => {};
    addBlacklistedTag.mockReturnValueOnce(new Promise(resolve => {
      resolveAdd = resolve;
    }));

    const site2: BooruSite = {
      ...site,
      id: 2,
      name: 'danbooru',
      url: 'https://danbooru.donmai.us',
      type: 'danbooru',
    };
    const post2: BooruPost = {
      ...post,
      siteId: 2,
    };

    const view = renderTagsSection();

    await waitFor(() => {
      expect(getBlacklistedTags).toHaveBeenCalledWith({ siteId: 1, limit: 0 });
    });

    await openTagMenu('ass');
    fireEvent.click(await screen.findByText('加入黑名单'));

    await waitFor(() => {
      expect(addBlacklistedTag).toHaveBeenCalledWith('ass', 1);
    });

    view.rerender(
      <AntdApp>
        <TagsSection post={post2} site={site2} />
      </AntdApp>
    );

    await waitFor(() => {
      expect(getBlacklistedTags).toHaveBeenCalledWith({ siteId: 2, limit: 0 });
    });

    await act(async () => {
      resolveAdd({
        success: true,
        data: blacklistedTag({ id: 9, siteId: 1, tagName: 'ass' }),
      });
    });

    await openTagMenu('ass');
    expect(await screen.findByText('加入黑名单')).toBeTruthy();
    expect(screen.queryByText('移除黑名单')).toBeNull();
  });

  it('does not apply stale favorite tag status after switching to another site', async () => {
    const oldFavoriteTags = deferred<{ success: true; data: { items: Array<{ tagName: string }>; total: number } }>();
    const site2: BooruSite = {
      ...site,
      id: 2,
      name: 'danbooru',
      url: 'https://danbooru.donmai.us',
      type: 'danbooru',
    };
    const post2: BooruPost = {
      ...post,
      siteId: 2,
    };

    getFavoriteTags
      .mockReturnValueOnce(oldFavoriteTags.promise)
      .mockResolvedValueOnce({
        success: true,
        data: {
          items: [],
          total: 0,
        },
      });

    const view = renderTagsSection();

    await waitFor(() => {
      expect(getFavoriteTags).toHaveBeenCalledWith({ siteId: 1, limit: 0 });
    });

    view.rerender(
      <AntdApp>
        <TagsSection post={post2} site={site2} />
      </AntdApp>
    );

    await waitFor(() => {
      expect(getFavoriteTags).toHaveBeenCalledWith({ siteId: 2, limit: 0 });
    });

    await act(async () => {
      oldFavoriteTags.resolve({
        success: true,
        data: {
          items: [{ tagName: 'sunpe' }],
          total: 1,
        },
      });
      await Promise.resolve();
    });

    await openTagMenu('sunpe');
    expect(await screen.findByText('收藏标签')).toBeTruthy();
    expect(screen.queryByText('取消收藏标签')).toBeNull();
  });

  it('reloads blacklist state after duplicate add and shows remove action from the reloaded record', async () => {
    getBlacklistedTags
      .mockResolvedValueOnce({
        success: true,
        data: {
          items: [],
          total: 0,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          items: [blacklistedTag({ id: 11, tagName: 'ass' })],
          total: 1,
        },
      });
    addBlacklistedTag.mockResolvedValueOnce({
      success: false,
      error: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: booru_blacklisted_tags.siteId, booru_blacklisted_tags.tagName',
    });

    renderTagsSection();

    await waitFor(() => {
      expect(getBlacklistedTags).toHaveBeenCalledWith({ siteId: 1, limit: 0 });
    });

    await openTagMenu('ass');
    fireEvent.click(await screen.findByText('加入黑名单'));

    await waitFor(() => {
      expect(getBlacklistedTags).toHaveBeenCalledTimes(2);
    });

    await openTagMenu('ass');
    expect(await screen.findByText('移除黑名单')).toBeTruthy();
  });

  it('reloads favorite tag and blacklist maps when matching domain events arrive', async () => {
    getFavoriteTags
      .mockResolvedValueOnce({
        success: true,
        data: {
          items: [],
          total: 0,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          items: [{ tagName: 'ass' }],
          total: 1,
        },
      });
    getBlacklistedTags
      .mockResolvedValueOnce({
        success: true,
        data: {
          items: [],
          total: 0,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          items: [blacklistedTag({ id: 11, tagName: 'ass' })],
          total: 1,
        },
      });

    renderTagsSection();

    await waitFor(() => {
      expect(getFavoriteTags).toHaveBeenCalledTimes(1);
      expect(getBlacklistedTags).toHaveBeenCalledTimes(1);
    });

    act(() => {
      appEventCallback?.(appEvent('favorite-tags:changed', {
        action: 'created',
        siteId: 1,
        tagName: 'ass',
      }));
    });

    await waitFor(() => {
      expect(getFavoriteTags).toHaveBeenCalledTimes(2);
    });

    act(() => {
      appEventCallback?.(appEvent('booru:blacklist-tags-changed', {
        action: 'created',
        siteId: 1,
        tagName: 'ass',
      }));
    });

    await waitFor(() => {
      expect(getBlacklistedTags).toHaveBeenCalledTimes(2);
    });

    expect(getBlacklistedTags.mock.calls[1][0]).toEqual({ siteId: 1, limit: 0 });
  });
});
