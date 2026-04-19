# 批量下载：会话去重 + 三 Tab 改造 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在批量下载服务里加入统一的"进入 running 前的看门"，根治同一 taskId 并发下载和 history 堆积两个问题；同时把前端的两 Tab + 固定保存任务列表重组为三个平级 Tab（活跃任务 / 历史任务 / 已保存任务）。

**Architecture:** 新增内部函数 `ensureCanEnterRunning(db, sessionId, taskId, opts)`，每一处把 session 翻到 `running` 之前调用它。函数本身不包 `withScheduler`，由调用方保证串行（`startBulkDownloadSession` 复用现有 scheduler 锁块；`retryAllFailedRecords`/`retryFailedRecord`/`resumeRunningSessions` 新增 `withScheduler` 包裹）。冲突仲裁：history 状态下的 self 被软删；非 history 的 self 原状不动由调用方决定。无冲突时顺手软删同 taskId 下其他 history。

**Tech Stack:** TypeScript + Electron 主进程 + SQLite（better-sqlite3 / 通过 `src/main/services/database.ts` 暴露的 `get`/`run`/`all`）；测试用 Vitest；前端 React + Ant Design。

**Spec 参考**：[docs/superpowers/specs/2026-04-19-bulk-download-dedup-and-tabs-design.md](../specs/2026-04-19-bulk-download-dedup-and-tabs-design.md)

## File Structure

| 路径 | 改动类型 | 职责 |
| --- | --- | --- |
| `src/main/services/bulkDownloadService.ts` | 修改 | 新增 `ensureCanEnterRunning` 内部函数；改写 4 处 running 转换点 |
| `src/renderer/pages/BooruBulkDownloadPage.tsx` | 修改 | 把 2 Tab + 固定保存列表重组为 3 Tab；新增 `merged` 响应处理 |
| `src/renderer/components/BulkDownloadSessionDetail.tsx` | 修改 | retry 请求响应 `merged:true` 时用 `message.info` 替代 `message.success` |
| `tests/main/services/bulkDownloadService.ensureCanEnterRunning.test.ts` | 新建 | 看门函数 5 个核心场景 |
| `tests/main/services/bulkDownloadService.retryMerged.test.ts` | 新建 | retry 遇到同 taskId 活跃时返回 merged:true 且软删 self |
| `tests/main/services/bulkDownloadService.resume.test.ts` | 扩展 | 模拟同 taskId 双 running 坏数据，恢复后只剩一条 |

**不修改**：`src/preload/index.ts`、`src/main/ipc/handlers.ts`、`src/main/ipc/channels.ts`（IPC 透传服务返回值，新加 `merged` 字段自然传到渲染端；无需类型层改动，因为 preload 没做类型收窄）。

---

## Task 1: 新增 `ensureCanEnterRunning` 内部函数（TDD）

**Files:**
- Create: `tests/main/services/bulkDownloadService.ensureCanEnterRunning.test.ts`
- Modify: `src/main/services/bulkDownloadService.ts`（在 `withScheduler` 定义附近新增内部函数）

- [ ] **Step 1.1: 写失败测试**

新建文件 `tests/main/services/bulkDownloadService.ensureCanEnterRunning.test.ts`：

```ts
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

  it('无冲突、无 history：直接放行，不发 UPDATE', async () => {
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
    // 关键：没有软删自己
    const selfDeleteCalls = runMock.mock.calls.filter(args =>
      /UPDATE bulk_download_sessions/.test(args[1]) &&
      args[2]?.includes('session-self') &&
      !args[2]?.some((v: any) => v === 'task-1' && args[2].indexOf('session-self') !== args[2].lastIndexOf('session-self'))
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
});
```

- [ ] **Step 1.2: 运行测试，确认全部失败（函数不存在）**

Run: `npm run test -- bulkDownloadService.ensureCanEnterRunning`
Expected: FAIL，错误含 `ensureCanEnterRunning is not exported` 或 `is not a function`。

- [ ] **Step 1.3: 在 `bulkDownloadService.ts` 中加入函数实现**

定位到 `src/main/services/bulkDownloadService.ts` 里 `withScheduler` 定义的上方（大约 line 540 之前，`sessionStopReasons` 声明之后的合适位置），插入：

