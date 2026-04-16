# 重构收尾设计文档（Refactor Wrap-Up Design）

- **日期**：2026-04-16
- **所属阶段**：TP-01 ~ TP-13 重构主体签收后的尾部收尾（Post-Audit Wrap-Up）
- **工作树**：`.worktrees/refactor-todo-full`
- **分支**：`feat/refactor-todo-full`（已推送到 `origin`，基线提交 `bc33730`）
- **对应审查报告**：`重构任务审查报告.md` 第 5 节
- **用户选择范围**：方案 D（5.1 + 5.2 + 5.3 + 5.4 + 5.5 全量收尾）

---

## 1. 目标与非目标

### 1.1 目标
1. 消除审查报告第 5 节列出的**全部** 5 项尾部事项
2. 不破坏已签收的 TP-01 ~ TP-13 成果
3. 保持单分支（`feat/refactor-todo-full`）继续提交；最终推送但**不合并 master**
4. 所有改动过 3 轮独立 agent review + 2 轮整体 review 方可推送

### 1.2 非目标
1. 不扩大重构范围（例如不借本轮做"顺手"重构其他模块）
2. 不引入新的 TP 任务包
3. 不改变已签收的设计决策（如下载链路、IPC 单一来源、备份脱敏等）
4. 不合并分支到 master

---

## 2. 任务包拆分（TW-01 ~ TW-05）

### 2.1 TW-01 · Flaky 测试修复

| 项目 | 内容 |
|---|---|
| 审查报告条目 | 5.1 |
| 目标文件 | `tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx` |
| 失败用例 | "编辑保存搜索时应展示站点选择器并以 siteId 一致调用 updateSavedSearch" |
| 现象 | 单条 `waitFor` 默认 5000ms 超时（全局 `testTimeout` 已提高到 30s 无效） |
| 方案 | 优先 `vi.useFakeTimers()` + `vi.advanceTimersByTime(5000)`；若业务依赖真实时序，则该 `waitFor` 显式 `{ timeout: 15_000 }` |
| 验收 | 连续 10 次运行全部通过；不提高全局 testTimeout |
| 依赖 | 无 |

**关键决策**：不通过提高全局 testTimeout 绕过。Flaky 的根因是测试内部异步时序设计不稳定，应从测试层修复而非扩大超时。

---

### 2.2 TW-02 · 动态/静态导入冲突消除

| 项目 | 内容 |
|---|---|
| 审查报告条目 | 5.2 |
| 冲突文件 | `BooruTagSearchPage.tsx` / `BooruArtistPage.tsx` / `BooruCharacterPage.tsx` |
| 冲突原因 | `App.tsx` 用 `React.lazy` 动态导入；`SubWindowApp.tsx` 静态 `import`，导致 Vite 动态分包失效 |
| 首选方案 | `SubWindowApp.tsx` 也改走 `React.lazy`，保持前后一致 |
| 备选方案 | 在 `vite.config.ts` 的 `build.rollupOptions.output.manualChunks` 中把这 3 个页面显式归到同一块 |
| 决策 | **先用首选方案**；如果首选方案引入 Suspense 复杂度，评估后切备选方案 |
| 验收 | `npm run build` 无相关 warning；子窗口独立使用这 3 个页面仍正常 |
| 依赖 | 无 |

---

### 2.3 TW-03 · `vendor-antd` 分包 + 虚拟列表评估接入

| 项目 | 内容 |
|---|---|
| 审查报告条目 | 5.3 |
| 现状 | `vendor-antd` 单包约 1249 kB |
| 目标 | ≤ 600 kB/单包 |
| 阶段 1 | 只做 `manualChunks` 子包拆分（`antd` / `antd-icons` / `antd-form` / 其他 vendor），观察产出 |
| 阶段 2 | 若拆分后仍超标或大列表运行时卡顿，在**一个**代表性大列表页接入 `react-virtuoso`（与 TP-12 评估结论对齐） |
| 接入页面 | 推荐 `BooruPostListPage` 或 `BooruTagSearchPage`（与 TW-02 不冲突，TW-02 可先动静态冲突消除） |
| 验收 | `vendor-antd` 警告消失；若接入虚拟列表，新增依赖版本/体积/回退写入 `重构文档/测试记录/TP-12-...-测试记录.md` 的"已接入"小节；Booru 大列表功能回归无退化 |
| 依赖 | TW-02 完成（避免虚拟列表引入期间导入链再变动） |

