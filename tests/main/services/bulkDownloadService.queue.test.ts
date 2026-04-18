import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Bug7：批量下载并发闸门 + queued 等待队列 的单元测试
 *
 * 关键守卫（反模式回归）：
 * 1. "闸门" 测试：countActiveSessions 已达到上限时，startBulkDownloadSession
 *    应把会话直接置为 queued 状态返回，不能滑到 dryRun / running。
 * 2. "推进" 测试：promoteNextQueued 在有空槽时应取出下一个 queued 会话
 *    并把它置回 pending 以便 startBulkDownloadSession 接手。
 * 3. countActiveSessions 的 SQL 只统计 dryRun + running。
 */

const getMock = vi.fn();
const runMock = vi.fn();
const allMock = vi.fn();

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
  runWithChanges: (...args: any[]) => runMock(...args),
  all: (...args: any[]) => allMock(...args),
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getProxyConfig: vi.fn(() => undefined),
  getConfig: vi.fn(() => ({ booru: { download: {} } })),
  getMaxConcurrentBulkDownloadSessions: vi.fn(() => 3),
}));

vi.mock('../../../src/main/services/booruClientFactory.js', () => ({
  createBooruClient: vi.fn(() => ({ getPosts: vi.fn() })),
}));

vi.mock('../../../src/main/services/booruService.js', () => ({
  getBooruSiteById: vi.fn(async () => ({ id: 1, name: 'yande' })),
  getBooruPostBySiteAndId: vi.fn(async () => null),
}));

vi.mock('../../../src/main/services/filenameGenerator.js', () => ({
  generateFileName: vi.fn(() => 'image.jpg'),
}));

vi.mock('../../../src/main/services/downloadManager.js', () => ({
  downloadManager: {},
}));

vi.mock('../../../src/main/services/networkScheduler.js', () => ({
  networkScheduler: {
    onChange: vi.fn(() => () => {}),
    isBrowsingActive: vi.fn(() => false),
  },
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  Notification: class {
    static isSupported = () => false;
    on = vi.fn();
    show = vi.fn();
  },
}));

describe('bulkDownloadService.countActiveSessions', () => {
  beforeEach(() => {
    getMock.mockReset();
    runMock.mockReset();
    allMock.mockReset();
  });

  it('SQL 只统计 status IN (dryRun, running)', async () => {
    getMock.mockResolvedValueOnce({ n: 2 });
    const { countActiveSessions } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    await countActiveSessions();
    const sql = String(getMock.mock.calls[0][1]);
    expect(sql).toMatch(/deletedAt IS NULL/);
    expect(sql).toMatch(/status IN \('dryRun', 'running'\)/);
  });

  it('返回 COUNT 列的 n 字段', async () => {
    getMock.mockResolvedValueOnce({ n: 4 });
    const { countActiveSessions } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const n = await countActiveSessions();
    expect(n).toBe(4);
  });

  it('row 为 null 时回退 0', async () => {
    getMock.mockResolvedValueOnce(null);
    const { countActiveSessions } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const n = await countActiveSessions();
    expect(n).toBe(0);
  });
});

describe('bulkDownloadService.startBulkDownloadSession 并发闸门（反模式守卫）', () => {
  beforeEach(async () => {
    getMock.mockReset();
    runMock.mockReset();
    allMock.mockReset();
    // 每次清除模块缓存，确保 schedulerMutex / activeSessionStartPromises 重置
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('fs');
  });

  it('当 active 数 >= maxConcurrent 时，新会话应直接置为 queued，不滑到 dryRun', async () => {
    // 模拟：3 个 running 会话已经占满闸门（与 mocked max=3 相等）
    // getMock 顺序：
    //   1) SELECT s.*, t.* FROM bulk_download_sessions 返回 pending 状态的新会话
    //   2) countActiveSessions → { n: 3 }
    // 其余 get 调用（如 update 后的 notification context 查询等）返回空
    const sessionRow: any = {
      id: 'sess-new',
      taskId: 'task-1',
      siteId: 1,
      status: 'pending',
      path: 'C:\\tmp\\nonexistent-but-mocked',
      tags: 'tag1',
      blacklistedTags: null,
      notifications: 0,
      skipIfExists: 1,
      quality: null,
      perPage: 20,
      concurrency: 1,
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-18T00:00:00Z',
      startedAt: '2026-04-18T00:00:00Z',
      currentPage: 1,
      totalPages: null,
      completedAt: null,
      error: null,
      deletedAt: null,
    };

    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (sql.includes('FROM bulk_download_sessions s') && sql.includes('INNER JOIN bulk_download_tasks t')) {
        return sessionRow;
      }
      if (sql.includes("status IN ('dryRun', 'running')")) {
        return { n: 3 };
      }
      return null;
    });

    allMock.mockResolvedValue([]);
    runMock.mockResolvedValue(undefined);

    // 用 fs mock 让 fs.existsSync 返回 true（避免 "目录不存在" 提前 return）
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: vi.fn(() => true),
        },
        existsSync: vi.fn(() => true),
      };
    });

    const { startBulkDownloadSession } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );

    const result = await startBulkDownloadSession('sess-new');
    expect(result).toEqual({ success: true });

    // 关键断言：应有 UPDATE SET status='queued'，且不应有 UPDATE SET status='dryRun'
    const updateCalls = runMock.mock.calls.filter(c => String(c[1]).includes('UPDATE bulk_download_sessions'));
    const statuses: string[] = [];
    for (const call of updateCalls) {
      const sql = String(call[1]);
      if (sql.includes('status = ?')) {
        const params = call[2] as any[];
        statuses.push(String(params[0]));
      }
    }
    expect(statuses).toContain('queued');
    expect(statuses).not.toContain('dryRun');
    expect(statuses).not.toContain('running');
  });
});

