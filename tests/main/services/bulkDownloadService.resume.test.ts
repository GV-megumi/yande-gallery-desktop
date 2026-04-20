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
      getMaxConcurrentBulkDownloadSessions: () => 3,
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

  /**
   * 启动自愈：DB 里同 taskId 两条 running 坏数据，经过预分组 + 看门后：
   * - 第一条（A）作为 keeper，看门放行 → 置 queued
   * - 第二条（B）在预分组阶段被立刻置 paused（保留 DB 顺序下的第一条规则）
   * resumedCount 必须为 1，不能退化成 0。
   */
  async function loadModuleWithDoubleRunning() {
    const sessionIdA = 'session-A';
    const sessionIdB = 'session-B';
    const taskId = 'task-1';
    const db = {};
    const run = vi.fn().mockResolvedValue({ changes: 1 });

    // 跟踪 A / B 在 DB 中的当前状态（用于 ensureCanEnterRunning 活跃探测）
    const sessionStatus = new Map<string, string>([
      [sessionIdA, 'running'],
      [sessionIdB, 'running'],
    ]);

    // 让 run 的状态更新回写到本地 map，供后续 get 活跃探测时使用
    run.mockImplementation(async (_db: unknown, sql: string, params: unknown[]) => {
      if (typeof sql === 'string' && sql.includes('UPDATE bulk_download_sessions') && Array.isArray(params)) {
        // updateBulkDownloadSession 的 UPDATE 最后一个参数是 id，status 作为前面某个参数传入。
        // 这里宽松匹配：如果 params 里出现了 status 值和 sessionId，就更新 map。
        const id = params[params.length - 1];
        if (typeof id === 'string' && sessionStatus.has(id)) {
          if (params.includes('queued')) sessionStatus.set(id, 'queued');
          else if (params.includes('paused')) sessionStatus.set(id, 'paused');
          else if (params.includes('completed')) sessionStatus.set(id, 'completed');
        }
      }
      return { changes: 1 };
    });

    const get = vi.fn().mockImplementation(async (_db: unknown, sql: string, params?: unknown[]) => {
      // ensureCanEnterRunning 的活跃探测（ignorePausedWhenProbing=true：排除 paused）
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT id FROM bulk_download_sessions') &&
        sql.includes("status IN ('pending', 'queued', 'dryRun', 'running')")
      ) {
        const excludeId = Array.isArray(params) ? params[1] : undefined;
        for (const [id, status] of sessionStatus.entries()) {
          if (id === excludeId) continue;
          if (['pending', 'queued', 'dryRun', 'running'].includes(status)) {
            return { id };
          }
        }
        return undefined;
      }
      // ensureCanEnterRunning 的活跃探测（默认：把 paused 也视作活跃）
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT id FROM bulk_download_sessions') &&
        sql.includes("status IN ('pending', 'queued', 'dryRun', 'running', 'paused')")
      ) {
        const excludeId = Array.isArray(params) ? params[1] : undefined;
        for (const [id, status] of sessionStatus.entries()) {
          if (id === excludeId) continue;
          if (['pending', 'queued', 'dryRun', 'running', 'paused'].includes(status)) {
            return { id };
          }
        }
        return undefined;
      }
      if (typeof sql === 'string' && sql.includes('SELECT status FROM bulk_download_sessions')) {
        return { status: 'running' };
      }
      return null;
    });

    const all = vi.fn().mockImplementation(async (_db: unknown, sql: string) => {
      if (typeof sql === 'string' && sql.includes('FROM bulk_download_sessions s')) {
        // resume 主查询：返回同 taskId 两条 running
        const makeRow = (id: string) => ({
          id,
          status: 'running',
          taskId,
          task_id: taskId,
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
        });
        return [makeRow(sessionIdA), makeRow(sessionIdB)];
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
      getMaxConcurrentBulkDownloadSessions: () => 3,
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
    return {
      resumeRunningSessions: mod.resumeRunningSessions,
      run,
      get,
      sessionIdA,
      sessionIdB,
    };
  }

  it('启动时 DB 里同 taskId 两条 running 坏数据，A 被恢复为 queued、B 被置 paused，resumed=1', async () => {
    // 核心不变量（收紧版）：
    // 1) resumed 恰好 = 1（不能被互相"paused"挡路而退化成 0）
    // 2) A（预分组第一条）必须被置成 queued 进入恢复队列
    // 3) B（预分组第二条）必须被预分组阶段直接置成 paused
    const { resumeRunningSessions, run, sessionIdA, sessionIdB } =
      await loadModuleWithDoubleRunning();

    const result = await resumeRunningSessions();

    expect(result).toEqual({ success: true, data: { resumed: 1 } });

    // A（先遍历到的）必须被置成 queued（进入恢复队列）
    const aSetQueued = run.mock.calls.some(args =>
      /SET status = \?/.test(args[1]) &&
      Array.isArray(args[2]) &&
      args[2].includes('queued') &&
      args[2].includes(sessionIdA)
    );
    expect(aSetQueued).toBe(true);

    // B（后遍历到的）必须被置成 paused
    const bSetPaused = run.mock.calls.some(args =>
      /SET status = \?/.test(args[1]) &&
      Array.isArray(args[2]) &&
      args[2].includes('paused') &&
      args[2].includes(sessionIdB)
    );
    expect(bSetPaused).toBe(true);
  });
});
