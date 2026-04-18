# Bug5 — 收藏标签对已完成下载再次点击下载被误判为 "任务已存在"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正 `startFavoriteTagBulkDownload` 对 `deduplicated=true` 的处理：只有当该任务仍有活跃会话时才返回 "任务已存在"；否则 fallthrough 到 `createBulkDownloadSession + startBulkDownloadSession` 重启新会话。

**Architecture:** 在 `bulkDownloadService` 新增 `hasActiveSessionForTask(taskId)`（查 DB 中 `status IN ('pending','dryRun','running','paused')` 且 `deletedAt IS NULL` 的会话数）。`booruService.startFavoriteTagBulkDownload` 的 deduplicated 分支先调此函数，活跃才短路返回，否则继续创建会话。

**Tech Stack:** Node.js、sqlite3、vitest

---

## File Structure

- 修改：`src/main/services/booruService.ts:2342-2346`
- 修改：`src/main/services/bulkDownloadService.ts`（新增导出 `hasActiveSessionForTask`）
- 新建：`tests/main/services/bulkDownloadService.hasActiveSession.test.ts`
- 新建：`tests/main/services/booruService.favoriteTagRedownload.test.ts`（可选，若 mock 复杂可并入上一个）

---

### Task 1: `bulkDownloadService` 新增 `hasActiveSessionForTask`

**Files:**
- Modify: `src/main/services/bulkDownloadService.ts`（导出新函数；插入位置在已有的 "查询类" 函数附近，例如 `getActiveBulkDownloadSessions` 下方）

- [ ] **Step 1: 新增函数**

在 `src/main/services/bulkDownloadService.ts` 选一处合适位置（建议在 `getActiveBulkDownloadSessions` 之后）追加：

```ts
/**
 * 判断某个批量下载任务当前是否有活跃会话（pending / dryRun / running / paused）。
 * 用于上游判定 "已存在任务模板 && 仍有进行中的会话" 时跳过重复启动。
 */
export async function hasActiveSessionForTask(taskId: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM bulk_download_sessions
     WHERE taskId = ?
       AND deletedAt IS NULL
       AND status IN ('pending', 'dryRun', 'running', 'paused')`,
    [taskId],
  );
  return (row?.n ?? 0) > 0;
}
```

（若该文件还未 import `get`，确认顶部的 `import { getDatabase, get, run, all } from './database.js'` 等声明包含 `get`。）

- [ ] **Step 2: 写单元测试**

Create: `tests/main/services/bulkDownloadService.hasActiveSession.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.fn();
vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: vi.fn(),
  all: vi.fn(),
}));

describe('bulkDownloadService.hasActiveSessionForTask', () => {
  beforeEach(() => getMock.mockReset());

  it('当 COUNT>0 时返回 true', async () => {
    getMock.mockResolvedValueOnce({ n: 2 });
    const { hasActiveSessionForTask } = await import('../../../src/main/services/bulkDownloadService.js');
    const result = await hasActiveSessionForTask('task-1');
    expect(result).toBe(true);
  });

  it('当 COUNT=0 时返回 false', async () => {
    getMock.mockResolvedValueOnce({ n: 0 });
    const { hasActiveSessionForTask } = await import('../../../src/main/services/bulkDownloadService.js');
    const result = await hasActiveSessionForTask('task-1');
    expect(result).toBe(false);
  });

  it('SQL 只统计 pending/dryRun/running/paused 且 deletedAt IS NULL', async () => {
    getMock.mockResolvedValueOnce({ n: 0 });
    const { hasActiveSessionForTask } = await import('../../../src/main/services/bulkDownloadService.js');
    await hasActiveSessionForTask('task-x');
    const sql = String(getMock.mock.calls[0][1]);
    expect(sql).toMatch(/taskId = \?/);
    expect(sql).toMatch(/deletedAt IS NULL/);
    expect(sql).toMatch(/status IN \('pending', 'dryRun', 'running', 'paused'\)/);
  });
});
```

- [ ] **Step 3: 跑测试确认 PASS**

Run: `npx vitest run tests/main/services/bulkDownloadService.hasActiveSession.test.ts --config vitest.config.ts`

Expected: 3 条 PASS。

---

### Task 2: `startFavoriteTagBulkDownload` 分流 deduplicated

**Files:**
- Modify: `src/main/services/booruService.ts:2342-2346`

- [ ] **Step 1: 替换 deduplicated 短路分支**

把 `src/main/services/booruService.ts:2342-2346` 的：

```ts
  // 任务已存在（去重），跳过会话创建，直接返回
  if (taskResult.data.deduplicated) {
    console.log('[booruService] 任务已存在，跳过会话创建:', taskId);
    return { taskId, sessionId: '', deduplicated: true };
  }
