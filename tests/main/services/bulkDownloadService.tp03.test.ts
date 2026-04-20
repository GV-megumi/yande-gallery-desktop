import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

type DownloadMode = 'head-size-mismatch-get-fails' | 'head-fails-get-fails' | 'head-fails-autofix';

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

describe('bulkDownloadService TP-03', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function loadModule(mode: DownloadMode, options?: { skipIfExists?: number }) {
    const taskId = 'task-1';
    const sessionId = 'session-1';
    const now = '2026-04-14T00:00:00.000Z';
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-download-tp03-'));
    tempDirs.push(downloadDir);

    const state: MockState = {
      task: {
        id: taskId,
        siteId: 1,
        path: downloadDir,
        tags: 'tag1',
        blacklistedTags: null,
        notifications: 1,
        skipIfExists: options?.skipIfExists ?? 1,
        quality: null,
        perPage: 20,
        concurrency: 1,
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
    const fileName = 'image.jpg';
    const filePath = path.join(downloadDir, fileName);
    const tempPath = `${filePath}.part`;

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
        const [url, sessionIdParam, status, page, pageIndex, createdAt, insertedFileName, extension, thumbnailUrl, sourceUrl] = params;
        const exists = state.records.some(record => record.url === url && record.sessionId === sessionIdParam);
        if (!exists) {
          state.records.push({
            url,
            sessionId: sessionIdParam,
            status,
            page,
            pageIndex,
            createdAt,
            fileName: insertedFileName,
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
        const [sessionIdParam, currentStatus] = params;
        if (sql.includes('WHERE sessionId = ? AND status = ?') && !sql.includes('url = ?')) {
          for (const record of state.records) {
            if (record.sessionId === sessionIdParam && record.status === currentStatus) {
              record.status = 'pending';
              record.error = null;
            }
          }
          return;
        }

        const url = params[params.length - 2];
        const recordSessionId = params[params.length - 1];
        const record = state.records.find(item => item.url === url && item.sessionId === recordSessionId);
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

      if (sql.includes('SELECT status FROM bulk_download_records')) {
        const [url, recordSessionId] = params;
        const record = state.records.find(item => item.url === url && item.sessionId === recordSessionId);
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
        const [recordSessionId, status] = params;
        return state.records
          .filter(record => record.sessionId === recordSessionId && (status ? record.status === status : true))
          .sort((a, b) => a.page - b.page || a.pageIndex - b.pageIndex)
          .map(record => ({ ...record }));
      }

      return [];
    });

    const getPosts = vi.fn().mockImplementation(async ({ page }: { page: number }) => {
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

    const axiosHead = vi.fn().mockImplementation(async () => {
      if (mode === 'head-size-mismatch-get-fails') {
        return { headers: { 'content-length': '15' } };
      }
      throw new Error('head failed');
    });

    const axiosGet = vi.fn().mockImplementation(async () => {
      if (mode === 'head-fails-autofix') {
        return {
          headers: { 'content-length': '4' },
          data: Readable.from([Buffer.from('done')]),
        };
      }
      throw new Error('socket hang up');
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
        head: axiosHead,
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
      const recordSessionId = params[params.length - 1];
      const record = state.records.find(item => item.url === url && item.sessionId === recordSessionId);
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
      getMaxConcurrentBulkDownloadSessions: vi.fn(() => 3),
    }));

    vi.doMock('../../../src/main/services/filenameGenerator.js', () => ({
      generateFileName: vi.fn(() => fileName),
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
      axiosHead,
      axiosGet,
      sessionId,
      filePath,
      tempPath,
    };
  }

  it('已有最终文件且大小不符时，重下失败后仍应保留最终文件，只清理 .part', async () => {
    const { startBulkDownloadSession, state, sessionId, filePath, tempPath } = await loadModule('head-size-mismatch-get-fails', {
      skipIfExists: 0,
    });
    fs.writeFileSync(filePath, 'old-final');

    await expect(startBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
    await waitFor(() => state.records.some(record => record.status === 'failed'));

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('old-final');
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(state.records[0].status).toBe('failed');
  });

  it('HEAD 失败时即使 skipIfExists=true，也不应把非空最终文件直接判为 completed', async () => {
    const { startBulkDownloadSession, state, sessionId, filePath, tempPath, send } = await loadModule('head-fails-get-fails', {
      skipIfExists: 1,
    });
    fs.writeFileSync(filePath, 'old-final');

    const originalExistsSync = fs.existsSync;
    let targetPathCheckCount = 0;
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockImplementation((checkedPath: fs.PathLike) => {
      if (String(checkedPath) === filePath) {
        targetPathCheckCount += 1;
        if (targetPathCheckCount === 1) {
          return false;
        }
      }
      return originalExistsSync(checkedPath);
    });

    try {
      await expect(startBulkDownloadSession(sessionId)).resolves.toEqual({ success: true });
      await waitFor(() => state.records.some(record => record.status === 'failed'));
    } finally {
      existsSyncSpy.mockRestore();
    }

    expect(state.records[0].status).toBe('failed');
    expect(state.records[0].error).toContain('socket hang up');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('old-final');
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(send).not.toHaveBeenCalledWith('bulk-download:record-status', expect.objectContaining({
      sessionId,
      url: state.records[0].url,
      status: 'completed',
    }));
  });

  it('autoFix 在 HEAD 失败时不应仅因最终文件非空就把记录修复为 completed', async () => {
    const { getBulkDownloadRecordsBySession, state, sessionId, filePath } = await loadModule('head-fails-autofix');
    fs.writeFileSync(filePath, 'old-final');
    state.records.push({
      url: 'https://example.com/image.jpg',
      sessionId,
      status: 'pending',
      page: 1,
      pageIndex: 0,
      createdAt: '2026-04-14T00:00:00.000Z',
      fileName: 'image.jpg',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    });

    const records = await getBulkDownloadRecordsBySession(sessionId, undefined, undefined, true);

    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('pending');
    expect(records[0].progress ?? 0).toBe(0);
    expect(records[0].downloadedBytes ?? 0).toBe(0);
    expect(records[0].totalBytes ?? 0).toBe(0);
  });
});
