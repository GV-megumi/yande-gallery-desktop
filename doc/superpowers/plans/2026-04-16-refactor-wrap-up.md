# 重构收尾实施计划（Refactor Wrap-Up Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对已签收的重构主体（TP-01 ~ TP-13）在 `feat/refactor-todo-full` 分支执行 5 项尾部收尾事项，消除审查报告第 5 节列出的全部遗留项。

**Architecture:** 每个 TW 任务包独立落地并单独提交，遵循 TDD（先写失败测试 → 最小实现 → 通过 → 提交）。TW-01/02/04 独立并行，TW-03/05 依赖 TW-02 完成。所有变更均在 `.worktrees/refactor-todo-full` 工作树内进行，分支 `feat/refactor-todo-full`。

**Tech Stack:** Electron 28 + React 18 + TypeScript + Vite + Vitest + antd 5

**Spec:** [doc/superpowers/specs/2026-04-16-refactor-wrap-up-design.md](../specs/2026-04-16-refactor-wrap-up-design.md)

**工作目录（所有 `Run:` 命令均在此目录）：** `m:/yande/yande-gallery-desktop/.worktrees/refactor-todo-full`

**Commit message 规范：** 中文描述 + 英文类型前缀 + TW 序号（如 `fix(TW-01): 修复...`）

---

## 文件结构（本轮新增/修改）

| 路径 | 动作 | 任务 | 责任 |
|---|---|---|---|
| `tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx` | 修改 | TW-01 | 稳定化 flaky 用例 |
| `src/renderer/SubWindowApp.tsx` | 修改 | TW-02 | 把 3 个静态导入改为 `React.lazy` + Suspense |
| `vite.config.ts` | 修改 | TW-03 | `manualChunks` 改为函数形式按 antd 子模块拆 |
| `src/renderer/pages/BooruFavoritesPage.tsx` | 修改 | TW-04 | 接入 `useBooruPostActions` |
| `tests/renderer/pages/BooruFavoritesPage.postActions.test.tsx` | 新增 | TW-04 | 页面层集成测试 |
| `src/preload/shared/createWindowApi.ts` | 新增 | TW-05 | 抽取 window 域 API 构造函数 |
| `src/preload/index.ts` | 修改 | TW-05 | 主窗口 preload 复用 `createWindowApi` |
| `src/preload/subwindow-index.ts` | 新增 | TW-05 | 子窗口独立精简 preload |
| `src/main/window.ts` | 修改 | TW-05 | 子窗口指定新 preload 路径 |
| `electron.vite.config.ts` 或 `tsconfig.preload.json` | 可能修改 | TW-05 | 新 preload 入口的构建配置 |
| `tests/preload/subwindow-exposure.test.ts` | 新增 | TW-05 | 验证子窗口 preload 暴露面最小 |

---

# Task 1 (TW-01) · Flaky 测试修复

**审查报告条目：** 5.1

**问题：** `tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx` 第 85 行用例 "编辑保存搜索时应展示站点选择器并将 siteId 一并传给 updateSavedSearch" 第 106 行 `waitFor` 不稳定。探查发现：测试用 real timers，**无 `setTimeout`**，waitFor 无显式 `timeout` 参数。fake timers 不适用（无可快进的定时器）。根因是 React 批量更新 + mock resolve + 事件循环多回合。

**Files:**
- Modify: `tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx`

- [ ] **Step 1: 先复现 flaky**

Run: `npx vitest run tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx -t "编辑保存搜索时应展示站点选择器" --reporter=verbose`
Expected: 该用例或通过或因 `waitFor` 超时失败（复现 flaky 性）。若本次运行通过，也需进入下一步加固。

- [ ] **Step 2: 阅读当前测试用例第 85-115 行**

使用 Read 工具读取 `tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx` 第 80-120 行，确认：
- `waitFor(() => { expect(updateSavedSearch).toHaveBeenCalledWith(...) })` 位于第 106 行
- 该 `waitFor` 无 `{ timeout }` 参数
- 前置操作（点击、表单变更、mouseDown）同步执行无延迟

- [ ] **Step 3: 修改用例，加显式 timeout 并用更稳定的等待条件**

找到该用例内的 `await waitFor(() => { expect(updateSavedSearch).toHaveBeenCalledWith(...) })`，替换为：

```typescript
await waitFor(
  () => {
    expect(updateSavedSearch).toHaveBeenCalled();
  },
  { timeout: 15_000 }
);

// 等待断言首次触发后再检查参数细节
expect(updateSavedSearch).toHaveBeenCalledWith(
  // 保持原测试参数期望值
);
```

**关键点：**
- 先等待"被调用"这个稳定事件（不依赖参数比对）
- 再在 waitFor 外做参数断言（此时 Promise 已 resolve，不存在时序抖动）
- 给 `{ timeout: 15_000 }` 保险（jsdom 冷启动 + mock resolve 微任务队列）
- **不**修改 `vitest.config.ts` 全局 `testTimeout`

- [ ] **Step 4: 运行单个用例验证通过**

Run: `npx vitest run tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx -t "编辑保存搜索时应展示站点选择器"`
Expected: PASS

- [ ] **Step 5: 连续运行 10 次验证稳定**

Run（bash/git-bash）：
```bash
for i in {1..10}; do
  echo "=== Run $i ==="
  npx vitest run tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx -t "编辑保存搜索时应展示站点选择器" --reporter=dot || { echo "FAIL at run $i"; exit 1; }
done
echo "ALL 10 RUNS PASSED"
```
Expected: 所有 10 次都 PASS，最后一行 "ALL 10 RUNS PASSED"

- [ ] **Step 6: 运行同文件全量测试确认未破坏其他用例**

Run: `npx vitest run tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx`
Expected: 该文件所有用例通过

- [ ] **Step 7: 提交**

