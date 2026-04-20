import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * bulkDownloadService.retry* - 冲突合并测试
 *
 * 场景：history 会话 S_hist 有失败项，用户点重试；同 taskId 已有另一条活跃 session S_active 在跑。
 * 期望：S_hist 被软删，服务返回 { success: true, merged: true, message: ... }；
 *       不执行 resetInFlightRecordsToPending / startDownloadingSession。
 *
 * 反模式守卫：旧实现无 guard，会直接 startDownloadingSession(S_hist, task)，导致同 task 双活跃。
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

const HIST_SESSION_ROW = {
  id: 'session-hist',
  taskId: 'task-1',
  siteId: 1,
  status: 'failed', // history 状态
  startedAt: '2024-01-01T00:00:00Z',
  completedAt: '2024-01-01T01:00:00Z',
  currentPage: 1,
  totalPages: 1,
  error: null,
  // inline task fields（retryAllFailedRecords 做了 JOIN）
  path: '/tmp/x',
  tags: 'a',
  blacklistedTags: null,
  notifications: 0,
  skipIfExists: 1,
  quality: 'original',
  perPage: 200,
  concurrency: 6,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

describe('bulkDownloadService.retry* - 冲突合并', () => {
  beforeEach(() => {
    getMock.mockReset();
    runMock.mockReset();
    allMock.mockReset();
    vi.resetModules();
  });

  it('同 taskId 已有活跃 session 时，软删 self 并返回 merged:true，不启动下载', async () => {
    // getBulkDownloadRecordsBySession 返回一条失败记录（简化：返回数组即可）
    allMock.mockResolvedValue([{ url: 'u1', fileName: 'a.jpg' }]);
    // 两次 get 调用：
    //   1) JOIN 查 session+task → HIST_SESSION_ROW
    //   2) ensureCanEnterRunning 的活跃探测 → 返回 active session
    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (/FROM bulk_download_sessions s\s+INNER JOIN bulk_download_tasks/.test(sql)) {
        return HIST_SESSION_ROW;
      }
      if (/FROM bulk_download_sessions\s+WHERE taskId = \? AND id != \?/.test(sql)) {
        return { id: 'session-active' };
      }
      return undefined;
    });

    const { retryAllFailedRecords } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const result = await retryAllFailedRecords('session-hist');

    expect(result.success).toBe(true);
    expect((result as any).merged).toBe(true);
    expect((result as any).message).toMatch(/已有进行中/);

    // 必须软删自己（UPDATE … deletedAt = ? WHERE id = ?）
    const softDeleteSelf = runMock.mock.calls.find(args =>
      /UPDATE bulk_download_sessions SET deletedAt = \? WHERE id = \?/.test(args[1]) &&
      args[2]?.[1] === 'session-hist'
    );
    expect(softDeleteSelf).toBeDefined();

    // 不应发 UPDATE bulk_download_sessions SET status = 'running'
    const transitionToRunning = runMock.mock.calls.find(args =>
      /status\s*=\s*\?/.test(args[1]) && args[2]?.includes('running')
    );
    expect(transitionToRunning).toBeUndefined();
  });

  it('retryFailedRecord：同 taskId 已有活跃 session 时，软删 self 并返回 merged:true', async () => {
    // 第一次 get：JOIN 查 session → history 状态
    // 第二次 get：ensureCanEnterRunning 活跃探测 → 返回活跃
    // 第三次 get：读失败记录行（若改写后被提前 early return，此 get 可能不触发）
    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (/FROM bulk_download_sessions s\s+INNER JOIN bulk_download_tasks/.test(sql)) {
        return HIST_SESSION_ROW;
      }
      if (/FROM bulk_download_sessions\s+WHERE taskId = \? AND id != \?/.test(sql)) {
        return { id: 'session-active' };
      }
      if (/FROM bulk_download_records/.test(sql)) {
        return {
          url: 'u1', sessionId: 'session-hist', status: 'pending', page: 1, pageIndex: 0,
          createdAt: '2024-01-01', fileName: 'a.jpg', extension: 'jpg',
          headers: null, thumbnailUrl: null, sourceUrl: null
        };
      }
      return undefined;
    });

    const { retryFailedRecord } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const result = await retryFailedRecord('session-hist', 'u1');

    expect(result.success).toBe(true);
    expect((result as any).merged).toBe(true);
    // 不应发出 UPDATE bulk_download_sessions SET status = 'running'
    const transitionToRunning = runMock.mock.calls.find(args =>
      /SET status = \?/.test(args[1]) && args[2]?.includes('running')
    );
    expect(transitionToRunning).toBeUndefined();
  });
});
