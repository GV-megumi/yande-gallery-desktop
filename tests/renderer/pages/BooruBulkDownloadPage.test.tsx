/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { App } from 'antd';
import { BooruBulkDownloadPage } from '../../../src/renderer/pages/BooruBulkDownloadPage';

vi.mock('../../../src/renderer/components/BulkDownloadTaskForm', () => ({
  BulkDownloadTaskForm: () => <div data-testid="bulk-download-task-form" />,
}));

vi.mock('../../../src/renderer/components/BulkDownloadSessionCard', () => ({
  BulkDownloadSessionCard: () => <div data-testid="bulk-download-session-card" />,
}));

const getActiveSessions = vi.fn().mockResolvedValue({
  success: true,
  data: [
    {
      id: 'session-1',
      taskId: 'task-1',
      status: 'running',
      totalPosts: 10,
      processedPosts: 1,
      downloadedPosts: 1,
      skippedPosts: 0,
      failedPosts: 0,
      currentPage: 1,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
    },
  ],
});

const getTasks = vi.fn().mockResolvedValue({
  success: true,
  data: [],
});

const getSites = vi.fn().mockResolvedValue({
  success: true,
  data: [],
});

describe('BooruBulkDownloadPage active gating', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    (window as any).electronAPI = {
      bulkDownload: {
        getActiveSessions,
        getTasks,
      },
      booru: {
        getSites,
      },
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('becomes hidden after mount should stop session polling', async () => {
    const view = render(
      <App>
        <BooruBulkDownloadPage active />
      </App>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(getActiveSessions).toHaveBeenCalledTimes(1);

    getActiveSessions.mockClear();

    view.rerender(
      <App>
        <BooruBulkDownloadPage active={false} />
      </App>
    );

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(getActiveSessions).not.toHaveBeenCalled();
  });
});
