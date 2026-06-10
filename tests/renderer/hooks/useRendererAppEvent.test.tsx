/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { RendererAppEvent } from '../../../src/shared/types';
import { useRendererAppEvent } from '../../../src/renderer/hooks/useRendererAppEvent';

type AppEventCallback = (event: RendererAppEvent) => void;

const unsubscribe = vi.fn();
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
  active?: boolean;
  onEvent: (event: RendererAppEvent) => void;
  type?: RendererAppEvent['type'] | readonly RendererAppEvent['type'][];
}) {
  useRendererAppEvent(props.type ?? 'booru:post-favorite-changed', props.onEvent, {
    active: props.active,
  });
  return null;
}

describe('useRendererAppEvent', () => {
  beforeEach(() => {
    appEventCallback = undefined;
    vi.clearAllMocks();
    unsubscribe.mockClear();
    onAppEvent.mockImplementation((callback: AppEventCallback) => {
      appEventCallback = callback;
      return unsubscribe;
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

  it('subscribes to app events filters by event type and unsubscribes on unmount', () => {
    const onEvent = vi.fn();

    const view = render(<Listener onEvent={onEvent} />);

    expect(onAppEvent).toHaveBeenCalledTimes(1);

    act(() => {
      appEventCallback?.(appEvent('booru:post-favorite-changed', {
        action: 'added',
        siteId: 1,
        postId: 100,
        isFavorited: true,
      }));
      appEventCallback?.(appEvent('booru:blacklist-tags-changed', {
        action: 'created',
        siteId: 1,
        tagName: 'blocked_tag',
      }));
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].type).toBe('booru:post-favorite-changed');

    view.unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('queues matching events while inactive and replays them when active again', () => {
    const onEvent = vi.fn();

    const view = render(<Listener active={false} onEvent={onEvent} />);

    act(() => {
      appEventCallback?.(appEvent('booru:post-favorite-changed', {
        action: 'removed',
        siteId: 1,
        postId: 100,
        isFavorited: false,
      }));
    });

    expect(onEvent).not.toHaveBeenCalled();

    view.rerender(<Listener active onEvent={onEvent} />);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].payload).toMatchObject({
      action: 'removed',
      siteId: 1,
      postId: 100,
    });
  });

  it('caps buffered events per type while inactive and replays only the latest event after overflow', () => {
    const onEvent = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const view = render(<Listener active={false} onEvent={onEvent} />);

    act(() => {
      // 超过 50 条上限：前 50 条进入缓冲，第 51 条触发溢出，之后只保留最新一条
      for (let index = 1; index <= 60; index += 1) {
        appEventCallback?.(appEvent('booru:post-favorite-changed', {
          action: 'added',
          siteId: 1,
          postId: index,
          isFavorited: true,
        }));
      }
    });

    expect(onEvent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[useRendererAppEvent]');

    view.rerender(<Listener active onEvent={onEvent} />);

    // 溢出后只回放最新一条事件，而不是逐条回放 60 次
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].payload).toMatchObject({ postId: 60 });

    warnSpy.mockRestore();
  });

  it('replays non-overflowed types in order alongside an overflowed type latest event', () => {
    const onEvent = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const types = ['booru:post-favorite-changed', 'booru:blacklist-tags-changed'] as const;

    const view = render(<Listener active={false} onEvent={onEvent} type={types} />);

    act(() => {
      appEventCallback?.(appEvent('booru:blacklist-tags-changed', {
        action: 'created',
        siteId: 1,
        tagName: 'tag_a',
      }));
      for (let index = 1; index <= 55; index += 1) {
        appEventCallback?.(appEvent('booru:post-favorite-changed', {
          action: 'added',
          siteId: 1,
          postId: index,
          isFavorited: true,
        }));
      }
      appEventCallback?.(appEvent('booru:blacklist-tags-changed', {
        action: 'deleted',
        siteId: 1,
        tagName: 'tag_b',
      }));
    });

    view.rerender(<Listener active onEvent={onEvent} type={types} />);

    // 未溢出类型（blacklist，共 2 条）全部按序回放；溢出类型只回放最新一条
    expect(onEvent).toHaveBeenCalledTimes(3);
    const replayedPayloads = onEvent.mock.calls.map((call) => call[0].payload);
    expect(replayedPayloads[0]).toMatchObject({ tagName: 'tag_a' });
    expect(replayedPayloads[1]).toMatchObject({ tagName: 'tag_b' });
    expect(replayedPayloads[2]).toMatchObject({ postId: 55 });

    warnSpy.mockRestore();
  });

  it('does not replay queued events for a previous subscription type', () => {
    const onEvent = vi.fn();

    const view = render(<Listener active={false} onEvent={onEvent} type="booru:post-favorite-changed" />);

    act(() => {
      appEventCallback?.(appEvent('booru:post-favorite-changed', {
        action: 'removed',
        siteId: 1,
        postId: 100,
        isFavorited: false,
      }));
    });

    view.rerender(<Listener active={false} onEvent={onEvent} type="booru:blacklist-tags-changed" />);
    view.rerender(<Listener active onEvent={onEvent} type="booru:blacklist-tags-changed" />);

    expect(onEvent).not.toHaveBeenCalled();
  });
});
