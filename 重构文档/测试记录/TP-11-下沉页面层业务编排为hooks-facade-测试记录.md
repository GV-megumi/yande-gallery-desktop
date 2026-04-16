# TP-11 下沉页面层业务编排为 hooks / facade - 测试记录

## 1. 记录目的

本记录用于承接 `重构文档/测试用例/TP-11-下沉页面层业务编排为hooks-facade.md` 中要求的 source of truth、试点页面清单、归并流程清单、最小契约、迁移前基线、实际结果、证据路径与结论。

当前记录已从“执行前口径锁定”更新为 **TP-11 首切片完成后的收口复审与证据同步**。当前可确认的完成范围，仅限 Artist / Popular / Pools 三个试点页的统一 `postActions` 动作桥接，并已通过 15 / 15 自动化验证；不扩大为整个 TP-11 完成。此前测试记录中的覆盖缺口已在本轮证据同步后关闭，但未纳入首切片验收范围的后续项仍继续保持待补测或 N/A。

## 2. 执行环境

- 记录时间：2026-04-15
- 工作目录：`M:\yande\yande-gallery-desktop\.worktrees\refactor-todo-full`
- 分支：`feat/refactor-todo-full`
- 提交号：`e5e9e098a835f603ba26d998b47ff445bbab6546`
- 当前阶段：TP-11 首切片已完成 Artist / Popular / Pools 的统一 `postActions` 动作桥接，正在做最终收口复审与证据同步

## 3. Source of truth

本次 TP-11 记录采用以下 source of truth：

1. 测试设计文档：`重构文档/测试用例/TP-11-下沉页面层业务编排为hooks-facade.md`
2. 任务包总控：`重构文档/03-任务拆分总控.md`
3. 审查报告中的重复编排问题：`审查报告.md` 中 P1-12
4. 当前页面实现基线：
   - `src/renderer/pages/BooruArtistPage.tsx`
   - `src/renderer/pages/BooruPopularPage.tsx`
   - `src/renderer/pages/BooruPoolsPage.tsx`
   - `src/renderer/pages/BooruFavoritesPage.tsx`
   - `src/renderer/hooks/useFavorite.ts`
   - `src/renderer/components/BooruImageCard.tsx`
   - `src/renderer/pages/BooruPostDetailsPage.tsx`
5. 当前测试模式基线：
   - `tests/renderer/pages/FavoriteTagsPage.logic.test.ts`
   - `tests/renderer/pages/FavoriteTagsPage.render.test.tsx`
   - `tests/renderer/pages/BooruCharacterPage.test.tsx`

## 4. 本次试点页面清单

### 4.1 纳入首切片的页面

- `src/renderer/pages/BooruArtistPage.tsx`
- `src/renderer/pages/BooruPopularPage.tsx`
- `src/renderer/pages/BooruPoolsPage.tsx`

### 4.2 本轮明确不纳入首切片的页面

- `src/renderer/pages/BooruFavoritesPage.tsx`

### 4.3 暂缓到后续切片观察的页面

- `src/renderer/pages/BooruCharacterPage.tsx`
- `src/renderer/pages/BooruTagSearchPage.tsx`
- `src/renderer/pages/BooruPage.tsx`

## 5. 本次要求归并的重复业务流程清单

首切片只归并以下页面层重复业务编排，不扩大到数据加载、分页、搜索、站点加载等更大责任面：

1. 详情查看状态编排
   - 当前重复体现为 `selectedPost/detailPost` + `detailOpen/detailsPageOpen` + `onClose`
2. 本地收藏切换后的页面状态回填
   - 包括成功后更新页面中的 `post.isFavorited`
3. 服务端喜欢切换
   - 包括 `serverFavorites: Set<number>` 的维护和统一反馈
4. 下载动作编排
   - 包括 `addToDownload(postId, siteId)` 调用与统一成功/失败反馈
5. 详情页 / 卡片共用动作桥接
   - 包括 `BooruImageCard` 与 `BooruPostDetailsPage` 的动作 props 保持一致

## 6. 允许保留在页面层的逻辑

以下逻辑在首切片中允许继续保留在页面层，不纳入本次 facade / hook：

1. 页面级数据加载
   - 如热门列表加载、艺术家搜索、Pool 列表和 Pool 明细加载
2. 页面级搜索 / 筛选 / 分页
3. 站点加载与页面初始化流程
4. 页面特有的业务逻辑
   - 例如艺术家信息加载、标签收藏、Pool 导航、页面专属 header / toolbar 行为
5. `BooruFavoritesPage.tsx` 的取消收藏即从列表移除并可能翻页回退逻辑
   - 该行为与 Artist / Popular / Pools 明显不同，不能在首切片中硬统一

