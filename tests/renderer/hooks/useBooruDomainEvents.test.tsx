/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type {
  RendererAppEvent,
  RendererBooruBlacklistTagsChangedPayload,
  RendererBooruFavoriteGroupsChangedPayload,
  RendererBooruPostDownloadStateChangedPayload,
  RendererBooruPostFavoriteChangedPayload,
  RendererBooruPostServerFavoriteChangedPayload,
  RendererBooruPostVoteChangedPayload,
  RendererBooruSavedSearchesChangedPayload,
  RendererBooruSearchHistoryChangedPayload,
  RendererBooruSitesChangedPayload,
  RendererFavoriteTagsChangedPayload,
} from '../../../src/shared/types';
import { useBooruDomainEvents } from '../../../src/renderer/hooks/useBooruDomainEvents';

type AppEventCallback = (event: RendererAppEvent) => void;

const onAppEvent = vi.fn();
let appEventCallback: AppEventCallback | undefined;

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

function Listener(props: {
  siteId: number | null;
  active?: boolean;
  onPostFavoriteChanged?: (payload: RendererBooruPostFavoriteChangedPayload) => void;
  onServerFavoriteChanged?: (payload: RendererBooruPostServerFavoriteChangedPayload) => void;
  onBlacklistTagsChanged?: (payload: RendererBooruBlacklistTagsChangedPayload) => void;
  onFavoriteTagsChanged?: (payload: RendererFavoriteTagsChangedPayload) => void;
  onSitesChanged?: (payload: RendererBooruSitesChangedPayload) => void;
  onFavoriteGroupsChanged?: (payload: RendererBooruFavoriteGroupsChangedPayload) => void;
  onSavedSearchesChanged?: (payload: RendererBooruSavedSearchesChangedPayload) => void;
  onSearchHistoryChanged?: (payload: RendererBooruSearchHistoryChangedPayload) => void;
  onPostDownloadStateChanged?: (payload: RendererBooruPostDownloadStateChangedPayload) => void;
  onPostVoteChanged?: (payload: RendererBooruPostVoteChangedPayload) => void;
}) {
  useBooruDomainEvents({
    siteId: props.siteId,
    active: props.active,
    onPostFavoriteChanged: props.onPostFavoriteChanged,
    onServerFavoriteChanged: props.onServerFavoriteChanged,
    onBlacklistTagsChanged: props.onBlacklistTagsChanged,
    onFavoriteTagsChanged: props.onFavoriteTagsChanged,
    onSitesChanged: props.onSitesChanged,
    onFavoriteGroupsChanged: props.onFavoriteGroupsChanged,
    onSavedSearchesChanged: props.onSavedSearchesChanged,
    onSearchHistoryChanged: props.onSearchHistoryChanged,
    onPostDownloadStateChanged: props.onPostDownloadStateChanged,
    onPostVoteChanged: props.onPostVoteChanged,
  });
  return null;
}