```

替换为：

```ts
  // 任务已存在（任务模板去重）：只有仍存在活跃会话时才短路返回，
  // 否则 fallthrough 到下面 createBulkDownloadSession + startBulkDownloadSession，
  // 复用任务模板启动一次新的下载会话。
  if (taskResult.data.deduplicated) {
    const hasActive = await bulkDownloadService.hasActiveSessionForTask(taskId);
    if (hasActive) {
      console.log('[booruService] 任务存在活跃会话，跳过重启:', taskId);
      return { taskId, sessionId: '', deduplicated: true };
    }
    console.log('[booruService] 任务已存在但无活跃会话，复用任务模板启动新会话:', taskId);
    // 继续走下面的 createBulkDownloadSession / startBulkDownloadSession
  }
```

- [ ] **Step 2: 确认后续快照更新链路不变**

检查 `src/main/services/booruService.ts` 的 `startFavoriteTagBulkDownload` 函数剩余部分（`createBulkDownloadSession` / `startBulkDownloadSession` / `updateFavoriteTagDownloadBindingSnapshot` 的调用链）是否保留；当前 fallthrough 直接走下去即可，无需其它改动。

---

### Task 3: 针对 `startFavoriteTagBulkDownload` 写行为测试

**Files:**
- Create: `tests/main/services/booruService.favoriteTagRedownload.test.ts`

- [ ] **Step 1: 写行为测试**

由于 `startFavoriteTagBulkDownload` 依赖较多模块，测试使用 vi.mock 隔离下游调用。

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 覆盖 bulkDownloadService 全部会被调用的导出
const createBulkDownloadTask = vi.fn();
const createBulkDownloadSession = vi.fn();
const startBulkDownloadSession = vi.fn();
const hasActiveSessionForTask = vi.fn();

vi.mock('../../../src/main/services/bulkDownloadService.js', () => ({
  createBulkDownloadTask: (...a: any[]) => createBulkDownloadTask(...a),
  createBulkDownloadSession: (...a: any[]) => createBulkDownloadSession(...a),
  startBulkDownloadSession: (...a: any[]) => startBulkDownloadSession(...a),
  hasActiveSessionForTask: (...a: any[]) => hasActiveSessionForTask(...a),
}));

// favoriteTag / binding 查询桩 —— 根据 booruService 实际使用的导出补齐
vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: vi.fn(),
  run: vi.fn(),
  all: vi.fn(),
}));
vi.mock('fs/promises', () => ({
  default: { mkdir: vi.fn(async () => {}) },
}));

// 最小桩：getFavoriteTagById / getFavoriteTagDownloadBinding / getGallerySnapshotById
// 这几个是 booruService 内部同文件导出，测试时只能走整体模块
// 因此改成 spy 再覆盖：
async function importSvcWithStubs(stubs: {
  favoriteTag: any;
  binding: any;
  gallery?: any;
}) {
  const mod = await import('../../../src/main/services/booruService.js');
  vi.spyOn(mod, 'getFavoriteTagById' as any).mockResolvedValue(stubs.favoriteTag);
  vi.spyOn(mod, 'getFavoriteTagDownloadBinding' as any).mockResolvedValue(stubs.binding);
  if (stubs.gallery !== undefined) {
    vi.spyOn(mod, 'getGallerySnapshotById' as any).mockResolvedValue(stubs.gallery);
  }
  return mod;
}

describe('booruService.startFavoriteTagBulkDownload - deduplicated 分流', () => {
  beforeEach(() => {
    createBulkDownloadTask.mockReset();
    createBulkDownloadSession.mockReset();
    startBulkDownloadSession.mockReset();
    hasActiveSessionForTask.mockReset();
  });

  const favoriteTag = { id: 1, siteId: 1, tagName: 'foo', queryType: 'tag' };
  const binding = { enabled: 1, downloadPath: '/tmp/x', galleryId: null };

  it('deduplicated 且有活跃会话 → 短路返回', async () => {
    createBulkDownloadTask.mockResolvedValueOnce({
      success: true,
      data: { id: 'task-a', deduplicated: true },
    });
    hasActiveSessionForTask.mockResolvedValueOnce(true);

    const mod = await importSvcWithStubs({ favoriteTag, binding });
    const result = await mod.startFavoriteTagBulkDownload(1);

    expect(result).toEqual({ taskId: 'task-a', sessionId: '', deduplicated: true });
    expect(createBulkDownloadSession).not.toHaveBeenCalled();
    expect(startBulkDownloadSession).not.toHaveBeenCalled();
  });

  it('deduplicated 但无活跃会话 → 复用任务、创建并启动新会话', async () => {
    createBulkDownloadTask.mockResolvedValueOnce({
      success: true,
      data: { id: 'task-b', deduplicated: true },
    });
    hasActiveSessionForTask.mockResolvedValueOnce(false);
    createBulkDownloadSession.mockResolvedValueOnce({ success: true, data: { id: 'session-new' } });
    startBulkDownloadSession.mockResolvedValueOnce({ success: true });

    const mod = await importSvcWithStubs({ favoriteTag, binding });
    const result = await mod.startFavoriteTagBulkDownload(1);

    expect(createBulkDownloadSession).toHaveBeenCalledWith('task-b');
    expect(startBulkDownloadSession).toHaveBeenCalledWith('session-new');
    expect(result.taskId).toBe('task-b');
    expect(result.sessionId).toBe('session-new');
    expect(result.deduplicated).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/main/services/booruService.favoriteTagRedownload.test.ts --config vitest.config.ts`