## 7. 最小输入输出契约（首切片）

本轮首切片拟形成的最小契约如下：

### 7.1 最小输入

- `siteId: number | null`
- `updatePosts: (updater) => void`
  - 由页面提供，用于把收藏状态回填到当前页面持有的帖子集合
- `localFavorite.toggle(post)`
  - 允许复用现有 `useFavorite`，而不是重写收藏底层逻辑
- 页面级反馈器
  - 当前页面仍使用 `message.success / message.error`

### 7.2 最小 view state

- `selectedPost: BooruPost | null`
- `detailOpen: boolean`
- `serverFavorites: Set<number>`
- `isServerFavorited(post): boolean`

### 7.3 最小 commands

- `openDetails(post)`
- `closeDetails()`
- `toggleFavorite(post)`
- `toggleServerFavorite(post)`
- `download(post)`

### 7.4 统一语义要求

- `toggleFavorite(post)` 成功后必须把当前页面中的对应帖子收藏态回填到最新值
- `toggleServerFavorite(post)` 成功后必须更新 `serverFavorites`
- `download(post)` 只负责提交下载与反馈，不负责额外页面刷新
- `openDetails(post)` / `closeDetails()` 负责统一详情弹层状态，不改变页面其他业务状态
- 契约必须继续兼容 `BooruImageCard` 与 `BooruPostDetailsPage` 现有动作 props

## 8. 迁移前基线

### 8.1 BooruPopularPage 当前基线

- 本地收藏由页面直接调用 `addFavorite/removeFavorite`
- 服务端喜欢由页面直接维护 `serverFavorites`
- 下载由页面直接调用 `addToDownload`
- 详情弹层由页面直接维护 `detailPost + detailOpen`

### 8.2 BooruArtistPage 当前基线

- 已复用 `useFavorite` 处理本地收藏底层逻辑
- 但服务端喜欢、下载、详情弹层仍由页面自己编排
- 收藏成功后的页面状态回填也仍写在页面层

### 8.3 BooruPoolsPage 当前基线

- 与 PopularPage 相同的三类动作重复存在
- 但回填目标是 `poolPosts` 而不是通用 `posts`

### 8.4 BooruFavoritesPage 当前差异基线

- 取消收藏会直接从当前列表删除数据，并在边界条件下回退分页
- 因此不属于首切片可直接统一的共性动作语义

## 9. 本次自动化 / 测试策略基线

### 9.1 纯逻辑测试模式

参考 `tests/renderer/pages/FavoriteTagsPage.logic.test.ts`：

- 用纯函数 / 轻状态对象验证最小契约与状态推导
- 首个 TP-11 失败测试优先落在“动作与状态契约”这一层

### 9.2 渲染桥接测试模式

参考：

- `tests/renderer/pages/FavoriteTagsPage.render.test.tsx`
- `tests/renderer/pages/BooruCharacterPage.test.tsx`

约定：

- 使用 `/** @vitest-environment jsdom */`
- 在 `beforeEach` 中 mock `window.electronAPI`
- 用组件测试验证页面是否通过统一动作契约触发下载 / 收藏 / 详情行为

## 10. 用例状态（当前阶段）

### 10.1 自动化证据汇总

- `tests/renderer/pages/BooruPostActions.logic.test.ts`：8 / 8 通过
- `tests/renderer/pages/BooruPostActions.integration.test.tsx`：7 / 7 通过
- 合并运行：15 / 15 通过

### 10.2 用例状态

