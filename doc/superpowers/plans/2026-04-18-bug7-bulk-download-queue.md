# Bug7 — 批量下载并发闸门 + `queued` 等待队列

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 批量下载会话引入并发上限（默认 3，可配置），超限的会话进入 `queued` 状态等待调度；每当活跃会话离开 `dryRun/running` 时自动推进下一个。

**Architecture:**
- 新增状态 `queued`。
- `startBulkDownloadSession` 加闸门：查 `countActiveSessions`，超限则把 session 打成 `queued` 直接返回。
- `promoteNextQueued`：离开 active 时调度下一个，递归进入 `startBulkDownloadSession`（再次过闸门）。
- 内存 mutex `schedulerMutex` 串行化 "计数 + 入集合" 以避免多入口并发撞上限。
- `init.ts` 启动恢复：把所有需要恢复的会话先打 `queued`，再按闸门 `promoteNextQueued`。
- UI：`StatusTag` 加 `queued: '等待中'`；`activeSessions` 过滤扩为 `pending/queued/dryRun/running/paused`；会话卡片 `queued` 时允许取消不允许手动启动。
- 配置：`config.yaml` 新字段 `bulkDownload.maxConcurrentSessions`（默认 3）。

**Tech Stack:** Node.js、sqlite3、React、vitest

---

## File Structure

- 修改：`src/shared/types.ts:150-159`（加 `queued`）
- 修改：`src/main/services/config.ts`（新增 `bulkDownload.maxConcurrentSessions`）
- 修改：`src/main/services/bulkDownloadService.ts`
  - 新增 `countActiveSessions` / `promoteNextQueued` / `schedulerMutex`
  - `startBulkDownloadSession` 加闸门（`L870-L1001`）
  - 所有离开 `dryRun/running` 的落点 finally 调 `promoteNextQueued`（`completed` / `allSkipped` / `failed` / `cancelled` / `paused`）
- 修改：`src/main/services/init.ts`（启动恢复套闸门）
- 修改：`src/renderer/components/StatusTag.tsx:10-22`（加 `queued` 映射）
- 修改：`src/renderer/pages/BooruBulkDownloadPage.tsx:102-116`（活跃过滤加 `pending`/`queued`）
- 修改：`src/renderer/components/BulkDownloadSessionCard.tsx`（queued 态的按钮可见性）
- 新建：`tests/main/services/bulkDownloadService.queue.test.ts`

---

### Task 1: 新状态 `queued` 与 UI 映射

**Files:**
- Modify: `src/shared/types.ts:150-159`
- Modify: `src/renderer/components/StatusTag.tsx:10-22`
- Modify: `src/renderer/pages/BooruBulkDownloadPage.tsx:102-116`

- [ ] **Step 1: 扩展枚举**

把 `src/shared/types.ts:150-159` 替换为：

```ts
export type BulkDownloadSessionStatus =
  | 'pending'      // 创建后、startSession 调用前的初始状态
  | 'queued'       // 已加入队列，等待并发槽位
  | 'dryRun'       // 扫描阶段（活跃）
  | 'running'      // 下载中（活跃）
  | 'completed'
  | 'allSkipped'
  | 'failed'
  | 'paused'
  | 'suspended'
  | 'cancelled';
```

- [ ] **Step 2: StatusTag 加映射**

在 `src/renderer/components/StatusTag.tsx:12` `pending` 下一行加入：

```ts
  queued: { color: 'default', text: '等待中（排队）' },
```

（`pending` 文案可保持 `等待中`，或改为 `就绪`，二选一按现场决定；默认不改。）

- [ ] **Step 3: activeSessions 过滤扩展**

把 `src/renderer/pages/BooruBulkDownloadPage.tsx:102-116` 替换为：

```tsx
  const { activeSessions, historySessions } = useMemo(() => {
    const active = sessions.filter(s =>
      s.status === 'pending' ||
      s.status === 'queued' ||
      s.status === 'dryRun' ||
      s.status === 'running' ||
      s.status === 'paused'
    );
    const history = sessions.filter(s =>
      s.status === 'completed' ||
      s.status === 'failed' ||
      s.status === 'cancelled' ||
      s.status === 'allSkipped'
    );
    return { activeSessions: active, historySessions: history };
  }, [sessions]);
```

