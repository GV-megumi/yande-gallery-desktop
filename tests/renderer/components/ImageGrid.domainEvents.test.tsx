/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

function timedImage(id: number, filename: string, updatedAt: string) {
  return {
    ...image(id, filename),
    createdAt: updatedAt,
    updatedAt,
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

  it('keeps name-sorted waterfall batches stable when more images become visible', async () => {
    const baseProps = {
      onReload,
      groupBy: 'none' as const,
      sortBy: 'name' as const,
      batchSize: 2,
      groupKeyPrefix: 'stable-name',
    };
    const { rerender } = render(
      <ImageGrid
        {...baseProps}
        images={[image(1, 'm.jpg'), image(2, 'z.jpg')]}
      />
    );

    const firstBatch = await waitFor(() => {
      const node = document.getElementById('stable-name__batch-1');
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    await within(firstBatch).findByAltText('m.jpg');
    expect(within(firstBatch).getByAltText('z.jpg')).toBeTruthy();
    expect(firstBatch.style.marginBottom).toBe('40px');

    rerender(
      <ImageGrid
        {...baseProps}
        images={[
          image(1, 'm.jpg'),
          image(2, 'z.jpg'),
          image(3, 'a.jpg'),
          image(4, 'b.jpg'),
        ]}
      />
    );

    const updatedFirstBatch = document.getElementById('stable-name__batch-1') as HTMLElement;
    const secondBatch = await waitFor(() => {
      const node = document.getElementById('stable-name__batch-2');
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });

    expect(within(updatedFirstBatch).getByAltText('m.jpg')).toBeTruthy();
    expect(within(updatedFirstBatch).getByAltText('z.jpg')).toBeTruthy();
    expect(within(updatedFirstBatch).queryByAltText('a.jpg')).toBeNull();
    expect(within(updatedFirstBatch).queryByAltText('b.jpg')).toBeNull();
    expect(await within(secondBatch).findByAltText('a.jpg')).toBeTruthy();
    expect(within(secondBatch).getByAltText('b.jpg')).toBeTruthy();
  });

  it('sorts images by requested ascending or descending order', async () => {
    const baseProps = {
      onReload,
      groupBy: 'none' as const,
      sortBy: 'name' as const,
      batchSize: 4,
      groupKeyPrefix: 'sort-order',
    };
    const images = [
      image(1, 'm.jpg'),
      image(2, 'a.jpg'),
      image(3, 'z.jpg'),
    ];

    const { rerender } = render(
      <ImageGrid
        {...baseProps}
        sortOrder="desc"
        images={images}
      />
    );

    const batch = await waitFor(() => {
      const node = document.getElementById('sort-order__batch-1');
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    await within(batch).findByAltText('z.jpg');
    expect(
      within(batch).getAllByRole('img').map((node) => node.getAttribute('alt')).filter(Boolean),
    ).toEqual(['z.jpg', 'm.jpg', 'a.jpg']);

    rerender(
      <ImageGrid
        {...baseProps}
        sortOrder="asc"
        images={images}
      />
    );

    await waitFor(() => {
      expect(
        within(batch).getAllByRole('img').map((node) => node.getAttribute('alt')).filter(Boolean),
      ).toEqual(['a.jpg', 'm.jpg', 'z.jpg']);
    });
  });

  it('keeps time sort order global before splitting waterfall batches', async () => {
    const baseProps = {
      onReload,
      groupBy: 'day' as const,
      sortBy: 'time' as const,
      batchSize: 2,
      groupKeyPrefix: 'time-order',
    };
    const images = [
      timedImage(1, 'three.jpg', '2026-06-09T00:03:00.000Z'),
      timedImage(2, 'one.jpg', '2026-06-09T00:01:00.000Z'),
      timedImage(3, 'four.jpg', '2026-06-09T00:04:00.000Z'),
      timedImage(4, 'two.jpg', '2026-06-09T00:02:00.000Z'),
    ];

    const { rerender } = render(
      <ImageGrid
        {...baseProps}
        sortOrder="asc"
        images={images}
      />
    );

    const firstAscBatch = await waitFor(() => {
      const node = document.getElementById('time-order__batch-1__2026年06月09日');
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    const secondAscBatch = await waitFor(() => {
      const node = document.getElementById('time-order__batch-2__2026年06月09日');
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    expect(
      within(firstAscBatch).getAllByRole('img').map((node) => node.getAttribute('alt')).filter(Boolean),
    ).toEqual(['one.jpg', 'two.jpg']);
    expect(
      within(secondAscBatch).getAllByRole('img').map((node) => node.getAttribute('alt')).filter(Boolean),
    ).toEqual(['three.jpg', 'four.jpg']);

    rerender(
      <ImageGrid
        {...baseProps}
        sortOrder="desc"
        images={images}
      />
    );

    await waitFor(() => {
      expect(
        within(firstAscBatch).getAllByRole('img').map((node) => node.getAttribute('alt')).filter(Boolean),
      ).toEqual(['four.jpg', 'three.jpg']);
    });
    expect(
      within(secondAscBatch).getAllByRole('img').map((node) => node.getAttribute('alt')).filter(Boolean),
    ).toEqual(['two.jpg', 'one.jpg']);
  });
});
