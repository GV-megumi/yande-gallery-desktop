import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

type TestMode = 'duplicate-pending-claim' | 'duplicate-start-dryrun' | 'running-session-restart-guard' | 'running-session-resets-stale-downloading';

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

async function waitFor(predicate: () => boolean, timeout = 2500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timeout');
}

async function flushAsyncWork(delay = 30) {
  await new Promise(resolve => setTimeout(resolve, delay));
}

describe('bulkDownloadService TP-02', () => {
  const tempDirs: string[] = [];
  const sessionCleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of sessionCleanups.splice(0)) {
      await cleanup();
    }
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
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-download-tp02-'));
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
        concurrency: mode === 'duplicate-pending-claim' ? 2 : 1,
        createdAt: now,
        updatedAt: now,
      },
      session: {
        id: sessionId,
        taskId,
        siteId: 1,
        status: (mode === 'running-session-restart-guard' || mode === 'running-session-resets-stale-downloading') ? 'running' : 'pending',
        startedAt: now,
        currentPage: 1,
        error: null,
        deletedAt: null,
      },
      records: [],
    };

    const db = {};
    const send = vi.fn();
    const getPostsCountRef = { current: 0 };
    const getRequestCountRef = { current: 0 };
    const releaseDryRunRef: { current?: () => void } = {};
    const releaseGetRef: { current?: () => void } = {};
    const settleDownloadRef: { current?: () => void } = {};
    const resetInFlightCountRef = { current: 0 };

    const createRecord = () => ({
      url: 'https://example.com/image.jpg',
      sessionId,
      status: 'pending',
      page: 1,
      pageIndex: 0,
      createdAt: now,
      fileName: 'image.jpg',
      extension: 'jpg',
      thumbnailUrl: 'https://example.com/preview.jpg',
      sourceUrl: '',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      error: null,
    });

    if (mode === 'running-session-restart-guard') {
      state.records.push(createRecord());
    }

    if (mode === 'running-session-resets-stale-downloading') {
      state.records.push({
        ...createRecord(),
        status: 'downloading',
        progress: 67,
        downloadedBytes: 12,
        totalBytes: 18,
        fileSize: 18,
      });
    }

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
            error: null,
          });
        }
        return;
      }

      if (sql.includes('UPDATE bulk_download_records')) {
        if (sql.includes('WHERE sessionId = ? AND status = ?') && !sql.includes('url = ?')) {
          const nextStatus = params[0];
          const sessionIdParam = params[1];
          const currentStatus = params[2];
          if (nextStatus === 'pending' && currentStatus === 'downloading') {
            resetInFlightCountRef.current += 1;
          }
          for (const record of state.records) {
            if (record.sessionId === sessionIdParam && record.status === currentStatus) {
              record.status = nextStatus;
              record.error = null;
              if (nextStatus === 'pending') {
                record.progress = 0;
                record.downloadedBytes = 0;
                record.totalBytes = 0;
                record.fileSize = null;
              }
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

        const isClaimPending = sql.includes('WHERE status = ? AND url = ? AND sessionId = ?');
        if (isClaimPending) {
          const currentStatus = params[1];
          if (record.status !== currentStatus) {
            return;
          }
          record.status = params[0];
          record.error = null;
          return;
        }

        if (mode === 'duplicate-pending-claim' && sql.includes('SET status = ?') && params[0] === 'downloading') {
          await new Promise(resolve => setTimeout(resolve, 80));
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
        const [sessionIdParam] = params;
        const grouped = new Map<string, number>();
        for (const record of state.records) {
          if (record.sessionId !== sessionIdParam) {
            continue;
          }
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

      return [];
    });

    const getPosts = vi.fn().mockImplementation(async ({ page }: { page: number }) => {
      getPostsCountRef.current += 1;

      if (mode === 'duplicate-start-dryrun') {
        if (page === 1) {
          await new Promise<void>(resolve => {
            releaseDryRunRef.current = resolve;
          });
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
        }
        return [];
      }

      if (mode === 'running-session-restart-guard' || mode === 'running-session-resets-stale-downloading') {
        return [];
      }

      if (page === 1) {
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
      }
      return [];
    });

    const axiosGet = vi.fn().mockImplementation(async (config: { method?: string; signal?: AbortSignal }) => {
      if (config.method !== 'GET') {
        return {
          headers: { 'content-length': '4' },
          data: Readable.from([Buffer.from('done')]),
        };
      }

      getRequestCountRef.current += 1;

      return await new Promise((resolve, reject) => {
        const abortWithUserError = () => reject(new Error('aborted by user'));
        releaseGetRef.current = abortWithUserError;
        settleDownloadRef.current = () => resolve({
          headers: { 'content-length': '4' },
          data: Readable.from([Buffer.from('done')]),
        });
        if (config.signal?.aborted) {
          abortWithUserError();
          return;
        }
        config.signal?.addEventListener('abort', abortWithUserError, { once: true });
      });
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
      const axiosModule = Object.assign(axiosGet, {
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
      generateFileName: vi.fn(() => 'image.jpg'),
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
    sessionCleanups.push(async () => {
      await mod.cancelBulkDownloadSession(sessionId);
      releaseDryRunRef.current?.();
      await flushAsyncWork(120);
    });

    return {
      ...mod,
      state,
      getPostsCountRef,
      getRequestCountRef,
      releaseDryRunRef,
      releaseGetRef,
      settleDownloadRef,
      resetInFlightCountRef,
      sessionId,
    };
  }

  it('pending 记录在落库变慢时也只应被领取一次，不应重复触发 GET', async () => {
    const { startBulkDownloadSession, cancelBulkDownloadSession, getRequestCountRef, sessionId } = await loadModule('duplicate-pending-claim');

    await expect(startBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => getRequestCountRef.current >= 1);
    await flushAsyncWork(180);

    expect(getRequestCountRef.current).toBe(1);

    await expect(cancelBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await flushAsyncWork();
  });

  it('dryRun 进行中重复 start 不应再次执行 dryRun', async () => {
    const { startBulkDownloadSession, getPostsCountRef, releaseDryRunRef, sessionId } = await loadModule('duplicate-start-dryrun');

    const firstStart = startBulkDownloadSession(sessionId);
    await waitFor(() => getPostsCountRef.current === 1);

    const secondStart = startBulkDownloadSession(sessionId);
    await flushAsyncWork();

    expect(getPostsCountRef.current).toBe(1);

    releaseDryRunRef.current?.();
    await expect(firstStart).resolves.toEqual({ success: true });
    await expect(secondStart).resolves.toEqual({ success: true });
  });

  it('running 会话重复 start 不应再次执行 dryRun', async () => {
    const { startBulkDownloadSession, getPostsCountRef, state, resetInFlightCountRef, sessionId } = await loadModule('running-session-restart-guard');

    await expect(startBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => resetInFlightCountRef.current >= 1);

    expect(getPostsCountRef.current).toBe(0);
    expect(state.session.status).toBe('running');
    expect(resetInFlightCountRef.current).toBe(1);
  });

  it('running 会话无活跃循环但残留 downloading 记录时，应先重置为 pending 再继续', async () => {
    const { startBulkDownloadSession, state, resetInFlightCountRef, sessionId } = await loadModule('running-session-resets-stale-downloading');

    await expect(startBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.records[0]?.status === 'pending');

    expect(state.session.status).toBe('running');
    expect(state.records[0].status).toBe('pending');
    expect(state.records[0].error ?? null).toBeNull();
    expect(state.records[0].progress ?? 0).toBe(0);
    expect(state.records[0].downloadedBytes ?? 0).toBe(0);
    expect(state.records[0].totalBytes ?? 0).toBe(0);
    expect(state.records[0].fileSize).toBeNull();
    expect(resetInFlightCountRef.current).toBe(1);
  });
});
