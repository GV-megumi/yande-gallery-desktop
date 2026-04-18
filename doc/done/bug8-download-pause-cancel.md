# Bug 8: 下载管理暂停误判失败 & 缺单条取消入口

## 现象

### 问题 1：暂停单条下载会被误标记成"失败"

在下载管理页面的"进行中"列表里点击某条下载的 **暂停** 按钮后：

- 该条记录偶发从"进行中"Tab 消失，跑到了"失败"Tab，errorMessage 为 `ECONNRESET` / `socket hang up` 之类的网络错误串。
- 用户感知上：明明是自己点暂停，却被系统归类为"下载失败"。

### 问题 2："进行中"列表没有单条取消入口

进行中的下载，用户只有 **暂停 / 恢复** 两个操作；想彻底放弃一条未完成的下载、让它从队列中消失并清理临时文件，没有 UI 入口，只能手动停掉程序或等待超时。

## 根因

### 问题 1：`handleDownloadError` 用字符串匹配识别用户中止

[src/main/services/downloadManager.ts](src/main/services/downloadManager.ts) 原 `handleDownloadError` 判断分支为：

```ts
private isAbortError(errorMessage: string): boolean {
  return errorMessage.includes('aborted') || errorMessage.includes('AbortError');
}

private async handleDownloadError(queueId: number, errorMessage: string) {
  this.activeDownloads.delete(queueId);

  const interruptedStatus = this.userInterruptedStatuses.get(queueId);
  if (interruptedStatus && this.isAbortError(errorMessage)) {
    this.userInterruptedStatuses.delete(queueId);
    this.processQueue();
    return;
  }

  this.userInterruptedStatuses.delete(queueId);
  await booruService.updateDownloadStatus(queueId, 'failed', errorMessage);
  // ...
}
```

问题：`AbortController.abort()` 在 `axios` + node stream 场景下抛出的错误串并不总是包含 `aborted` / `AbortError`。随着 node / axios 版本和传输层状态不同，可能出现：

- `ECONNRESET`
- `socket hang up`
- `read ECONNRESET`
- `Request failed with status code 0`

等情况。此时 `isAbortError('ECONNRESET: socket hang up') === false`，尽管 `userInterruptedStatuses.get(queueId) === 'paused'` 已标记，判断仍走 else 分支，把 DB 覆盖成 `failed` + 错误串。

### 问题 2：缺单条取消入口

`downloadManager` 只暴露 `pauseDownload` / `resumeDownload` / `retryDownload`，没有 `cancelDownload`；preload / IPC / UI 同样缺失。

## 修复

### 修复 1：`handleDownloadError` 只看 `userInterruptedStatuses`

用户主动暂停 / 取消的 DB 状态由 `pauseDownload` / `cancelDownload` 自己写入。错误分支只需要：
- 清掉内部 `activeDownloads` 状态；
- 看 `userInterruptedStatuses.get(queueId)` 是否有值，有就直接 return，不覆盖 DB；
- 否则才写 failed。

一并删除 `isAbortError` 方法（不再需要字符串匹配）。

### 修复 2：新增 `cancelDownload(queueId)` + 链路

`downloadManager.cancelDownload(queueId)`：
- 若任务在 `activeDownloads`：标记 `userInterruptedStatuses` 为 `cancelled` → `cancelToken.abort()` → 清 `.part` 临时文件（best-effort）；
- 不论是否活跃，统一写 DB 状态为 `cancelled` 并广播；
- 最后 `processQueue()` 继续调度。

链路补全：
- `IPC_CHANNELS.BOORU_CANCEL_DOWNLOAD` 通道常量；
- `ipcMain.handle` handler；
- preload `createBooruApi` 导出 `cancelDownload`；
- `ElectronAPI` 类型声明追加 `cancelDownload`；
- `BooruDownloadPage` 操作列为每行（`pending / downloading / paused` 都有）追加 `Popconfirm` 包装的 "取消/删除" 按钮，触发 `handleCancelDownload` → `window.electronAPI.booru.cancelDownload(queueId)` → `loadQueue` 刷新。

## 测试

### 反模式守卫测试（先 FAIL，修复后 PASS）

[tests/main/services/downloadManager.state.test.ts](tests/main/services/downloadManager.state.test.ts) 新增：

```ts
it('handleDownloadError: 用户暂停后，即使错误串不含 aborted 也不应覆盖为 failed', async () => {
  // ...
  await downloadManager.pauseDownload(21);
  updateDownloadStatus.mockClear();
  await downloadManager.handleDownloadError(21, 'ECONNRESET: socket hang up');
  expect(updateDownloadStatus).not.toHaveBeenCalledWith(21, 'failed', expect.anything());
});
```

在移除 `isAbortError` 之前跑这条测试会 FAIL（错误串不含 aborted，旧逻辑走 else 分支覆盖 failed）；移除后 PASS。

### 正向新行为测试

- `cancelDownload` 对活跃下载：标记 cancelled、abort、清 activeDownloads、清 `.part`、写 DB、触发 processQueue；
- `cancelDownload` 对 paused/pending：直接写 DB；
- `cancelDownload` 之后再来 abort 错误，`handleDownloadError` 不再覆盖 DB。

### 前端测试

[tests/renderer/pages/BooruDownloadPage.test.tsx](tests/renderer/pages/BooruDownloadPage.test.tsx) 改写为：
- 进行中行应同时渲染 "暂停下载" 和 "取消下载" 按钮；
- 已暂停行应同时渲染 "恢复下载" 和 "取消下载" 按钮，点 "取消下载" 弹 Popconfirm，点 "确认取消" 走 `cancelDownload(202)`。

## 相关文件

- src/main/services/downloadManager.ts
- src/main/ipc/channels.ts
- src/main/ipc/handlers.ts
- src/preload/shared/createBooruApi.ts
- src/preload/index.ts
- src/renderer/pages/BooruDownloadPage.tsx
- tests/main/services/downloadManager.state.test.ts
- tests/main/ipc/channels.test.ts
- tests/renderer/pages/BooruDownloadPage.test.tsx
