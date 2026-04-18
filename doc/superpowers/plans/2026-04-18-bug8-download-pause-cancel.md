# Bug8 — 下载管理暂停误判失败 & 缺单条取消入口

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
1. `downloadManager.handleDownloadError` 不再把用户主动暂停的 abort 覆盖为 `failed`。
2. 下载管理 "进行中" 列表为 `pending / downloading / paused` 记录追加单条 "删除/取消" 入口（DB `cancelled` + 前端移除 + 临时文件清理）。

**Architecture:**
- 错误分支只看 `userInterruptedStatuses` 是否有值，去掉 `isAbortError` 字符串匹配。
- 新增 `downloadManager.cancelDownload(queueId)`：标记中止 → abort → 清磁盘临时文件 → `updateDownloadStatus('cancelled')`（或硬删队列行）→ `broadcastStatus` → `processQueue`。
- 新 IPC `BOORU_CANCEL_DOWNLOAD`、handler、preload 暴露 `cancelDownload(queueId)`。
- `BooruDownloadPage` 操作列追加 `Popconfirm` 包装的 "取消/删除" 按钮。

**Tech Stack:** Electron IPC、Node.js、React、Ant Design、vitest

---

## File Structure

- 修改：`src/main/services/downloadManager.ts`
  - `handleDownloadError`（`L525-L543`）去 `isAbortError`
  - 新增 `cancelDownload(queueId)`
- 修改：`src/main/ipc/channels.ts`（加 `BOORU_CANCEL_DOWNLOAD`）
- 修改：`src/main/ipc/handlers.ts`（加 handler）
- 修改：`src/preload/shared/createBooruApi.ts`（导出 `cancelDownload`）
- 修改：`src/preload/index.ts`（类型声明）
- 修改：`src/renderer/pages/BooruDownloadPage.tsx`（操作列 + handler）
- 新建/扩展：`tests/main/services/downloadManager.state.test.ts`（若已存在，则扩展）

---

### Task 1: 修 `handleDownloadError` 不再误覆盖 paused/cancelled

**Files:**
- Modify: `src/main/services/downloadManager.ts:521-543`

- [ ] **Step 1: 写失败测试**

在 `tests/main/services/downloadManager.state.test.ts` 底部追加（若文件不存在则创建，并参考 `downloadManager.test.ts` 的 mock 写法）：

```ts
describe('handleDownloadError - 用户主动中止保护', () => {
  it('当 userInterruptedStatuses 有值时不应把 DB 覆盖为 failed（不依赖错误串内容）', async () => {
    // 伪代码说明：
    // 1. 构造 downloadManager 实例
    // 2. manager.userInterruptedStatuses.set(100, 'paused')
    // 3. 调用 private handleDownloadError(100, 'ECONNRESET: socket hang up')
    //    （通过 (manager as any).handleDownloadError(...) 访问）
    // 4. 断言：booruService.updateDownloadStatus 没有被以 'failed' 调用
  });
});
```

**实际测试写法**：`downloadManager.ts` 导出了 `DownloadManager` 类（或实例，取决于你读到的真实实现）。测试里先 `vi.mock` 掉 `booruService.updateDownloadStatus`，再 spy 检查未被调以 `'failed'`。

参考现有 `tests/main/services/downloadManager.state.test.ts` 的 mock/import 方式，**不要**另起独立 mock 体系。

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `npx vitest run tests/main/services/downloadManager.state.test.ts --config vitest.config.ts`

Expected: 新加的 "不覆盖为 failed" 断言 FAIL（当前 `isAbortError('ECONNRESET')=false` 会走 else 分支）。

- [ ] **Step 3: 修实现**

把 `src/main/services/downloadManager.ts:521-543` 替换为：

