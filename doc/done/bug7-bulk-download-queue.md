# Bug 7: 批量下载没有并发会话上限，缺少"等待中"排队机制

## 现象

在"批量下载"页面的"活跃会话"Tab 中，可以**无上限地同时发起任意多个批量下载会话**。同时点击多个任务的"开始"、或同时配置多个收藏标签下载，都会并发进入扫描（`dryRun`）/ 下载（`running`）状态。

这会带来：

- 同一站点短时间内产生大量并发请求，容易触发限流甚至被封。
- 本地磁盘 IO / 缩略图生成等资源被多个会话争抢，单个会话速度反而都变慢。
- 界面上"活跃会话"列表信息密度过高，用户也无法分辨"谁在真跑 / 谁该等等"。

## 预期行为

批量下载会话应当有**并发上限**（默认建议 3 个），超出上限的会话进入"等待中"队列，直到有活跃会话结束/暂停/取消/失败后再自动顶上：

- **活跃槽位**（并发运行）：`dryRun` / `running` 两类状态合计最多 3 个。
- **等待槽位**：一个新的会话状态（例如 `queued`），UI 显示为"等待中（排队）"。
- 队列推进规则：某个活跃会话离开 `dryRun` / `running`（进入 `completed` / `failed` / `cancelled` / `allSkipped` / `paused`）时，按入队顺序取下一个等待中的会话，把它从"队列中"推进到真实启动链路（`dryRun` → `running`）。
- 用户主动对"等待中"的会话点取消/删除，应从队列里直接移除，不占槽位。
- 用户主动对"下载中"的会话点暂停，应释放槽位让等待中的会话顶上；恢复暂停的会话时，若槽位已满，应重新进入"等待中"。

## 代码定位

### 当前状态枚举