```bash
git add tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx
git commit -m "fix(TW-01): 稳定化 BooruSavedSearchesPage 编辑用例的 flaky waitFor

- 将 waitFor 拆为两步：先等待 mock 被调用，再断言参数
- 显式 timeout: 15_000 覆盖 jsdom 冷启动 + 微任务队列抖动
- 不修改全局 testTimeout，避免掩盖其他潜在 flaky

对应审查报告 5.1；连续 10 次本地运行全部通过。"
```

---

# Task 2 (TW-02) · 动态/静态导入冲突消除

**审查报告条目：** 5.2

**问题：** `SubWindowApp.tsx` 第 9-11 行静态导入 `BooruTagSearchPage` / `BooruArtistPage` / `BooruCharacterPage`，与 `App.tsx` 第 30/36/37 行的 `React.lazy` 导入冲突，导致 Vite 动态分包失效，构建有 3 条警告。

**Files:**
- Modify: `src/renderer/SubWindowApp.tsx`

- [ ] **Step 1: 先复现构建警告**

Run: `npm run build 2>&1 | grep -E "dynamically imported by|also statically imported" | head -20`
Expected: 至少看到 3 条包含 `BooruTagSearchPage` / `BooruArtistPage` / `BooruCharacterPage` 的警告

- [ ] **Step 2: 阅读 SubWindowApp.tsx 关键片段**

Read: `src/renderer/SubWindowApp.tsx` 第 1-20 行（确认导入语句位置）、第 150-260 行（确认 switch 分支位置与 Suspense 当前用法）

关键确认：
- 第 9-11 行：`import { BooruTagSearchPage } from './pages/BooruTagSearchPage'` 等 3 行
- 第 171/195/219 行：三个 case 分支渲染
- 第 250 行：已有 `<Suspense fallback={suspenseFallback}>`（仅包二级菜单分支）
- **`suspenseFallback` 已存在于文件中**（二级菜单使用）

- [ ] **Step 3: 删除 3 条静态导入，替换为 React.lazy**

把 `src/renderer/SubWindowApp.tsx` 第 9-11 行：
```typescript
import { BooruTagSearchPage } from './pages/BooruTagSearchPage';
import { BooruArtistPage } from './pages/BooruArtistPage';
import { BooruCharacterPage } from './pages/BooruCharacterPage';
```

替换为（与 `App.tsx` 第 30/36/37 行的 lazy 写法保持一致）：
```typescript
const BooruTagSearchPage = React.lazy(() =>
  import('./pages/BooruTagSearchPage').then((m) => ({ default: m.BooruTagSearchPage }))
);
const BooruArtistPage = React.lazy(() =>
  import('./pages/BooruArtistPage').then((m) => ({ default: m.BooruArtistPage }))
);
const BooruCharacterPage = React.lazy(() =>
  import('./pages/BooruCharacterPage').then((m) => ({ default: m.BooruCharacterPage }))
);
```

如果文件顶端未 `import React from 'react'`，确认它已经以某种形式可用（例如 `import React, { ... } from 'react'`）；否则补上。

- [ ] **Step 4: 用 Suspense 包裹这 3 个 case 的渲染**

找到第 171/195/219 行附近的 `case 'tag-search'` / `case 'artist'` / `case 'character'` 三处渲染，分别用 `<Suspense fallback={suspenseFallback}>...</Suspense>` 包裹。例：

`case 'tag-search'`（第 171 行左右）原渲染：
```tsx
return <BooruTagSearchPage initialKeyword={initialKeyword} />;
```
改为：
```tsx
return (
  <Suspense fallback={suspenseFallback}>
    <BooruTagSearchPage initialKeyword={initialKeyword} />
  </Suspense>
);
```

对 `case 'artist'` 和 `case 'character'` 同样处理，保持各自现有的 props 传递不变。

- [ ] **Step 5: 本地构建验证警告消失**

Run: `npm run build 2>&1 | grep -E "dynamically imported by|also statically imported" | head -20`
Expected: 无输出（相关警告消失）

- [ ] **Step 6: 运行 renderer 相关测试验证未破坏**

Run: `npx vitest run tests/renderer/ --reporter=dot`
Expected: 所有通过（或与 TW-01 前相同的基线）

- [ ] **Step 7: 手工烟雾测试（如条件允许）**

在本机启动 `npm run dev`，右键点击 Booru 页面菜单中的"单独窗口打开"，分别验证三类子窗口能正常加载 Tag Search / Artist / Character 页面。fallback 短暂闪现属正常。
（若本地环境不允许启动 Electron，记录此项为"待人工验证"，不阻塞提交。）

- [ ] **Step 8: 提交**

```bash
git add src/renderer/SubWindowApp.tsx
git commit -m "fix(TW-02): 统一子窗口页面的 lazy 导入，消除分包冲突

- SubWindowApp.tsx 中 BooruTagSearchPage / BooruArtistPage / BooruCharacterPage
  改走 React.lazy，与 App.tsx 一致，避免 Vite 动态分包失效
- 三个 case 分支加 Suspense 包裹（复用已有 suspenseFallback）

对应审查报告 5.2；npm run build 不再产出相关 warning。"
```

---

# Task 3 (TW-03) · vendor-antd 子包拆分与虚拟列表评估接入

**审查报告条目：** 5.3

**依赖：** TW-02 必须先完成并提交（避免打包产出两层变化混在一起）。

**问题：** 当前 `vite.config.ts` 的 `manualChunks` 把 `antd` 和 `@ant-design/icons` 打到单一 `vendor-antd` 块，产物 ≈ 1249 kB。

**Files:**
- Modify: `vite.config.ts`
- Modify（阶段 2 条件性）: `src/renderer/pages/BooruTagSearchPage.tsx`（若引入 virtuoso）
- Modify（阶段 2 条件性）: `package.json` + `package-lock.json`

## 阶段 1：manualChunks 函数化拆分

- [ ] **Step 1: 读取当前 vite.config.ts**

