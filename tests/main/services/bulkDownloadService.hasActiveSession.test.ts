import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * bulkDownloadService.hasActiveSessionForTask 单元测试
 *
 * 覆盖 Bug5：startFavoriteTagBulkDownload 的 deduplicated 分支需要判定
 * "任务模板存在 && 仍有活跃会话" 才短路返回。该函数用于给出活跃判定。
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

describe('bulkDownloadService.hasActiveSessionForTask', () => {
  beforeEach(() => {
    getMock.mockReset();
    runMock.mockReset();
    allMock.mockReset();
  });

  it('当 COUNT>0 时返回 true', async () => {
    getMock.mockResolvedValueOnce({ n: 2 });
    const { hasActiveSessionForTask } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const result = await hasActiveSessionForTask('task-1');
    expect(result).toBe(true);
  });

  it('当 COUNT=0 时返回 false', async () => {
    getMock.mockResolvedValueOnce({ n: 0 });
    const { hasActiveSessionForTask } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const result = await hasActiveSessionForTask('task-1');
    expect(result).toBe(false);
  });

  it('SQL 只统计 pending/dryRun/running/paused 且 deletedAt IS NULL', async () => {
    getMock.mockResolvedValueOnce({ n: 0 });
    const { hasActiveSessionForTask } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    await hasActiveSessionForTask('task-x');
    const sql = String(getMock.mock.calls[0][1]);
    expect(sql).toMatch(/taskId = \?/);
    expect(sql).toMatch(/deletedAt IS NULL/);
    expect(sql).toMatch(/status IN \('pending', 'dryRun', 'running', 'paused'\)/);
    const params = getMock.mock.calls[0][2];
    expect(params).toEqual(['task-x']);
  });
});
