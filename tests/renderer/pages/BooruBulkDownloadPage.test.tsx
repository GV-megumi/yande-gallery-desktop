/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, act, cleanup, fireEvent, screen } from '@testing-library/react';
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

describe('BooruBulkDownloadPage handleStartFromTask (bug2 regression)', () => {
  beforeEach(() => {
    // antd 组件依赖 matchMedia，jsdom 默认无实现，这里补一个 no-op
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
  });

  afterEach(() => {
    cleanup();
    delete (window as any).electronAPI;
  });

  // bug2 反模式守卫：loadSessions 必须在 createSession 成功后立即调用，
  // 而不是等 startSession 的 dryRun 完成后才调。
  // 这里用一个永不 resolve 的 startSession Promise 模拟 dryRun 阻塞，
  // 如果实现仍然 await startSession，refreshAfterCreate 永远不会触发。
  it('calls loadSessions immediately after createSession, before startSession resolves', async () => {
    const taskFixture = {
      id: 'task-1',
      name: '测试任务',
      siteId: 'site-1',
      tags: [],
      limit: 100,
      options: {},
      createdAt: '2026-04-18T00:00:00.000Z',
      updatedAt: '2026-04-18T00:00:00.000Z',
    } as any;

    const getActiveSessionsLocal = vi.fn().mockResolvedValue({ success: true, data: [] });
    const getTasksLocal = vi.fn().mockResolvedValue({ success: true, data: [taskFixture] });
    const getSitesLocal = vi.fn().mockResolvedValue({ success: true, data: [] });
    const createSession = vi.fn().mockResolvedValue({
      success: true,
      data: { id: 'session-new' },
    });

    // startSession 永不 resolve —— 模拟 dryRun 阻塞
    let resolveStart: ((v: any) => void) | undefined;
    const startSession = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveStart = resolve;
      })
    );

    (window as any).electronAPI = {
      bulkDownload: {
        getActiveSessions: getActiveSessionsLocal,
        getTasks: getTasksLocal,
        createSession,
        startSession,
      },
      booru: {
        getSites: getSitesLocal,
      },
    };

    render(
      <App>
        <BooruBulkDownloadPage active />
      </App>
    );

    // 等 mount 阶段的初始 loadSessions / loadTasks / loadSites 跑完
    await waitFor(() => {
      expect(getTasksLocal).toHaveBeenCalled();
      expect(getActiveSessionsLocal).toHaveBeenCalledTimes(1);
    });

    // 等任务列表渲染出"开始"按钮
    const startBtn = await screen.findByRole('button', { name: /开始/ });

    // 点击"开始"
    await act(async () => {
      fireEvent.click(startBtn);
      // 让 handleStartFromTask 里的 await createSession 完成
      await Promise.resolve();
      await Promise.resolve();
    });

    // createSession 应该被调用
    expect(createSession).toHaveBeenCalledWith('task-1');

    // startSession 已经被 kick off（在后台 IIFE 里），但还没 resolve
    expect(startSession).toHaveBeenCalledWith('session-new');

    // 核心断言：loadSessions 必须在 startSession resolve 之前就再次被调用过
    // (mount 时 1 次 + createSession 成功后立即 1 次 = 至少 2 次)
    expect(getActiveSessionsLocal.mock.calls.length).toBeGreaterThanOrEqual(2);

    // 收尾：让 startSession resolve，避免未处理 promise 警告
    if (resolveStart) {
      await act(async () => {
        resolveStart!({ success: true });
        await Promise.resolve();
      });
    }
  });
});
