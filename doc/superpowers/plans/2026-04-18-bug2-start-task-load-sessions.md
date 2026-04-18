# Bug2 — "已保存任务 → 开始" 后活跃会话列表需手动刷新

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `handleStartFromTask` 在 `createSession` 成功后立即 `loadSessions()`，让 `startSession` 的 dryRun 不再阻塞 UI 反馈；`startSession` 成功后再刷一次以反映 `running` 状态。

**Architecture:** 对齐 `handleCreateOrUpdateTask` 已有的 "立即 loadSessions + 后台 IIFE 执行 startSession" 模式，消除点击 "开始" 后 N 秒空窗期。

**Tech Stack:** React、TypeScript、vitest

---

## File Structure

- 修改：`src/renderer/pages/BooruBulkDownloadPage.tsx:224-248`

---

### Task 1: 改写 handleStartFromTask

**Files:**
- Modify: `src/renderer/pages/BooruBulkDownloadPage.tsx:224-248`

- [ ] **Step 1: 替换整个函数**

把 `src/renderer/pages/BooruBulkDownloadPage.tsx:224-248` 的 `handleStartFromTask` 替换为：

```tsx
  // 从已保存的任务创建会话
  const handleStartFromTask = async (task: BulkDownloadTask) => {
    try {
      if (!window.electronAPI) return;

      const sessionResult = await window.electronAPI.bulkDownload.createSession(task.id);
      if (!sessionResult.success || !sessionResult.data) {
        message.error('创建会话失败: ' + (sessionResult.error || '未知错误'));
        return;
      }

      const sessionId = sessionResult.data.id;
      message.success('会话创建成功，开始下载...');

      // ① 立即刷新一次，让 pending 状态的新会话卡片先出现，避免 dryRun 阻塞期间的空窗
      loadSessions();

      // ② startSession 内部要跑 dryRun，可能阻塞数秒；
      //   放到后台 IIFE，不阻塞 UI 事件处理函数
      (async () => {
        try {
          const startResult = await window.electronAPI!.bulkDownload.startSession(sessionId);
          if (!startResult.success) {
            message.error('启动下载失败: ' + (startResult.error || '未知错误'));
            return;
          }
          // ③ 成功后再刷一次，反映 running 状态
          loadSessions();
        } catch (err) {
          console.error('启动下载失败:', err);
          message.error('启动下载失败');
        }
      })();
    } catch (error) {
      console.error('启动任务失败:', error);
      message.error('启动任务失败');
    }
  };
```

改动要点：
- `createSession` 成功 → `message.success` → `loadSessions()` 同步先跑
- `startSession` 丢进后台 IIFE，IIFE 内再 `loadSessions()`
- 外层事件处理函数立刻返回，UI 不再卡在 dryRun

---

### Task 2: 回归验证

**Files:** —

- [ ] **Step 1: 跑相关测试**

Run: `npx vitest run tests/renderer/pages/BooruBulkDownloadPage.test.tsx --config vitest.config.ts`

Expected: 全部 PASS。若 test mock 的是 `loadSessions` 调用次数，确认断言已经期望 2 次（或改成 `toHaveBeenCalled` 不定次数）。

- [ ] **Step 2: TS 编译**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: 无错误。

- [ ] **Step 3: 人工验证**

`npm run dev` → Booru → 批量下载 → 已保存的任务 Tab → 任选一条点 "开始"：
- 不到 1 秒内上方活跃会话 Tab 就出现新卡片（状态应为 `pending` 或 `dryRun`）
- 数秒后状态转为 `running`（不需要用户手动点刷新）
- `handleCreateOrUpdateTask`（"新建任务→开始"）行为保持不变

---

### Task 3: 归档 + 提交

**Files:** —

- [ ] **Step 1: 归档**

```bash
git mv bug2.md doc/done/bug2-start-task-load-sessions.md
```

- [ ] **Step 2: 提交**

```bash
git add src/renderer/pages/BooruBulkDownloadPage.tsx doc/done/bug2-start-task-load-sessions.md
git commit -m "fix(bug2): 已保存任务开始后立即刷新活跃会话

$(cat <<'EOF'
原 handleStartFromTask 对 startSession 用了 await，而 startSession
内部要跑 dryRun 扫描全部页面，会阻塞数秒。这段时间内 loadSessions
不会被调用，新会话虽然已在 DB（pending），但 UI 上看不到，用户
误以为点击没反应。

对齐 handleCreateOrUpdateTask 的模式：
- createSession 成功后立即 loadSessions（让 pending 卡片先出现）
- startSession 丢进后台 IIFE，成功后再 loadSessions（反映 running）
- 外层事件处理函数立刻返回，UI 无空窗期
EOF
)"
```

Expected: commit 成功。

---

## Self-Review Checklist

- [x] Spec §批 A A5 "createSession 后立即 loadSessions、startSession 后台 IIFE" 完成。
- [x] 与 `handleCreateOrUpdateTask` 已有模式一致。
- [x] 错误处理双侧都保留（外层 + IIFE）。
- [x] 无占位符。