Expected: 2 条 PASS。若 spy 某个导出失败（TS 报 "not configurable"），把对应函数改为测试前先 `vi.mock` 模块再覆盖；或者把 `importSvcWithStubs` 里的 spy 换成 `vi.doMock`。

---

### Task 4: 全量回归 + 提交

**Files:** —

- [ ] **Step 1: 跑相关测试**

Run: `npx vitest run tests/main/services/booruService.test.ts tests/main/services/booruService.integration.test.ts tests/main/services/bulkDownloadService.test.ts --config vitest.config.ts`

Expected: 全部 PASS。

- [ ] **Step 2: TS 编译**

Run: `npx tsc -p tsconfig.main.json --noEmit`

Expected: 无错误。

- [ ] **Step 3: 人工验证**

`npm run dev` → 标签管理 → 收藏标签 → 选一条之前跑完下载的标签 → 点 "下载" 按钮：
- 应看到 `message.success('已重新开始下载...')`（或原 `downloadTaskCreated` 文案），活跃会话 Tab 出现新卡片
- 再立即点一次 → 此时应看到 `message.info('任务已存在')`（因为有活跃会话）

- [ ] **Step 4: 归档 + 提交**

```bash
git mv bug5.md doc/done/bug5-favorite-tag-redownload.md
git add src/main/services/bulkDownloadService.ts \
        src/main/services/booruService.ts \
        tests/main/services/bulkDownloadService.hasActiveSession.test.ts \
        tests/main/services/booruService.favoriteTagRedownload.test.ts \
        doc/done/bug5-favorite-tag-redownload.md
git commit -m "fix(bug5): 收藏标签已完成下载再点击应重启新会话

$(cat <<'EOF'
createBulkDownloadTask 的 deduplicated 语义是"任务模板去重"，
但 startFavoriteTagBulkDownload 曾经把它当作"下载去重"直接短路返回，
导致已完成/失败的任务无法从收藏标签页重新发起。

- bulkDownloadService 新增 hasActiveSessionForTask(taskId)
  （统计 pending/dryRun/running/paused 且未软删的会话数）
- startFavoriteTagBulkDownload 的 deduplicated 分支先查活跃会话：
  - 有活跃 → 继续短路返回，保留"任务已存在"提示
  - 无活跃 → fallthrough 到 createBulkDownloadSession +
    startBulkDownloadSession，复用任务模板启动新会话
EOF
)"
```

Expected: commit 成功。

---

## Self-Review Checklist

- [x] Spec §批 B B1 的三条都覆盖：新增 `hasActiveSessionForTask`、分流 deduplicated、保留错误提示语义。
- [x] 活跃状态集合与 BooruBulkDownloadPage 的 `activeSessions` 判定保持一致（`pending/dryRun/running/paused`）。
- [x] 快照更新链路 (`updateFavoriteTagDownloadBindingSnapshot`) 通过 fallthrough 自动复用，无需额外改动。
- [x] 无占位符。
