import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * bulkDownloadService.createBulkDownloadSession - 重复启动去重测试
 *
 * 场景：BooruBulkDownloadPage "已保存的任务" 列表的"开始"按钮被用户连续点击
 *      时，同一 taskId 会被重复创建会话，UI 出现多条 queued 记录。
 *
 * 期望：createBulkDownloadSession 在存在活跃会话（pending / queued / dryRun /
 *       running / paused）时短路返回已存在的会话，并带 deduplicated: true 标记。
 *       原本的新建 INSERT 不应执行。
 *
 * 反模式守卫：旧实现无 guard，直接 INSERT → 反模式，会创建重复会话。
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

const TASK_ROW = {
  id: 'task-1',
  siteId: 1,
  path: '/tmp/x',
  tags: 'akino_ell',
  blacklistedTags: null,
  notifications: 0,
  skipIfExists: 1,
  quality: 'original',
  perPage: 200,
  concurrency: 6,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

const EXISTING_SESSION_ROW = {
  id: 'session-existing',
  taskId: 'task-1',
  siteId: 1,
  status: 'queued',
  startedAt: '2024-01-02T00:00:00Z',
  completedAt: null,
  currentPage: 1,
  totalPages: null,
  error: null,
};

describe('bulkDownloadService.createBulkDownloadSession - 活跃会话去重', () => {
  beforeEach(() => {
    getMock.mockReset();
    runMock.mockReset();
    allMock.mockReset();
    vi.resetModules();
  });

  it('已存在活跃会话时，不再 INSERT 新会话，直接返回已存在会话并带 deduplicated:true', async () => {
    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (/FROM bulk_download_tasks/.test(sql)) return TASK_ROW;
      // 新增的活跃会话探测 SELECT（预期按活跃状态筛一条）
      if (/FROM bulk_download_sessions/.test(sql)) return EXISTING_SESSION_ROW;
      return undefined;
    });

    const { createBulkDownloadSession } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const result = await createBulkDownloadSession('task-1');

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe('session-existing');
    expect((result as any).deduplicated).toBe(true);
    // 核心：INSERT 不应被调用
    const insertCalls = runMock.mock.calls.filter((args) =>
      /INSERT INTO bulk_download_sessions/.test(String(args[1])),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('无活跃会话时，正常创建新会话（无 deduplicated 标记）', async () => {
    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (/FROM bulk_download_tasks/.test(sql)) return TASK_ROW;
      if (/FROM bulk_download_sessions/.test(sql)) return undefined;
      return undefined;
    });
    runMock.mockResolvedValue(undefined);

    const { createBulkDownloadSession } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const result = await createBulkDownloadSession('task-1');

    expect(result.success).toBe(true);
    expect(result.data?.id).toBeTruthy();
    expect((result as any).deduplicated).toBeUndefined();
    const insertCalls = runMock.mock.calls.filter((args) =>
      /INSERT INTO bulk_download_sessions/.test(String(args[1])),
    );
    expect(insertCalls).toHaveLength(1);
  });

  it('任务不存在时返回 success:false，不触发去重探测，不 INSERT', async () => {
    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (/FROM bulk_download_tasks/.test(sql)) return undefined;
      return undefined;
    });

    const { createBulkDownloadSession } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const result = await createBulkDownloadSession('task-missing');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    const insertCalls = runMock.mock.calls.filter((args) =>
      /INSERT INTO bulk_download_sessions/.test(String(args[1])),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('两次并发调用仅产生一次 INSERT（竞争守卫）', async () => {
    // 模拟 "查活跃 → INSERT" 的真实顺序：
    // - 活跃会话 SELECT 在第一次 INSERT 之前都看不到行；
    // - INSERT 之后再 SELECT 会看到这条新行，所以并发第二次必须
    //   在 INSERT 已生效之后才读，否则两次 SELECT 都撞到空，两次都 INSERT。
    // 反模式守卫：锁外 "check-then-insert" 下，两次 get() 都会返回 undefined，
    //   两次 INSERT 都会发生，这条断言会 FAIL。
    const insertedSessions: Array<{
      id: string;
      taskId: string;
      siteId: number;
      status: string;
      startedAt: string;
      completedAt: null;
      currentPage: number;
      totalPages: null;
      error: null;
    }> = [];

    getMock.mockImplementation(async (_db: any, sql: string, params?: any[]) => {
      if (/FROM bulk_download_tasks/.test(sql)) return TASK_ROW;
      if (/FROM bulk_download_sessions/.test(sql)) {
        const taskId = params?.[0];
        return insertedSessions.find((s) => s.taskId === taskId) ?? undefined;
      }
      return undefined;
    });
    runMock.mockImplementation(async (_db: any, sql: string, params?: any[]) => {
      if (/INSERT INTO bulk_download_sessions/.test(sql) && params) {
        insertedSessions.push({
          id: params[0],
          taskId: params[1],
          siteId: params[2],
          status: params[3],
          startedAt: params[4],
          completedAt: null,
          currentPage: params[5],
          totalPages: null,
          error: null,
        });
      }
      return undefined;
    });

    const { createBulkDownloadSession } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );

    const [r1, r2] = await Promise.all([
      createBulkDownloadSession('task-1'),
      createBulkDownloadSession('task-1'),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    const insertCalls = runMock.mock.calls.filter((args) =>
      /INSERT INTO bulk_download_sessions/.test(String(args[1])),
    );
    expect(insertCalls).toHaveLength(1);

    // 恰好一次被去重
    const dedupCount = [r1, r2].filter((r) => (r as any).deduplicated === true).length;
    expect(dedupCount).toBe(1);
    // 两次返回的 session.id 一致
    expect(r1.data?.id).toBe(r2.data?.id);
  });
});
