## 当前阶段：重构收尾（Post-Audit Wrap-Up）

### 背景

- 重构主体任务 TP-01 ~ TP-13 已在 `.worktrees/refactor-todo-full`（分支 `feat/refactor-todo-full`）落地
- 详见 `重构任务审查报告.md`，该报告已判定重构达到"整体可签收口径"
- 审查报告第 5 节列出 5 项尾部事项，本阶段对其做**全量收尾**（用户确认方案 D）

### 工作位置

- 工作树：`.worktrees/refactor-todo-full`
- 分支：`feat/refactor-todo-full`（已推送到 `origin`）
- 基线提交：`bc33730`
- 本阶段在同一分支上继续提交，**不新建分支**（重构主体已在此分支）

---

## 收尾任务包（TW-01 ~ TW-05）

### TW-01 修复 flaky 测试 · 对应审查报告 5.1

**问题**：`tests/renderer/pages/BooruSavedSearchesPage.render.test.tsx` 中"编辑保存搜索时应展示站点选择器并以 siteId 一致调用 updateSavedSearch" 用例，在 5000ms `waitFor` 内未完成断言（全局 testTimeout 已调至 30s，本案例为单条 waitFor 默认 5s 所致）。

**验收标准**：
- 该用例在 CI 与本地连续运行 10 次全部通过
- 不再依赖 `setTimeout(..., 5000)` 真实时延或脆弱的异步断言顺序
- 不通过提高全局 `testTimeout` 的方式绕过

**实施要点**：
- 优先用 `vi.useFakeTimers()` + `vi.advanceTimersByTime(...)` 将 5s 假时延 fake 化
- 若必须保留真实时延，给该 `waitFor` 显式 `{ timeout: 15_000 }`
- 修改需附测试日志证据（运行 10 次的连续通过结果）

---

### TW-02 消除动态/静态导入冲突 · 对应审查报告 5.2

**问题**：以下 3 个页面同时被 `App.tsx` 动态导入（`React.lazy`）与 `SubWindowApp.tsx` 静态导入，导致 Vite 动态分包失效，构建产出 3 条警告：
- `src/renderer/pages/BooruTagSearchPage.tsx`
- `src/renderer/pages/BooruArtistPage.tsx`
- `src/renderer/pages/BooruCharacterPage.tsx`

**验收标准**：
- `npm run build` 不再输出 "dynamically imported by ... is also statically imported by ..." 警告
- SubWindow 仍能在独立窗口中正常使用这 3 个页面
- 不引入循环依赖

**实施要点**：
- 首选方案：`SubWindowApp.tsx` 改走 `React.lazy` 保持与主窗口一致
- 备选方案：通过 `vite.config.ts` 的 `build.rollupOptions.output.manualChunks` 显式指定这 3 个页面进同一块
- 与现有 SubWindow 路由对接逻辑对齐，不得破坏 window-route 映射

---

### TW-03 `vendor-antd` 分包与虚拟列表评估接入 · 对应审查报告 5.3

**问题**：`vendor-antd` 产物约 1249 kB，超出常见 warning limit。

**验收标准**：
- `vendor-antd` 单包下降至 ≤ 600 kB（或按 Vite `manualChunks` 按需子分包）
- 大列表（如 Booru 搜索结果页）引入虚拟列表（优先 `react-virtuoso` 或 `@tanstack/react-virtual`，与 TP-12 评估结论对齐）
- 新增依赖版本、体积、回退方案记录进 `重构文档/测试记录/TP-12-评估并接入成熟库与现代化能力-测试记录.md` 的"已接入"小节
- 回归测试：Booru 大列表滚动、筛选、选中、批量下载流程无功能退化

**实施要点**：
- 先按 `antd` / `antd-icons` / 其他 vendor 三个维度拆子包，判断是否仍需虚拟列表
- 若虚拟列表必须接入：只改**一个**代表性大列表页（推荐 `BooruPostListPage` 或 `BooruTagSearchPage`），不追求全面替换
- 新增依赖需明确声明"本轮接入范围"并同步 `package.json`、锁定版本

---

### TW-04 `useBooruPostActions` 铺开 · 对应审查报告 5.4

**现状**：已在 `BooruArtistPage` / `BooruPoolsPage` / `BooruPopularPage` 接入，其余页面仍为页面层自建业务逻辑。

