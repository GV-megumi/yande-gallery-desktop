import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { IPC_CHANNELS } from '../../../src/main/ipc/channels.ts';

vi.mock('../../../src/main/ipc/channels.js', () => ({
  IPC_CHANNELS,
}));

type TestMode = 'pause' | 'cancel' | 'pause-race' | 'pause-restart-race' | 'pause-restart-overlap' | 'cancel-code' | 'network-error';

interface MockState {
  task: {
    id: string;
    siteId: number;
    path: string;
    tags: string;
    blacklistedTags: string | null;
    notifications: number;
    skipIfExists: number;
    quality: string | null;
    perPage: number;
    concurrency: number;
    createdAt: string;
    updatedAt: string;
  };
  session: {
    id: string;
    taskId: string;
    siteId: number;
    status: string;
    startedAt: string;
    currentPage: number;
    totalPages?: number;
    completedAt?: string;
    error?: string | null;
    deletedAt?: string | null;
  };
  records: Array<{
    url: string;
    sessionId: string;
    status: string;
    page: number;
    pageIndex: number;
    createdAt: string;
    fileName: string;
    extension?: string;
    thumbnailUrl?: string;
    sourceUrl?: string;
    error?: string | null;
    progress?: number;
    downloadedBytes?: number;
    totalBytes?: number;
    fileSize?: number;
  }>;
}

async function waitFor(predicate: () => boolean, timeout = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timeout');
}

async function flushAsyncWork(delay = 20) {
  await new Promise(resolve => setTimeout(resolve, delay));
}