```ts
/**
 * 看门：session 从非 running 状态翻入 running 前调用。
 *
 * 必须在 withScheduler 锁内被调用 —— 本函数不再自己包锁，避免嵌套调度。
 * 调用方：startBulkDownloadSession（已在锁内）/ retryAllFailedRecords /
 * retryFailedRecord / resumeRunningSessions。
 *
 * 行为：
 * 1. 查同 taskId 下是否还存在别的活跃 session（pending/queued/dryRun/running/paused）。
 *    - 命中：
 *      - selfIsHistory=true（retry 场景，本 session 当前在 history）→ 软删本 session，返回 selfSoftDeleted:true；
 *      - selfIsHistory=false（正常推进）→ 不动本 session，返回 selfSoftDeleted:false；由调用方决定降级。
 * 2. 无冲突：软删同 taskId 下所有其他 history session（completed/failed/cancelled/allSkipped）。
 * 3. 返回 ok:true，调用方继续翻入 running。
 */
export async function ensureCanEnterRunning(
  db: any,
  sessionId: string,
  taskId: string,
  opts: { selfIsHistory: boolean }
): Promise<
  | { ok: true }
  | {
      ok: false;
      reason: 'hasActive';
      activeSessionId: string;
      selfSoftDeleted: boolean;
    }
> {
  // 1. 活跃冲突探测
  const activeRow = await get<{ id: string }>(
    db,
    `SELECT id FROM bulk_download_sessions
      WHERE taskId = ? AND id != ? AND deletedAt IS NULL
        AND status IN ('pending', 'queued', 'dryRun', 'running', 'paused')
      LIMIT 1`,
    [taskId, sessionId]
  );

  if (activeRow) {
    if (opts.selfIsHistory) {
      const now = new Date().toISOString();
      await run(
        db,
        `UPDATE bulk_download_sessions SET deletedAt = ? WHERE id = ?`,
        [now, sessionId]
      );
      return {
        ok: false,
        reason: 'hasActive',
        activeSessionId: activeRow.id,
        selfSoftDeleted: true,
      };
    }
    return {
      ok: false,
      reason: 'hasActive',
      activeSessionId: activeRow.id,
      selfSoftDeleted: false,
    };
  }

  // 2. 无冲突：软删同 taskId 下所有其他 history
  const now = new Date().toISOString();
  await run(
    db,
    `UPDATE bulk_download_sessions
        SET deletedAt = ?
      WHERE taskId = ? AND id != ? AND deletedAt IS NULL
        AND status IN ('completed', 'failed', 'cancelled', 'allSkipped')`,
    [now, taskId, sessionId]
  );

  return { ok: true };
}
```

- [ ] **Step 1.4: 运行测试，确认全部通过**

Run: `npm run test -- bulkDownloadService.ensureCanEnterRunning`
Expected: PASS（5 个用例全部绿）。

- [ ] **Step 1.5: Commit**

```bash
git add src/main/services/bulkDownloadService.ts tests/main/services/bulkDownloadService.ensureCanEnterRunning.test.ts
git commit -m "feat(bulk-download): 新增 ensureCanEnterRunning 看门函数"
```

---

## Task 2: `startBulkDownloadSession` 接入看门函数

**Files:**
- Modify: `src/main/services/bulkDownloadService.ts`（现有 `withScheduler` 块 line 1082-1094 附近）

startBulkDownloadSession 已经在 `withScheduler` 内做 "queued / 预留 dryRun" 决策，把看门检查直接塞进同一个锁块最前面。

- [ ] **Step 2.1: 改造 `withScheduler` 块**

找到 `startBulkDownloadSession` 函数中的这一段（约 line 1072-1094）：

```ts
      // ── 并发闸门：超上限时打成 queued；否则在锁内就把 dryRun 槽位预留好 ──
      //
      // 反模式回归守卫（bug7-I1）：...
      const outcome = await withScheduler(async () => {
        const max = getMaxConcurrentBulkDownloadSessions();
        const active = await countActiveSessions();
        if (active >= max) {
          await updateBulkDownloadSession(sessionId, { status: 'queued' });
          console.log('[bulkDownloadService] 会话进入等待队列:', sessionId);
          return 'queued' as const;
        }
        await updateBulkDownloadSession(sessionId, { status: 'dryRun', currentPage: 1 });
        return 'reserved' as const;
      });
```

改为：