| 用例 | 当前状态 | 说明 |
|---|---|---|
| TP-11-TC-001 试点页面清单与归并流程清单必须先被明确 | 通过 | 本记录第 4、5、6、7、8 节已锁定首切片 source of truth，且明确首切片只覆盖 Artist / Popular / Pools，`BooruFavoritesPage.tsx` 仍排除在外 |
| TP-11-TC-002 多页面相同业务动作应通过统一 commands 语义承接 | 通过 | 15 条自动化测试已直接覆盖 Artist / Popular / Pools 首切片的统一动作桥接：Artist 与 Popular 的本地收藏 / 下载均桥接到统一 `postActions`；Popular 的详情页与卡片服务端喜欢已桥接到 `postActions`；Pools 的详情加载与详情桥接也已纳入统一语义 |
| TP-11-TC-003 页面应主要消费 view state，而非重新拼接跨层原始对象 | 待补测 | 当前可确认 `useBooruPostActions` 逻辑与页面桥接测试已通过，但“页面主要消费 view state + commands”的结构性证据尚未以独立自动化或专项审查完整固化，因此暂不判通过 |
| TP-11-TC-004 失败、重试、刷新语义应由统一结构承接 | 待补测 | 本轮首切片自动化证据集中在动作桥接与关键闭环，尚未形成 Artist / Popular / Pools 跨页一致的失败、重试、刷新专项证据 |
| TP-11-TC-005 防抖、请求竞态与重复触发不应在各页重新实现 | 待补测 | 本轮首切片未提供搜索 / 刷新竞态、防抖或重复触发统一治理的完整自动化证据，不能误判通过 |
| TP-11-TC-006 轮询、订阅或自动刷新逻辑必须在页面卸载或隐藏后正确清理 | N/A | 本轮首切片不纳入轮询 / 订阅 / 自动刷新治理，当前测试也未覆盖该方向 |
| TP-11-TC-007 抽层后不应重新突破 IPC / preload / shared 边界，且不得把重编排上浮到 handler | 待补测 | 现有证据可证明 `useBooruPostActions` 逻辑与页面桥接可用，但尚缺针对 IPC / preload / shared 边界与 handler 职责收缩的独立核对证据 |
| TP-11-TC-008 页面特化逻辑必须有明确保留理由，不得拿“特殊情况”逃避归并 | 通过 | `BooruFavoritesPage.tsx` 仍明确不纳入首切片，排除理由与首切片边界一致，未被本轮实现错误扩大 |
| TP-11-TC-009 迁移后的试点页面应保持原有关键业务闭环不回退 | 通过 | 15 条自动化测试已直接支撑首切片关键闭环：Artist 页本地收藏 / 下载桥接到统一 `postActions`，且持久化 `isLiked` 能桥接到卡片服务端喜欢显示；Artist 页 `suspended` 时详情弹层 `open` 为 false；Popular 页本地收藏 / 下载与详情页 / 卡片服务端喜欢均桥接到 `postActions`；Pools 页翻页使用最新 `poolPage` 加载详情并保持详情桥接，切换新 pool 时会以第 1 页重新加载详情 |
| TP-11-TC-010 新增同类页面应能复用现有 facade / hook 契约 | 待补测 | 当前只证明首切片试点页可用，尚未对新增同类页面的复用接入形成独立证据，不能提前判通过 |

## 11. 当前结论

1. TP-11 首切片当前已完成的范围，严格限定为 `src/renderer/pages/BooruArtistPage.tsx`、`src/renderer/pages/BooruPopularPage.tsx`、`src/renderer/pages/BooruPoolsPage.tsx` 三个试点页的统一 `postActions` 动作桥接；`src/renderer/pages/BooruFavoritesPage.tsx` 仍不属于本轮首切片，也不能据此把结论扩大为整个 TP-11 完成。
2. 当前已有 15 / 15 条自动化测试作为首切片直接证据，分别覆盖 `tests/renderer/pages/BooruPostActions.logic.test.ts` 与 `tests/renderer/pages/BooruPostActions.integration.test.tsx`，可以确认 Artist / Popular / Pools 的统一 `postActions` 动作桥接已完成且无规格 / 质量阻塞。
3. 本轮需要收口固化的首切片结论包括：
   - Artist 页的本地收藏 / 下载已桥接到统一 `postActions`
   - Artist 页持久化 `isLiked` 已桥接到卡片服务端喜欢显示
   - Artist 页详情页 `open` 已改为 `postActions.detailOpen && !suspended`，保证 `suspended` 时详情弹层 `open` 为 false
   - Popular 页的本地收藏 / 下载、详情页与卡片服务端喜欢均已桥接到统一 `postActions`
   - Pools 页会使用最新 `poolPage` 加载详情并保持详情桥接，切换新 pool 时会以第 1 页重新加载详情
4. 之前测试记录中的首切片覆盖缺口，现已通过 15 / 15 自动化证据完成关闭；当前测试记录不再存在阻塞 TP-11 首切片收口的缺证问题。
5. 失败 / 重试 / 刷新统一语义、竞态 / 防抖统一治理、轮询 / 订阅清理、完整迁移前后闭环、以及新增同类页面复用边界，仍属于后续项；当前不纳入首切片通过结论，继续保持待补测或 N/A。

## 12. 后续补充位置

后续如继续推进 TP-11 非首切片范围，需在本记录补充以下内容：

- 失败测试路径、重试路径与刷新恢复证据
- “页面主要消费 view state + commands”的结构性证据
- IPC / preload / shared 边界与 handler 职责收缩的专项核对结果
- 竞态、防抖、重复触发统一治理证据
- 轮询 / 订阅 / 自动刷新在隐藏、卸载、重进场景下的清理证据
- 完整迁移前后闭环对比证据
- 新增同类页面接入现有 facade / hook 的复用边界证据
- 后续规格审查与代码审查结论