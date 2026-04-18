# Bug 5: 收藏标签对已完成的下载再次点击"下载"时被误判为"任务已存在"

## 现象

在"标签管理 → 收藏标签"列表里，对一个下载状态已经是 **已完成** 的收藏标签再次点击"下载"按钮：

- 前端弹出 `message.info('任务已存在')`。
- 实际上没有启动新的下载会话，下载状态也不会刷新。

## 预期行为

判定"任务已存在"应该以**是否还有活跃会话**为准：

- 已有 **等待中 / 扫描中(dryRun) / 下载中 / 暂停** 等活跃会话 → 提示"任务已存在"，不重复启动。
- 之前的会话都已经处于终态（**已完成 / 失败 / 取消 / 全部跳过**）→ 应当复用任务记录，**创建并启动一个新会话**（即重启下载）。

## 代码定位

### 前端触发点

[FavoriteTagsPage.tsx:557-574](src/renderer/pages/FavoriteTagsPage.tsx#L557-L574) `triggerDownload`：

```ts
const result = await window.electronAPI.booru.startFavoriteTagBulkDownload(favoriteTagId);
if (result.success && result.data) {
  if (result.data.deduplicated) {
    message.info(t('favoriteTags.downloadTaskExists'));   // ← 误报"任务已存在"
  } else {
    message.success(t('favoriteTags.downloadTaskCreated'));
  }
  await loadFavoriteTags();
}
```

文案 `favoriteTags.downloadTaskExists = '任务已存在'`：[zh-CN.ts:245](src/renderer/locales/zh-CN.ts#L245)。

### 主进程判定链

1. [booruService.ts:2262-2346](src/main/services/booruService.ts#L2262-L2346) `startFavoriteTagBulkDownload`：

   ```ts
   const taskResult = await bulkDownloadService.createBulkDownloadTask({
     siteId, path: binding.downloadPath, tags: resolvedTags, ...
   });
   // ...
   if (taskResult.data.deduplicated) {
     console.log('[booruService] 任务已存在，跳过会话创建:', taskId);
     return { taskId, sessionId: '', deduplicated: true };   // ← 直接短路，不再创建/启动会话
   }
   const sessionResult = await bulkDownloadService.createBulkDownloadSession(taskId);
   // ... 然后 startBulkDownloadSession
   ```

2. [bulkDownloadService.ts:135-170](src/main/services/bulkDownloadService.ts#L135-L170) `createBulkDownloadTask` 的去重：

   ```ts
   // 去重检查：相同下载路径 + 标签集合视为同一任务
   const existing = await get<any>(db, `
     SELECT * FROM bulk_download_tasks WHERE path = ? AND tags = ? ORDER BY createdAt DESC LIMIT 1
   `, [options.path, normalizedTags]);

   if (existing) {
     // ... 返回 deduplicated: true
   }
   ```

### 根因

`createBulkDownloadTask` 的去重键是 `path + normalizedTags`，命中的是 **bulk_download_tasks**（任务模板），**不是 bulk_download_sessions**（会话）。

也就是说：只要**历史上**为这套 path+tags 创建过任务（不管对应的会话现在是不是已经跑完了），再次触发就会被标记为 `deduplicated: true`。

而 `startFavoriteTagBulkDownload` 在上游拿到 `deduplicated: true` 后，**直接短路**返回（[booruService.ts:2343-2346](src/main/services/booruService.ts#L2343-L2346)），跳过了后续的 `createBulkDownloadSession` 和 `startBulkDownloadSession`。结果就是：

- 任务行已存在 → "deduplicated" → 直接告诉前端"任务已存在"，但**根本没有检查是否有活跃会话**。
- 对已完成、失败、取消的历史会话来说，这等同于"无法重新下载"。

这里的核心概念混淆是：**"任务模板去重"（不重复插入同一套配置）** 和 **"下载去重"（不重复跑同一个下载）** 被合并成了同一个判定。

### 旁证：批量下载主页面不受此 Bug 影响

- [BooruBulkDownloadPage.tsx:224-248](src/renderer/pages/BooruBulkDownloadPage.tsx#L224-L248) 的 `handleStartFromTask`：**无条件**对已保存的任务再 `createSession + startSession`，不看 `deduplicated`。所以从"已保存的任务"列表点"开始"能正常重启。
- [BooruBulkDownloadPage.tsx:163-185](src/renderer/pages/BooruBulkDownloadPage.tsx#L163-L185) 的"新建任务"路径：对 `deduplicated` 做特殊处理，只是为了避免同一配置创建重复任务模板行——语义正确。

问题只出在 `startFavoriteTagBulkDownload` 里，把"任务模板已存在"当成"下载已经在进行中"。

## 建议修复方向

推荐在 [booruService.ts:2343-2346](src/main/services/booruService.ts#L2343-L2346) 处分流：拿到 `deduplicated=true` 时，先查询是否存在该任务的**活跃会话**，只有有活跃会话才返回 deduplicated，否则继续创建 + 启动新会话。

伪代码：

```ts
if (taskResult.data.deduplicated) {
  // 查询该任务当前是否有活跃会话
  const hasActive = await bulkDownloadService.hasActiveSessionForTask(taskId);
  // 活跃状态 = pending | dryRun | running | paused
  if (hasActive) {
    console.log('[booruService] 任务存在活跃会话，跳过重启:', taskId);
    return { taskId, sessionId: '', deduplicated: true };
  }
  console.log('[booruService] 任务已存在但无活跃会话，重启新会话:', taskId);
  // fallthrough：继续走下面的 createBulkDownloadSession + startBulkDownloadSession
}
```

需要配套在 `bulkDownloadService` 暴露一个查询：

```ts
export async function hasActiveSessionForTask(taskId: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await get<{ n: number }>(db, `
    SELECT COUNT(*) AS n FROM bulk_download_sessions
    WHERE taskId = ? AND deletedAt IS NULL
      AND status IN ('pending', 'dryRun', 'running', 'paused')
  `, [taskId]);
  return (row?.n ?? 0) > 0;
}
```

注意点：

- 活跃状态集合要与 [BooruBulkDownloadPage.tsx:102-116](src/renderer/pages/BooruBulkDownloadPage.tsx#L102-L116) 前端 `activeSessions` 的判定保持一致（`pending / dryRun / running / paused`）。
- 当走"重启"分支时，要补齐 `updateFavoriteTagDownloadBindingSnapshot`（如 `lastSessionId` / `lastStartedAt` / `lastStatus`）的更新链，保证 UI 上的"上次下载状态"字段正确刷新——现有代码在 [booruService.ts:2358-2375](src/main/services/booruService.ts#L2358-L2375) 已经有完整链路，只需让 deduplicated 分支正常 fallthrough 即可复用。
- 前端的 `message.info('任务已存在')` 文案保持不变，但只会在"真的有活跃会话"的情况下触发。可以考虑在成功重启时追加一个不同的成功文案（例如"已重新开始下载"）用于与首次下载区分，属于增强项非必须。

## 影响

- 功能性缺陷：已完成的收藏标签无法从 UI 发起"再下载/增量下载"，用户被迫绕到"批量下载 → 已保存的任务"手动点开始（且由于 [bug2](bug2.md) 那边还有刷新问题，体验更差）。
- 语义混乱：前端"任务已存在"提示让用户误以为当前还有活跃下载正在跑，可能等半天也看不到进度。
- 与交互描述不符：收藏标签的"下载按钮"本意是"触发一次下载"，不是"创建任务模板"。