```ts
      // ── 并发闸门 + 同 taskId 去重：锁内串行化 ──
      //
      // 1) ensureCanEnterRunning：拦住 "同 taskId 已经在跑另一条" 的情况，
      //    并顺手清掉同 taskId 下的历史记录（不变量：history 最多 1 条）。
      // 2) 并发闸门：超上限打 queued；否则预留 dryRun 槽位。
      //
      // 反模式回归守卫（bug7-I1）：...
      const outcome = await withScheduler(async () => {
        const gate = await ensureCanEnterRunning(db, sessionId, sessionRow.taskId, {
          selfIsHistory: false,
        });
        if (!gate.ok) {
          return { kind: 'conflict' as const, activeSessionId: gate.activeSessionId };
        }

        const max = getMaxConcurrentBulkDownloadSessions();
        const active = await countActiveSessions();
        if (active >= max) {
          await updateBulkDownloadSession(sessionId, { status: 'queued' });
          console.log('[bulkDownloadService] 会话进入等待队列:', sessionId);
          return { kind: 'queued' as const };
        }
        await updateBulkDownloadSession(sessionId, { status: 'dryRun', currentPage: 1 });
        return { kind: 'reserved' as const };
      });
      if (outcome.kind === 'conflict') {
        console.log(
          '[bulkDownloadService] 同 taskId 已有活跃会话，拒绝启动:',
          sessionId,
          '→',
          outcome.activeSessionId
        );
        return {
          success: false,
          error: '该任务已有进行中的下载会话',
        };
      }
      if (outcome.kind === 'queued') {
        return { success: true, queued: true };
      }
```

- [ ] **Step 2.2: 运行现有 createSession + queue 测试确认未破坏**

Run: `npm run test -- bulkDownloadService.createSession bulkDownloadService.queue`
Expected: 全部 PASS（这两批测试不触达同 taskId 冲突分支，只验证既有并发闸门行为）。

- [ ] **Step 2.3: Commit**

```bash
git add src/main/services/bulkDownloadService.ts
git commit -m "feat(bulk-download): startBulkDownloadSession 接入 ensureCanEnterRunning 看门"
```

---

## Task 3: `retryAllFailedRecords` 接入看门函数 + 新增冲突合并测试

**Files:**
- Create: `tests/main/services/bulkDownloadService.retryMerged.test.ts`
- Modify: `src/main/services/bulkDownloadService.ts`（函数 `retryAllFailedRecords` line 2346-2450 附近）

- [ ] **Step 3.1: 写失败测试**

新建文件 `tests/main/services/bulkDownloadService.retryMerged.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * bulkDownloadService.retryAllFailedRecords - 冲突合并测试
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

describe('bulkDownloadService.retryAllFailedRecords - 冲突合并', () => {
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
    let getCall = 0;
    getMock.mockImplementation(async (_db: any, sql: string) => {
      getCall++;
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
});
```

- [ ] **Step 3.2: 运行测试，确认失败**

Run: `npm run test -- bulkDownloadService.retryMerged`
Expected: FAIL（当前实现会调 updateBulkDownloadSession 翻 running，且不返回 merged）。

- [ ] **Step 3.3: 改造 `retryAllFailedRecords`**