describe('bulkDownloadService.promoteNextQueued 推进队列（反模式守卫）', () => {
  beforeEach(async () => {
    getMock.mockReset();
    runMock.mockReset();
    allMock.mockReset();
    vi.resetModules();
  });

  it('有空槽 + 有 queued 会话时，应把它的 status 改回 pending 以便后续启动', async () => {
    // 模拟：0 个 active（< max=3），有 1 个 queued 会话 sess-q
    // getMock 顺序：
    //   1) countActiveSessions → { n: 0 }
    //   2) getNextQueuedSessionId → { id: 'sess-q' }
    //   3) 后续 startBulkDownloadSession 调 SELECT s.*/t.* 可能也会 hit；我们让它返回 null
    //      让 startBulkDownloadSession 直接退出（返回 {success: false, error: '会话不存在'}）
    let getCallCount = 0;
    getMock.mockImplementation(async (_db: any, sql: string) => {
      getCallCount++;
      if (sql.includes("status IN ('dryRun', 'running')")) {
        return { n: 0 };
      }
      if (sql.includes("status = 'queued'")) {
        return { id: 'sess-q' };
      }
      // 让后续 startBulkDownloadSession 找不到会话而退出，避免无限递归
      return null;
    });

    allMock.mockResolvedValue([]);
    runMock.mockResolvedValue(undefined);

    const { promoteNextQueued } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );

    await promoteNextQueued();

    // 让内部不 await 的 startBulkDownloadSession 微任务跑完
    await new Promise(resolve => setTimeout(resolve, 10));

    // 关键断言：应有一次 UPDATE SET status='pending' WHERE id='sess-q'
    const pendingUpdates = runMock.mock.calls.filter(call => {
      const sql = String(call[1]);
      const params = call[2] as any[];
      return (
        sql.includes('UPDATE bulk_download_sessions') &&
        sql.includes('status = ?') &&
        Array.isArray(params) &&
        params[0] === 'pending' &&
        params[params.length - 1] === 'sess-q'
      );
    });
    expect(pendingUpdates.length).toBeGreaterThanOrEqual(1);
    expect(getCallCount).toBeGreaterThanOrEqual(2);
  });

  it('无空槽（active >= max）时，不应查询 queued 会话，也不改任何 status', async () => {
    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (sql.includes("status IN ('dryRun', 'running')")) {
        return { n: 3 };
      }
      if (sql.includes("status = 'queued'")) {
        throw new Error('不应查询 queued，因为已满槽');
      }
      return null;
    });

    runMock.mockResolvedValue(undefined);

    const { promoteNextQueued } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );

    await expect(promoteNextQueued()).resolves.toBeUndefined();

    // 不应有任何 UPDATE
    const updateCalls = runMock.mock.calls.filter(c =>
      String(c[1]).includes('UPDATE bulk_download_sessions')
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('有空槽但没有 queued 会话时，安静返回，不改任何 status', async () => {
    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (sql.includes("status IN ('dryRun', 'running')")) {
        return { n: 0 };
      }
      if (sql.includes("status = 'queued'")) {
        return null;
      }
      return null;
    });

    runMock.mockResolvedValue(undefined);

    const { promoteNextQueued } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );

    await expect(promoteNextQueued()).resolves.toBeUndefined();

    const updateCalls = runMock.mock.calls.filter(c =>
      String(c[1]).includes('UPDATE bulk_download_sessions')
    );
    expect(updateCalls).toHaveLength(0);
  });
});
