import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * bulkDownloadService.ensureCanEnterRunning - 进入 running 前的看门函数
 *
 * 场景：
 * - 每次 session 从非 running 翻入 running 之前调用。
 * - 冲突时阻断，必要时软删自己（history 场景）。
 * - 无冲突时顺手软删同 taskId 下其他 history。
 *
 * 反模式守卫：
 * - 必须在 withScheduler 锁内被调用（由调用方保证），函数本身不再嵌套锁。
 * - 不允许删自己（非 history 场景）。
 */

const getMock = vi.fn();
const runMock = vi.fn();
const allMock = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  Notification: vi.fn(),
}));

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
  runWithChanges: (...args: any[]) => runMock(...args),
  all: (...args: any[]) => allMock(...args),
}));

describe('bulkDownloadService.ensureCanEnterRunning', () => {
  beforeEach(() => {
    getMock.mockReset();
    runMock.mockReset();
    allMock.mockReset();
    vi.resetModules();
  });

  it('无冲突、无 history：放行，不软删自己', async () => {
    // 活跃查询返回 undefined（无冲突）
    getMock.mockResolvedValue(undefined);
    // history 清理 UPDATE 由 runMock 捕获

    const { ensureCanEnterRunning } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const result = await ensureCanEnterRunning(
      {} as any,
      'session-self',
      'task-1',
      { selfIsHistory: false }
    );

    expect(result).toEqual({ ok: true });
    // 仍会发一条 history 清理 UPDATE（即使 0 行），允许存在；
    // 关键：没有软删自己。用 SQL 形状匹配 selfIsHistory=true 分支才会发出的
    // `UPDATE ... SET deletedAt = ? WHERE id = ?` 形态，与 history 清理使用的
    // 多条件 WHERE（taskId/id/deletedAt/status）天然区分，不依赖 params 位置 trick。
    const selfDeleteCalls = runMock.mock.calls.filter(args =>
      /UPDATE bulk_download_sessions SET deletedAt = \? WHERE id = \?/.test(args[1]) &&
      args[2]?.[1] === 'session-self'
    );
    expect(selfDeleteCalls.length).toBe(0);
  });

  it('无冲突、有 2 条同 taskId history：全部软删，但不删自己', async () => {
    getMock.mockResolvedValue(undefined);

    const { ensureCanEnterRunning } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const result = await ensureCanEnterRunning(
      {} as any,
      'session-self',
      'task-1',
      { selfIsHistory: false }
    );

    expect(result).toEqual({ ok: true });
    // 必须发一条 history 清理 UPDATE
    const historyCleanup = runMock.mock.calls.find(args =>
      /UPDATE bulk_download_sessions\s+SET deletedAt/.test(args[1]) &&
      /status IN \('completed', 'failed', 'cancelled', 'allSkipped'\)/.test(args[1])
    );
    expect(historyCleanup).toBeDefined();
    expect(historyCleanup![2]).toEqual(
      expect.arrayContaining(['task-1', 'session-self'])
    );
  });

  it('有活跃 session、selfIsHistory=false：阻断，不动本 session', async () => {
    getMock.mockResolvedValue({ id: 'session-active' });

    const { ensureCanEnterRunning } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const result = await ensureCanEnterRunning(
      {} as any,
      'session-self',
      'task-1',
      { selfIsHistory: false }
    );

    expect(result).toEqual({
      ok: false,
      reason: 'hasActive',
      activeSessionId: 'session-active',
      selfSoftDeleted: false,
    });
    // 本 session 不应被软删
    const softDeleteSelf = runMock.mock.calls.find(args =>
      /UPDATE bulk_download_sessions\s+SET deletedAt/.test(args[1]) &&
      args[2]?.[1] === 'session-self'
    );
    expect(softDeleteSelf).toBeUndefined();
  });

  it('有活跃 session、selfIsHistory=true：软删本 session，不清 history', async () => {
    getMock.mockResolvedValue({ id: 'session-active' });

    const { ensureCanEnterRunning } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const result = await ensureCanEnterRunning(
      {} as any,
      'session-self',
      'task-1',
      { selfIsHistory: true }
    );

    expect(result).toEqual({
      ok: false,
      reason: 'hasActive',
      activeSessionId: 'session-active',
      selfSoftDeleted: true,
    });
    // 软删自己的 UPDATE 必须发出
    const softDeleteSelf = runMock.mock.calls.find(args =>
      /UPDATE bulk_download_sessions\s+SET deletedAt = \?\s+WHERE id = \?/.test(args[1]) &&
      args[2]?.[1] === 'session-self'
    );
    expect(softDeleteSelf).toBeDefined();
    // 不应发"清 history"那条 UPDATE
    const historyCleanup = runMock.mock.calls.find(args =>
      /status IN \('completed', 'failed', 'cancelled', 'allSkipped'\)/.test(args[1])
    );
    expect(historyCleanup).toBeUndefined();
  });

  it('活跃查询 SQL 口径正确（排除自己、排除已软删、覆盖 5 个活跃状态）', async () => {
    getMock.mockResolvedValue(undefined);

    const { ensureCanEnterRunning } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    await ensureCanEnterRunning(
      {} as any,
      'session-self',
      'task-1',
      { selfIsHistory: false }
    );

    const activeProbe = getMock.mock.calls.find(args =>
      /FROM bulk_download_sessions/.test(args[1])
    );
    expect(activeProbe).toBeDefined();
    const sql: string = activeProbe![1];
    expect(sql).toMatch(/taskId\s*=\s*\?/);
    expect(sql).toMatch(/id\s*!=\s*\?/);
    expect(sql).toMatch(/deletedAt IS NULL/);
    expect(sql).toMatch(/status IN \('pending', 'queued', 'dryRun', 'running', 'paused'\)/);
  });

  it('ignorePausedWhenProbing=true 时，活跃探测 SQL 排除 paused', async () => {
    getMock.mockResolvedValue(undefined);

    const { ensureCanEnterRunning } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    await ensureCanEnterRunning(
      {} as any,
      'session-self',
      'task-1',
      { selfIsHistory: false, ignorePausedWhenProbing: true }
    );

    const activeProbe = getMock.mock.calls.find(args =>
      /FROM bulk_download_sessions/.test(args[1])
    );
    expect(activeProbe).toBeDefined();
    const sql: string = activeProbe![1];
    expect(sql).toMatch(/status IN \('pending', 'queued', 'dryRun', 'running'\)/);
    expect(sql).not.toMatch(/paused/);
  });
});
