/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageGrid } from '../../../src/renderer/components/ImageGrid';
import type { RendererAppEvent } from '../../../src/shared/types';

vi.mock('../../../src/renderer/components/ContextMenu', () => ({
  ContextMenu: ({ children }: { children: React.ReactElement }) => children,
}));

const getThumbnail = vi.fn();
const generateThumbnail = vi.fn();
const reportInvalidImage = vi.fn();
const onReload = vi.fn();
let appEventCallback: ((event: RendererAppEvent) => void) | undefined;

function appEvent<TType extends RendererAppEvent['type']>(
  type: TType,
  payload: Extract<RendererAppEvent, { type: TType }>['payload'],
): Extract<RendererAppEvent, { type: TType }> {
  return {
    type,
    version: 1,
    occurredAt: '2026-06-09T00:00:00.000Z',
    source: 'imageService',
    payload,
  } as Extract<RendererAppEvent, { type: TType }>;
}

function image(id: number, filename: string) {
  return {
    id,
    filename,
    filepath: `C:/gallery/${filename}`,
    width: 100,
    height: 100,
    fileSize: 1024,
    format: 'jpg',
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
  };
}

describe('ImageGrid domain events', () => {
  beforeEach(() => {
    appEventCallback = undefined;
    vi.clearAllMocks();

    getThumbnail.mockImplementation(async (filepath: string) => ({
      success: true,
      data: `app://thumb/${filepath.split('/').pop()}`,
    }));
    generateThumbnail.mockResolvedValue({ success: true });
    reportInvalidImage.mockResolvedValue({ success: true });

    (window as any).electronAPI = {
      system: {
        onAppEvent: vi.fn((callback: (event: RendererAppEvent) => void) => {
          appEventCallback = callback;
          return vi.fn();
        }),
        showItem: vi.fn(),
      },
      image: {
        getThumbnail,
        generateThumbnail,
      },
      gallery: {
        reportInvalidImage,
      },
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as any).electronAPI;
  });

  it('hides a deleted image from the visible grid', async () => {
    render(<ImageGrid images={[image(1, 'a.jpg'), image(2, 'b.jpg')]} onReload={onReload} />);

    expect(await screen.findByAltText('a.jpg')).toBeTruthy();
    expect(screen.getByAltText('b.jpg')).toBeTruthy();

    act(() => {
      appEventCallback?.(appEvent('gallery:images-changed', {
        action: 'deleted',
        imageId: 1,
        affectedImageIds: [1],
        reason: 'userDelete',
      }));
    });

    await waitFor(() => {
      expect(screen.queryByAltText('a.jpg')).toBeNull();
    });
    expect(screen.getByAltText('b.jpg')).toBeTruthy();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('does not consume gallery domain events while inactive', async () => {
    render(<ImageGrid active={false} images={[image(1, 'a.jpg'), image(2, 'b.jpg')]} onReload={onReload} />);

    expect(await screen.findByAltText('a.jpg')).toBeTruthy();
    expect(screen.getByAltText('b.jpg')).toBeTruthy();

    act(() => {
      appEventCallback?.(appEvent('gallery:images-changed', {
        action: 'deleted',
        imageId: 1,
        affectedImageIds: [1],
        reason: 'userDelete',
      }));
    });

    expect(screen.getByAltText('a.jpg')).toBeTruthy();
    expect(screen.getByAltText('b.jpg')).toBeTruthy();
    expect(onReload).not.toHaveBeenCalled();
  });

  it('hides an image when invalid image reporting removes the original image', async () => {
    render(<ImageGrid images={[image(1, 'a.jpg'), image(2, 'b.jpg')]} onReload={onReload} />);

    expect(await screen.findByAltText('a.jpg')).toBeTruthy();

    act(() => {
      appEventCallback?.(appEvent('gallery:invalid-images-changed', {
        action: 'reported',
        invalidImageId: 20,
        originalImageId: 1,
      }));
    });

    await waitFor(() => {
      expect(screen.queryByAltText('a.jpg')).toBeNull();
    });
    expect(screen.getByAltText('b.jpg')).toBeTruthy();
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