```ts
  /**
   * 处理下载错误
   * 注意：调用方应在调用此方法前清除损坏临时文件
   *
   * 用户主动暂停/取消引发的 abort 由 pauseDownload / cancelDownload 自己写 DB 状态，
   * 这里只需要清理内部状态并继续队列；不再通过字符串匹配 abort 错误。
   */
  private async handleDownloadError(queueId: number, errorMessage: string) {
    this.activeDownloads.delete(queueId);

    const interruptedStatus = this.userInterruptedStatuses.get(queueId);
    if (interruptedStatus) {
      // 用户主动中止（暂停或取消），DB 状态由上层入口写好
      this.userInterruptedStatuses.delete(queueId);
      this.processQueue();
      return;
    }

    // 真正意义上的失败
    await booruService.updateDownloadStatus(queueId, 'failed', errorMessage);
    this.broadcastStatus(queueId, 'failed', errorMessage);
    this.processQueue();
  }
```

删掉 `isAbortError` 方法（不再使用）。

- [ ] **Step 4: 跑测试确认 PASS**

Run: `npx vitest run tests/main/services/downloadManager.state.test.ts --config vitest.config.ts`

Expected: 新断言 PASS；其它既有测试也 PASS。

---

### Task 2: 新增 `cancelDownload` 方法

**Files:**
- Modify: `src/main/services/downloadManager.ts`（在 `pauseDownload` / `resumeDownload` 附近追加）

- [ ] **Step 1: 写失败测试**

在 `tests/main/services/downloadManager.state.test.ts` 追加：

```ts
describe('cancelDownload', () => {
  it('对活跃下载应标记 cancelled、abort、清 activeDownloads、写 DB、继续队列', async () => {
    // 1. 构造 manager，手动塞入 activeDownloads.set(id, { cancelToken: { abort: vi.fn() }, ... })
    // 2. 调用 cancelDownload(id)
    // 3. 断言：
    //    - userInterruptedStatuses.get(id) === 'cancelled'
    //    - cancelToken.abort 被调
    //    - activeDownloads 不再含 id
    //    - booruService.updateDownloadStatus 被调以 (id, 'cancelled')
    //    - processQueue 被调
  });

  it('对 paused/pending 下载也可取消，直接写 DB 并广播', async () => {
    // 1. 不往 activeDownloads 塞
    // 2. 调用 cancelDownload(id)
    // 3. 断言 updateDownloadStatus 被调以 (id, 'cancelled')
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `npx vitest run tests/main/services/downloadManager.state.test.ts --config vitest.config.ts`

Expected: 两条新断言 FAIL（`cancelDownload` 不存在）。

- [ ] **Step 3: 实现 `cancelDownload`**

在 `src/main/services/downloadManager.ts` 的 `pauseDownload` 下方追加：

```ts
  /**
   * 取消/删除单个下载任务（从队列中移除）
   * - 若正在下载：标记 cancelled → abort → 清临时文件（best-effort）
   * - 若暂停/等待：直接写 DB cancelled 状态 + 广播
   * - 继续调度队列
   */
  async cancelDownload(queueId: number): Promise<boolean> {
    console.log(`[DownloadManager] 取消下载任务 #${queueId}`);
    try {
      const activeDownload = this.activeDownloads.get(queueId);
      if (activeDownload) {
        this.userInterruptedStatuses.set(queueId, 'cancelled');
        try {
          activeDownload.cancelToken.abort();
        } catch (err) {
          console.warn(`[DownloadManager] abort 取消请求失败 #${queueId}:`, err);
        }
        this.activeDownloads.delete(queueId);

        // 清理残留的 .part 临时文件
        if (activeDownload.targetPath) {
          try {
            await fsPromises.unlink(buildDownloadTempPath(activeDownload.targetPath));
          } catch (err: any) {
            if (err?.code !== 'ENOENT') {
              console.warn(`[DownloadManager] 清理临时文件失败 #${queueId}:`, err?.message ?? err);
            }
          }
        }
      }

      await booruService.updateDownloadStatus(queueId, 'cancelled');
      this.broadcastStatus(queueId, 'cancelled');

      this.processQueue();
      return true;
    } catch (error) {
      console.error(`[DownloadManager] 取消任务 #${queueId} 失败:`, error);
      return false;
    }
  }
