import { afterEach, describe, expect, it, vi } from 'vitest';

describe('bulkDownloadService.resumeRunningSessions', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  async function loadModule() {
    const pausedSessionId = 'paused-session';
    const runningSessionId = 'running-session';
    const db = {};
    const run = vi.fn().mockResolvedValue({ changes: 1 });
    const get = vi.fn().mockImplementation(async (_db, sql: string) => {
      if (sql.includes('SELECT status FROM bulk_download_sessions')) {
        return { status: 'paused' };
      }
      return null;
    });
    const all = vi.fn().mockImplementation(async (_db, sql: string) => {
      if (sql.includes('FROM bulk_download_sessions s')) {
        const includePaused = sql.includes("'paused'");
        return includePaused
          ? [
              {
                id: pausedSessionId,
                status: 'paused',
                task_id: 'task-1',
                task_siteId: 1,
                task_path: '/downloads',
                task_tags: 'tag1',
                task_blacklistedTags: null,
                task_notifications: 1,
                task_skipIfExists: 1,
                task_quality: null,
                task_perPage: 50,
                task_concurrency: 2,
                task_createdAt: '2026-04-14T00:00:00.000Z',
                task_updatedAt: '2026-04-14T00:00:00.000Z',
              },
            ]
          : [
              {
                id: runningSessionId,
                status: 'running',
                task_id: 'task-2',
                task_siteId: 1,
                task_path: '/downloads',
                task_tags: 'tag2',
                task_blacklistedTags: null,
                task_notifications: 1,
                task_skipIfExists: 1,
                task_quality: null,
                task_perPage: 50,
                task_concurrency: 2,
                task_createdAt: '2026-04-14T00:00:00.000Z',
                task_updatedAt: '2026-04-14T00:00:00.000Z',
              },
            ];
      }

      if (sql.includes('FROM bulk_download_records') && sql.includes('GROUP BY status')) {
        return [{ status: 'pending', count: 1 }];
      }

      return [];
    });

    vi.doMock('electron', () => ({
      BrowserWindow: {
        getAllWindows: () => [],
      },
      Notification: class {
        static isSupported = () => true;
        on = vi.fn();
        show = vi.fn();
      },
    }));

    vi.doMock('../../../src/main/services/database.js', () => ({
      getDatabase: vi.fn().mockResolvedValue(db),
      run,
      get,
      all,
    }));

    vi.doMock('../../../src/main/services/config.js', () => ({
      getProxyConfig: () => undefined,
      getConfig: () => ({ booru: { download: {} } }),
    }));

    vi.doMock('../../../src/main/services/booruClientFactory.js', () => ({
      createBooruClient: vi.fn(),
    }));

    vi.doMock('../../../src/main/services/booruService.js', () => ({
      getBooruSiteById: vi.fn(),
      getBooruPostBySiteAndId: vi.fn(),
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
    return { resumeRunningSessions: mod.resumeRunningSessions, run, pausedSessionId, runningSessionId };
  }

  it('不应自动恢复 paused 会话', async () => {
    const { resumeRunningSessions, run, pausedSessionId } = await loadModule();

    const result = await resumeRunningSessions();

    expect(result).toEqual({ success: true, data: { resumed: 1 } });
    expect(run.mock.calls.some(([, , params]) => Array.isArray(params) && params.includes(pausedSessionId))).toBe(false);
  });

  it('恢复 running 会话时应重置 downloading 记录的进度字段', async () => {
    const { resumeRunningSessions, run, runningSessionId } = await loadModule();

    const result = await resumeRunningSessions();

    expect(result).toEqual({ success: true, data: { resumed: 1 } });
    expect(run).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('SET status = ?, error = NULL, progress = 0, downloadedBytes = 0, totalBytes = 0, fileSize = NULL'),
      ['pending', runningSessionId, 'downloading']
    );
  });
});
