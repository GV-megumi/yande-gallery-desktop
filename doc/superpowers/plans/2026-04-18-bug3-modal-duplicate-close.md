# Bug3 — 批量下载详情弹窗关闭按钮与 X 重复

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `BulkDownloadSessionDetail` 顶部工具栏删除自绘的 "关闭" 按钮，只保留 Antd Modal 自带的右上角 X。

**Architecture:** 保持仓库内其它 Modal 的一致性（全部走 Modal 自带关闭）。`onClose` prop 暂保留，因为其它地方（如重试成功后回调）仍可能复用。

**Tech Stack:** React、Ant Design、vitest

---

## File Structure

- 修改：`src/renderer/components/BulkDownloadSessionDetail.tsx:377`（删一行）

---

### Task 1: 删除自绘关闭按钮

**Files:**
- Modify: `src/renderer/components/BulkDownloadSessionDetail.tsx:368-378`

- [ ] **Step 1: 替换 Space 块**

把 `src/renderer/components/BulkDownloadSessionDetail.tsx:368-378` 的右侧 Space 块：

```tsx
        <Space>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={() => loadRecords(false, true)} 
            loading={loading}
            title="刷新并自动修复状态不一致的记录"
          >
            刷新
          </Button>
          <Button onClick={onClose}>关闭</Button>
        </Space>
```

替换为：

```tsx
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => loadRecords(false, true)}
            loading={loading}
            title="刷新并自动修复状态不一致的记录"
          >
            刷新
          </Button>
        </Space>
```

（删除 `<Button onClick={onClose}>关闭</Button>` 这一行）

---

### Task 2: 回归验证

**Files:** —

- [ ] **Step 1: 跑相关测试**

Run: `npx vitest run tests/renderer/pages/BooruBulkDownloadPage.test.tsx --config vitest.config.ts`

Expected: PASS。若某条测试断言 "关闭" 文本存在，更新测试把它指向 Modal 自带的 close icon 或 removed 断言。

- [ ] **Step 2: 人工验证**

`npm run dev` → Booru → 批量下载 → 打开任一会话卡片的 "查看详情" → 确认：
- 弹窗右上角只有 Antd 默认的 X 图标
- 内容区顶部只剩一个 "刷新" 按钮，没有 "关闭" 按钮
- 点 X 能关闭弹窗

---

### Task 3: 归档 + 提交

**Files:** —

- [ ] **Step 1: 归档**

```bash
git mv bug3.md doc/done/bug3-modal-duplicate-close.md
```

- [ ] **Step 2: 提交**

```bash
git add src/renderer/components/BulkDownloadSessionDetail.tsx doc/done/bug3-modal-duplicate-close.md
git commit -m "fix(bug3): 下载详情弹窗去掉重复的关闭按钮

$(cat <<'EOF'
Modal 已经渲染右上角 X（closable 默认 true），内容区再绘一个"关闭"按钮
和 X 完全同效、交互重复。删除自绘按钮，保持与仓库其它 Modal 一致的
关闭语义。onClose prop 保留给未来重试等回调复用。
EOF
)"
```

Expected: commit 成功。

---

## Self-Review Checklist

- [x] Spec §批 A A3 要求 "删自绘关闭按钮" 完成。
- [x] 未动 `onClose` prop，保持向后兼容。
- [x] 无占位符。