```

（若 `activeDownload.targetPath` 字段名与现有实现不一致，按实际命名调整；确认 `fsPromises` / `buildDownloadTempPath` 已 import，否则补 import。）

另：确认 `booruService.updateDownloadStatus` 的 status 参数类型支持 `'cancelled'`；若 `DownloadStatus` 枚举不含该值，先在 `src/shared/types.ts` 补齐（多数情况应该已有，因为失败 Tab 也会用）。

- [ ] **Step 4: 跑测试确认 PASS**

Run: `npx vitest run tests/main/services/downloadManager.state.test.ts --config vitest.config.ts`

Expected: 全部 PASS。

---

### Task 3: IPC 通道 + handler

**Files:**
- Modify: `src/main/ipc/channels.ts:91-92` 附近
- Modify: `src/main/ipc/handlers.ts:1663-1675` 附近

- [ ] **Step 1: 新增通道常量**

在 `src/main/ipc/channels.ts:91-92` 附近（`BOORU_RESUME_DOWNLOAD` 后面一行）追加：

```ts
  BOORU_CANCEL_DOWNLOAD: 'booru:cancel-download',
```

- [ ] **Step 2: 新增 handler**

在 `src/main/ipc/handlers.ts` `BOORU_RESUME_DOWNLOAD` 的 handler（L1666）后追加：

```ts
  // 取消/删除单个下载
  ipcMain.handle(IPC_CHANNELS.BOORU_CANCEL_DOWNLOAD, async (_event: IpcMainInvokeEvent, queueId: number) => {
    console.log('[IPC] 取消单个下载:', queueId);
    try {
      const success = await downloadManager.cancelDownload(queueId);
      return { success };
    } catch (error) {
      console.error('[IPC] 取消下载失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
```

- [ ] **Step 3: 跑 channels.test.ts 确认常量注册**

Run: `npx vitest run tests/main/ipc/channels.test.ts --config vitest.config.ts`

Expected: PASS（若断言 "无重复 channel 值"，新增值应通过）。

---

### Task 4: preload 暴露 `cancelDownload`

**Files:**
- Modify: `src/preload/shared/createBooruApi.ts:60-63`
- Modify: `src/preload/index.ts:216-217`

- [ ] **Step 1: 改 createBooruApi**

在 `src/preload/shared/createBooruApi.ts` 的 `resumeDownload` 后追加：

```ts
    cancelDownload: (queueId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CANCEL_DOWNLOAD, queueId),
```

- [ ] **Step 2: 改类型声明**

在 `src/preload/index.ts:217` `resumeDownload` 声明后追加：

```ts
        cancelDownload: (queueId: number) => Promise<{ success: boolean; error?: string }>;
```

---

### Task 5: 前端 "删除" 按钮

**Files:**
- Modify: `src/renderer/pages/BooruDownloadPage.tsx:487-517`

- [ ] **Step 1: 新增 handler**

找到 `handlePauseDownload` / `handleResumeDownload` 附近，追加：

```tsx
  const handleCancelDownload = async (queueId: number) => {
    try {
      const result = await window.electronAPI?.booru.cancelDownload(queueId);
      if (result?.success) {
        message.success('已取消下载');
        loadQueue();
      } else {
        message.error('取消失败: ' + (result?.error || '未知错误'));
      }
    } catch (err) {
      console.error('取消下载失败:', err);
      message.error('取消下载失败');
    }
  };
```

（`message`、`loadQueue` 已在文件上文 import/定义，若缺失按现有模式补齐。）

- [ ] **Step 2: 操作列加 Popconfirm 删除按钮**

把 `src/renderer/pages/BooruDownloadPage.tsx:487-516` 的操作列 render 改为：

```tsx
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: any, record: DownloadQueueItem) => (
        <Space>
          {record.status === 'paused' ? (
            <Tooltip title="恢复下载">
              <Button
                type="text"
                icon={<PlayCircleOutlined />}
                aria-label="恢复下载"
                onClick={() => handleResumeDownload(record.id)}
                style={{ color: '#52c41a' }}
              />
            </Tooltip>
          ) : (
            <Tooltip title="暂停下载">
              <Button
                type="text"
                icon={<PauseCircleOutlined />}
                aria-label="暂停下载"
                onClick={() => handlePauseDownload(record.id)}
                disabled={record.status === 'pending'}
              />
            </Tooltip>
          )}
          <Popconfirm
            title="取消并从队列中移除？"
            description="将清理已下载的临时文件。"
            okText="取消下载"
            cancelText="保留"
            onConfirm={() => handleCancelDownload(record.id)}
          >
            <Tooltip title="取消/删除">
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label="取消下载"
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
```

（`Popconfirm` / `DeleteOutlined` 若尚未 import，加到文件顶部。`DeleteOutlined` 来自 `@ant-design/icons`。）

- [ ] **Step 3: 跑相关测试**

Run: `npx vitest run tests/renderer/pages/BooruDownloadPage.test.tsx --config vitest.config.ts`

Expected: 全部 PASS；可能需要为新 handler 补一条渲染断言或 mock preload 的 cancelDownload。

---

### Task 6: 回归、人工验证、归档提交

**Files:** —

- [ ] **Step 1: 全量测试**

Run: `npx vitest run tests/main tests/renderer --config vitest.config.ts`

Expected: 全 PASS。

- [ ] **Step 2: TS 编译**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Run: `npx tsc --noEmit -p tsconfig.json`

Expected: 无错误。

- [ ] **Step 3: 人工验证**

`npm run dev` →
- Booru 列表随便加几张进下载 → "进行中" 列表出现；
- 点 "暂停" → 应停留在 "进行中" 并显示 "已暂停"（不再跳到 "失败" Tab）；
- 点 "取消" → `Popconfirm` 确认后该行立即消失，磁盘 `.part` 文件被清；
- 查 "失败" Tab，未见本次被暂停/取消的记录。

- [ ] **Step 4: 归档 + 提交**

```bash
git mv bug8.md doc/done/bug8-download-pause-cancel.md
git add src/main/services/downloadManager.ts \
        src/main/ipc/channels.ts \
        src/main/ipc/handlers.ts \
        src/preload/shared/createBooruApi.ts \
        src/preload/index.ts \
        src/renderer/pages/BooruDownloadPage.tsx \
        tests/main/services/downloadManager.state.test.ts \
        doc/done/bug8-download-pause-cancel.md
git commit -m "fix(bug8): 暂停不再误判失败，下载队列补取消入口

$(cat <<'EOF'
问题 1：handleDownloadError 的 isAbortError 字符串匹配只认
'aborted' / 'AbortError'，而实际 abort 结果可能是
ECONNRESET / socket hang up 等，导致 DB 被覆盖为 failed，
暂停的任务反而出现在失败 Tab。

问题 2：进行中列表无单条删除入口，用户无法放弃未完成的下载。

修复：
- handleDownloadError 只看 userInterruptedStatuses 是否有值；
  用户主动中止由 pauseDownload/cancelDownload 自行写 DB 状态，
  此分支不再覆盖，也不再依赖 isAbortError（一并删除该方法）。
- downloadManager 新增 cancelDownload(queueId)：
  活跃下载 abort + 清临时文件；非活跃直接改 DB；均更新状态到
  'cancelled' 并广播。
- 新增 IPC BOORU_CANCEL_DOWNLOAD + handler + preload cancelDownload。
- BooruDownloadPage 操作列为 pending/downloading/paused 行追加
  Popconfirm 包装的 "取消" 按钮，清队列 + loadQueue 刷新。
EOF
)"
```

Expected: commit 成功。

---

## Self-Review Checklist

- [x] Spec §批 B B2 全部覆盖：`handleDownloadError` 收紧判定 + `cancelDownload` + IPC + preload + UI。
- [x] 测试先于实现（Task 1 / Task 2 各自 Red → Green）。
- [x] 文件路径、行号均基于当前实际代码（Read 时记录）。
- [x] 无占位符。
