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
    // 关键守卫：闸门超限时必须返回 queued: true，否则前端 notifyIfQueued
    // 无法靠返回值识别排队状态（会退回 race-prone 的 getActiveSessions 查询路径）。
    expect(result).toEqual({ success: true, queued: true });

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

  it('queued 幂等分支：外部重复 start 对已在队列的会话返回 queued: true（noop 也标记）', async () => {
    // 模拟：会话当前 status 已经是 queued（例如被 promoteNextQueued 打回 queued
    // 之后，或闸门超限刚打完 queued 外部又点了一次）
    const sessionRow: any = {
      id: 'sess-queued',
      taskId: 'task-1',
      siteId: 1,
      status: 'queued',
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
      startedAt: null,
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
      return null;
    });

    allMock.mockResolvedValue([]);
    runMock.mockResolvedValue(undefined);

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

    const result = await startBulkDownloadSession('sess-queued');

    // 关键守卫：queued 幂等 noop 也要返回 queued: true，
    // 让 UI 能一致地弹 "已加入队列" 提示，不依赖再查 status。
    expect(result).toEqual({ success: true, queued: true });

    // noop 分支不应触发任何状态更新
    const updateCalls = runMock.mock.calls.filter(c =>
      String(c[1]).includes('UPDATE bulk_download_sessions')
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('正常 dryRun 路径（闸门未满）：返回成功但不含 queued 标记', async () => {
    // 模拟：active=0（< max=3），会话 pending，目录存在；
    // 但我们让 booruClient.getPosts throw，让 performDryRun 返回失败，
    // 避免后续下载循环的 IO 副作用，同时仍然能走通 "闸门放行后的第一段路径"。
    const sessionRow: any = {
      id: 'sess-normal',
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
      startedAt: null,
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
        return { n: 0 };
      }
      return null;
    });

    allMock.mockResolvedValue([]);
    runMock.mockResolvedValue(undefined);

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

    // 让 performDryRun 在 getPosts 阶段失败，返回 {success:false}
    vi.doMock('../../../src/main/services/booruClientFactory.js', () => ({
      createBooruClient: vi.fn(() => ({
        getPosts: vi.fn(async () => { throw new Error('mock get posts fail'); }),
      })),
    }));

    const { startBulkDownloadSession } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );

    const result = await startBulkDownloadSession('sess-normal');

    // 关键守卫：非 queued 路径不得混入 queued: true，否则 UI 会把失败
    // / 正常启动误标记成排队中。
    expect(result.queued).not.toBe(true);
    // 允许 success 为 true 或 false（取决于 Dry Run mock 行为），
    // 这个断言聚焦在 "queued 不被错误地置 true"
  });

  /**
   * bug7-I1 反模式守卫：并发闸门必须在锁内就把 dryRun 槽位预留好。
   *
   * 场景：两个 start 并发进入，max=1，初始 active=0。
   * 预期：只有一个进入 dryRun，另一个应被闸门打回 queued。
   * 实现思路：把 countActiveSessions 的返回做成 "按真实 dryRun 计数" 的函数，
   * 统计 "当前已有多少次 UPDATE status='dryRun' 被写入"。这样就能精确复现
   * "锁外 dryRun 置位" 的旧逻辑漏洞：锁只保护计数，不保护置位。
   *
   * 反模式证据：把 bulkDownloadService.ts 里锁内的 dryRun 置位挪到锁外
   * （恢复旧代码），本条将 FAIL（两个 sessions 都进入 dryRun）。
   */
  it('并发闸门：两个 start 并发争抢同一个空槽，应有且只有一个进入 dryRun', async () => {
    // dryRunAssignedIds：记录已经被写 status='dryRun' 的 sessionId 集合，
    // 作为 countActiveSessions 的实时口径。
    const dryRunAssignedIds = new Set<string>();
    const queuedAssignedIds = new Set<string>();

    const makeRow = (id: string) => ({
      id,
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
    });

    // max=1：闸门只允许 1 个 dryRun/running；其他应被打到 queued。
    vi.doMock('../../../src/main/services/config.js', () => ({
      getProxyConfig: vi.fn(() => undefined),
      getConfig: vi.fn(() => ({ booru: { download: {} } })),
      getMaxConcurrentBulkDownloadSessions: vi.fn(() => 1),
    }));

    getMock.mockImplementation(async (_db: any, sql: string, params?: any[]) => {
      if (sql.includes('FROM bulk_download_sessions s') && sql.includes('INNER JOIN bulk_download_tasks t')) {
        return makeRow(String(params?.[0]));
      }
      if (sql.includes("status IN ('dryRun', 'running')")) {
        // 真实口径：按已写入 dryRun 的 sessionId 集合计数
        return { n: dryRunAssignedIds.size };
      }
      return null;
    });

    allMock.mockResolvedValue([]);

    // run 里拦截 UPDATE status='dryRun' / 'queued'：把 sessionId 挪到对应集合，
    // 用于驱动上面的 active 计数以及最终断言。
    //
    // 关键：UPDATE status='dryRun' 额外插入一次 I/O 宏任务延迟（setTimeout 0），
    // 模拟真实 DB 写入不是同步微任务的场景。这会让旧实现（锁外写 dryRun）
    // 在释放锁、进入宏任务等待的期间把锁让给下一个 start 的 lock callback，
    // 从而暴露 "两个 start 都看到 active<max" 的竞态。
    const ioDelay = () => new Promise<void>(resolve => setTimeout(resolve, 0));
    runMock.mockImplementation(async (_db: any, sql: string, params?: any[]) => {
      if (String(sql).includes('UPDATE bulk_download_sessions') && Array.isArray(params)) {
        const statusValue = params[0];
        const idValue = params[params.length - 1];
        if (statusValue === 'dryRun') {
          // 用宏任务延迟模拟真实 DB 写，暴露 "dryRun 置位" 在锁外的 race
          await ioDelay();
          dryRunAssignedIds.add(String(idValue));
        } else if (statusValue === 'queued') {
          queuedAssignedIds.add(String(idValue));
        }
      }
      return undefined;
    });

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

    // 让 performDryRun 在 getPosts 阶段失败，阻止后续下载循环 IO 副作用，
    // 让测试只聚焦在 "闸门阶段" 的状态置位。
    vi.doMock('../../../src/main/services/booruClientFactory.js', () => ({
      createBooruClient: vi.fn(() => ({
        getPosts: vi.fn(async () => { throw new Error('mock get posts fail'); }),
      })),
    }));

    const { startBulkDownloadSession } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );

    // 并发发起两个 start；allSettled 保证即使某一个抛也不会中断另一个
    const results = await Promise.allSettled([
      startBulkDownloadSession('sess-a'),
      startBulkDownloadSession('sess-b'),
    ]);

    // 两个 Promise 都应 fulfilled（失败会被转成 {success:false,error}）
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);

    // 关键断言：只有一个会话进入 dryRun，另一个被打到 queued
    expect(dryRunAssignedIds.size).toBe(1);
    expect(queuedAssignedIds.size).toBe(1);

    // 两个 id 应分别落到不同的集合（不应同一个 id 既 dryRun 又 queued）
    const dryId = [...dryRunAssignedIds][0];
    const queuedId = [...queuedAssignedIds][0];
    expect(dryId).not.toBe(queuedId);
    expect(new Set([dryId, queuedId])).toEqual(new Set(['sess-a', 'sess-b']));

    // queued 分支的返回值也应带 queued: true
    const fulfilledValues = results
      .filter((r): r is PromiseFulfilledResult<{ success: boolean; queued?: boolean }> => r.status === 'fulfilled')
      .map(r => r.value);
    const queuedReturns = fulfilledValues.filter(v => v.queued === true);
    expect(queuedReturns).toHaveLength(1);
  });
});