Read: `vite.config.ts` 全文。确认现状：
```typescript
manualChunks: {
  'vendor-react': ['react', 'react-dom'],
  'vendor-antd': ['antd', '@ant-design/icons'],
  'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/modifiers', '@dnd-kit/utilities'],
}
```

- [ ] **Step 2: 构建基线产物，记录 vendor-antd 体积**

Run: `npm run build 2>&1 | grep -E "vendor-(react|antd|dnd)" | tee /tmp/tw03-baseline.txt`
Expected: 至少一行包含 `vendor-antd.*kB`，记录数值作基线（应在 1200 kB 上下）

- [ ] **Step 3: 改 vite.config.ts 的 manualChunks 为函数形式**

替换原 `manualChunks` 对象为函数：
```typescript
manualChunks(id) {
  if (!id.includes('node_modules')) return undefined;

  // React 核心
  if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
    return 'vendor-react';
  }

  // antd 核心 UI（不含 icons）
  if (/node_modules[\\/]antd[\\/]/.test(id)) {
    return 'vendor-antd-core';
  }
  // antd 图标
  if (/node_modules[\\/]@ant-design[\\/]icons[\\/]/.test(id)) {
    return 'vendor-antd-icons';
  }
  // antd 子模块生态（cssinjs、colors、hooks 等）
  if (/node_modules[\\/]@ant-design[\\/]/.test(id)) {
    return 'vendor-antd-misc';
  }
  // rc-* (antd 底层组件)
  if (/node_modules[\\/]rc-[\w-]+[\\/]/.test(id)) {
    return 'vendor-antd-rc';
  }

  // dnd-kit
  if (/node_modules[\\/]@dnd-kit[\\/]/.test(id)) {
    return 'vendor-dnd';
  }

  // 其他 node_modules 走默认拆分
  return undefined;
}
```

**关键点：**
- 函数形式允许按**路径模式**而不是**包名**拆
- `rc-*` 系列（antd 的 radix 层依赖）单独拆出，它们体积不小
- `@ant-design/icons` 单独拆，它独占几百 kB

- [ ] **Step 4: 构建验证 vendor-antd-core 单包 ≤ 600 kB**

Run: `npm run build 2>&1 | grep -E "vendor-(react|antd|dnd)" | tee /tmp/tw03-after.txt`
Expected: 出现 `vendor-antd-core`、`vendor-antd-icons`、`vendor-antd-misc`、`vendor-antd-rc` 多条；**最大单包 ≤ 600 kB**

若 `vendor-antd-core` 仍 > 600 kB → 进入阶段 2（虚拟列表）。否则阶段 2 可跳过并记录为"未接入（manualChunks 已达标）"。

- [ ] **Step 5: 运行全量测试确认未破坏**

Run: `npx vitest run --reporter=dot`
Expected: 与 TW-01+02 完成后的基线一致（≥ 1574 通过）

- [ ] **Step 6: 阶段 1 提交**

```bash
git add vite.config.ts
git commit -m "perf(TW-03-1): vendor-antd 按子模块拆分为多包

- manualChunks 改为函数形式，按 node_modules 路径精细拆分
- 新增 vendor-antd-core / -icons / -misc / -rc 四个子包
- rc-* 系列底层依赖单独成包，避免 antd 单包过大

对应审查报告 5.3；构建体积从 ~1249 kB 降到最大单包 ≤ 600 kB。"
```

## 阶段 2：（条件性）引入 react-virtuoso

**触发条件：** 阶段 1 后 `vendor-antd-core` 仍 > 600 kB；或 Booru 大列表页运行时滚动帧率明显下降（人工判断）。

**若不触发：** 跳过此阶段，在 `重构文档/测试记录/TP-12-评估并接入成熟库与现代化能力-测试记录.md` 的"已接入"小节明确写"TW-03 阶段 2 未触发，仅做 manualChunks"，并直接进入 Task 4。

- [ ] **Step 7: 安装 react-virtuoso（仅在触发时）**

Run: `npm install react-virtuoso@4`
Expected: 安装成功；`package.json` 的 `dependencies` 新增 `react-virtuoso`；`package-lock.json` 更新

- [ ] **Step 8: 在 BooruTagSearchPage 接入 Virtuoso**

Read 目标文件确认当前列表渲染位置：`src/renderer/pages/BooruTagSearchPage.tsx`（695 行）

定位列表渲染的 JSX（通常是 `{posts.map((post) => <BooruPostCard ... />)}` 这种结构）。包一层 `Virtuoso`：

```tsx
import { VirtuosoGrid } from 'react-virtuoso';

// 原：
// <div className="booru-grid">
//   {posts.map((post) => (<BooruPostCard key={post.id} post={post} />))}
// </div>

// 替换为：
<VirtuosoGrid
  style={{ height: '100%' }}
  totalCount={posts.length}
  overscan={200}
  itemContent={(index) => {
    const post = posts[index];
    if (!post) return null;
    return <BooruPostCard post={post} />;
  }}
  components={{
    List: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
      function VirtuosoListWrapper(props, ref) {
        return <div ref={ref} {...props} className="booru-grid" />;
      }
    ),
  }}
/>
```

**关键点：**
- 保持原有 `.booru-grid` 类名，不破坏现有 CSS
- 使用 `VirtuosoGrid` 而不是 `Virtuoso`，因为列表是网格布局
- `overscan={200}` 保证滚动流畅（调小会频繁创建卸载）

- [ ] **Step 9: 构建产物验证并对比**

Run: `npm run build 2>&1 | grep -E "vendor-|BooruTagSearchPage"`
Expected: `vendor-antd-core` ≤ 600 kB；`BooruTagSearchPage` 块含 virtuoso，但主 vendor 体积未回升

- [ ] **Step 10: 运行相关测试**

Run: `npx vitest run tests/renderer/pages/BooruTagSearchPage`
Expected: 通过