[src/shared/types.ts:149-159](src/shared/types.ts#L149-L159)：

```ts
export type BulkDownloadSessionStatus =
  | 'pending'      // 创建后、startSession 调用前的初始状态（单点）
  | 'dryRun'       // 扫描阶段（活跃）
  | 'running'      // 下载中（活跃）
  | 'completed'
  | 'allSkipped'
  | 'failed'
  | 'paused'
  | 'suspended'
  | 'cancelled';
```

这里 `pending` 的语义是"会话刚创建、还没进入扫描"，不代表"因并发上限而排队"。UI 上虽然 [StatusTag.tsx:12](src/renderer/components/StatusTag.tsx#L12) 已经把 `pending` 映射成"等待中"，但因为它只会在 `createSession → startSession` 这一小段窗口存在，用户通常根本看不到，也不会把它当作"排队"语义。

### 当前会话启动链路没有任何并发控制

[bulkDownloadService.ts:870-997](src/main/services/bulkDownloadService.ts#L870-L997) `startBulkDownloadSession`：

```ts
// ... 读取 session / task
if (currentStatus === 'dryRun')  return { success: true };
if (currentStatus === 'running') { /* 幂等补救 */ return { success: true }; }

// 直接进入扫描
await updateBulkDownloadSession(sessionId, { status: 'dryRun', currentPage: 1 });
const dryRunResult = await performDryRun(sessionId, task);
// ...
await updateBulkDownloadSession(sessionId, { status: 'running', totalPages: ... });
startDownloadingSession(sessionId, task).catch(...);
```

整个链路里没有"查询当前活跃会话数 → 超过上限则排队"的分支。
`activeDownloadSessionPromises`（[bulkDownloadService.ts:1246](src/main/services/bulkDownloadService.ts#L1246)）只用作"每个 session 的下载循环句柄"，不是全局并发计数。

### 触发点散布在多条路径

任何一条路径调用 `startBulkDownloadSession` 都会无视并发数立刻启动：

- [BooruBulkDownloadPage.tsx:224-248](src/renderer/pages/BooruBulkDownloadPage.tsx#L224-L248) `handleStartFromTask`（已保存任务 → 开始）。
- [BooruBulkDownloadPage.tsx:147-221](src/renderer/pages/BooruBulkDownloadPage.tsx#L147-L221) `handleCreateOrUpdateTask`（创建并开始）。
- [BulkDownloadSessionCard.tsx](src/renderer/components/BulkDownloadSessionCard.tsx) 的恢复/重试动作（`resumeBulkDownloadSession` / `retryFailedRecord`）。
- [booruService.ts:2262-2346](src/main/services/booruService.ts#L2262-L2346) 收藏标签下载链路。
- [init.ts:78-](src/main/services/init.ts#L78) 进程启动后恢复 `running` / `dryRun` 会话——现在也是一次性全部拉起，缺少同一套限流。

## 建议修复方向

按"最小可用 → 完整"两级推进。

### ① 新增 `queued` 状态

在 [types.ts:149-159](src/shared/types.ts#L149-L159) 的 `BulkDownloadSessionStatus` 加入 `'queued'`。UI 侧：

- [StatusTag.tsx:10-22](src/renderer/components/StatusTag.tsx#L10-L22) 的 `STATUS_PRESETS` 加映射 `queued: { color: 'default', text: '等待中' }`；考虑把现有 `pending` 的文案改成更贴语义的"已创建"或"就绪"（二者区分）。
- [BooruBulkDownloadPage.tsx:102-116](src/renderer/pages/BooruBulkDownloadPage.tsx#L102-L116) 的 `activeSessions` 过滤集合扩成 `pending | queued | dryRun | running | paused`——"等待中"也应出现在"活跃会话"Tab 里。
- [bulkDownloadService.ts:870-997](src/main/services/bulkDownloadService.ts#L870-L997) 对 `queued` 分支也做幂等（传进来就什么都不做，等调度器来推进）。

### ② 在 `startBulkDownloadSession` 加并发闸门

伪代码：

```ts
const MAX_CONCURRENT_SESSIONS = 3;

export async function startBulkDownloadSession(sessionId) {
  // ...前置校验保持不变（目录存在、status 去重等）

  const activeCount = await countActiveSessions(); // status IN ('dryRun','running')
  if (activeCount >= MAX_CONCURRENT_SESSIONS) {
    await updateBulkDownloadSession(sessionId, { status: 'queued' });
    return { success: true };
  }

  // 进入原有 dryRun → running 链路
}
```

配套补一个 `countActiveSessions`：

```ts
async function countActiveSessions(): Promise<number> {
  const db = await getDatabase();
  const row = await get<{ n: number }>(db, `
    SELECT COUNT(*) AS n FROM bulk_download_sessions
    WHERE deletedAt IS NULL AND status IN ('dryRun', 'running')
  `);
  return row?.n ?? 0;
}
```

注意：
- 为了避免并发入口打起来（比如用户连点三个"开始"同时进入），计数 + 状态更新这对操作需要用内存互斥锁（`activeSessionStartPromises` 旁边加一把全局 mutex，或直接用事务）串行化。

### ③ 完成/暂停时推进队列

在所有从 `dryRun` / `running` 离开的地方（下载结束 finally、`pauseBulkDownloadSession`、`cancelBulkDownloadSession`、下载错误 catch），插入一次调度：

```ts
async function promoteNextQueued() {
  const nextId = await get<{ id: string }>(db, `
    SELECT id FROM bulk_download_sessions
    WHERE deletedAt IS NULL AND status = 'queued'
    ORDER BY startedAt ASC LIMIT 1
  `);
  if (nextId) await startBulkDownloadSession(nextId.id); // 递归进入 ② 的闸门
}
```

`startBulkDownloadSession` 自身要幂等地把 `queued` 重新走到 `dryRun` 分支（当前是"只认 pending/paused/…"），所以 ① 的 `queued` 分支幂等和这里对应。

### ④ 启动时的并发恢复

[init.ts:78-](src/main/services/init.ts#L78) 恢复 `running/dryRun` 会话的地方也套同一闸门：先把所有应恢复的会话改成 `queued`，再用 `promoteNextQueued` 按槽位顺序拉起，避免一次性把所有恢复的会话全部同时启动。

### ⑤ UI 层的协同点

- 会话卡片上，`queued` 时的"暂停 / 继续 / 取消"按钮映射：应该允许"取消"（出队），允许"手动提前启动"就别做了——用户的期望就是"自动排队"。
- "开始下载"交互文案加提示，比如超过并发时弹 `message.info('已加入队列，等待其他下载完成')`，和 bug2（[doc/done/bug2-start-task-load-sessions.md](doc/done/bug2-start-task-load-sessions.md)）里"立刻 loadSessions 看到新卡片"的修复组合起来更自然。
- 并发上限最好做成可配置（`config.yaml` 里一个 `bulkDownload.maxConcurrentSessions`），默认 3。

## 影响

- 当前是"无节流"，重负载场景下很容易对站点产生不友好的并发压力，也增加被限流风险。
- 对用户来说，"开始"按钮没有排队语义，同时点 N 个任务 → 看到 N 个同时在扫描/下载，反而没人快，体验糟。
- 加入 `queued` 状态后，现有状态 tag（`StatusTag`）、前端活跃会话过滤、后端状态迁移、重启恢复四处都要一起动，**务必在一个 PR 里闭环**，避免中间状态出现"死会话"（在 DB 里是 queued，但没有调度器来推它）。

---

## 修复落地（2026-04-18）

按原建议方向 ①②③④⑤ 全部落地：

1. **状态枚举扩展**：`src/shared/types.ts` 的 `BulkDownloadSessionStatus` 增加 `'queued'`。
2. **StatusTag 映射**：`src/renderer/components/StatusTag.tsx` 的 `STATUS_PRESETS` 加 `queued: { color: 'default', text: '等待中（排队）' }`。
3. **配置项**：`src/main/services/config.ts` 增加 `bulkDownload.maxConcurrentSessions`（默认 3）与访问器 `getMaxConcurrentBulkDownloadSessions()`，`normalizeConfigSaveInput` 同步支持。
4. **调度器 + 闸门**：`src/main/services/bulkDownloadService.ts`：
   - 新增 `countActiveSessions`（只数 `dryRun | running`）、`schedulerMutex`（Promise 链串行化计数+状态切换）、`getNextQueuedSessionId`（FIFO）、`promoteNextQueued`（锁内置 pending → 锁外调 startSession）。
   - `startBulkDownloadSession` 加闸门：超 max 时直接 `status='queued'` 返回；`queued` 分支幂等；所有离开 `dryRun/running` 的落点（failed / allSkipped / completed / 目录不存在 / 下载循环 finally）调 `promoteNextQueued` 推进下一个。
   - `pauseBulkDownloadSession` / `cancelBulkDownloadSession` 返回前也调 `promoteNextQueued`。
5. **启动恢复套闸门**：`resumeRunningSessions` 先把待恢复会话全部置 `queued`，再触发 maxConcurrent 次 `promoteNextQueued` 让调度器按上限拉起。
6. **UI 协同**：
   - `src/renderer/pages/BooruBulkDownloadPage.tsx` 的 `activeSessions` 过滤扩为 `pending | queued | dryRun | running | paused`；`handleCreateOrUpdateTask` / `handleStartFromTask` 成功后调 `notifyIfQueued` 若新会话为 `queued` 则 `message.info('已加入队列，等待其他下载完成')`。
   - `src/renderer/components/BulkDownloadSessionCard.tsx` 增加 `queued` 分支，只显示"取消（出队）"按钮，不显示"开始/暂停/继续"。
7. **测试**：`tests/main/services/bulkDownloadService.queue.test.ts` 覆盖：
   - `countActiveSessions` SQL 只数 `dryRun, running` 且 `deletedAt IS NULL`。
   - **闸门反模式守卫**：3 个 active 时 startSession 应置 `queued`，不滑到 `dryRun`。
   - **推进反模式守卫**：有空槽 + 有 queued 时应把队首置回 `pending`；无空槽不应查 queued；有空槽无 queued 安静返回。
   - 验证过反模式 FAIL 证据：临时禁用闸门时第一条失败；临时禁用 promote 时推进测试失败。