- [ ] **Step 4: TS 编译**

Run: `npx tsc -p tsconfig.main.json --noEmit && npx tsc --noEmit -p tsconfig.json`

Expected: 无错误。

---

### Task 2: 配置字段

**Files:**
- Modify: `src/main/services/config.ts`（`AppConfig` 类型、`DEFAULT_CONFIG`、`normalizeConfigSaveInput`）

- [ ] **Step 1: 加类型字段**

在 `src/main/services/config.ts` 中 `AppConfig` 接口合适位置（与其它模块级配置同层）追加：

```ts
  bulkDownload?: {
    /** 同一时刻允许的批量下载活跃会话数（dryRun + running），超限会话进入 queued */
    maxConcurrentSessions?: number;
  };
```

- [ ] **Step 2: 默认值**

在 `DEFAULT_CONFIG` 里加：

```ts
  bulkDownload: {
    maxConcurrentSessions: 3,
  },
```

- [ ] **Step 3: `normalizeConfigSaveInput` 支持透传**

在 `normalizeConfigSaveInput` 的返回对象（`L1080` 附近 `booru:` 同级）追加：

```ts
    bulkDownload: {
      maxConcurrentSessions: input.bulkDownload?.maxConcurrentSessions
        ?? currentConfig.bulkDownload?.maxConcurrentSessions
        ?? 3,
    },
```

- [ ] **Step 4: 导出访问器**

在 `src/main/services/config.ts` 文件底部（与其它 `getXxx` 同层）加：

```ts
export function getMaxConcurrentBulkDownloadSessions(): number {
  const n = getConfig()?.bulkDownload?.maxConcurrentSessions;
  if (typeof n === 'number' && n > 0) return n;
  return 3;
}
```

- [ ] **Step 5: TS 编译**

Run: `npx tsc -p tsconfig.main.json --noEmit`

Expected: 无错误。

---

### Task 3: `countActiveSessions` / `schedulerMutex` / `promoteNextQueued`

**Files:**
- Modify: `src/main/services/bulkDownloadService.ts`（靠近 `getActiveBulkDownloadSessions` 放）

- [ ] **Step 1: 写函数**

在 `src/main/services/bulkDownloadService.ts` 中 `getActiveBulkDownloadSessions` 之后追加：

```ts
/** 当前 active = dryRun | running 的会话数 */
export async function countActiveSessions(): Promise<number> {
  const db = await getDatabase();
  const row = await get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM bulk_download_sessions
     WHERE deletedAt IS NULL AND status IN ('dryRun', 'running')`,
  );
  return row?.n ?? 0;
}

/**
 * 调度器锁：保证 "查活跃数 + 置 queued / 进入 dryRun" 这对操作串行，
 * 避免多个 startBulkDownloadSession 并发撞上同一空槽。
 */
let schedulerMutex: Promise<unknown> = Promise.resolve();
function withScheduler<T>(fn: () => Promise<T>): Promise<T> {
  const next = schedulerMutex.then(() => fn());
  schedulerMutex = next.catch(() => undefined);
  return next;
}

/** 取第一个 queued 会话 id（FIFO，按 startedAt 升序） */
async function getNextQueuedSessionId(): Promise<string | null> {
  const db = await getDatabase();
  const row = await get<{ id: string }>(
    db,
    `SELECT id FROM bulk_download_sessions
     WHERE deletedAt IS NULL AND status = 'queued'
     ORDER BY COALESCE(startedAt, createdAt) ASC
     LIMIT 1`,
  );
  return row?.id ?? null;
}

