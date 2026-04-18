# Bug 2: 批量下载"开始"已保存任务后，活跃会话列表要手动刷新

## 现象

批量下载页面的"已保存的任务"列表中点击某条任务的 **开始** 按钮后：

- 会话实际上**已经创建并开始运行**（后端 DB 已有该会话，且状态从 `pending` 过渡到 `dryRun` / `running`）。
- 但页面上方的"活跃会话"Tab **长时间不更新**，看不到新会话卡片。
- 用户必须手动点击右上角的 **刷新** 按钮，才能看到新会话。

## 预期行为

点击 **开始** 后，"活跃会话"Tab 应在很短时间内显示新会话（至少先以 `pending` 状态卡片占位），而不是等用户手动刷新。

## 代码定位

核心文件：[src/renderer/pages/BooruBulkDownloadPage.tsx](src/renderer/pages/BooruBulkDownloadPage.tsx)

### 触发点

- [BooruBulkDownloadPage.tsx:224-248](src/renderer/pages/BooruBulkDownloadPage.tsx#L224-L248) `handleStartFromTask`：点击"已保存的任务"的 **开始** 按钮后执行。

  简化流程：

  ```ts
  const sessionResult = await bulkDownload.createSession(task.id);   // ① 创建会话
  // ...
  const startResult   = await bulkDownload.startSession(sessionId);  // ② 启动（含 dryRun）
  // ...
  loadSessions();                                                    // ③ 拉取活跃会话
  ```

### 根因：`startSession` 会阻塞 UI 反馈

- `createBulkDownloadSession` 会**同步**把会话写入 `bulk_download_sessions` 表，状态初始为 `pending`（[bulkDownloadService.ts:392-434](src/main/services/bulkDownloadService.ts#L392-L434)），此时新会话已经能被 [getActiveBulkDownloadSessions](src/main/services/bulkDownloadService.ts#L442-L501) 查到。
- 但 `startBulkDownloadSession` 并**不是**"启动一下立刻返回"：它要先把状态改成 `dryRun`，然后执行 `performDryRun`（扫描全部页面并写入记录），之后才会更新为 `running` 并返回成功（[bulkDownloadService.ts:870-997](src/main/services/bulkDownloadService.ts#L870-L997)）。
- `handleStartFromTask` 对 `startSession` 用了 `await`，所以在整个 dryRun 完成之前 JS 事件处理函数不会继续执行——`loadSessions()` 要等 N 秒才会被调用。

结果是：

- T=0：用户点击"开始"，会话已经是 `pending` 状态并入库。
- T=0 ~ N：`startSession` 阻塞在 `await`（dryRun 中），UI 完全没有"活跃会话刷新"动作。
- T=N：`startSession` 返回成功，`loadSessions()` 才被调用，会话终于出现在列表里。

在这段 T=0 ~ T=N 的时间内，如果用户手动点击 **刷新**（[BooruBulkDownloadPage.tsx:275-277](src/renderer/pages/BooruBulkDownloadPage.tsx#L275-L277) 的 `handleRefresh`），会立刻跑一次 `loadSessions`，把此时处于 `pending` / `dryRun` 的会话拿回来——这就是"需要手动点击刷新才会显示"的表现。

### 对照：新建任务路径没有这个问题

[BooruBulkDownloadPage.tsx:187-215](src/renderer/pages/BooruBulkDownloadPage.tsx#L187-L215) 的 `handleCreateOrUpdateTask` 走的是另一条路径——它把"创建会话 + 启动 + `loadSessions`"整个放进一个**后台 IIFE**：

```ts
(async () => {
  const sessionResult = await bulkDownload.createSession(newTaskId);
  // ...
  const startResult = await bulkDownload.startSession(sessionId);
  // ...
  loadSessions();
})();
```

虽然这条路径里 `loadSessions` 的调用时机也是在 `startSession` 完成之后（同样会经历 dryRun 的阻塞），但因为**外层事件处理函数不等待**这个 IIFE，所以主 UI 还能做别的事（如关闭创建对话框、展示 `message.success`）。而且这条路径多数情况下会再经历一个"对话框收起 / 列表淡入"的交互过渡，用户视觉上不会感到断层。

"已保存任务 → 开始" 这条路径既没有拆分到后台，也没有中间 UI 反馈，空窗期直接显现出来。

## 建议修复方向

推荐选项（从小到大）：

1. **最小改动**：在 [BooruBulkDownloadPage.tsx:232](src/renderer/pages/BooruBulkDownloadPage.tsx#L232) 也就是 `createSession` 成功之后、`startSession` 之前，**立刻调用一次 `loadSessions()`**，让 `pending` 状态的会话卡片先出现；`startSession` 成功后再刷一次以反映 `running` 状态。

   ```ts
   const sessionResult = await bulkDownload.createSession(task.id);
   if (!sessionResult.success || !sessionResult.data) { ... }
   const sessionId = sessionResult.data.id;
   message.success('会话创建成功，开始下载...');
   loadSessions();                                  // ← 先让新卡片出现
   const startResult = await bulkDownload.startSession(sessionId);
   if (!startResult.success) { ... }
   loadSessions();                                  // 再同步一次新状态
   ```

2. **对齐另一条路径的写法**：把 `startSession` 放进后台 IIFE，像 `handleCreateOrUpdateTask` 那样：

   ```ts
   const sessionResult = await bulkDownload.createSession(task.id);
   // ... 错误处理
   const sessionId = sessionResult.data.id;
   message.success('会话创建成功，开始下载...');
   loadSessions();
   (async () => {
     const startResult = await bulkDownload.startSession(sessionId);
     if (!startResult.success) { message.error(...); return; }
     loadSessions();
   })();
   ```

3. **更彻底**：给批量下载会话状态变化加 IPC 事件（类似 [`onBulkDownloadRecordStatus`](src/renderer/components/BulkDownloadSessionDetail.tsx#L140-L169) 那样的会话级事件），前端订阅状态变更后主动 `setSessions`，不再完全依赖轮询 + `loadSessions` 触发。

## 影响

- 交互反馈差：用户点击"开始"后几秒内以为没反应，甚至会重复点击。
- 与"创建新任务 → 开始"路径行为不一致，容易让人以为"从已保存任务启动"存在问题。
- 轮询相关的 `useEffect`（[BooruBulkDownloadPage.tsx:119-144](src/renderer/pages/BooruBulkDownloadPage.tsx#L119-L144)）依赖 `activeSessions.length`，空窗期内 `activeSessions.length` 一直是 0，定时刷新也不会被启动——必须等第一次 `loadSessions` 拿到新会话后，轮询才会接管。