describe('useBooruDomainEvents', () => {
  beforeEach(() => {
    appEventCallback = undefined;
    vi.clearAllMocks();
    onAppEvent.mockImplementation((callback: AppEventCallback) => {
      appEventCallback = callback;
      return vi.fn();
    });

    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      value: {
        system: {
          onAppEvent,
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('routes matching Booru domain events and filters events from other sites', () => {
    const onPostFavoriteChanged = vi.fn();
    const onServerFavoriteChanged = vi.fn();
    const onBlacklistTagsChanged = vi.fn();
    const onFavoriteTagsChanged = vi.fn();

    render(
      <Listener
        siteId={2}
        onPostFavoriteChanged={onPostFavoriteChanged}
        onServerFavoriteChanged={onServerFavoriteChanged}
        onBlacklistTagsChanged={onBlacklistTagsChanged}
        onFavoriteTagsChanged={onFavoriteTagsChanged}
      />,
    );

    act(() => {
      appEventCallback?.(appEvent('booru:post-favorite-changed', {
        action: 'added',
        siteId: 2,
        postId: 100,
        isFavorited: true,
      }));
      appEventCallback?.(appEvent('booru:post-server-favorite-changed', {
        action: 'liked',
        siteId: 3,
        postId: 101,
        isLiked: true,
      }));
      appEventCallback?.(appEvent('booru:blacklist-tags-changed', {
        action: 'imported',
        affectedCount: 2,
      }));
      appEventCallback?.(appEvent('favorite-tags:changed', {
        action: 'updated',
        siteId: 2,
        tagName: 'artist_name',
      }));
    });

    expect(onPostFavoriteChanged).toHaveBeenCalledTimes(1);
    expect(onPostFavoriteChanged).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 2,
      postId: 100,
      isFavorited: true,
    }));
    expect(onServerFavoriteChanged).not.toHaveBeenCalled();
    expect(onBlacklistTagsChanged).toHaveBeenCalledTimes(1);
    expect(onBlacklistTagsChanged).toHaveBeenCalledWith(expect.objectContaining({
      action: 'imported',
      affectedCount: 2,
    }));
    expect(onFavoriteTagsChanged).toHaveBeenCalledTimes(1);
  });

  it('always routes site list changes regardless of current site filter', () => {
    const onSitesChanged = vi.fn();

    render(<Listener siteId={2} onSitesChanged={onSitesChanged} />);

    act(() => {
      appEventCallback?.(appEvent('booru:sites-changed', {
        action: 'activeChanged',
        siteId: 3,
        activeSiteId: 3,
        affectedCount: 1,
      }));
    });

    expect(onSitesChanged).toHaveBeenCalledWith(expect.objectContaining({
      action: 'activeChanged',
      siteId: 3,
    }));
  });

  it('routes saved-search cross-site moves to subscribers of the previous site', () => {
    const onSavedSearchesChanged = vi.fn();

    render(<Listener siteId={2} onSavedSearchesChanged={onSavedSearchesChanged} />);

    act(() => {
      // 保存的搜索从站点 2 移动到站点 5：订阅站点 2 的页面也应收到事件
      appEventCallback?.(appEvent('booru:saved-searches-changed', {
        action: 'updated',
        siteId: 5,
        previousSiteId: 2,
        searchId: 20,
      }));
      // 与站点 2 无关的跨站点移动（4 → 5）：不应触发
      appEventCallback?.(appEvent('booru:saved-searches-changed', {
        action: 'updated',
        siteId: 5,
        previousSiteId: 4,
        searchId: 21,
      }));
    });

    expect(onSavedSearchesChanged).toHaveBeenCalledTimes(1);
    expect(onSavedSearchesChanged).toHaveBeenCalledWith(expect.objectContaining({
      searchId: 20,
      previousSiteId: 2,
    }));
  });

  it('routes P1 and P2 Booru events through the same site filter', () => {
    const onFavoriteGroupsChanged = vi.fn();
    const onSavedSearchesChanged = vi.fn();
    const onSearchHistoryChanged = vi.fn();
    const onPostDownloadStateChanged = vi.fn();
    const onPostVoteChanged = vi.fn();

    render(
      <Listener
        siteId={2}
        onFavoriteGroupsChanged={onFavoriteGroupsChanged}
        onSavedSearchesChanged={onSavedSearchesChanged}
        onSearchHistoryChanged={onSearchHistoryChanged}
        onPostDownloadStateChanged={onPostDownloadStateChanged}
        onPostVoteChanged={onPostVoteChanged}
      />,
    );

    act(() => {
      appEventCallback?.(appEvent('booru:favorite-groups-changed', {
        action: 'favoriteMoved',
        siteId: 2,
        groupId: 10,
        postId: 100,
      }));
      appEventCallback?.(appEvent('booru:saved-searches-changed', {
        action: 'updated',
        siteId: 2,
        searchId: 20,
      }));
      appEventCallback?.(appEvent('booru:search-history-changed', {
        action: 'created',
        siteId: 3,
        affectedCount: 1,
      }));
      appEventCallback?.(appEvent('booru:post-download-state-changed', {
        action: 'markedDownloaded',
        siteId: 2,
        postId: 100,
        downloaded: true,
      }));
      appEventCallback?.(appEvent('booru:post-vote-changed', {
        siteId: 2,
        postId: 100,
        vote: 1,
      }));
    });

    expect(onFavoriteGroupsChanged).toHaveBeenCalledWith(expect.objectContaining({
      action: 'favoriteMoved',
      groupId: 10,
    }));
    expect(onSavedSearchesChanged).toHaveBeenCalledWith(expect.objectContaining({
      action: 'updated',
      searchId: 20,
    }));
    expect(onSearchHistoryChanged).not.toHaveBeenCalled();
    expect(onPostDownloadStateChanged).toHaveBeenCalledWith(expect.objectContaining({
      action: 'markedDownloaded',
      postId: 100,
    }));
    expect(onPostVoteChanged).toHaveBeenCalledWith(expect.objectContaining({
      postId: 100,
      vote: 1,
    }));
  });
});
