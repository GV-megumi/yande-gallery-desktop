# 批量下载：会话去重 + 三 Tab 改造

**日期**：2026-04-19
**范围**：批量下载功能的并发/重试正确性修复 + 历史会话去重 + 页面 Tab 结构重组
**所在 worktree**：`.worktrees/refactor-todo-full`（`feat/refactor-todo-full` 分支）

## 背景

批量下载页面（`BooruBulkDownloadPage`）目前把一个 task 的所有 session 按状态分成"活跃会话"和"历史会话"两个 Tab，并在下方固定显示一个"已保存的任务"列表。

发现两个问题：

1. **重试并发 bug**：当历史会话中某条 session 有失败项，用户点"重试"时，服务层（`retryAllFailed` / `retryFailedRecord`）只检查当前这条 session 自己的状态，不检查**同一个 `taskId` 下是否已有另一条活跃 session 在跑**。结果：同一个 task 会有两条 session 同时下载，互相竞争输出目录、API 限流配额。
2. **历史堆积**：一个 task 每完成一次就在 `bulk_download_sessions` 新增一条 history 记录；长期使用后 UI 历史列表堆成同一个 task 的多条重复项。用户希望"同一个 task 在历史里最多一条，新的覆盖旧的"。

同时用户希望把当前"2 个 Tab + 固定保存任务列表"的布局改成三 Tab 平级结构。

## 目标

- 彻底消除"同一个 task 两条活跃 session 同时下载"的可能性，无论经由哪条路径进入 running 状态。
- 保证 `bulk_download_sessions` 中 history 状态（`completed` / `failed` / `cancelled` / `allSkipped`）下，同一个 `taskId` 最多一条可见记录。
- 页面主体由两 Tab + 固定列表改为三 Tab：**活跃任务 / 历史任务 / 已保存任务**。

## 非目标

- 不修改 DB schema，复用现有 `deletedAt` 软删机制。
- 不做一次性历史 backfill 清理（老库里已经积累的重复 history 只在下次该 task 再跑时自然被清理）。
- 不合并跨 session 的失败记录行（即不把 S_hist 的 failed records 迁移进 S_active）。冲突场景直接软删 S_hist，由 S_active 自己通过 `skipIfExists` 天然覆盖。
- "已保存任务"底下的操作（新建 / 编辑 / 删除 / 从任务开始）行为不变，只是换了容器。

## 设计

### 一、后端：统一的"进入 running 前的看门"

新增一个内部函数，在每一处把 session 翻到 `running` 前调用：

```ts
// 在 src/main/services/bulkDownloadService.ts 内部，不导出
async function ensureCanEnterRunning(
  db: Database,
  sessionId: string,
  taskId: string,
  opts: { selfIsHistory: boolean }
): Promise<
  | { ok: true }
  | { ok: false; reason: 'hasActive'; activeSessionId: string; selfSoftDeleted: boolean }
>;
```

**行为**（必须在 `withScheduler` 锁内调用，复用现有 scheduler mutex，和 `createBulkDownloadSession` 的活跃去重同锁，天然串行化"查 + 改"）：

1. 查同 `taskId` 下是否还存在别的活跃 session：

   ```sql
   SELECT id FROM bulk_download_sessions
    WHERE taskId = ? AND id != ? AND deletedAt IS NULL
      AND status IN ('pending', 'queued', 'dryRun', 'running', 'paused')
    LIMIT 1;
   ```

   若命中 → 本次进入 running 被拒绝：
   - `opts.selfIsHistory === true`（retry 场景，当前 session 状态是 `completed` / `failed` / `cancelled` / `allSkipped`）：
     - 软删本 session：`UPDATE bulk_download_sessions SET deletedAt = ? WHERE id = ?`
     - 返回 `{ ok: false, reason: 'hasActive', activeSessionId, selfSoftDeleted: true }`
   - `opts.selfIsHistory === false`（pending/paused/queued → running 的正常推进）：
     - 不动本 session 状态（调用方自行决定回滚为 pending 还是别的）
     - 返回 `{ ok: false, reason: 'hasActive', activeSessionId, selfSoftDeleted: false }`

2. 无冲突时，软删同 `taskId` 下**所有其他** history session：

   ```sql
   UPDATE bulk_download_sessions
      SET deletedAt = ?
    WHERE taskId = ? AND id != ? AND deletedAt IS NULL
      AND status IN ('completed', 'failed', 'cancelled', 'allSkipped');
   ```

