/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, act, cleanup, fireEvent, screen } from '@testing-library/react';
import { App } from 'antd';
import { BooruBulkDownloadPage } from '../../../src/renderer/pages/BooruBulkDownloadPage';

// Bug7 follow-up：测试 notifyIfQueued 直接读 startSession 返回值。
// 页面通过 App.useApp() 拿 message，我们 spy 它，让 useApp 返回一个可观测的
// message 对象，测试据此断言 message.info 是否被调、文本是否包含 "已加入队列"。
const messageInfo = vi.fn();
const messageError = vi.fn();
const messageSuccess = vi.fn();
const messageWarning = vi.fn();
const fakeUseAppResult = {
  message: {
    info: messageInfo,
    error: messageError,
    success: messageSuccess,
    warning: messageWarning,
    open: vi.fn(),
    loading: vi.fn(),
    destroy: vi.fn(),
  },
  notification: {
    open: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    destroy: vi.fn(),
  },
  modal: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    confirm: vi.fn(),
    destroyAll: vi.fn(),
  },
};
// 直接改 App.useApp（App 是带 static 的组件函数，可以覆写其 useApp 属性）
(App as any).useApp = () => fakeUseAppResult;

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

  it('接收 bulk-download:sessions-changed 后应防抖刷新会话', async () => {
    let appEventCallback: ((event: any) => void) | undefined;
    const unsubscribe = vi.fn();
    (window as any).electronAPI.system = {
      onAppEvent: vi.fn((callback) => {
        appEventCallback = callback;
        return unsubscribe;
      }),
    };

    render(
      <App>
        <BooruBulkDownloadPage active />
      </App>
    );

    await act(async () => {
      await Promise.resolve();
    });
    getActiveSessions.mockClear();

    act(() => {
      appEventCallback?.({
        type: 'bulk-download:sessions-changed',
        version: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        source: 'bulkDownloadService',
        payload: { reason: 'created', sessionId: 's1' },
      });
      appEventCallback?.({
        type: 'bulk-download:sessions-changed',
        version: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        source: 'bulkDownloadService',
        payload: { reason: 'statusChanged', sessionId: 's1' },
      });
      vi.advanceTimersByTime(200);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getActiveSessions).toHaveBeenCalledTimes(1);
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

    // 切到"已保存任务" Tab（默认是"活跃任务"，saved tab 里的按钮在 items lazy render 前还不在 DOM）
    const savedTab = await screen.findByRole('tab', { name: /已保存任务/ });
    await act(async () => {
      fireEvent.click(savedTab);
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

describe('BooruBulkDownloadPage notifyIfQueued (bug7 follow-up I1/I2)', () => {
  beforeEach(() => {
    messageInfo.mockReset();
    messageError.mockReset();
    messageSuccess.mockReset();
    messageWarning.mockReset();

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

  // 守卫：startSession 返回 queued: true 时，UI 必须立即弹 "已加入队列" info，
  // 不得再依赖后续 getActiveSessions 查 status（race-prone）。
  it('当 startSession 返回 queued: true 时，应弹 message.info("已加入队列...")', async () => {
    const taskFixture = {
      id: 'task-q',
      name: '队列测试任务',
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
      data: { id: 'session-queued' },
    });
    // 关键：startSession 返回 queued: true（闸门超限分支）
    const startSession = vi.fn().mockResolvedValue({ success: true, queued: true });

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

    await waitFor(() => {
      expect(getTasksLocal).toHaveBeenCalled();
    });

    // 切到"已保存任务" Tab（默认是"活跃任务"，saved tab 里的按钮在 items lazy render 前还不在 DOM）
    const savedTab = await screen.findByRole('tab', { name: /已保存任务/ });
    await act(async () => {
      fireEvent.click(savedTab);
    });

    const startBtn = await screen.findByRole('button', { name: /开始/ });

    await act(async () => {
      fireEvent.click(startBtn);
      // 让 handleStartFromTask 里 createSession → startSession 的后台 IIFE 跑完
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(startSession).toHaveBeenCalledWith('session-queued');
    });

    // 关键守卫：message.info 必须被调，且文本含 "已加入队列"
    await waitFor(() => {
      expect(messageInfo).toHaveBeenCalled();
    });
    const infoMessages = messageInfo.mock.calls.map(c => String(c[0]));
    expect(infoMessages.some(m => m.includes('已加入队列'))).toBe(true);

    // 反模式守卫：不应再靠 getActiveSessions 查 queued 状态
    //（handleStartFromTask 只在 mount + createSession 成功 + startSession 成功这三处刷新
    // 列表，没有再专门查 queued。我们确保没有任何一次 getActiveSessions 发生在
    // startSession resolve 之后专门为判队列用的场景 —— 这里宽松断言：数量保持在常规
    // 刷新范围内，不会额外多一次）
    // 允许 mount + 两次 loadSessions = 3 次，不应该 >= 4（旧实现会多一次 notifyIfQueued 里的查询）
    expect(getActiveSessionsLocal.mock.calls.length).toBeLessThanOrEqual(3);
  });

  // 反模式守卫：startSession 返回 queued: false / 省略 queued 时，不得弹 info
  it('当 startSession 返回 queued: false（或字段缺失）时，不应弹 message.info', async () => {
    const taskFixture = {
      id: 'task-n',
      name: '正常任务',
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
      data: { id: 'session-normal' },
    });
    // 关键：正常启动，无 queued 标记
    const startSession = vi.fn().mockResolvedValue({ success: true });

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

    await waitFor(() => {
      expect(getTasksLocal).toHaveBeenCalled();
    });

    // 切到"已保存任务" Tab（默认是"活跃任务"，saved tab 里的按钮在 items lazy render 前还不在 DOM）
    const savedTab = await screen.findByRole('tab', { name: /已保存任务/ });
    await act(async () => {
      fireEvent.click(savedTab);
    });

    const startBtn = await screen.findByRole('button', { name: /开始/ });

    await act(async () => {
      fireEvent.click(startBtn);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(startSession).toHaveBeenCalledWith('session-normal');
    });

    // 反模式守卫：不得因为正常路径而误弹 "已加入队列"
    const infoMessages = messageInfo.mock.calls.map(c => String(c[0]));
    expect(infoMessages.some(m => m.includes('已加入队列'))).toBe(false);
  });
});