- [ ] **Step 11: 记录 TP-12 测试记录并提交**

在 `重构文档/测试记录/TP-12-评估并接入成熟库与现代化能力-测试记录.md` 的"已接入"小节添加条目（若文件中尚无"已接入"小节则新增）：
```markdown
### react-virtuoso（2026-04-16 TW-03 阶段 2 接入）

- 版本：^4.x（记录 lock 的精确版本号）
- 接入页面：BooruTagSearchPage.tsx
- 接入原因：vendor-antd 分包后主 UI 仍超出 600 kB / 长列表滚动帧率不理想
- 回退策略：若引入副作用（滚动卡顿、卡片尺寸计算错误、详情浮层行为异常），直接移除 Virtuoso 恢复原生 map 渲染
- 体积影响：vendor 总增量 ≈ XX kB；对首屏影响评估 XXms
```

提交：
```bash
git add package.json package-lock.json src/renderer/pages/BooruTagSearchPage.tsx 重构文档/测试记录/TP-12-评估并接入成熟库与现代化能力-测试记录.md
git commit -m "perf(TW-03-2): BooruTagSearchPage 接入 react-virtuoso 虚拟列表

- 仅在一个代表性大列表页接入，不全量替换
- 保留原 .booru-grid 样式，最小侵入
- TP-12 记录中补全'已接入'小节（版本/体积/回退）

阶段 1 manualChunks 后主单包仍超 600 kB 触发本阶段；如未触发则跳过此 commit。"
```

---

# Task 4 (TW-04) · useBooruPostActions 铺开到 BooruFavoritesPage

**审查报告条目：** 5.4

**问题：** `BooruFavoritesPage.tsx` 直接调用 `window.electronAPI.booru.*` 的多个 post 操作相关方法，与已接入 `useBooruPostActions` 的 3 个页面模式不一致。

**Files:**
- Modify: `src/renderer/pages/BooruFavoritesPage.tsx`
- Create: `tests/renderer/pages/BooruFavoritesPage.postActions.test.tsx`

- [ ] **Step 1: 读源代码锁定 API 调用位置**

Read: `src/renderer/pages/BooruFavoritesPage.tsx` 完整

确认直接 API 调用位置（探查已告知）：
- 第 90 / 94 行：`serverUnfavorite` / `serverFavorite`
- 第 264 行：`addToDownload`
- 第 215 行：`getFavorites`（数据加载，**不迁移**）
- 第 132 / 152 / 166 / 169 / 184 行：站点/分组 CRUD（**不迁移**，与 post 操作无关）
- 第 308 行：`onFavoritesRepairDone` 事件监听（**不迁移**）

**迁移范围（与 post 操作相关）：**
- 服务端收藏切换：`serverFavorite` / `serverUnfavorite`
- 加入下载队列：`addToDownload`
- 详情面板打开/关闭（如果当前页面有该能力）

**不迁移：** `useFavorite`（本地收藏），数据加载 API（非 post 操作），事件订阅。

- [ ] **Step 2: 读 BooruArtistPage 参照样板**

Read: `src/renderer/pages/BooruArtistPage.tsx` 第 90-160 行，确认：
- `useBooruPostActions` 调用签名（已知第 110-118 行）
- `postActions.openDetails` / `.closeDetails` / `.download` / `.toggleServerFavorite` 等在 JSX 中如何使用

- [ ] **Step 3: 读 hook 签名**

Read: `src/renderer/hooks/useBooruPostActions.ts` 第 1-220 行。确认 `CreateBooruPostActionsOptions` 接口字段。特别留意：
- `updatePosts`：BooruFavoritesPage 的 posts state setter
- `serverFavorite` / `serverUnfavorite`：直接透传 API
- `addToDownload`：直接透传 API
- `toggleLocalFavorite` / `isServerFavorited`：hook 内处理的本地/服务端逻辑

- [ ] **Step 4: 写集成测试（先失败）**

创建 `tests/renderer/pages/BooruFavoritesPage.postActions.test.tsx`：

```typescript
/**
 * TW-04 验收测试：BooruFavoritesPage 通过 useBooruPostActions 执行 post 操作，
 * 不再直接调用 window.electronAPI.booru.serverFavorite/serverUnfavorite/addToDownload。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App as AntApp } from 'antd';
import React from 'react';
import { BooruFavoritesPage } from '@/renderer/pages/BooruFavoritesPage';

const booruApi = {
  getSites: vi.fn().mockResolvedValue([{ id: 1, name: 'mock', baseUrl: 'https://mock' }]),
  getFavoriteGroups: vi.fn().mockResolvedValue([]),
  getFavorites: vi.fn().mockResolvedValue({
    posts: [
      {
        id: 101,
        siteId: 1,
        tags: 'tag_a',
        fileUrl: 'https://mock/a.jpg',
        previewUrl: 'https://mock/a_preview.jpg',
        width: 100,
        height: 100,
        // 其余按 BooruPost 类型补齐
      },
    ],
    total: 1,
  }),
  serverFavorite: vi.fn().mockResolvedValue({ success: true }),
  serverUnfavorite: vi.fn().mockResolvedValue({ success: true }),
  addToDownload: vi.fn().mockResolvedValue({ success: true }),
  onFavoritesRepairDone: vi.fn(() => () => {}),
  checkFavorites: vi.fn().mockResolvedValue({ ok: true }),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as any).electronAPI = { booru: booruApi };
});

describe('BooruFavoritesPage · useBooruPostActions 集成', () => {
  it('点击下载按钮时通过 hook 调用 addToDownload', async () => {
    render(
      <AntApp>
        <BooruFavoritesPage />
      </AntApp>
    );

    // 等待首屏 post 渲染
    await waitFor(() => {
      expect(booruApi.getFavorites).toHaveBeenCalled();
    }, { timeout: 15_000 });

    // 触发卡片下载（根据页面实际 DOM 选 aria-label / data-testid / icon）
    const downloadBtn = await screen.findByRole('button', { name: /下载|download/i });
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(booruApi.addToDownload).toHaveBeenCalledWith(101, 1);
    }, { timeout: 15_000 });
  });

  it('点击服务端收藏按钮时通过 hook 调用 serverFavorite', async () => {
    render(
      <AntApp>
        <BooruFavoritesPage />
      </AntApp>
    );

    await waitFor(() => {
      expect(booruApi.getFavorites).toHaveBeenCalled();
    }, { timeout: 15_000 });

    const serverFavBtn = await screen.findByRole('button', { name: /服务端收藏|server favorite/i });
    fireEvent.click(serverFavBtn);

    await waitFor(() => {
      expect(
        booruApi.serverFavorite.mock.calls.length + booruApi.serverUnfavorite.mock.calls.length
      ).toBeGreaterThan(0);
    }, { timeout: 15_000 });
  });
});
```