3. 返回 `{ ok: true }`。调用方继续把本 session 翻到 running。

### 二、调用点接入

需要逐个接入 `ensureCanEnterRunning` 的位置（状态从非 running 翻到 `running` 的地方）：

1. **`startBulkDownloadSession`**（正常启动流程，`pending` / `queued` / `dryRun` / `paused` → `running`）
   - `selfIsHistory = false`
   - 冲突时：保持原 session 在现有状态，IPC 返回 `{ success: false, error: '该任务已有进行中的下载会话' }`，文案与 `createBulkDownloadSession` 的 `deduplicated` 提示风格一致。
2. **`retryAllFailed`** ([src/main/services/bulkDownloadService.ts:2415-2425](src/main/services/bulkDownloadService.ts#L2415) 的 `completed`/`failed` 分支，以及 [2431-2437](src/main/services/bulkDownloadService.ts#L2431) 的 `paused` 分支)
   - `completed` / `failed` 分支：`selfIsHistory = true`
   - `paused` 分支：`selfIsHistory = false`（paused 属于活跃态；此分支里自己就是那个"活跃"，所以另一条活跃才算冲突，逻辑仍对）
   - 冲突且 `selfIsHistory=true` 时：IPC 返回 `{ success: true, merged: true, message: '该任务已有进行中的下载，历史记录已合并' }`。UI 收到后刷列表，该 history 卡片消失；不再执行后续 `resetInFlightRecordsToPending` / `startDownloadingSession`。
3. **`retryFailedRecord`** ([src/main/services/bulkDownloadService.ts:2538-2548](src/main/services/bulkDownloadService.ts#L2538) 的 `status !== 'running'` 分支)
   - 判定 `selfIsHistory` 依据 `sessionRow.status`（是否在 history 集合里）。
   - 冲突处理同上。
4. **`resumeRunningSessions`**（程序启动时把之前在 `running` / `paused` 状态的 session 继续跑）
   - 每条 session 恢复前过一次 `ensureCanEnterRunning`，`selfIsHistory = false`。
   - 冲突时（上次崩溃留下坏数据，同 task 两条同时 `running`）：保留先遍历到的那条继续运行，后遍历到的置回 `paused` 并记录 warning 日志 `[bulkDownloadService] 恢复时检测到同 taskId 双活跃，已把 {id} 置回 paused`。
   - 无冲突但命中 history 清理时：照常清理（启动时也能顺便清掉坏数据）。

### 三、完成时的旧去重逻辑

- 现在"完成时做 history 去重"并**不存在**（当前代码只翻状态）。新方案把去重彻底放到"进入 running 时"；完成路径 ([src/main/services/bulkDownloadService.ts:1621](src/main/services/bulkDownloadService.ts#L1621) 附近的 status → completed 翻转) **不加**去重逻辑。
- 因此 history 表状态约束是一个不变量：**在任意时刻，同一个 `taskId` 下未软删的 history session 数 ≤ 1**（因为下一次同 task 进入 running 时会把这 1 条清掉）。

### 四、前端：三 Tab 改造

文件：[src/renderer/pages/BooruBulkDownloadPage.tsx](src/renderer/pages/BooruBulkDownloadPage.tsx)

- 把现有 Tabs（`activeKey="active"`，两项）+ 下方 [line 425-495](src/renderer/pages/BooruBulkDownloadPage.tsx#L425) 的"已保存的任务"整块固定区域，合并为三个 Tab，顺序：
  1. `key="active"` 标题 **活跃任务** — 内容 = 现活跃会话列表（过滤 `activeSessions`）
  2. `key="history"` 标题 **历史任务** — 内容 = 现历史会话列表（过滤 `historySessions`）
  3. `key="saved"` 标题 **已保存任务** — 内容 = 现"已保存的任务"整块（Ant List + 开始/编辑/删除按钮）
- 默认 `activeKey="active"`（进页面先看当前在跑的，不变）。
- 顶部"新建任务"按钮保留在 Tabs **外面**（全局可见）。
- 原"已保存的任务"标题移除（它现在已经是 Tab 标题）。
- IPC / 数据加载逻辑不动：`loadSessions` / `loadTasks` / `loadSites` 都在 `useEffect` 里统一拉取。
- "重试合并到活跃"后 UI 提示：使用 `message.info(res.message)`（读后端返回的 `message` 字段），并调用 `loadSessions()` 刷新，被软删的 history 卡片随之消失。

### 五、事件 / 刷新

- 当前前端靠 `setInterval(loadSessions, 5000)` 在有活跃 session 时定期轮询（[BooruBulkDownloadPage.tsx:145](src/renderer/pages/BooruBulkDownloadPage.tsx#L145)）。
- 如果项目已有 `bulk-download:session-deleted` 或等价 IPC 事件，新 history 清理时复用发一条；**如果没有**，不新增事件通道，依赖 retry IPC 返回后 UI 主动 `loadSessions()` + 5s 轮询兜底。
- 需要实现时翻查 [src/preload/index.ts:142-162](src/preload/index.ts#L142) 的 `bulkDownload` 域和 `src/main/ipc` 下的相关 handler，确认现有事件集后决定。

## 错误处理

- `ensureCanEnterRunning` 内部所有 SQL 失败冒泡给调用方，由调用方包在既有 `try/catch` 里转成 `{ success: false, error }`。
- 冲突时软删本 session 的 `UPDATE` 若失败，整个操作视为失败，返回 error，UI 正常弹错。不留"一半清理完一半没清"的中间态（放在 scheduler 锁里本就串行，且 SQLite 单 statement 原子）。
- `resumeRunningSessions` 路径里某条恢复失败不能阻塞别的 session 恢复：每条用独立 `try/catch` 包起来，失败只记 warning。

## 测试

新增单测文件 `tests/main/services/bulkDownloadService.ensureCanEnterRunning.test.ts`，参考 [tests/main/services/bulkDownloadService.createSession.test.ts](tests/main/services/bulkDownloadService.createSession.test.ts) 的 setup 风格，覆盖：

1. **无冲突、无 history** → 放行，DB 无额外 UPDATE。
2. **无冲突、有 2 条 history（同 taskId）** → 放行；两条 history 的 `deletedAt` 均被置非空；自己的 `deletedAt` 不变。
3. **有活跃 session，selfIsHistory=false** → 返回 `{ok:false, selfSoftDeleted:false}`；本 session 状态、`deletedAt` 均不变。
4. **有活跃 session，selfIsHistory=true** → 返回 `{ok:false, selfSoftDeleted:true}`；本 session `deletedAt` 被置；活跃 session 不受影响。
5. **并发两个 retry 同时调用** → 通过 scheduler 锁串行化，一个返回 `ok:true` 并进 running，另一个返回 `reason:'hasActive'` 并被软删。

扩展现有 `bulkDownloadService.resume.test.ts`：补一个用例，模拟 DB 里同 taskId 两条 `running` 的坏数据，断言恢复后只剩一条在运行、另一条被置回 `paused`。

回归（不新增，只过一遍）：
- `bulkDownloadService.createSession.test.ts` — 确认 createSession 层的活跃去重不受影响。
- `bulkDownloadService.abort.test.ts` / `bulkDownloadService.events.test.ts` / `bulkDownloadService.queue.test.ts` — 进入 running 的路径经过看门函数后行为不变。

## 不做

- 不做 DB schema 变更。
- 不做启动期 history 一次性 backfill 清理。
- 不新增跨 session 的记录合并能力。
- 不修改"新建任务"按钮位置和"已保存任务"内部 Ant List 的交互。
- 不调整日志前缀、i18n 键名（只改显示文案）。

## 参考

- [src/main/services/bulkDownloadService.ts](src/main/services/bulkDownloadService.ts)
- [src/renderer/pages/BooruBulkDownloadPage.tsx](src/renderer/pages/BooruBulkDownloadPage.tsx)
- [src/renderer/components/BulkDownloadSessionCard.tsx](src/renderer/components/BulkDownloadSessionCard.tsx)
- [src/renderer/components/BulkDownloadSessionDetail.tsx](src/renderer/components/BulkDownloadSessionDetail.tsx)
- [src/preload/index.ts](src/preload/index.ts) `bulkDownload` 域
- [tests/main/services/bulkDownloadService.createSession.test.ts](tests/main/services/bulkDownloadService.createSession.test.ts)