**关键决策**：**分两阶段**。先 manualChunks，再按需引入虚拟列表。避免一次性同时动 2 个变量。

---

### 2.4 TW-04 · `useBooruPostActions` 铺开

| 项目 | 内容 |
|---|---|
| 审查报告条目 | 5.4 |
| 现状 | 已接入 `BooruArtistPage` / `BooruPoolsPage` / `BooruPopularPage` |
| 本轮接入 | **必做**：`BooruFavoritesPage`。**追加条件**：若迁移过程中发现其他 Booru 页面存在与 `BooruFavoritesPage` ≥ 80% 重复的 post 操作代码，可一并迁移；否则不追加（避免范围爆炸） |
| 铺开边界 | 不强求覆盖全部 Booru 页面；目标是形成"完整铺开示例 ≥ 4 个主线页面"（已有 3 + 本轮必做 1） |
| 测试要求 | 为新接入页面补充集成级行为测试（与 `BooruArtistPage.*.test.tsx` 同级别） |
| 验收 | 新接入页面不再直接调 `window.electronAPI.booru.*` 的 post 操作相关 API；hook 签名保持向后兼容（其他 3 页面不改） |
| 依赖 | 无 |

---

### 2.5 TW-05 · 子窗口 preload 精简

| 项目 | 内容 |
|---|---|
| 审查报告条目 | 5.5 |
| 现状 | 子窗口与主窗口共享 `src/preload/index.ts`（676 行） |
| 目标 | 为子窗口抽独立 preload，只暴露该场景所需域 |
| 文件 | 新建 `src/preload/subwindow-index.ts`（或 `src/preload/subwindow/index.ts`，与现有结构对齐） |
| 暴露域锁定方法 | 先对 `SubWindowApp.tsx` 及其所有子组件做一次静态调用扫描（grep `window.electronAPI.`），列出**实际**使用到的 API；只暴露这些实际使用项。没扫到就不进。禁止按"可能用得上"预留 |
| 预期暴露域（待扫描确认） | 初步估计：`booru.*`（只读部分 + post 操作）、`image.*`、`window.*`、`system.openExternal`、`config.get`（只读） |
| 预期剔除域 | `gallery.*`、`db.*`、`config.save`、`bulkDownload.*`、`google.*`、`gphotos.*`、`gdrive.*`（最终以扫描结果为准） |
| 主进程配置 | `src/main/window.ts` 在创建子窗口时 `webPreferences.preload` 指向新路径 |
| 测试 | 新增测试：验证子窗口无法访问被剔除的 API（例如 `window.electronAPI.db` 为 undefined） |
| 依赖 | TW-02 完成（子窗口行为稳定后再做 preload 拆分） |

**关键决策**：采用"抽共用定义 + 按域组合"的方式，而不是复制粘贴；核心在 `src/preload/shared/`（若不存在则新建）下提供各域的 API 构造函数，主/子窗口各自组合所需域。

---

## 3. 架构与依赖关系

### 3.1 任务依赖图

```
TW-01 (独立)
TW-02 (独立) ──► TW-03 (先 chunks 后虚拟列表)
           └──► TW-05 (子窗口 preload)
TW-04 (独立)
```

- **并行组 A**：TW-01、TW-02、TW-04（彼此无耦合）
- **串行组 B**：TW-02 完成后 → TW-03、TW-05

### 3.2 文件影响面

| 模块 | 改动文件 | 风险级别 |
|---|---|---|
| 测试 | `tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx` | 低 |
| Renderer 路由 | `src/renderer/SubWindowApp.tsx`（或 `vite.config.ts`） | 中 |
| 构建配置 | `vite.config.ts` | 中 |
| Renderer 大列表 | `BooruPostListPage.tsx` 或 `BooruTagSearchPage.tsx`（仅一个） | 中 |
| Renderer hooks | `src/renderer/hooks/useBooruPostActions.ts`、`BooruFavoritesPage.tsx` | 中 |
| Preload | `src/preload/` 新增子窗口 preload，`src/main/window.ts` 挂载 | 中高 |
| 依赖 | 可能引入 `react-virtuoso`（TP-12 候选库之一） | 中 |

