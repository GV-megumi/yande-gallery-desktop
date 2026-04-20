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
const cancelDownload = vi.fn().mockResolvedValue({ success: true });
const pauseAllDownloads = vi.fn().mockResolvedValue({ success: true });
const resumeAllDownloads = vi.fn().mockResolvedValue({ success: true });
const clearDownloadRecords = vi.fn().mockResolvedValue({ success: true, data: 0 });
const deleteDownloadRecord = vi.fn().mockResolvedValue({ success: true });
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
        cancelDownload,
        pauseAllDownloads,
        resumeAllDownloads,
        clearDownloadRecords,
        deleteDownloadRecord,
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

  it('进行中下载应同时暴露暂停与取消按钮（Bug8）', async () => {
    renderPage();

    expect(await screen.findByText('12345')).toBeDefined();

    await waitFor(() => {
      expect(getDownloadQueue).toHaveBeenCalledWith('downloading');
    });

    const row = screen.getByText('12345').closest('tr');
    expect(row).not.toBeNull();

    const rowScope = within(row!);
    expect(rowScope.getByRole('button', { name: '暂停下载' })).toBeDefined();
    // Bug8: 新增取消/删除按钮，确保用户能放弃进行中的任务
    expect(rowScope.getByRole('button', { name: '取消下载' })).toBeDefined();
  });

  it('已暂停下载项应同时暴露恢复与取消按钮，取消确认后走 cancelDownload', async () => {
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
    const cancelButton = rowScope.getByRole('button', { name: '取消下载' });
    expect(cancelButton).toBeDefined();

    await user.click(resumeButton);
    await waitFor(() => {
      expect(resumeDownload).toHaveBeenCalledWith(202);
    });

    // 点击取消按钮弹出 Popconfirm，点 "确认取消" 触发 cancelDownload
    await user.click(cancelButton);
    const confirmButton = await screen.findByRole('button', { name: '确认取消' });
    await user.click(confirmButton);
    await waitFor(() => {
      expect(cancelDownload).toHaveBeenCalledWith(202);
    });
  });

  it('失败列表每行应提供图标式"重试下载"与"删除记录"按钮，风格与进行中列表一致', async () => {
    downloadingQueue.splice(0, downloadingQueue.length);
    pausedQueue.splice(0, pausedQueue.length);
    failedQueue.splice(0, failedQueue.length, {
      id: 303,
      postId: 99999,
      siteId: 1,
      status: 'failed',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      retryCount: 1,
      priority: 0,
      targetPath: 'C:/downloads/failed.jpg',
      errorMessage: 'canceled',
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
    });

    const user = userEvent.setup();
    renderPage();

    // 切到"失败"标签页（用文本匹配，避免 Antd tab 的 aria 名称差异）
    const failedTab = await screen.findByText(/失败\s*\(1\)/);
    await user.click(failedTab);

    await waitFor(() => {
      expect(screen.getByText('99999')).toBeDefined();
    });

    const row = screen.getByText('99999').closest('tr');
    expect(row).not.toBeNull();
    const rowScope = within(row!);

    // 反模式守卫：旧版是带文字的 primary 大按钮，没有 aria-label，getByRole 按
    // 名称 "重试下载" 找不到；同时"删除记录"按钮根本不存在。
    const retryBtn = rowScope.getByRole('button', { name: '重试下载' });
    const deleteBtn = rowScope.getByRole('button', { name: '删除记录' });
    expect(retryBtn).toBeDefined();
    expect(deleteBtn).toBeDefined();

    // 重试走 retryDownload(postId, siteId)
    await user.click(retryBtn);
    await waitFor(() => {
      expect(retryDownload).toHaveBeenCalledWith(99999, 1);
    });

    // 删除走 Popconfirm → deleteDownloadRecord(queueId)
    await user.click(deleteBtn);
    const confirmDelete = await screen.findByRole('button', { name: '确认删除' });
    await user.click(confirmDelete);
    await waitFor(() => {
      expect(deleteDownloadRecord).toHaveBeenCalledWith(303);
    });
  });
});