/** 若有空槽，取下一个 queued 会话重新进入 startBulkDownloadSession。 */
export async function promoteNextQueued(): Promise<void> {
  const nextId = await withScheduler(async () => {
    const max = getMaxConcurrentBulkDownloadSessions();
    const active = await countActiveSessions();
    if (active >= max) return null;
    const id = await getNextQueuedSessionId();
    if (!id) return null;
    // 在锁内把状态改回 pending，避免再被 getNextQueuedSessionId 取到
    await updateBulkDownloadSession(id, { status: 'pending' });
    return id;
  });
  if (!nextId) return;
  // 递归调用：startBulkDownloadSession 内部会再过闸门
  // 不 await，避免阻塞当前 finally
  startBulkDownloadSession(nextId).catch(err => {
    console.error('[bulkDownloadService] promoteNextQueued 启动失败:', err);
  });
}
```

（确认文件顶部已 import `getMaxConcurrentBulkDownloadSessions`；若未，添加 `import { getMaxConcurrentBulkDownloadSessions } from './config.js';`。）

- [ ] **Step 2: 写单元测试**

Create: `tests/main/services/bulkDownloadService.queue.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.fn();
const runMock = vi.fn();

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...a: any[]) => getMock(...a),
  run: (...a: any[]) => runMock(...a),
  all: vi.fn(),
}));
vi.mock('../../../src/main/services/config.js', () => ({
  getMaxConcurrentBulkDownloadSessions: () => 3,
  // 其它导出按需补齐
}));

