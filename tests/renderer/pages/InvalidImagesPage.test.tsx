/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';

vi.mock('../../../src/renderer/components/ContextMenu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../src/renderer/components/LazyLoadFooter', () => ({
  LazyLoadFooter: ({ current, total, onLoadMore }: { current: number; total: number; onLoadMore: () => void }) => {
    if (current >= total) {
      return null;
    }

    return <button onClick={onLoadMore}>加载更多（{current}/{total}）</button>;
  },
}));

import { InvalidImagesPage } from '../../../src/renderer/pages/InvalidImagesPage';

const getInvalidImages = vi.fn();
const deleteInvalidImage = vi.fn();
const clearInvalidImages = vi.fn();

function renderPage() {
  return render(
    <App>
      <InvalidImagesPage />
    </App>
  );
}

describe('InvalidImagesPage error state', () => {
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

    getInvalidImages.mockResolvedValue({ success: false, error: 'boom' });
    deleteInvalidImage.mockResolvedValue({ success: true });
    clearInvalidImages.mockResolvedValue({ success: true, data: { deleted: 0 } });

    (window as any).electronAPI = {
      gallery: {
        getInvalidImages,
        deleteInvalidImage,
        clearInvalidImages,
      },
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('加载失败时应显示错误态而不是“没有无效图片”空态', async () => {
    renderPage();

    await waitFor(() => {
      expect(getInvalidImages).toHaveBeenCalled();
    });

    expect(await screen.findByText('加载无效图片失败')).toBeTruthy();
    expect(screen.queryByText('没有无效图片')).toBeNull();
  });

  it('错误态应提供重试入口并允许重新加载', async () => {
    getInvalidImages
      .mockResolvedValueOnce({ success: false, error: 'boom' })
      .mockResolvedValueOnce({ success: true, data: [], total: 0 });

    renderPage();

    expect(await screen.findByText('加载无效图片失败')).toBeTruthy();

    const retryButton = screen.getAllByRole('button', { name: /重\s*试/ })[0];
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(getInvalidImages).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText('没有无效图片')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /重\s*试/ })).toHaveLength(0);
  });

  it('初始加载成功后加载更多失败时应保留已加载内容而不是切换为整页错误态', async () => {
    const firstPage = new Array(200);
    firstPage[0] = {
      id: 1,
      originalImageId: 1001,
      filename: 'broken-1.jpg',
      filepath: '/images/broken-1.jpg',
      fileSize: 123,
      width: 100,
      height: 80,
      format: 'jpg',
      thumbnailPath: null,
      detectedAt: '2026-04-14T12:00:00.000Z',
      galleryId: 1,
    };

    let resolveLoadMore!: (value: { success: boolean; data?: typeof firstPage; total?: number; error?: string }) => void;
    const loadMorePromise = new Promise<{ success: boolean; data?: typeof firstPage; total?: number; error?: string }>(resolve => {
      resolveLoadMore = resolve;
    });

    getInvalidImages.mockImplementation((pageNum: number) => {
      if (pageNum === 1) {
        return Promise.resolve({
          success: true,
          data: firstPage,
          total: 201,
        });
      }

      return loadMorePromise;
    });

    renderPage();

    expect(await screen.findByText('broken-1.jpg')).toBeTruthy();
    expect(screen.getByText('共 201 项无效图片')).toBeTruthy();

    const loadMoreButton = await screen.findByRole('button', { name: '加载更多（200/201）' });
    fireEvent.click(loadMoreButton);

    await waitFor(() => {
      expect(getInvalidImages).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveLoadMore({ success: false, error: 'load more failed' });
      await loadMorePromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('broken-1.jpg')).toBeTruthy();
      expect(screen.getByText('共 201 项无效图片')).toBeTruthy();
      expect(screen.getByRole('button', { name: '加载更多（200/201）' })).toBeTruthy();
      expect(screen.queryAllByRole('button', { name: /重\s*试/ })).toHaveLength(0);
      expect(screen.queryByText('没有无效图片')).toBeNull();
    });
  });
});