**注意：** 按钮的查找选择器（`/下载|download/i` 等）需要根据 `BooruFavoritesPage` 实际的按钮 `aria-label` / 文案调整。读代码 Step 1 时就应该记下这些选择器的精确值。

- [ ] **Step 5: 运行测试，确认失败**

Run: `npx vitest run tests/renderer/pages/BooruFavoritesPage.postActions.test.tsx`
Expected: FAIL（因为当前 BooruFavoritesPage 还在直接调 API，但调用路径跟测试预期的 hook 路径不一致；或者组件内部路径与 hook 后不一致）

（若测试"失败原因"是断言挂上去但调用栈正确，也视作合法失败。目的是证明测试真实检查到了 post 操作通路。）

- [ ] **Step 6: 在 BooruFavoritesPage.tsx 中引入 useBooruPostActions**

在 `src/renderer/pages/BooruFavoritesPage.tsx` 组件顶部（state 声明之后，JSX 之前）加入：

```typescript
import { useBooruPostActions } from '../hooks/useBooruPostActions';

// ...

const postActions = useBooruPostActions({
  siteId: selectedSiteId, // 与该页现有 siteId state 变量名对齐；若不同名则按实际
  updatePosts: (updater) => setPosts((prev) => updater(prev)),
  toggleLocalFavorite, // 现有 useFavorite 提供的 toggle；若返回签名不符需适配
  addToDownload: (postId, siteId) => window.electronAPI.booru.addToDownload(postId, siteId),
  serverFavorite: (siteId, postId) => window.electronAPI.booru.serverFavorite(siteId, postId),
  serverUnfavorite: (siteId, postId) => window.electronAPI.booru.serverUnfavorite(siteId, postId),
  message,
});
```

**严格约束：**
- **所有** post 操作相关按钮的 onClick **改走** `postActions.*`（`download` / `toggleServerFavorite` / `openDetails` 等）
- **不修改** 数据加载（`getFavorites`）、分组 CRUD、事件订阅等非 post 操作相关的调用
- **不修改** `useBooruPostActions` 本身的 API 签名
- 如果 `toggleLocalFavorite` 返回签名与 hook 期望不符，在本地包一层 adapter 函数解决，**不**改 hook

- [ ] **Step 7: 删除原来三处直接 API 调用点**

找到原第 90 行（`serverFavorite`）、第 94 行（`serverUnfavorite`）、第 264 行（`addToDownload`）所在函数体/按钮回调，把调用替换为 `postActions.toggleServerFavorite(post)` / `postActions.download(post)`。保留其他代码（分组操作、数据加载）。

- [ ] **Step 8: 运行测试验证通过**

Run: `npx vitest run tests/renderer/pages/BooruFavoritesPage.postActions.test.tsx`
Expected: PASS

- [ ] **Step 9: 运行 BooruFavoritesPage 全量测试**

Run: `npx vitest run tests/renderer/pages/BooruFavoritesPage`
Expected: PASS（如果存在其他 `BooruFavoritesPage.*.test.tsx` 文件也都通过）

- [ ] **Step 10: 运行 hook 现有测试确认没破坏 hook 本身**

Run: `npx vitest run tests/renderer/hooks/BooruPostActions tests/renderer/pages/BooruArtistPage tests/renderer/pages/BooruPoolsPage tests/renderer/pages/BooruPopularPage`
Expected: 所有通过（已铺开的 3 个页面不应受影响）

- [ ] **Step 11: 判断追加条件并必要时迁其他页**

审视 `BooruFavoritesPage` 的迁移改动 diff。如果改完后发现：
- 某个其他 Booru 页面（如 `BooruSavedSearchesPage` 的帖子列表部分）有与 `BooruFavoritesPage` 几乎一致（≥ 80% 重复）的 post 操作代码
- 则顺带迁移该页（重复 Step 3-8）

否则**不追加**（避免范围爆炸）。

在 commit message 中明确说明是否追加、为什么。

- [ ] **Step 12: 提交**

```bash
git add src/renderer/pages/BooruFavoritesPage.tsx tests/renderer/pages/BooruFavoritesPage.postActions.test.tsx
git commit -m "refactor(TW-04): BooruFavoritesPage 接入 useBooruPostActions

- 页面层不再直接调 serverFavorite / serverUnfavorite / addToDownload
- 数据加载（getFavorites）、分组 CRUD、事件订阅保持原样
- 新增 BooruFavoritesPage.postActions.test.tsx 集成测试
- 未发现 ≥80% 重复代码的其他页面，本轮不追加迁移

对应审查报告 5.4；铺开页面达到 4 个（Artist/Pools/Popular + Favorites），
hook 签名保持向后兼容。"
```

---

# Task 5 (TW-05) · 子窗口 preload 精简

**审查报告条目：** 5.5

**依赖：** TW-02 必须完成（子窗口 React.lazy 改动稳定后再动 preload）。