describe('bulkDownloadService.countActiveSessions', () => {
  beforeEach(() => { getMock.mockReset(); });

  it('SQL 只数 dryRun + running', async () => {
    getMock.mockResolvedValueOnce({ n: 2 });
    const { countActiveSessions } = await import('../../../src/main/services/bulkDownloadService.js');
    await countActiveSessions();
    const sql = String(getMock.mock.calls[0][1]);
    expect(sql).toMatch(/status IN \('dryRun', 'running'\)/);
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `npx vitest run tests/main/services/bulkDownloadService.queue.test.ts --config vitest.config.ts`

Expected: PASS。

---

### Task 4: `startBulkDownloadSession` 加闸门

**Files:**
- Modify: `src/main/services/bulkDownloadService.ts:870-1001`

- [ ] **Step 1: 在 dryRun 之前插闸门**

把 `src/main/services/bulkDownloadService.ts:944-948` 的：

```ts
      // 更新状态为 dryRun（扫描阶段）
      await updateBulkDownloadSession(sessionId, {
        status: 'dryRun',
        currentPage: 1
      });
```

前面（即 `L942` `}` 之后、`L944` 注释之前）插入：

```ts
      // ── 并发闸门：超上限时打成 queued 立刻返回 ──
      const shouldQueue = await withScheduler(async () => {
        const max = getMaxConcurrentBulkDownloadSessions();
        const active = await countActiveSessions();
        if (active < max) return false;
        await updateBulkDownloadSession(sessionId, { status: 'queued' });
        console.log('[bulkDownloadService] 会话进入等待队列:', sessionId);
        return true;
      });
      if (shouldQueue) {
        return { success: true };
      }
```

- [ ] **Step 2: 对 `queued` 状态做幂等**

在 `src/main/services/bulkDownloadService.ts:919-942`（`currentStatus === 'dryRun'` / `'running'` 判定附近），再加一个：

```ts
      if (currentStatus === 'queued') {
        // queued 会话由 promoteNextQueued 调度器负责推进，此处仅在调度器调用时
        // （status 已被 promoteNextQueued 改回 pending）才会往下走；外部重复调用直接忽略。
        console.log('[bulkDownloadService] 会话当前仍在队列中，忽略外部 start 调用');
        return { success: true };
      }
```

注意顺序：调度器会先把 status 从 `queued` 置 `pending`（见 Task 3 的 `promoteNextQueued`），所以正常调度链路上这里**不会**命中。命中时意味着外部（UI / 收藏标签）对 queued 会话再次点击，不应重复入列。

- [ ] **Step 3: 在各终态 finally 处推进队列**

把 `src/main/services/bulkDownloadService.ts:981-987` 的：

```ts
      startDownloadingSession(sessionId, task).catch(error => {
        console.error('[bulkDownloadService] 下载过程出错:', error);
        updateBulkDownloadSession(sessionId, {
          status: 'failed',
          error: error.message
        });
      });
```

替换为：

```ts
      startDownloadingSession(sessionId, task)
        .catch(error => {
          console.error('[bulkDownloadService] 下载过程出错:', error);
          return updateBulkDownloadSession(sessionId, {
            status: 'failed',
            error: error.message
          });
        })
        .finally(() => {
          // 下载结束（成功 / 失败 / 取消 / 暂停 均由内部写 DB 后到达），推进队列
          promoteNextQueued().catch(err => {
            console.error('[bulkDownloadService] promoteNextQueued failed:', err);
          });
        });
```

另外在 `allSkipped` 分支（`L966-L970`）的 return 前也调一下：

```ts
      if (pendingCount.pending === 0) {
        await updateBulkDownloadSession(sessionId, {
          status: 'allSkipped'
        });
        promoteNextQueued().catch(err => console.error('[bulkDownloadService] promoteNextQueued failed:', err));
        return { success: true };
      }
```

`failed`（`L953-L958`）的 return 前同样加一行：

```ts
      if (!dryRunResult.success) {
        await updateBulkDownloadSession(sessionId, {
          status: 'failed',
          error: dryRunResult.error
        });
        promoteNextQueued().catch(err => console.error('[bulkDownloadService] promoteNextQueued failed:', err));
        return { success: false, error: dryRunResult.error };
      }
```

- [ ] **Step 4: `pauseBulkDownloadSession` / `cancelBulkDownloadSession` 末尾也推进队列**

在 `src/main/services/bulkDownloadService.ts` 内找 `pauseBulkDownloadSession` / `cancelBulkDownloadSession`（若命名不同，搜索 `status: 'paused'` / `status: 'cancelled'` 所在函数）。在这两个函数写完 DB 之后、return 之前插入：

```ts
  promoteNextQueued().catch(err => console.error('[bulkDownloadService] promoteNextQueued failed:', err));
```

- [ ] **Step 5: 回归 + 单测**

Run: `npx vitest run tests/main/services/bulkDownloadService.queue.test.ts tests/main/services/bulkDownloadService.test.ts tests/main/services/bulkDownloadService.abort.test.ts tests/main/services/bulkDownloadService.tp02.test.ts tests/main/services/bulkDownloadService.tp03.test.ts --config vitest.config.ts`

Expected: PASS。如部分既有测试强依赖 "`startBulkDownloadSession` 必 dryRun → running" 的直线链路而未 mock 闸门路径，给它们补一条 `countActiveSessions` mock 返回 0。

---

### Task 5: 启动恢复套闸门

**Files:**
- Modify: `src/main/services/init.ts`（`L78+` 恢复 `running`/`dryRun` 会话处）

- [ ] **Step 1: 改 init 恢复链**

定位 `src/main/services/init.ts` 里扫描 `running/dryRun` 会话并逐个 `startBulkDownloadSession` 的循环。改成：

```ts
// 把本次恢复的所有会话先打为 queued，统一由调度器按闸门拉起
for (const session of sessionsToRestore) {
  await updateBulkDownloadSession(session.id, { status: 'queued' });
}
// 触发一次调度，循环内会按 maxConcurrent 把前 N 个拉起，
// 它们完成后再 promoteNextQueued 顶上。
for (let i = 0; i < getMaxConcurrentBulkDownloadSessions(); i++) {
  promoteNextQueued().catch(err => console.error('[init] promoteNextQueued failed:', err));
}
```

（保留原有的日志、错误处理；`updateBulkDownloadSession` / `promoteNextQueued` 按 `import { ... } from './bulkDownloadService.js'` 形式 import。）

---

### Task 6: UI：queued 态按钮与创建时提示

**Files:**
- Modify: `src/renderer/components/BulkDownloadSessionCard.tsx`（按钮可见性）
- Modify: `src/renderer/pages/BooruBulkDownloadPage.tsx`（handleCreateOrUpdateTask / handleStartFromTask 的 message）

- [ ] **Step 1: queued 时的按钮**

在 `BulkDownloadSessionCard.tsx` 会话卡片操作区（找 `session.status === 'pending'` / `'paused'` 等判定位置）追加：

- 若 `session.status === 'queued'` → 只显示 "取消"（调用既有的 `cancelBulkDownloadSession`）；不显示 "暂停" / "恢复" / "重试"。

示意（具体文件行号需在阅读时定位；若原本没有 queued 分支，就加一段 `else if (session.status === 'queued')`）：

```tsx
) : session.status === 'queued' ? (
  <Tooltip title="取消（出队）">
    <Button icon={<CloseOutlined />} onClick={() => handleCancel(session)}>取消</Button>
  </Tooltip>
) : ...
```

- [ ] **Step 2: 创建时若入队，弹提示**

在 `handleCreateOrUpdateTask` / `handleStartFromTask` / 收藏标签 download 触发点，成功返回后，如果 `sessions.some(s => s.id === newSessionId && s.status === 'queued')` 则弹：

```ts
message.info('已加入队列，等待其他下载完成');
```

（实现细节：最简单的是 `loadSessions` 之后判定；或修改 `startBulkDownloadSession` 的返回类型让它告知调用方 `queued` 状态。若不想扩 API，前端在 `loadSessions` 回来后看刚创建的 sessionId 的 status 判定。）

---

### Task 7: 回归 + 归档 + 提交

**Files:** —

- [ ] **Step 1: 全量测试**

Run: `npx vitest run tests/main tests/renderer --config vitest.config.ts`

Expected: PASS。

- [ ] **Step 2: TS 编译**

Run: `npx tsc -p tsconfig.main.json --noEmit && npx tsc --noEmit -p tsconfig.json`

Expected: 无错误。

- [ ] **Step 3: 人工验证**

`npm run dev`：
- 同时开 4 个批量下载任务 → 前 3 个进入 dryRun / running，第 4 个状态显示 "等待中（排队）"。
- 第一个完成后 → 第 4 个自动从 queued 进入 dryRun。
- 对 queued 会话点 "取消" → 直接从队列移除，不占槽位。
- 对 running 会话点 "暂停" → 活跃数-1，下一个 queued 自动顶上；"恢复" 该暂停会话时若槽满应重新变 queued（此条为产品期望，若实现成 paused 直接恢复也可，视实现保留/调整）。
- 重启应用（有 running/dryRun 的情况下）→ 所有会话先 queued，按闸门依次拉起。

- [ ] **Step 4: 归档 + 提交**

```bash
git mv bug7.md doc/done/bug7-bulk-download-queue.md
git add src/shared/types.ts \
        src/main/services/config.ts \
        src/main/services/bulkDownloadService.ts \
        src/main/services/init.ts \
        src/renderer/components/StatusTag.tsx \
        src/renderer/components/BulkDownloadSessionCard.tsx \
        src/renderer/pages/BooruBulkDownloadPage.tsx \
        tests/main/services/bulkDownloadService.queue.test.ts \
        doc/done/bug7-bulk-download-queue.md
git commit -m "feat(bug7): 批量下载并发闸门 + queued 排队队列

$(cat <<'EOF'
原先无上限并发会话，导致对站点产生过大压力、本地 IO 争抢、UI
信息过载。本次引入：

- 新状态 queued（超闸门或启动恢复的占位）
- config.yaml 新字段 bulkDownload.maxConcurrentSessions，默认 3
- countActiveSessions / promoteNextQueued / schedulerMutex：
  串行 "计数 + 状态切换"，避免并发撞同一空槽
- startBulkDownloadSession 入口加闸门：超限置 queued 返回
- 所有离开 dryRun/running 的分支（completed/failed/allSkipped/
  paused/cancelled）finally 调 promoteNextQueued 推进
- init.ts 启动恢复：先全打 queued，再触发 maxConcurrent 次调度
- StatusTag 加 queued 映射；活跃会话过滤扩为
  pending/queued/dryRun/running/paused
- 会话卡片 queued 态只保留"取消（出队）"按钮
EOF
)"
```

Expected: commit 成功。

---

## Self-Review Checklist

- [x] Spec §批 C C2 五条子点全部覆盖：状态、UI 过滤、闸门、调度器、init 恢复。
- [x] 离开 active 的五种分支都调 `promoteNextQueued`。
- [x] mutex 保证计数+入集合原子。
- [x] 配置化 `maxConcurrentSessions`。
- [x] 无占位符；文件行号基于 Read 实际结果。