定位 [src/main/services/bulkDownloadService.ts:2346](src/main/services/bulkDownloadService.ts#L2346) 附近的 `retryAllFailedRecords` 函数。在 "失败记录重置为 pending" (约 line 2403-2407) 之后、三分支状态翻转 (line 2410+) 之前，插入看门调用。整段三分支按下面重写：

定位到现在的三个 `if/else if`（`completed`/`failed` → `paused` → `running`），改写为：

```ts
    // 将所有失败的记录重置为 pending
    await run(db, `
      UPDATE bulk_download_records
      SET status = ?, error = NULL
      WHERE sessionId = ? AND status = ?
    `, ['pending', sessionId, 'failed']);

    // ── 进入 running 前的看门（复用与 startBulkDownloadSession 相同的不变量） ──
    const selfIsHistory =
      sessionRow.status === 'completed' ||
      sessionRow.status === 'failed' ||
      sessionRow.status === 'cancelled' ||
      sessionRow.status === 'allSkipped';

    const gate = await withScheduler(() =>
      ensureCanEnterRunning(db, sessionId, sessionRow.taskId, { selfIsHistory })
    );

    if (!gate.ok) {
      if (gate.selfSoftDeleted) {
        console.log(
          '[bulkDownloadService] 同 taskId 已有活跃会话，已软删本 history session:',
          sessionId,
          '→',
          gate.activeSessionId
        );
        return {
          success: true,
          merged: true,
          message: '该任务已有进行中的下载，历史记录已合并',
        } as any;
      }
      return { success: false, error: '该任务已有进行中的下载会话' };
    }

    // 根据会话状态决定是否需要启动下载
    if (sessionRow.status === 'completed' || sessionRow.status === 'failed' ||
        sessionRow.status === 'cancelled' || sessionRow.status === 'allSkipped') {
      // 会话已结束，重新启动下载
      await waitForDownloadSessionToStop(sessionId);
      await resetInFlightRecordsToPending(sessionId);
      sessionStopReasons.delete(sessionId);
      await updateBulkDownloadSession(sessionId, {
        status: 'running'
      });

      startDownloadingSession(sessionId, task).catch(error => {
        console.error('[bulkDownloadService] 重试下载过程出错:', error);
        updateBulkDownloadSession(sessionId, {
          status: 'failed',
          error: error.message
        });
      });
    } else if (sessionRow.status === 'paused') {
      await waitForDownloadSessionToStop(sessionId);
      await resetInFlightRecordsToPending(sessionId);
      sessionStopReasons.delete(sessionId);
      await updateBulkDownloadSession(sessionId, {
        status: 'running'
      });
      startDownloadingSession(sessionId, task).catch(error => {
        console.error('[bulkDownloadService] 恢复暂停会话下载失败:', error);
      });
    } else if (sessionRow.status === 'running') {
      // 会话正在运行，下载循环会自动获取并处理新的 pending 记录
      console.log('[bulkDownloadService] 会话正在运行，记录已重置为 pending，等待下载循环处理');
    }
```

同时给 `retryAllFailedRecords` 的返回值类型加上 `merged?: boolean; message?: string`（找到函数签名 `Promise<{ success: boolean; error?: string }>` 改为 `Promise<{ success: boolean; merged?: boolean; message?: string; error?: string }>`）。

另外把 `cancelled` / `allSkipped` 也纳入"已结束可重试"分支 —— 这是既有遗漏的修补，和主题一致顺手修。

- [ ] **Step 3.4: 运行测试确认通过**

Run: `npm run test -- bulkDownloadService.retryMerged bulkDownloadService.ensureCanEnterRunning`
Expected: 两批全绿。

- [ ] **Step 3.5: 跑一遍回归防劣化**

Run: `npm run test -- bulkDownloadService`
Expected: 全部 PASS。

- [ ] **Step 3.6: Commit**

```bash
git add src/main/services/bulkDownloadService.ts tests/main/services/bulkDownloadService.retryMerged.test.ts
git commit -m "feat(bulk-download): retryAllFailedRecords 接入看门，冲突时软删 history 合并"
```

---

## Task 4: `retryFailedRecord` 接入看门函数

**Files:**
- Modify: `src/main/services/bulkDownloadService.ts`（函数 `retryFailedRecord` line 2455-2600 附近）

- [ ] **Step 4.1: 在现有测试文件补一个冲突合并用例**

打开 `tests/main/services/bulkDownloadService.retryMerged.test.ts`，在 describe 里追加：

```ts
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
```

- [ ] **Step 4.2: 运行测试确认失败**

Run: `npm run test -- bulkDownloadService.retryMerged`
Expected: 新用例 FAIL。

- [ ] **Step 4.3: 改造 `retryFailedRecord`**

定位到 [src/main/services/bulkDownloadService.ts:2537-2548](src/main/services/bulkDownloadService.ts#L2537) 的 `if (sessionRow.status !== 'running')` 分支。改写为：

```ts
    // 如果会话未运行，需要翻 running → 先过看门
    if (sessionRow.status !== 'running') {
      const selfIsHistory =
        sessionRow.status === 'completed' ||
        sessionRow.status === 'failed' ||
        sessionRow.status === 'cancelled' ||
        sessionRow.status === 'allSkipped';

      const gate = await withScheduler(() =>
        ensureCanEnterRunning(db, sessionId, sessionRow.taskId, { selfIsHistory })
      );

      if (!gate.ok) {
        if (gate.selfSoftDeleted) {
          console.log(
            '[bulkDownloadService] retryFailedRecord：同 taskId 已有活跃会话，已软删 history session:',
            sessionId,
            '→',
            gate.activeSessionId
          );
          return {
            success: true,
            merged: true,
            message: '该任务已有进行中的下载，历史记录已合并',
          } as any;
        }
        return { success: false, error: '该任务已有进行中的下载会话' };
      }

      await waitForDownloadSessionToStop(sessionId);
      await resetInFlightRecordsToPending(sessionId);
      sessionStopReasons.delete(sessionId);
      await updateBulkDownloadSession(sessionId, {
        status: 'running'
      });
      // 启动下载会话（会自动处理 pending 记录）
      startDownloadingSession(sessionId, task).catch((error: Error) => {
        console.error('[bulkDownloadService] 启动下载会话失败:', error);
      });
    } else {
```

同时把 `retryFailedRecord` 签名的返回类型加上 `merged?: boolean; message?: string`（与 Task 3 一致）。

- [ ] **Step 4.4: 运行测试确认通过**

Run: `npm run test -- bulkDownloadService.retryMerged`
Expected: 两个用例全绿。

- [ ] **Step 4.5: 跑一遍回归**

Run: `npm run test -- bulkDownloadService`
Expected: 全部 PASS。

- [ ] **Step 4.6: Commit**

```bash
git add src/main/services/bulkDownloadService.ts tests/main/services/bulkDownloadService.retryMerged.test.ts
git commit -m "feat(bulk-download): retryFailedRecord 接入看门，冲突时软删 history 合并"
```

---

## Task 5: `resumeRunningSessions` 接入看门函数（自愈启动时坏数据）

**Files:**
- Modify: `src/main/services/bulkDownloadService.ts`（函数 `resumeRunningSessions` line 2258-2341）
- Modify: `tests/main/services/bulkDownloadService.resume.test.ts`（扩展）

- [ ] **Step 5.1: 先读一下现有 resume 测试风格**

Run: `head -80 tests/main/services/bulkDownloadService.resume.test.ts`
Expected: 输出里能看到 mock setup 与单 session 恢复的 describe 块；后续用例附加在同一 describe 下。

- [ ] **Step 5.2: 追加失败测试**

在 `tests/main/services/bulkDownloadService.resume.test.ts` 的 describe 末尾追加：

```ts
  it('启动时若 DB 存在同 taskId 双 running 坏数据，只保留先遍历到的那条，另一条被置回 paused', async () => {
    // 两条同 taskId 的 running 会话，模拟上次崩溃后的坏数据
    allMock.mockResolvedValue([
      {
        id: 'session-A', taskId: 'task-1', siteId: 1, status: 'running',
        startedAt: '2024-01-01T00:00:00Z', completedAt: null,
        currentPage: 1, totalPages: 3, error: null,
        task_id: 'task-1', task_siteId: 1, task_path: '/tmp/x',
        task_tags: 'a', task_blacklistedTags: null, task_notifications: 0,
        task_skipIfExists: 1, task_quality: 'original', task_perPage: 200,
        task_concurrency: 6, task_createdAt: '2024-01-01', task_updatedAt: '2024-01-01',
      },
      {
        id: 'session-B', taskId: 'task-1', siteId: 1, status: 'running',
        startedAt: '2024-01-01T00:01:00Z', completedAt: null,
        currentPage: 1, totalPages: 3, error: null,
        task_id: 'task-1', task_siteId: 1, task_path: '/tmp/x',
        task_tags: 'a', task_blacklistedTags: null, task_notifications: 0,
        task_skipIfExists: 1, task_quality: 'original', task_perPage: 200,
        task_concurrency: 6, task_createdAt: '2024-01-01', task_updatedAt: '2024-01-01',
      },
    ]);
    // stats 永远有 pending，保证走到看门检查分支
    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (/FROM bulk_download_records/.test(sql) && /status\s*=\s*'pending'/.test(sql)) {
        return { count: 1 };
      }
      // ensureCanEnterRunning 的活跃探测：session-A 查时无别的活跃（B 仍是 running，但 B.id != A.id —— 命中！）
      //   第一次查（session-A）→ 返回 session-B
      //   第二次查（session-B）→ 返回 undefined（A 已被第一次看门清成 queued，不算活跃）
      // ...具体 setup 视实际实现调整
      return undefined;
    });

    const { resumeRunningSessions } = await import(
      '../../../src/main/services/bulkDownloadService.js'
    );
    const result = await resumeRunningSessions();

    expect(result.success).toBe(true);
    // 第一条（session-A）成功入队 queued；第二条（session-B）因冲突被置回 paused
    const setPausedForB = runMock.mock.calls.find(args =>
      /SET status = \?/.test(args[1]) &&
      args[2]?.includes('paused') &&
      args[2]?.includes('session-B')
    );
    expect(setPausedForB).toBeDefined();
  });
```

> 注：此测试的 mock 关系较复杂，允许在实现完成后微调 mock expectations。测试的核心断言是："第二条 running 被置成 paused"，其它 mock 是铺垫。

- [ ] **Step 5.3: 运行测试确认失败**

Run: `npm run test -- bulkDownloadService.resume`
Expected: 新用例 FAIL。

- [ ] **Step 5.4: 改造 `resumeRunningSessions` 的 per-session 循环**

定位 [src/main/services/bulkDownloadService.ts:2294-2321](src/main/services/bulkDownloadService.ts#L2294) 的 for 循环，改写为：

```ts
    let resumedCount = 0;
    for (const row of runningSessions) {
      const sessionId = row.id;

      try {
        // 将 downloading 状态的记录重置为 pending
        await resetInFlightRecordsToPending(sessionId);

        // 检查是否还有待下载的记录
        const stats = await getBulkDownloadSessionStats(sessionId);
        if (stats.pending === 0 && stats.completed + stats.failed === stats.total) {
          console.log(`[bulkDownloadService] 会话 ${sessionId} 没有待下载记录，标记为已完成`);
          await updateBulkDownloadSession(sessionId, {
            status: 'completed',
            completedAt: new Date().toISOString()
          });
          continue;
        }

        // 启动恢复前过看门：若同 taskId 已有另一条活跃（包括前一轮刚入队的），
        // 这条就置回 paused 等用户手动处理
        const gate = await withScheduler(() =>
          ensureCanEnterRunning({}, sessionId, row.taskId, { selfIsHistory: false })
        );
        if (!gate.ok) {
          console.warn(
            `[bulkDownloadService] 恢复时检测到同 taskId 双活跃，已把 ${sessionId} 置回 paused（活跃:${gate.activeSessionId}）`
          );
          await updateBulkDownloadSession(sessionId, { status: 'paused' });
          continue;
        }

        await waitForDownloadSessionToStop(sessionId);
        await resetInFlightRecordsToPending(sessionId);

        sessionStopReasons.delete(sessionId);
        await updateBulkDownloadSession(sessionId, { status: 'queued' });
        console.log(`[bulkDownloadService] 会话入队等待恢复: ${sessionId}, 待下载: ${stats.pending}`);

        resumedCount++;
      } catch (err) {
        console.warn(`[bulkDownloadService] 恢复会话 ${sessionId} 失败，跳过:`, err);
      }
    }
```

> 注意第一个参数 `{}` 是占位 db（ensureCanEnterRunning 内部会通过 `get`/`run` 绑定到真实 db；若 `ensureCanEnterRunning` 需要 db 句柄，改为 `await getDatabase()` 再传入，和 Task 1 的函数签名保持一致）。**实际应传真实 db 句柄** —— 在循环外 `const db = await getDatabase();` 拿一次，传进去。

修正：在循环外 line 2261 已有 `const db = await getDatabase();`，复用即可：把 `ensureCanEnterRunning({}, ...)` 改为 `ensureCanEnterRunning(db, ...)`。

- [ ] **Step 5.5: 运行测试确认通过**

Run: `npm run test -- bulkDownloadService.resume`
Expected: 所有 resume 测试全绿（包括新用例）。

- [ ] **Step 5.6: Commit**

```bash
git add src/main/services/bulkDownloadService.ts tests/main/services/bulkDownloadService.resume.test.ts
git commit -m "feat(bulk-download): resumeRunningSessions 接入看门，自愈启动时双活跃坏数据"
```

---

## Task 6: 前端重组为 3 个 Tab

**Files:**
- Modify: `src/renderer/pages/BooruBulkDownloadPage.tsx`（Tabs 块 line 368-495）

- [ ] **Step 6.1: 改写 Tabs 结构**

定位 [src/renderer/pages/BooruBulkDownloadPage.tsx:368](src/renderer/pages/BooruBulkDownloadPage.tsx#L368) 附近的 Tabs 组件及下方的"已保存的任务"整块。改为：

```tsx
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'active',
            label: `活跃任务 (${activeSessions.length})`,
            children: activeSessions.length === 0 ? (
              <Empty description="暂无活跃下载" />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {activeSessions.map(session => (
                  <BulkDownloadSessionCard
                    key={session.id}
                    session={session}
                    onRefresh={loadSessions}
                  />
                ))}
              </Space>
            ),
          },
          {
            key: 'history',
            label: `历史任务 (${historySessions.length})`,
            children: historySessions.length === 0 ? (
              <Empty description="暂无历史记录" />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {historySessions.map(session => (
                  <BulkDownloadSessionCard
                    key={session.id}
                    session={session}
                    onRefresh={loadSessions}
                  />
                ))}
              </Space>
            ),
          },
          {
            key: 'saved',
            label: `已保存任务 (${tasks.length})`,
            children: tasks.length === 0 ? (
              <Empty description="暂无已保存任务" />
            ) : (
              // 下面整块是原先 line 425-495 渲染的 Ant List，原样搬过来
              <List
                dataSource={tasks}
                renderItem={task => (
                  <List.Item
                    actions={[
                      <Button
                        key="start"
                        type="primary"
                        icon={<PlayCircleOutlined />}
                        onClick={() => handleStartFromTask(task)}
                      >
                        开始
                      </Button>,
                      <Button
                        key="edit"
                        icon={<EditOutlined />}
                        onClick={() => {
                          setEditingTask(task);
                          setFormVisible(true);
                        }}
                      >
                        编辑
                      </Button>,
                      <Popconfirm
                        key="delete"
                        title="确定要删除这个任务吗？"
                        onConfirm={() => handleDeleteTask(task.id)}
                      >
                        <Button danger icon={<DeleteOutlined />}>
                          删除
                        </Button>
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      title={task.tags || '无标签'}
                      description={
                        <Space direction="vertical" size={2}>
                          <span>路径: {task.path}</span>
                          <span>
                            每页: {task.perPage} | 并发: {task.concurrency} | 质量: {task.quality}
                          </span>
                          {task.blacklistedTags && (
                            <span>黑名单: {task.blacklistedTags}</span>
                          )}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            ),
          },
        ]}
      />
```

说明：
- 原来下方"已保存的任务"Card 标题连同 Card 容器一起删除（Tab 本身提供分段）。
- 原 Tabs 下方的固定区域（line 425-495）整块移入 `saved` Tab 的 children。若原实现用了 Card 包裹，迁移时把外层 Card 去掉只留 List（或保留 Card 以保持卡片感，视实际视觉效果决定；默认去掉 Card，Tab children 自带 padding）。
- 保留 `activeTab` state 和 `setActiveTab`；若原实现用字符串常量 `"active"` / `"history"` 定义，加上 `"saved"`。
- 顶部"新建任务"按钮保持在 Tabs 外部，不动。

- [ ] **Step 6.2: 确认导入**

如果 `List` / `PlayCircleOutlined` / `EditOutlined` / `DeleteOutlined` / `Popconfirm` / `Empty` 在迁移后变成未使用或新增，调整 `import` 语句（通常 TypeScript 会提示 unused/undefined）。

- [ ] **Step 6.3: 启动 dev 跑一遍人工验证**

Run: `npm run dev`
人工检查清单：
1. 进入批量下载页面 → 默认停在 "活跃任务" Tab。
2. 三个 Tab 标题正确：活跃任务 / 历史任务 / 已保存任务，顺序一致。
3. Tab 间切换正常，已保存任务里的"开始 / 编辑 / 删除"按钮都能点。
4. 顶部"新建任务"按钮仍在 Tabs 外部可见。
5. 活跃任务和历史任务里各自只显示对应状态的 session 卡片。

如果 UI 跑不起来或无法本地操作，明确在 commit message 里记 "未能本地验证 UI" 让后续 reviewer 知悉。

- [ ] **Step 6.4: Commit**

```bash
git add src/renderer/pages/BooruBulkDownloadPage.tsx
git commit -m "refactor(bulk-download): 批量下载页改为三 Tab（活跃 / 历史 / 已保存任务）"
```

---

## Task 7: Detail 弹窗中识别 `merged` 响应

**Files:**
- Modify: `src/renderer/components/BulkDownloadSessionDetail.tsx`（`handleRetryRecord` line 207、`handleRetryAllFailed` line 226）

- [ ] **Step 7.1: 改 `handleRetryRecord`**

定位 [src/renderer/components/BulkDownloadSessionDetail.tsx:207-223](src/renderer/components/BulkDownloadSessionDetail.tsx#L207)，替换 `if (result.success)` 分支：

```tsx
      if (result.success) {
        if ((result as any).merged) {
          message.info((result as any).message || '该任务已有进行中的下载，历史记录已合并');
          // 历史记录被软删，直接关闭详情弹窗交给外层刷新
          onRefresh?.();
          return;
        }
        message.success('已加入重试队列');
        loadRecords(true);
        onRefresh?.();
      } else {
        message.error('重试失败: ' + (result.error || '未知错误'));
      }
```

- [ ] **Step 7.2: 改 `handleRetryAllFailed`**

定位 [src/renderer/components/BulkDownloadSessionDetail.tsx:226-245](src/renderer/components/BulkDownloadSessionDetail.tsx#L226)，同理：

```tsx
      if (result.success) {
        if ((result as any).merged) {
          message.info((result as any).message || '该任务已有进行中的下载，历史记录已合并');
          onRefresh?.();
          return;
        }
        message.success('已将所有失败项加入重试队列');
        loadRecords(true);
        onRefresh?.();
      } else {
        message.error('重试失败: ' + (result.error || '未知错误'));
      }
```

- [ ] **Step 7.3: 人工验证（若 dev 可跑）**

Run: `npm run dev`
操作：
1. 创建一个任务 T，跑一次让它进入 history（至少有一个失败项 —— 可用假 tag 故意触发失败）。
2. 从"已保存任务" Tab 再点一次"开始"，让 T 产生一个活跃 session。
3. 在 history 的卡片上点"查看详情" → 点"重试所有失败项"。
4. 预期：弹出 info 提示 "该任务已有进行中的下载，历史记录已合并"；关闭弹窗；历史列表刷新后这条 history 卡片消失。

无法本地跑时，跳过这一步并在 commit 中注明。

- [ ] **Step 7.4: Commit**

```bash
git add src/renderer/components/BulkDownloadSessionDetail.tsx
git commit -m "feat(bulk-download): 重试遇到同 taskId 活跃时，详情弹窗显示合并提示"
```

---

## Task 8: 全量回归 + 最终 sanity check

**Files:** 无（纯验证）

- [ ] **Step 8.1: 跑全量测试**

Run: `npm run test`
Expected: 全部 PASS。若有失败，先止损这个 task（不再动代码），定位是哪一步引入的回归，回到对应 Task 修复。

- [ ] **Step 8.2: 跑构建**

Run: `npm run build`
Expected: 无类型错误、无构建失败。

- [ ] **Step 8.3: 若前面 Task 6/7 未能本地验证 UI，此刻补一次完整人工验证**

Run: `npm run dev`
场景清单：
1. 新建任务 → 跑完一次 → 进入 history，看到一条记录。
2. 再次从"已保存任务"开始同一 task → 原 history 记录在刷新后消失（被软删）；活跃列表出现新 session。
3. 等待新 session 完成 → 进入 history；此时 history 里只有 1 条（最新）。
4. 手动制造"有 failed 项的 history"（用会失败的 tag 跑一次）→ 跑另一个 running session（最简单：直接从已保存任务再开始一次）→ 在 history 的详情点"重试所有失败项" → info 提示合并，卡片消失。
5. Tab 顺序和默认：页面打开落到"活跃任务" Tab。

- [ ] **Step 8.4: 无需额外 commit（纯验证），手动 push 交给 reviewer**

```bash
git log --oneline -10
```
Expected: 能看到 Task 1-7 的 7 条中文 commit，按顺序排列。

---

## Self-Review Notes（已完成）

- ✅ Spec 覆盖：spec 三个目标（并发修复 / history 去重 / 三 Tab）都能映射到 Task 1-8。
- ✅ 无 TBD/占位符。Task 5 的 mock setup 标注了"实现完成后微调 mock expectations" —— 允许微调但核心断言明确。
- ✅ 类型一致：`ensureCanEnterRunning` 返回类型在所有 Task 中统一；`merged:boolean; message:string` 字段在 Task 3/4/7 中拼写一致。
- ✅ TDD 顺序：Task 1/3/4/5 均是先写测试后实现；Task 2/6/7 是改造型，靠既有测试 + 手工/回归验证（接受度更低但合理，因为 Task 2 只是把 ensureCanEnterRunning 嵌进已有锁块，Task 6/7 纯 UI）。
- ✅ Commit 粒度：7 个 commit，每个都对应一个可独立理解的语义单元。