describe('bulkDownloadService.getNextQueuedSessionId FIFO（rowid 排序）', () => {
  beforeEach(async () => {
    getMock.mockReset();
    runMock.mockReset();
    allMock.mockReset();
    vi.resetModules();
  });

  it('SQL 应按 COALESCE(startedAt, rowid) ASC 排序（UUID id 不可排，必须用 rowid 兜底 FIFO）', async () => {
    // 模拟：有空槽 + 有 queued 会话
    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (sql.includes("status IN ('dryRun', 'running')")) {
        return { n: 0 };
      }
      if (sql.includes("status = 'queued'")) {
        return { id: 'sess-q' };
      }
      return null;
    });

    runMock.mockResolvedValue(undefined);

    const { promoteNextQueued } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );

    await promoteNextQueued();
    await new Promise(resolve => setTimeout(resolve, 10));

    // 找到那条 SELECT id FROM bulk_download_sessions ... status = 'queued' 的 SQL
    const queuedSelectCalls = getMock.mock.calls.filter(c =>
      String(c[1]).includes("status = 'queued'") &&
      String(c[1]).includes('SELECT id FROM bulk_download_sessions')
    );
    expect(queuedSelectCalls.length).toBeGreaterThanOrEqual(1);

    const sql = String(queuedSelectCalls[0][1]);
    // 关键守卫：必须包含 rowid 兜底排序；不能只用 id（session.id 是 UUID v4，不可排序）
    expect(sql).toMatch(/ORDER BY COALESCE\(startedAt,\s*rowid\)\s+ASC/);
    // 反模式守卫：确保不再使用 "COALESCE(startedAt, id)" 这种 UUID 排序
    expect(sql).not.toMatch(/COALESCE\(startedAt,\s*id\)/);
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