**问题：** 子窗口与主窗口共用 `src/preload/index.ts`（676 行），暴露了 db / gallery / config / booru（70+ 方法）/ bulkDownload / system / google 等大量域。探查发现：**SubWindowApp 实际只用 `window` 域的 4 个方法**（`openTagSearch` / `openArtist` / `openCharacter` / `openSecondaryMenu`）。

**Files:**
- Create: `src/preload/shared/createWindowApi.ts`
- Create: `src/preload/subwindow-index.ts`
- Modify: `src/preload/index.ts`（主窗口 preload 复用 createWindowApi）
- Modify: `src/main/window.ts`
- Modify（可能）: `electron.vite.config.ts` 或等价的构建配置（为新 preload 入口配 output）
- Create: `tests/preload/subwindow-exposure.test.ts`

## 5.1 扫描锁定暴露域

- [ ] **Step 1: 确认 SubWindow 实际调用的 electronAPI 域**

Run: `grep -RnE "window\.electronAPI\??\." src/renderer/SubWindowApp.tsx src/renderer/pages/ 2>&1 | head -100`

但注意：SubWindow 并非加载所有 pages。实际 SubWindow 加载的是 `BooruTagSearchPage` / `BooruArtistPage` / `BooruCharacterPage` / 二级菜单页。这些页面内部会调多种 API。

**真正要锁定的暴露域** = SubWindowApp 本体调用 + 它渲染到的页面所有调用的并集。

Run: `grep -RnE "window\.electronAPI\??\." src/renderer/SubWindowApp.tsx src/renderer/pages/BooruTagSearchPage.tsx src/renderer/pages/BooruArtistPage.tsx src/renderer/pages/BooruCharacterPage.tsx 2>&1 | head -200`

并对二级菜单各页面同样做一次扫描（以它们 lazy 加载进 SubWindow 为准）。

记录最终的**暴露域白名单**到 commit message / TP 测试记录。预期远小于主窗口 10+ 域。

- [ ] **Step 2: 读 preload/index.ts 全文，识别每个域的暴露代码段**

Read: `src/preload/index.ts` 全文（676 行）。用笔记（或临时文本）标注每个域（`db` / `gallery` / `config` / ...）的起止行号。

## 5.2 抽取 createWindowApi 共享工厂

- [ ] **Step 3: 先写 createWindowApi 的单测（可选但推荐）**

如果工程一贯有 preload 单测，创建 `tests/preload/createWindowApi.test.ts`；否则跳过此步，测试统一在 Step 14 的 exposure 测试里做。

- [ ] **Step 4: 新建 src/preload/shared/createWindowApi.ts**

内容：
```typescript
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../main/ipc/channels.js';

/**
 * window 域 API 工厂。
 * 主窗口 preload 与子窗口 preload 共用。
 * 外部依赖仅 ipcRenderer + IPC_CHANNELS（主进程单一来源）。
 */
export function createWindowApi() {
  return {
    openTagSearch: (args: unknown) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_TAG_SEARCH, args),
    openArtist: (args: unknown) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_ARTIST, args),
    openCharacter: (args: unknown) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_CHARACTER, args),
    openSecondaryMenu: (args: unknown) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_SECONDARY_MENU, args),
  } as const;
}
```

**严格要求：**
- 不能引入任何新依赖
- `IPC_CHANNELS` 键名必须与 `src/main/ipc/channels.ts` 现有定义一致，不允许新增或改名
- 若现有通道键名与上面不同，以主进程源为准，修改 createWindowApi 对齐而**不是**改 channels.ts
- 参数类型（`unknown`）保守化，不做 DTO 收紧；收紧可作为后续专题

- [ ] **Step 5: 修改 src/preload/index.ts 让主窗口 preload 复用 createWindowApi**

找到 preload 中 `window:` 域的暴露（通常是 `window: { openTagSearch: ..., openArtist: ..., openCharacter: ..., openSecondaryMenu: ... }`）。替换为：

```typescript
import { createWindowApi } from './shared/createWindowApi.js';

// ...在 contextBridge.exposeInMainWorld('electronAPI', { ... }) 里：
window: createWindowApi(),
```

**不允许做的事：**
- 不动其他域（db / gallery / booru 等）
- 不改 IPC_CHANNELS 导入路径
- 不改对外暴露的形状（保持 `electronAPI.window.openX` 可调用）

- [ ] **Step 6: 运行全量 preload / main 测试确认主窗口不退化**

Run: `npx vitest run tests/main tests/preload`
Expected: 所有通过

## 5.3 创建子窗口独立 preload

- [ ] **Step 7: 新建 src/preload/subwindow-index.ts**

内容：
```typescript
/**
 * 子窗口 preload。
 * 设计约束（TP-06 最小暴露面）：只暴露 SubWindow 及其加载的页面实际使用的 API 域。
 * 本轮扫描结果（详见 commit message）：
 *   - window: 4 方法（openTagSearch / openArtist / openCharacter / openSecondaryMenu）
 *   - 以及 Step 1 扫描得到的其他必须域（根据实际结果填充）
 * 禁止按"可能用得上"预留其他域。
 */
import { contextBridge } from 'electron';
import { createWindowApi } from './shared/createWindowApi.js';

// 根据 Step 1 的扫描结果，如果 SubWindow 加载的页面确实调用了其他域（如 booru），
// 这里需要按需引入对应的 create*Api 工厂并暴露。
// 如果本轮扫描确认仅需 window 域，下面就是完整实现：

contextBridge.exposeInMainWorld('electronAPI', {
  window: createWindowApi(),
});
```

**关键：** Step 1 扫描结果决定本文件最终暴露域。若 SubWindow 承载的页面（Tag/Artist/Character + 二级菜单）需要 `booru.*`，则要把 booru 暴露也抽工厂并引入。**按实际，不按预留。**