### 3.3 兼容性
- **主窗口行为不变**：TW-05 不改主窗口 preload 的对外 API
- **IPC 协议不变**：不新增/修改 `IPC_CHANNELS`
- **数据库结构不变**
- **配置 schema 不变**

---

## 4. Review 规范

### 4.1 单任务 3 轮 review（每个 TW 都要过）

每个 TW 任务提交后，**必须**派发 3 轮独立 agent：

| 轮次 | Agent 定位 | 核验点 |
|---|---|---|
| R1 功能实现 | 对照验收标准 | 每条验收项打勾；复现失败用例修复状态 |
| R2 偏移审查 | 对照 `重构文档` / TP 基线 | 无超范围改动；未把已签收 TP 项拖回 |
| R3 方案合理性 | 架构/可维护性/性能/安全 | 是否存在反模式、重复渲染、边界问题 |

- Review agent **必须**是不同 agent 实例
- **禁止**同一 agent 自写自查
- Review 发现问题 → 原 agent 或新 agent 修复 → **继续跑 3 轮**，直到清干净
- 推荐用 `code-reviewer` 子 agent 或 `Explore` 子 agent 做独立 review

### 4.2 整体 2 轮 review（所有 TW 完成后）

| 轮次 | Agent 定位 | 核验点 |
|---|---|---|
| G1 集成 review | 跨 TW 交互 | TW-02/03/05 组合是否产生未预期副作用（例如 manualChunks 与子窗口 preload 打包冲突） |
| G2 回归 review | 对照 `重构任务审查报告.md` | 已签收项（TP-01~13）没有因本轮改动被破坏 |

---

## 5. 验证标准

### 5.1 每任务完成后
- 相关局部测试通过
- `npm run build` 无新增警告

### 5.2 全部任务完成后
- `npm run test` 全量 ≥ 1574/1574 通过（TW-01 修复 flaky 后应该 1574/1574）
- `npm run build` 无"dynamically imported by ... is also statically imported by ..." 警告
- `vendor-antd` 单包 ≤ 600 kB（TW-03 验收）
- 手工 smoke：Booru 搜索/收藏/批量下载、子窗口打开、关闭到托盘、恢复下载

### 5.3 推送前最终自检
- 2 轮整体 review 无未解决问题
- 本轮所有新增/修改文件在 diff 中可追溯到 TW-xx 提交
- `重构任务审查报告.md` 第 5 节更新，把已收尾项标记完成

---

## 6. 交付

1. `git push origin feat/refactor-todo-full`
2. **不合并到 master**
3. 更新 `重构任务审查报告.md` 第 5 节
4. 更新 `TODO.md`（把 TW-01~05 标记为完成）

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| TW-03 引入 `react-virtuoso` 与现有组件样式/滚动行为冲突 | 先只接入一个页面；失败时回退到纯 manualChunks 方案，`react-virtuoso` 保留"已评估未接入" |
| TW-05 子窗口 preload 拆分后 IPC_CHANNELS 仍从主进程导入但其他域共用工具破坏边界 | 新增独立测试验证子窗口 `window.electronAPI` 只含允许域 |
| 并行 agent 改同一份文件造成冲突 | 依赖图严格遵守；同一文件的任务不并行 |
| Review agent 发现过多问题导致轮次爆炸 | 修复后只对**受影响范围**重跑 review，不全量重跑 |
| Flaky 修复仍然偶发 | CI 运行 10 次全部通过为准；不达标则改方案（fake timers → 重写测试） |

---

## 8. 本设计文档外的约束

- 遵守 `CLAUDE.md` 项目规范（外部网络走主进程、共享类型、日志、注释、中文 commit 等）
- 遵守 superpowers 规范（TDD、subagent-driven-development、verification-before-completion、requesting-code-review）
- 本机代理 `127.0.0.1:7897` 仅在网络问题时使用，不默认挂代理

---

## 9. 附录：与审查报告第 5 节的映射

| 审查报告条目 | 本设计任务包 | 是否收尾 |
|---|---|---|
| 5.1 flaky 测试 | TW-01 | 是 |
| 5.2 动态/静态导入冲突 | TW-02 | 是 |
| 5.3 `vendor-antd` 大小 | TW-03 | 是（分包 + 可选虚拟列表） |
| 5.4 `useBooruPostActions` 铺开 | TW-04 | 是（扩至 ≥ 4 个主线页面） |
| 5.5 子窗口 preload | TW-05 | 是（独立 preload） |