describe('bulkDownloadService abort semantics', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function loadModule(mode: TestMode) {
    const taskId = 'task-1';
    const sessionId = 'session-1';
    const now = '2026-04-14T00:00:00.000Z';
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-download-abort-'));
    tempDirs.push(downloadDir);

    const state: MockState = {
      task: {
        id: taskId,
        siteId: 1,
        path: downloadDir,
        tags: 'tag1',
        blacklistedTags: null,
        notifications: 1,
        skipIfExists: 1,
        quality: null,
        perPage: 20,
        concurrency: mode === 'pause-restart-overlap' ? 2 : 1,
        createdAt: now,
        updatedAt: now,
      },
      session: {
        id: sessionId,
        taskId,
        siteId: 1,
        status: 'pending',
        startedAt: now,
        currentPage: 1,
        error: null,
        deletedAt: null,
      },
      records: [],
    };

    const db = {};
    const send = vi.fn();
    const restartRaceResolveRef: { current?: () => void } = {};
    const inFlightGetCountRef = { current: 0 };
    const createStreamResponse = () => ({
      headers: { 'content-length': '4' },
      data: Readable.from([Buffer.from('done')]),
    });
    const createAbortError = () => {
      if (mode === 'cancel-code') {
        return Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' });
      }
      return new Error('aborted by user');
    };
    const createAbortableGetPromise = (
      config: { signal?: AbortSignal },
      options?: { deferAbortReject?: boolean; onAbort?: (reject: (reason?: unknown) => void) => void }
    ) => new Promise((resolve, reject) => {
      inFlightGetCountRef.current += 1;
      const finalizeReject = (reason?: unknown) => {
        inFlightGetCountRef.current -= 1;
        reject(reason);
      };

      if (config.signal?.aborted) {
        finalizeReject(createAbortError());
        return;
      }

      config.signal?.addEventListener('abort', () => {
        if (options?.onAbort) {
          options.onAbort(finalizeReject);
          return;
        }
        if (options?.deferAbortReject) {
          setTimeout(() => finalizeReject(createAbortError()), 0);
          return;
        }
        finalizeReject(createAbortError());
      }, { once: true });
    });
    let pauseRestartRaceGetCount = 0;
    let pauseRestartOverlapGetCount = 0;
    const axiosMock = vi.fn().mockImplementation((config: { signal?: AbortSignal; method?: string }) => {
      if (mode === 'network-error') {
        return Promise.reject(new Error('socket hang up'));
      }

      if (config.method === 'GET' && mode === 'pause-restart-race') {
        pauseRestartRaceGetCount += 1;
        if (pauseRestartRaceGetCount > 1) {
          return Promise.resolve(createStreamResponse());
        }

        return createAbortableGetPromise(config, {
          onAbort: reject => {
            restartRaceResolveRef.current = () => reject(new Error('aborted by user'));
          },
        });
      }

      if (config.method === 'GET' && mode === 'pause-restart-overlap') {
        pauseRestartOverlapGetCount += 1;
        if (pauseRestartOverlapGetCount === 1) {
          return createAbortableGetPromise(config, {
            onAbort: reject => {
              restartRaceResolveRef.current = () => reject(new Error('aborted by user'));
            },
          });
        }
        if (pauseRestartOverlapGetCount === 2) {
          return createAbortableGetPromise(config);
        }
        return Promise.resolve(createStreamResponse());
      }

      if (config.method === 'GET' && (mode === 'pause' || mode === 'cancel' || mode === 'pause-race' || mode === 'cancel-code')) {
        return createAbortableGetPromise(config, {
          deferAbortReject: mode === 'pause-race',
        });
      }

      return Promise.resolve(createStreamResponse());
    });

    const run = vi.fn().mockImplementation(async (_db, sql: string, params: any[] = []) => {
      if (sql.includes('UPDATE bulk_download_sessions')) {
        const sessionIdParam = params[params.length - 1];
        if (sessionIdParam !== state.session.id) {
          return;
        }

        let idx = 0;
        if (sql.includes('status = ?')) {
          state.session.status = params[idx++];
        }
        if (sql.includes('currentPage = ?')) {
          state.session.currentPage = params[idx++];
        }
        if (sql.includes('totalPages = ?')) {
          state.session.totalPages = params[idx++];
        }
        if (sql.includes('error = ?')) {
          state.session.error = params[idx++] ?? null;
        }
        if (sql.includes('completedAt = ?')) {
          state.session.completedAt = params[idx++];
        }
        return;
      }

      if (sql.includes('INSERT OR IGNORE INTO bulk_download_records')) {
        const [url, sessionIdParam, status, page, pageIndex, createdAt, fileName, extension, thumbnailUrl, sourceUrl] = params;
        const exists = state.records.some(record => record.url === url && record.sessionId === sessionIdParam);
        if (!exists) {
          state.records.push({
            url,
            sessionId: sessionIdParam,
            status,
            page,
            pageIndex,
            createdAt,
            fileName,
            extension: extension || undefined,
            thumbnailUrl: thumbnailUrl || undefined,
            sourceUrl: sourceUrl || undefined,
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0,
          });
        }
        return;
      }

      if (sql.includes('UPDATE bulk_download_records')) {
        if (sql.includes('WHERE sessionId = ? AND status = ?') && !sql.includes('url = ?')) {
          const nextStatus = params[0];
          const sessionIdParam = params[1];
          const currentStatus = params[2];
          for (const record of state.records) {
            if (record.sessionId === sessionIdParam && record.status === currentStatus) {
              record.status = nextStatus;
              record.error = null;
            }
          }
          return;
        }

        const url = params[params.length - 2];
        const sessionIdParam = params[params.length - 1];
        const record = state.records.find(item => item.url === url && item.sessionId === sessionIdParam);
        if (!record) {
          return;
        }

        let idx = 0;
        if (sql.includes('status = ?')) {
          record.status = params[idx++];
        }
        if (sql.includes('fileSize = ?')) {
          record.fileSize = params[idx++];
        }
        if (sql.includes('progress = ?')) {
          record.progress = params[idx++];
        }
        if (sql.includes('downloadedBytes = ?')) {
          record.downloadedBytes = params[idx++];
        }
        if (sql.includes('totalBytes = ?')) {
          record.totalBytes = params[idx++];
        }
        if (sql.includes('error = ?')) {
          record.error = params[idx++] ?? null;
        }
        return;
      }

      return;
    });

    const get = vi.fn().mockImplementation(async (_db, sql: string, params: any[] = []) => {
      if (sql.includes('FROM bulk_download_sessions s') && sql.includes('INNER JOIN bulk_download_tasks t')) {
        return {
          ...state.session,
          ...state.task,
        };
      }

      if (sql.includes('SELECT status FROM bulk_download_sessions')) {
        return { status: state.session.status };
      }

      if (sql.includes('SELECT taskId FROM bulk_download_sessions')) {
        return { taskId: state.session.taskId };
      }

      if (sql.includes('SELECT path FROM bulk_download_tasks')) {
        return { path: state.task.path };
      }

      if (sql.includes('SELECT status FROM bulk_download_records')) {
        const [url, sessionIdParam] = params;
        const record = state.records.find(item => item.url === url && item.sessionId === sessionIdParam);
        return record ? { status: record.status } : null;
      }

      return null;
    });

    const all = vi.fn().mockImplementation(async (_db, sql: string, params: any[] = []) => {
      if (sql.includes('FROM booru_posts')) {
        return [];
      }

      if (sql.includes('FROM bulk_download_records') && sql.includes('GROUP BY status')) {
        const grouped = new Map<string, number>();
        for (const record of state.records) {
          grouped.set(record.status, (grouped.get(record.status) ?? 0) + 1);
        }
        return Array.from(grouped.entries()).map(([status, count]) => ({ status, count }));
      }

      if (sql.includes('SELECT * FROM bulk_download_records')) {
        const [sessionIdParam, status] = params;
        return state.records
          .filter(record => record.sessionId === sessionIdParam && (status ? record.status === status : true))
          .sort((a, b) => a.page - b.page || a.pageIndex - b.pageIndex)
          .map(record => ({ ...record }));
      }

      if (sql.includes('SELECT fileName FROM bulk_download_records')) {
        const [sessionIdParam] = params;
        return state.records
          .filter(record => record.sessionId === sessionIdParam && (record.status === 'downloading' || record.status === 'pending'))
          .map(record => ({ fileName: record.fileName }));
      }

      return [];
    });

    const getPosts = vi.fn().mockImplementation(async ({ page }: { page: number }) => {
      if (page !== 1) {
        return [];
      }

      if (mode === 'pause-restart-overlap') {
        return [{
          id: 123,
          md5: 'abc123',
          file_url: 'https://example.com/image-1.jpg',
          preview_url: 'https://example.com/preview-1.jpg',
          sample_url: 'https://example.com/sample-1.jpg',
          tags: 'tag1',
          rating: 's',
          width: 100,
          height: 100,
          score: 1,
          source: '',
        }, {
          id: 124,
          md5: 'def456',
          file_url: 'https://example.com/image-2.jpg',
          preview_url: 'https://example.com/preview-2.jpg',
          sample_url: 'https://example.com/sample-2.jpg',
          tags: 'tag1',
          rating: 's',
          width: 100,
          height: 100,
          score: 1,
          source: '',
        }];
      }

      return [{
        id: 123,
        md5: 'abc123',
        file_url: 'https://example.com/image.jpg',
        preview_url: 'https://example.com/preview.jpg',
        sample_url: 'https://example.com/sample.jpg',
        tags: 'tag1',
        rating: 's',
        width: 100,
        height: 100,
        score: 1,
        source: '',
      }];
    });

    vi.doMock('electron', () => ({
      BrowserWindow: {
        getAllWindows: () => [{ webContents: { send } }],
      },
      Notification: class {
        static isSupported = () => true;
        on = vi.fn();
        show = vi.fn();
      },
    }));

    vi.doMock('axios', () => {
      const axiosModule = Object.assign(axiosMock, {
        head: vi.fn().mockResolvedValue({ headers: { 'content-length': '4' } }),
      });
      return {
        default: axiosModule,
      };
    });

    const runWithChanges = vi.fn().mockImplementation(async (_db, sql: string, params: any[] = []) => {
      if (!sql.includes('UPDATE bulk_download_records')) {
        return { changes: 0 };
      }

      const url = params[params.length - 2];
      const sessionIdParam = params[params.length - 1];
      const record = state.records.find(item => item.url === url && item.sessionId === sessionIdParam);
      if (!record) {
        return { changes: 0 };
      }

      const isClaimPending = sql.includes('WHERE status = ? AND url = ? AND sessionId = ?');
      if (!isClaimPending) {
        return { changes: 0 };
      }

      const currentStatus = params[1];
      if (record.status !== currentStatus) {
        return { changes: 0 };
      }

      record.status = params[0];
      record.error = null;
      return { changes: 1 };
    });

    vi.doMock('../../../src/main/services/database.js', () => ({
      getDatabase: vi.fn().mockResolvedValue(db),
      run,
      runWithChanges,
      get,
      all,
    }));

    vi.doMock('../../../src/main/services/config.js', () => ({
      getProxyConfig: vi.fn(() => undefined),
      getConfig: vi.fn(() => ({ booru: { download: {} } })),
    }));

    vi.doMock('../../../src/main/services/filenameGenerator.js', () => ({
      generateFileName: vi.fn((_template: string | undefined, metadata?: { id?: string | number }) => metadata?.id ? `${metadata.id}.jpg` : 'image.jpg'),
    }));

    vi.doMock('../../../src/main/services/booruClientFactory.js', () => ({
      createBooruClient: vi.fn(() => ({ getPosts })),
    }));

    vi.doMock('../../../src/main/services/booruService.js', () => ({
      getBooruSiteById: vi.fn(async () => ({ id: 1, name: 'yande' })),
      getBooruPostBySiteAndId: vi.fn(async () => null),
    }));

    vi.doMock('../../../src/main/services/downloadManager.js', () => ({
      downloadManager: {},
    }));

    vi.doMock('../../../src/main/services/networkScheduler.js', () => ({
      networkScheduler: {
        onChange: vi.fn(() => () => {}),
        isBrowsingActive: vi.fn(() => false),
      },
    }));

    const mod = await import('../../../src/main/services/bulkDownloadService.js');
    return {
      ...mod,
      state,
      send,
      axiosMock,
      inFlightGetCountRef,
      restartRaceResolveRef,
      sessionId,
    };
  }

  it('暂停进行中的下载时，不应把记录持久化或广播为 failed', async () => {
    const { startBulkDownloadSession, pauseBulkDownloadSession, state, send, inFlightGetCountRef, sessionId } = await loadModule('pause');

    await expect(startBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.records.some(record => record.status === 'downloading'));
    expect(inFlightGetCountRef.current).toBeGreaterThan(0);

    await expect(pauseBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.session.status === 'paused');
    await waitFor(() => inFlightGetCountRef.current === 0);
    await flushAsyncWork();

    expect(state.records).toHaveLength(1);
    expect(state.records[0].status).not.toBe('failed');
    expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, expect.objectContaining({
      sessionId,
      url: state.records[0].url,
      status: 'failed',
    }));
  });

  it('取消进行中的下载时，不应把记录持久化或广播为 failed', async () => {
    const { startBulkDownloadSession, cancelBulkDownloadSession, state, send, inFlightGetCountRef, sessionId } = await loadModule('cancel');

    await expect(startBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.records.some(record => record.status === 'downloading'));
    expect(inFlightGetCountRef.current).toBeGreaterThan(0);

    await expect(cancelBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.session.status === 'cancelled');
    await waitFor(() => inFlightGetCountRef.current === 0);
    await flushAsyncWork();

    expect(state.records).toHaveLength(1);
    expect(state.records[0].status).not.toBe('failed');
    expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, expect.objectContaining({
      sessionId,
      url: state.records[0].url,
      status: 'failed',
    }));
  });

  it('暂停状态写入晚于 abort 拒绝时，仍不应把记录标记为 failed', async () => {
    const { startBulkDownloadSession, pauseBulkDownloadSession, state, send, sessionId } = await loadModule('pause-race');

    await expect(startBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.records.some(record => record.status === 'downloading'));

    const pausePromise = pauseBulkDownloadSession(sessionId);
    await expect(pausePromise).resolves.toEqual({ success: true });
    await waitFor(() => state.session.status === 'paused');
    await flushAsyncWork();

    expect(state.records).toHaveLength(1);
    expect(state.records[0].status).not.toBe('failed');
    expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, expect.objectContaining({
      sessionId,
      url: state.records[0].url,
      status: 'failed',
    }));
  });

  it('取消使用 ERR_CANCELED 形式的中断时，仍不应把记录持久化或广播为 failed', async () => {
    const { startBulkDownloadSession, cancelBulkDownloadSession, state, send, inFlightGetCountRef, sessionId } = await loadModule('cancel-code');

    await expect(startBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.records.some(record => record.status === 'downloading'));
    expect(inFlightGetCountRef.current).toBeGreaterThan(0);

    await expect(cancelBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.session.status === 'cancelled');
    await waitFor(() => inFlightGetCountRef.current === 0);
    await flushAsyncWork();

    expect(state.records).toHaveLength(1);
    expect(state.records[0].status).not.toBe('failed');
    expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, expect.objectContaining({
      sessionId,
      url: state.records[0].url,
      status: 'failed',
    }));
  });

  it('暂停后立即继续时，旧循环晚到的 abort 结果不应污染新一轮下载', async () => {
    const {
      startBulkDownloadSession,
      pauseBulkDownloadSession,
      state,
      send,
      axiosMock,
      restartRaceResolveRef,
      sessionId,
    } = await loadModule('pause-restart-race');

    await expect(startBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.records.some(record => record.status === 'downloading'));

    await expect(pauseBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.session.status === 'paused');

    let restartSettled = false;
    const restartPromise = startBulkDownloadSession(sessionId).then(result => {
      restartSettled = true;
      return result;
    });
    await flushAsyncWork();
    expect(restartSettled).toBe(false);

    restartRaceResolveRef.current?.();
    await expect(restartPromise).resolves.toEqual({ success: true });
    await waitFor(() => state.session.status === 'running' || state.records[0].status === 'downloading');
    await flushAsyncWork();

    expect(state.records).toHaveLength(1);
    expect(axiosMock.mock.calls.filter(([config]) => config?.method === 'GET')).toHaveLength(2);
    expect(state.session.status).not.toBe('failed');
    expect(state.records[0].status).not.toBe('failed');
    expect(state.records[0].error ?? null).toBeNull();
    expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, expect.objectContaining({
      sessionId,
      url: state.records[0].url,
      status: 'failed',
    }));
  });

  it('暂停后继续前应等待旧 worker 彻底退出，即使旧循环已先结束', async () => {
    const {
      startBulkDownloadSession,
      pauseBulkDownloadSession,
      state,
      restartRaceResolveRef,
      sessionId,
    } = await loadModule('pause-restart-overlap');

    await expect(startBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.records.filter(record => record.status === 'downloading').length === 2);

    await expect(pauseBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.session.status === 'paused');
    await waitFor(() => state.records.some(record => record.status === 'downloading'));
    await flushAsyncWork();

    let restartSettled = false;
    const restartPromise = startBulkDownloadSession(sessionId).then(result => {
      restartSettled = true;
      return result;
    });
    await flushAsyncWork(60);

    expect(restartSettled).toBe(false);

    restartRaceResolveRef.current?.();
    await expect(restartPromise).resolves.toEqual({ success: true });
    await waitFor(() => state.session.status === 'running' || state.records.some(record => record.status === 'downloading'));
    await flushAsyncWork();

    expect(state.session.status).not.toBe('failed');
    expect(state.records.every(record => record.status !== 'failed')).toBe(true);
  });

  it('真实下载错误仍应把记录标记并广播为 failed', async () => {
    const { startBulkDownloadSession, state, send, sessionId } = await loadModule('network-error');

    await expect(startBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.records.some(record => record.status === 'failed'));

    expect(state.records).toHaveLength(1);
    expect(state.records[0].error).toContain('socket hang up');
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, expect.objectContaining({
      sessionId,
      url: state.records[0].url,
      status: 'failed',
      error: expect.stringContaining('socket hang up'),
    }));
  });
});
