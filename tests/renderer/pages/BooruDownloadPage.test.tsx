/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';
import userEvent from '@testing-library/user-event';
import { BooruDownloadPage } from '../../../src/renderer/pages/BooruDownloadPage';
import type { DownloadQueueItem } from '../../../src/shared/types';

vi.mock('../../../src/renderer/components/StatusTag', () => ({
  StatusTag: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('../../../src/renderer/components/ContextMenu', () => ({
  useContextMenu: () => ({
    data: null,
    open: false,
    x: 0,
    y: 0,
    show: vi.fn(),
    close: vi.fn(),
  }),
  ContextMenuPortal: () => null,
}));

const pendingQueue: DownloadQueueItem[] = [];
const downloadingQueue: DownloadQueueItem[] = [
  {
    id: 101,
    postId: 12345,
    siteId: 1,
    status: 'downloading',
    progress: 30,
    downloadedBytes: 300,
    totalBytes: 1000,
    retryCount: 0,
    priority: 0,
    targetPath: 'C:/downloads/sample.jpg',
    createdAt: '2026-04-14T00:00:00.000Z',
    updatedAt: '2026-04-14T00:00:00.000Z',
  },
];
const pausedQueue: DownloadQueueItem[] = [];
const completedQueue: DownloadQueueItem[] = [];
const failedQueue: DownloadQueueItem[] = [];

const getDownloadQueue = vi.fn(async (status: string) => {
  const dataMap: Record<string, DownloadQueueItem[]> = {
    pending: pendingQueue,
    downloading: downloadingQueue,
    paused: pausedQueue,
    completed: completedQueue,
    failed: failedQueue,
  };

  return {
    success: true,
    data: dataMap[status] ?? [],
  };
});
const getQueueStatus = vi.fn().mockResolvedValue({
  success: true,
  data: {
    isPaused: false,
    activeCount: 1,
    maxConcurrent: 3,
  },
});
const resumePendingDownloads = vi.fn().mockResolvedValue({
  success: true,
  data: { resumed: 0, total: 0 },
});
const pauseDownload = vi.fn().mockResolvedValue({ success: true });
const resumeDownload = vi.fn().mockResolvedValue({ success: true });
const pauseAllDownloads = vi.fn().mockResolvedValue({ success: true });
const resumeAllDownloads = vi.fn().mockResolvedValue({ success: true });
const clearDownloadRecords = vi.fn().mockResolvedValue({ success: true, data: 0 });
const retryDownload = vi.fn().mockResolvedValue({ success: true });
const showItem = vi.fn().mockResolvedValue({ success: true });

function renderPage() {
  return render(
    <App>
      <BooruDownloadPage />
    </App>
  );
}

describe('BooruDownloadPage active download actions', () => {
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

    (window as any).electronAPI = {
      booru: {
        getDownloadQueue,
        getQueueStatus,
        resumePendingDownloads,
        pauseDownload,
        resumeDownload,
        pauseAllDownloads,
        resumeAllDownloads,
        clearDownloadRecords,
        retryDownload,
        onDownloadProgress: vi.fn(),
        onDownloadStatus: vi.fn(),
        onQueueStatus: vi.fn(),
      },
      system: {
        showItem,
      },
    };
  });

  it('进行中下载应保留暂停操作但不再暴露伪取消按钮', async () => {
    renderPage();

    expect(await screen.findByText('12345')).toBeDefined();

    await waitFor(() => {
      expect(getDownloadQueue).toHaveBeenCalledWith('downloading');
    });

    const row = screen.getByText('12345').closest('tr');
    expect(row).not.toBeNull();

    const rowScope = within(row!);
    expect(rowScope.getByRole('button', { name: '暂停下载' })).toBeDefined();
    expect(rowScope.queryByRole('button', { name: '删除' })).toBeNull();
    expect(rowScope.queryByRole('button', { name: '取消下载' })).toBeNull();
  });

  it('已暂停下载项应保留恢复操作且不暴露伪取消按钮', async () => {
    downloadingQueue.splice(0, downloadingQueue.length);
    pausedQueue.splice(0, pausedQueue.length, {
      id: 202,
      postId: 54321,
      siteId: 1,
      status: 'paused',
      progress: 45,
      downloadedBytes: 450,
      totalBytes: 1000,
      retryCount: 0,
      priority: 0,
      targetPath: 'C:/downloads/paused.jpg',
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
    });

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('54321')).toBeDefined();

    await waitFor(() => {
      expect(getDownloadQueue).toHaveBeenCalledWith('paused');
    });

    const row = screen.getByText('54321').closest('tr');
    expect(row).not.toBeNull();

    const rowScope = within(row!);
    const resumeButton = rowScope.getByRole('button', { name: '恢复下载' });
    expect(resumeButton).toBeDefined();
    expect(rowScope.queryByRole('button', { name: '删除' })).toBeNull();
    expect(rowScope.queryByRole('button', { name: '取消下载' })).toBeNull();

    await user.click(resumeButton);
    await waitFor(() => {
      expect(resumeDownload).toHaveBeenCalledWith(202);
    });
  });
});