**如果 Step 1 扫描显示需要 `booru.*`：**
- 同样方式：创建 `src/preload/shared/createBooruApi.ts`（从现有 `src/preload/index.ts` 的 booru 段迁出）
- 主窗口和子窗口 preload 都通过工厂组合
- 分两个 commit：一个抽 booru 工厂（不改行为），一个真正接入子窗口

若扫描只需 window，则跳过额外工厂。

- [ ] **Step 8: 修改构建配置让新 preload 入口被打包**

Read: `electron.vite.config.ts`（或等价的 `vite.config.preload.ts` / `tsconfig.preload.json`）

找到 preload 构建的 `entry` 或 `input` 配置。原值应该指向 `src/preload/index.ts`。修改为同时包含两个入口：

```typescript
// 以 electron-vite 为例
preload: {
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/preload/index.ts'),
        subwindow: resolve(__dirname, 'src/preload/subwindow-index.ts'),
      },
    },
  },
  // ...其它既有配置
}
```

构建后应产出 `dist/preload/index.js` 与 `dist/preload/subwindow.js` 两个产物。

- [ ] **Step 9: 验证构建产生子窗口 preload 产物**

Run: `npm run build`
Expected: 构建成功；`dist/preload/subwindow.js` 或对应产物存在

Run: `ls dist/preload/` 或 Glob 确认产物文件

- [ ] **Step 10: 修改 src/main/window.ts 的子窗口创建**

Read: `src/main/window.ts` 第 264-327 行（createSubWindow）

定位：
```typescript
// 第 285-286 行当前：
const absolutePreloadPath = path.join(__dirname, '../preload/index.js');
// 第 299 行：
webPreferences: { preload: absolutePreloadPath, /* ... */ }
```

修改为：
```typescript
const absolutePreloadPath = path.join(__dirname, '../preload/subwindow.js');
// 其余保持不变
```

**不允许：**
- 改 `nodeIntegration`、`contextIsolation`、`sandbox` 等其他 webPreferences 字段
- 改 createSubWindow 其他逻辑（LRU、MAX_SUB_WINDOWS 等）

## 5.4 暴露面收缩测试

- [ ] **Step 11: 新建 tests/preload/subwindow-exposure.test.ts**

内容：
```typescript
/**
 * TW-05 验收测试：子窗口 preload 暴露面最小化。
 * 保证仅暴露实际需要的域，其他在 preload/index.ts 暴露的域在子窗口下不可访问。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const exposed: Record<string, unknown> = {};

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => {
      (exposed as Record<string, unknown>)[name] = api;
    },
  },
  ipcRenderer: {
    invoke: vi.fn(async () => undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

beforeEach(() => {
  for (const k of Object.keys(exposed)) delete exposed[k];
  vi.resetModules();
});

describe('subwindow preload 暴露面', () => {
  it('只暴露 window 域（以及 Step 1 扫描得出的其他必需域）', async () => {
    await import('@/preload/subwindow-index');

    const api = exposed.electronAPI as Record<string, unknown> | undefined;
    expect(api).toBeDefined();

    // 允许出现的域（根据 Step 1 扫描结果填充）
    const ALLOWED = new Set(['window']);

    const actual = new Set(Object.keys(api!));
    for (const key of actual) {
      expect(ALLOWED.has(key), `子窗口不应暴露 "${key}" 域`).toBe(true);
    }
  });

  it('子窗口不暴露 db 域', async () => {
    await import('@/preload/subwindow-index');
    const api = exposed.electronAPI as Record<string, unknown>;
    expect((api as Record<string, unknown>).db).toBeUndefined();
  });

  it('子窗口不暴露 gallery 域', async () => {
    await import('@/preload/subwindow-index');
    const api = exposed.electronAPI as Record<string, unknown>;
    expect((api as Record<string, unknown>).gallery).toBeUndefined();
  });

  it('子窗口不暴露 bulkDownload 域', async () => {
    await import('@/preload/subwindow-index');
    const api = exposed.electronAPI as Record<string, unknown>;
    expect((api as Record<string, unknown>).bulkDownload).toBeUndefined();
  });

  it('子窗口 window 域包含 4 个方法', async () => {
    await import('@/preload/subwindow-index');
    const api = exposed.electronAPI as { window: Record<string, unknown> };
    expect(typeof api.window.openTagSearch).toBe('function');
    expect(typeof api.window.openArtist).toBe('function');
    expect(typeof api.window.openCharacter).toBe('function');
    expect(typeof api.window.openSecondaryMenu).toBe('function');
  });
});
```

**若 Step 1 扫描显示子窗口还需要 booru 域**：在 `ALLOWED` 集合中追加 `'booru'`，并删除/调整禁止 booru 的那条断言。

- [ ] **Step 12: 运行测试，首次预期失败或通过（取决于代码状态）**

Run: `npx vitest run tests/preload/subwindow-exposure.test.ts`
Expected: 当前 subwindow-index.ts 已存在（Step 7 已建）→ 应 PASS。若失败，修正 subwindow-index.ts 直到测试全绿。

- [ ] **Step 13: 运行主窗口 preload 测试保证未退化**

Run: `npx vitest run tests/preload`
Expected: 所有通过（包括主窗口的 exposure 测试，如果存在）

- [ ] **Step 14: 运行主进程 window 测试**

Run: `npx vitest run tests/main/window`
Expected: 所有通过

- [ ] **Step 15: 运行全量测试**

Run: `npx vitest run --reporter=dot`
Expected: 全部通过

- [ ] **Step 16: 手工烟雾测试（条件允许时）**

`npm run dev`，打开子窗口（右键 Booru 菜单"单独窗口打开"）。打开 DevTools → Console，输入：
```javascript
typeof window.electronAPI.window?.openTagSearch  // 应为 "function"
typeof window.electronAPI.db                      // 应为 "undefined"
typeof window.electronAPI.gallery                 // 应为 "undefined"
typeof window.electronAPI.bulkDownload            // 应为 "undefined"
```

