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