**验收标准**：
- 至少再覆盖以下主线页面之一：`BooruFavoritesPage`
- 抽取后这些页面层不再直接触达 `window.electronAPI.booru.*` 中与 post 操作相关的低层 API
- 现有 hook API 不因铺开而破坏向后兼容
- 新增测试覆盖：至少为新铺开的页面补一个集成级行为测试（等同 `BooruArtistPage.*.test.tsx` 同级别）

**实施要点**：
- 遵循 TP-11 的 hooks / facade 下沉设计
- 若遇到页面专属行为，优先扩展 hook options / 返回值而不是在页面层绕开 hook
- 不强求一次覆盖全部 Booru 页面，以一个**完整铺开示例**为准

---

### TW-05 子窗口 preload 精简 · 对应审查报告 5.5

**现状**：子窗口目前共享主窗口 preload（676 行），虽同信任域、非安全缺口，但不符合"最小暴露面"长期目标。

**验收标准**：
- 为子窗口（单独打开页）抽一份精简 preload（命名如 `subwindow-preload.ts`）
- 子窗口仅暴露该场景需要的域（如 `booru.*`、`image.*`、`window.*`），移除 `gallery.*`、`db.*`、`config.save` 等不必要能力
- 主窗口 preload 不受影响
- `src/main/window.ts` 为子窗口路径显式指定新 preload 路径
- 新增测试：验证子窗口无法访问被剔除的 API

**实施要点**：
- 抽一层 `preload/shared/` 通用 API 定义，主窗口 & 子窗口 preload 按各自域挑选
- 不破坏 IPC 单一来源（TP-05）：`IPC_CHANNELS` 仍从主进程 source 导入
- 跨子窗口通信（如有）优先复用现有 window 域 IPC，不自造

---

## 开发流程规范（本阶段严格执行）

### 1. 分支与提交

- 在 `feat/refactor-todo-full` 分支上继续提交
- 按 TW-01 ~ TW-05 的粒度提交，每个任务至少一个独立 commit
- Commit message 用中文，类型前缀保留英文（`fix(TW-01): ...`、`refactor(TW-04): ...`）
- **禁止 squash**，保留可追溯的提交历史

### 2. 子智能体派发

- 独立任务优先**并行派发**（TW-01/TW-02/TW-04/TW-05 之间无强依赖）
- TW-03 依赖潜在依赖升级，最后串行执行
- 每个子智能体的任务 prompt 必须包含：验收标准、实施要点、禁止事项、回归测试范围

### 3. Review 规范（硬性要求）

- **所有**代码改动必须经过至少 **3 轮独立 agent review**
- Review agent 必须是**不同 agent 实例**，**不得自写自查**
- Review 轮次：
  1. **功能实现 review**：对照验收标准逐条核验
  2. **偏移审查**：对照 `重构文档` 与 TP 基线，确认没有引入超范围改动或破坏现有 TP 成果
  3. **方案合理性审查**：架构、可维护性、安全、性能反模式审查
- Review 发现的问题由原实现 agent 或新 agent 修复，修复后需再次 review（直到 3 轮全部通过）

### 4. 验证

- 每个 TW 任务完成后：`npm run test` 所涉范围子集通过
- 所有 TW 完成后：
  - `npm run build` 无新增警告（`vendor-antd` 警告需按 TW-03 验收消除）
  - `npm run test` 全量通过，1574/1574
  - 手工验证：Booru 列表、批量下载、子窗口三大核心流程无退化

### 5. 最终整体 review

所有 TW 任务完成后，再派发 **2 轮** 独立 agent 对整体改动做：
- **集成 review**：跨 TW 交互是否有副作用
- **回归 review**：对照 `重构任务审查报告.md` 的现有结论，确认本轮改动没有把已签收项目拖回

### 6. 推送

- 所有 review 通过后 `git push origin feat/refactor-todo-full`
- **不合并到 master**，保留分支供后续集成评审
- 推送后更新 `重构任务审查报告.md` 第 5 节，把本轮解决的事项标记为"已收尾"

---

## 参考资料

- `重构任务审查报告.md` — 审查结论与收尾项定义
- `重构文档/` — TP 基线与测试记录
- `CLAUDE.md` — 项目开发规范
- 本机代理：`http://127.0.0.1:7897`（网络问题时备用）

**交付承诺：** 本阶段一次性走完 TW-01 ~ TW-05 + 3 轮 review + 2 轮整体 review + 推送，中途不停。