（若本地环境不允许，记录"待人工验证"，不阻塞提交。）

- [ ] **Step 17: 提交**

```bash
git add src/preload/shared/createWindowApi.ts src/preload/index.ts src/preload/subwindow-index.ts src/main/window.ts electron.vite.config.ts tests/preload/subwindow-exposure.test.ts
# 以及构建配置实际对应的文件路径

git commit -m "refactor(TW-05): 子窗口 preload 独立化，暴露面收缩到最小

- 新增 src/preload/shared/createWindowApi.ts，主窗口与子窗口共用 window 域工厂
- 新增 src/preload/subwindow-index.ts，仅暴露 SubWindow 及其加载页面实际使用的域
- src/main/window.ts 中子窗口 preload 改指向 dist/preload/subwindow.js
- 新增 tests/preload/subwindow-exposure.test.ts 验证 db/gallery/bulkDownload 不可访问
- 主窗口 preload 对外暴露的 window 域行为等价不变（复用同一工厂）

对应审查报告 5.5；IPC_CHANNELS 仍从主进程源单一导入，不破坏 TP-05。"
```

---

# 整体验证（所有 Task 完成后）

- [ ] **Step 全-1: 全量测试**

Run: `npx vitest run --reporter=json --outputFile=.latest-test-results.json`
Expected: `numTotalTests ≥ 1574`，`numFailedTests = 0`（TW-01 应把 flaky 修掉）

- [ ] **Step 全-2: 构建零警告**

Run: `npm run build 2>&1 | tee /tmp/tw-build.log`
Expected:
- 无 "dynamically imported by ... is also statically imported by ..." 警告（TW-02 验收）
- 无 vendor-antd 单包 > warning limit 的提示（TW-03 验收，单包 ≤ 600 kB）

- [ ] **Step 全-3: 类型检查**

Run: `npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.preload.json --noEmit && npx tsc -p tsconfig.renderer.json --noEmit`（按实际工程的 tsconfig 布局调用）
Expected: 无错误

- [ ] **Step 全-4: 更新 `重构任务审查报告.md` 第 5 节标记已收尾**

Read: `重构任务审查报告.md` 第 5 节

在 5.1 ~ 5.5 各小节的开头补一行：
```markdown
> **更新（2026-04-16，TW-01~TW-05）**：已收尾，见 [doc/superpowers/plans/2026-04-16-refactor-wrap-up.md](doc/superpowers/plans/2026-04-16-refactor-wrap-up.md)。
```

- [ ] **Step 全-5: 提交收尾报告更新**

```bash
git add 重构任务审查报告.md
git commit -m "docs(TW): 更新审查报告标记 5.1~5.5 已收尾"
```

- [ ] **Step 全-6: 推送到 origin（不合并 master）**

Run: `git push origin feat/refactor-todo-full`
Expected: 推送成功

---

# Review 调度规范

## 单任务 3 轮（每个 TW 任务提交之后立即触发）

每轮独立 agent（code-reviewer 或 Explore），指令模板：

### R1 功能实现 review
> 你是独立代码审查者。对 commit {SHA} 对照 doc/superpowers/specs/2026-04-16-refactor-wrap-up-design.md 中 TW-XX 的"验收标准"逐条核验。对每条标准输出 PASS / FAIL + 证据（文件:行号 / 测试名 / 构建日志）。不修改代码，不夸大。报告 ≤ 300 字。

### R2 偏移审查
> 你是独立代码审查者。对 commit {SHA} 核验：是否只改动了计划指定的文件？是否引入了超范围改动（如顺手重构无关模块、修改已签收 TP 的代码）？对 TP-05 IPC 单一来源、TP-07 安全边界、TP-13 pagePreferences 是否有影响？逐项输出 YES/NO + 证据。不修改代码。报告 ≤ 300 字。

### R3 方案合理性
> 你是独立代码审查者，关注架构/可维护性/性能/安全。对 commit {SHA}：是否有反模式（重复渲染、重复请求、绕过缓存、锁定 sleep）？是否引入循环依赖？是否有更合理的实现方式？是否为"临时方案"却没标注？不修改代码。报告 ≤ 300 字。

3 轮中任意一轮发现 FAIL / 合理改进建议 → 原实现 agent 或新 agent 修复 → 在同一 TW 内再提一个 fix commit → **对 fix commit 重跑 3 轮**。不对无改动范围重跑。

## 整体 2 轮（所有 TW 完成并推送之前）

### G1 集成 review
> 你是独立代码审查者，关注跨 TW 副作用。TW-02 的 lazy 改动 + TW-03 的 manualChunks + TW-05 的新 preload 入口三者组合，是否产生未预期的打包/运行时副作用？SubWindow 在新 preload 下加载 lazy 页面是否正常？报告 ≤ 400 字。

### G2 回归 review
> 你是独立代码审查者，对照 重构任务审查报告.md 逐一审查 TP-01 ~ TP-13 已签收项。本轮 TW-01~05 的改动是否有任何一处把已签收项拖回部分完成/未完成？按 TP 编号输出 YES/NO + 依据。报告 ≤ 500 字。

任何一轮发现回归 → 修复后重跑 G1 & G2。

---

# 禁止事项（所有 Task 共享）

- 禁止修改 `vitest.config.ts` 的全局 `testTimeout`
- 禁止修改 `src/main/ipc/channels.ts` 的既有键名
- 禁止修改已签收 TP 的核心代码（下载链路、backup sanitize、pagePreferences 等）
- 禁止在本轮新增与 TW-01~05 无关的任何 feature
- 禁止跳过 review 流程（任何一个 TW 都必须过 3 轮）
- 禁止合并到 master
- 禁止在 master 上新增提交（规划文件已由另一个 commit 处理）
- Commit message 必须中文 + 英文前缀（`fix(TW-01):` 等）
