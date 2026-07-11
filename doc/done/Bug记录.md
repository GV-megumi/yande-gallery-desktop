# Bug 记录

本文档用于记录当前批次发现、验证和后续处理的 Bug。每条记录必须先基于当前代码、配置、日志或可复现行为完成确认，再写入结论。

## 记录规则

- 先查证，再记录：不要只根据现象描述直接下结论。
- 记录证据：写明涉及文件、接口、配置、日志或复现路径。
- 区分状态：使用 `待查证`、`已确认`、`非 Bug`、`已修复`、`暂缓`。
- 保持简洁：只保留后续修复和回归验证需要的信息。

## 当前记录

### Bug1：标签加入黑名单后菜单仍显示“加入黑名单”

- 状态：已修复
- 现象：在帖子详情标签区右键标签，执行“加入黑名单”后，再次打开同一标签菜单仍显示“加入黑名单”，预期应切换为“移除黑名单”。
- 查证：截图中的菜单文案对应 `TagsSection` 的标签右键菜单；该组件已加载 `favoritedTags` 并用 `isFav` 在“收藏标签 / 取消收藏标签”之间切换，但黑名单菜单项固定写死为“加入黑名单”。`addToBlacklist` 成功后只提示成功，没有维护黑名单状态。主进程和 preload 已提供 `getBlacklistedTags` / `removeBlacklistedTag(id)` 能力，删除黑名单需要记录 `id`。
- 原因：`TagsSection` 没有加载当前站点黑名单列表，也没有保存 `tagName -> blacklistedTag.id` 的状态映射；加入成功后没有更新本地状态，菜单渲染时无法判断标签是否已在黑名单中。
- 影响范围：帖子详情页标签区的右键菜单；用户加入黑名单后无法从同一入口直接移除，只会再次触发添加并可能收到“标签已在黑名单中”的提示。
- 涉及文件：`src/renderer/components/BooruPostDetails/TagsSection.tsx`、`src/preload/shared/createBooruApi.ts`、`src/main/services/booruService.ts`。
- 处理建议：参考收藏标签状态逻辑，在 `TagsSection` 加载 `getBlacklistedTags({ siteId: site.id, limit: 0 })`，维护 `Map<tagName, id>`；菜单根据是否存在黑名单记录切换“加入黑名单 / 移除黑名单”；加入成功后写入返回记录，移除时调用 `removeBlacklistedTag(id)` 并删除本地映射。
- 验证方式：为 `TagsSection` 增加渲染层回归测试，覆盖已在黑名单时菜单显示“移除黑名单”、点击后调用 `removeBlacklistedTag(id)`，以及加入成功后菜单状态立即切换。
- 回归验证：`npx vitest run --config vitest.config.ts tests/renderer/components/TagsSection.blacklist.test.tsx` 已覆盖并通过；最终新增测试集合中通过。

### Bug2：图片详情页加载新图时短暂显示上一张缓存图

- 状态：已修复
- 现象：Booru 图片详情页切换到当前未缓存的图片时，主图区域会继续显示上一张已缓存图片，同时叠加“正在加载原图...”；待当前图片下载缓存完成后才切换为正确图片。预期是新图未准备好时不显示上一张图片。
- 查证：`BooruPostDetailsPage` 的原图加载 effect 只在 `!open || !currentPost` 时清空 `imageUrl`。切换到新 `currentPost` 后，进入缓存分支会先 `setIsCaching(true)` 并异步执行 `getCachedImageUrl` / `cacheImage`，但没有在开始加载时清空旧 `imageUrl`。渲染层只要 `imageUrl` 非空就继续渲染 `<img src={imageUrl}>`，加载提示是覆盖层，不会隐藏旧图。该 effect 也没有 `cancelled` / request id 守卫，快速切换时旧异步请求返回后仍可能写回 `imageUrl`。
- 原因：详情页把“当前应展示图片 URL”和“当前帖子加载中”耦合在单个 `imageUrl` 状态里，切换帖子时没有立即使旧 URL 失效，也没有防止过期异步回写。
- 影响范围：`BooruPostDetailsPage` 的上一张 / 下一张、列表打开详情后快速切换、幻灯片自动播放；在新图未缓存或网络较慢时更容易出现，用户会短暂看到与右侧详情不匹配的上一张图片。
- 涉及文件：`src/renderer/pages/BooruPostDetailsPage.tsx`。
- 处理建议：在 `currentPost` 变化开始加载时立即清空或标记当前 `imageUrl` 不可展示；为加载 effect 增加 `cancelled` 标记或递增 request id，所有异步返回前校验仍对应当前 `postId` / `md5`；加载中区域应显示占位/空黑底，而不是沿用旧图。图片 `onError` 回退逻辑也应只允许当前请求写回。
- 验证方式：增加渲染层回归测试，模拟第一张已有 `imageUrl`、切换到第二张且 `cacheImage` pending，断言加载期间不渲染第一张 src；再 resolve 第二张缓存，断言只显示第二张。另加快速切换 A→B→C 的过期请求回写守卫测试。
- 回归验证：`npx vitest run --config vitest.config.ts tests/renderer/pages/BooruPostDetailsPage.imageLoading.test.tsx` 已覆盖并通过；相关旧用例 `tests/renderer/pages/BooruPostDetailsPage.video.test.ts` 已通过。

### Bug3：Booru 图片列表加载时分页消失且缩略图首屏反馈偏慢

- 状态：已修复
- 现象：Booru 图片浏览页加载时会显示一整片骨架屏，但页码 / 分页控件消失；用户只能等本次加载完成后才重新看到页码。当前加载反馈偏慢，预期是保留页码和页面结构，先展示占位，缩略图完成后逐个淡入。
- 查证：`BooruPage` 在 `loadPosts` / `searchPosts` 开始时设置 `loading=true`，数据返回后才 `setPosts(data)` 和 `setCurrentPage(page)`。渲染层在 `loading` 为 true 时只渲染 `SkeletonGrid`，分页控件和 `BooruGridLayout` 被包在 `!loading && posts.length > 0` 分支中，因此加载期间必然消失。`BooruImageCard` 内部已有单卡片骨架、`img loading="lazy"` 和 `onLoad` 后淡入，但这些卡片只有在整批 `posts` 返回并取消全局 loading 后才会挂载。
- 原因：列表页使用单一全局 `loading` 控制整块内容，把“页面数据请求中”和“缩略图逐张加载中”混在一起；分页控件跟随内容分支被卸载，单卡片缩略图占位也被外层全局骨架挡住。
- 影响范围：`BooruPage` 的普通浏览、搜索翻页、按页跳转；网络慢、站点接口慢或搜索带标签分类时更明显。用户在加载期间失去页码上下文，也看不到当前目标页的稳定占位。
- 涉及文件：`src/renderer/pages/BooruPage.tsx`、`src/renderer/components/BooruGridLayout.tsx`、`src/renderer/components/BooruImageCard.tsx`、`src/renderer/components/SkeletonGrid.tsx`、`src/renderer/components/PaginationControl.tsx`。
- 处理建议：将分页控件从 `!loading` 分支中解耦，加载期间也保留当前页 / 目标页的分页栏，可禁用跳转按钮或显示轻量 loading 状态；区分 `pageLoading` 与缩略图加载状态，页面请求中展示与网格列宽一致的占位卡片，不卸载分页。拿到帖子元数据后立即渲染 `BooruGridLayout`，让 `BooruImageCard` 的单卡片骨架接管缩略图加载并逐张淡入。若元数据获取本身耗时较长，后续可考虑 IPC 分批返回或前端分块 `setPosts`，避免必须等整批结果才能出现第一批卡片。
- 验证方式：增加 `BooruPage` 渲染层测试，模拟 `getPosts` pending 时断言分页控件仍存在且按钮按 loading 策略禁用；resolve 返回帖子后断言卡片立即渲染，每张卡片在图片 `onLoad` 前显示自身占位、`onLoad` 后淡入。补充搜索翻页场景，确认页码不会在 loading 期间消失。
- 回归验证：`npx vitest run --config vitest.config.ts tests/renderer/pages/BooruPage.loadingPagination.test.tsx` 已覆盖并通过；相关分页、卡片旧用例已通过。

### Bug4：原图缓存完成后详情页偶发不刷新

- 状态：已修复
- 现象：Booru 详情页查看原图时，有时原图实际已经下载缓存完成，但界面仍停留在旧显示状态或加载状态，没有刷新到完成后的原图。
- 查证：主进程 `imageCacheService.cacheImage` 直接把下载流写入最终缓存路径，`getCachedImagePath` 只用 `fs.access(cachePath)` 判断缓存是否存在。下载过程中 `createWriteStream(cachePath)` 会让最终文件提前出现在磁盘上，其他详情页加载或预加载请求调用 `getCachedImageUrl` 时可能拿到尚未写完的 `app://...` URL。详情页把该 URL 写入 `imageUrl` 后，`<img>` 可能尝试加载不完整文件；真正下载完成后 URL 没变，`setImageUrl` 写同一个字符串不会触发有效刷新，图片元素也没有 `key` 或 cache-busting token 强制重新挂载。详情页原图加载 effect 也缺少请求取消 / request id 守卫，旧请求和当前请求可能互相覆盖 `imageUrl` 与 `isCaching`。
- 原因：缓存文件缺少“写入中”和“已完成”的原子边界，导致未完成文件被当作可展示缓存；renderer 只以 URL 字符串驱动刷新，同 URL 完成态无法触发重新加载。
- 影响范围：`BooruPostDetailsPage` 原图查看、上一张 / 下一张切换、详情页预加载与当前图加载并发时。网络慢、大图下载时间长、相邻图片预加载命中同一缓存项时更容易出现。
- 涉及文件：`src/main/services/imageCacheService.ts`、`src/main/ipc/handlers/booruHandlers.ts`、`src/renderer/pages/BooruPostDetailsPage.tsx`。
- 处理建议：`imageCacheService` 改为下载到临时文件（例如 `.part`），pipeline 完成并校验后再原子 `rename` 到最终路径；`getCachedImagePath` 必须只认最终完整文件，并避开 in-flight / `.part` 文件。`BooruPostDetailsPage` 的原图加载 effect 增加 request id 或 `cancelled` 守卫；图片渲染可用 `key` 或 `{url, version}` 状态，在缓存完成后强制创建新的 `<img>` 加载周期。`onError` 回退也要校验仍是当前请求，避免旧图错误覆盖新图。
- 验证方式：补充 `imageCacheService` 测试，模拟下载中 final path 不应被 `getCachedImageUrl` 识别，下载完成后才返回 `app://`。补充详情页渲染测试，模拟先拿到不完整缓存 URL / 或同 URL 完成回写，断言完成后图片元素会重新加载并显示原图；再覆盖快速切换时旧请求不能覆盖当前图。
- 回归验证：`npx vitest run --config vitest.config.ts tests/main/services/imageCacheService.atomic.test.ts` 已覆盖并通过；相关旧用例 `tests/main/services/imageCacheService.test.ts` 已通过。

### Bug5：Booru 状态变更缺少全局通知与跨页面消费

- 状态：已修复 / 已补全全局领域事件基础设施（2026-06-09）
- 现象：Booru 中帖子被本地收藏、服务端喜欢，或标签加入 / 移出黑名单后，其他窗口、子页面和已打开列表往往不会立即同步。加入黑名单后，当前 Booru 列表页应马上隐藏命中图片，黑名单命中列表也应立刻加入新标签；当前实现需要重新加载、切换站点或依赖局部状态刷新，体验不稳定。
- 查证：项目已有 `rendererEventBus`，会把 `RendererAppEvent` 广播到所有 `BrowserWindow`，并桥接到 API 事件流；`preload` 也暴露了 `system.onAppEvent` 供 renderer 订阅。但 `RendererAppEvent` 目前只覆盖批量下载、收藏标签、图库和缩略图事件，没有 `booru:post-favorite-changed`、`booru:server-favorite-changed`、`booru:blacklist-tags-changed` 等 Booru 状态事件。`booruService` 只在收藏标签相关操作里发出 `favorite-tags:changed`，普通帖子收藏、服务端喜欢、黑名单增删改没有发全局事件。`BooruPage` 只在站点变化时调用 `getActiveBlacklistTagNames`，黑名单命中统计和过滤结果都来自本页本地 `blacklistTagNames`；`useFavorite`、`useBooruPostActions` 以及多个 Booru 子页面也主要维护本地 `Set`，没有统一消费全局变更。
- 原因：现有事件总线能力存在，但 Booru 领域事件目录不完整；数据变更方没有统一在 mutation 成功后发布领域事件，消费方也没有统一 hook / store 来同步跨窗口、跨子页面状态，导致“谁改谁知道，别人不知道”。
- 影响范围：`BooruPage`、`BooruPostDetailsPage`、`BooruTagSearchPage`、`BooruCharacterPage`、`BooruArtistPage`、`BooruFavoritesPage`、`BooruPopularPage`、`BooruPoolsPage`、`BooruServerFavoritesPage` 以及多窗口 / 子窗口同时打开时的状态一致性。
- 涉及文件：`src/shared/types.ts`、`src/main/services/rendererEventBus.ts`、`src/main/services/booruService.ts`、`src/main/ipc/handlers/booruHandlers.ts`、`src/preload/shared/createSystemApi.ts`、`src/renderer/pages/BooruPage.tsx`、`src/renderer/hooks/useFavorite.ts`、`src/renderer/hooks/useBooruPostActions.ts`。
- 处理建议：先扩展 `RendererAppEvent` 的 Booru 领域事件契约，例如 `booru:post-favorite-changed`、`booru:server-favorite-changed`、`booru:blacklist-tags-changed`，payload 至少包含 `siteId`、`postId` / `tagName`、目标状态、动作类型和受影响数量。主进程在 `addToFavorites` / `removeFromFavorites`、`serverFavorite` / `serverUnfavorite`、黑名单 add / remove / toggle / update / batch / import 成功后统一发事件。renderer 侧沉淀 `useRendererAppEvent` / `useBooruDomainEvents` 一类消费 hook，支持按站点过滤、局部乐观更新、必要时防抖重新拉取。`BooruPage` 应先消费黑名单事件，更新 `blacklistTagNames` 后立即重算当前页过滤和命中统计；详情页、卡片列表和收藏 / 喜欢相关页面再消费帖子收藏与服务端喜欢事件，避免多处本地 Set 长期漂移。
- 简略重构规划：第一步补事件类型和主进程发事件测试，确保所有窗口都能收到同一 Booru 变更；第二步做 renderer 统一消费 hook，并优先接入黑名单变更，让当前页立即隐藏命中图片、命中列表立即更新；第三步接入本地收藏和服务端喜欢，统一同步列表卡片、详情页工具栏和各子页面；第四步整理文档，把哪些 mutation 会发哪些事件、消费者应该如何订阅写入 Renderer API / Booru 文档。
- 验证方式：补共享事件类型测试和 `rendererEventBus` 广播测试；补 `booruService` / IPC mutation 成功后发事件测试；补 `BooruPage` 回归测试，模拟黑名单新增事件后当前页命中图片立即从列表消失且命中统计出现新标签；补多组件挂载测试，模拟收藏 / 喜欢事件后列表卡片、详情工具栏和收藏页状态同步。
- 实施记录：已新增 `src/shared/appEvents.ts`、`src/main/services/appEventPublisher.ts`、`useRendererAppEvent`、`useBooruDomainEvents`、`useGalleryDomainEvents`，并将 Booru 收藏 / 服务端喜欢 / 黑名单 / 站点 / 保存搜索 / 分组 / 下载状态 / 投票、Gallery 图片 / 相册 / 无效图 / 忽略文件夹、批量下载任务 / record、配置、备份恢复、API 服务状态纳入统一 `RendererAppEvent`。高频下载进度仍保留专用 IPC。详细设计、落地范围和验证记录见 `doc/superpowers/specs/2026-06-09-global-domain-events-sync-design.md`、`doc/superpowers/plans/2026-06-09-global-domain-events-sync-fix.md` 和 `doc/全局领域事件与跨窗口状态同步缺陷审查.md`。

## 2026-06-10 全局领域事件批次 Code Review 修复记录

- 来源：对全局领域事件批次 commit `101fca0` 与 `3795573` 的 code review，共确认 15 项缺陷，本批已全部修复完成。
- 统一回归验证：`npx tsc -p tsconfig.main.json --noEmit` 与 `npx tsc -p tsconfig.preload.json --noEmit` 通过；`npm run test` 全量 2163 个测试（基线 2140 + 本批新增 23 个回归测试）全部通过。以下各条「回归验证」仅列出针对性的测试文件。

### Bug6：setPostLiked 误发 synced 事件导致服务端喜欢页无限远程请求循环（严重）

- 状态：已修复
- 现象：打开服务端喜欢页后，每次拉取服务端收藏都会触发新一轮远程 API 请求，形成无限请求循环，且分页不断弹回第 1 页。
- 原因：`setPostLiked` 的 isLiked UPDATE 没有值守卫，node-sqlite3 的 `this.changes` 按匹配行（而非实际修改行）计数，导致同步服务端喜欢状态时即使状态未变也误发 `booru:server-favorite-changed`（action='synced'）事件；`BooruServerFavoritesPage` 收到 isLiked=true 事件即调用 `loadServerFavorites(1)`，拉取→事件→再拉取叠加成循环并弹回第 1 页。
- 涉及文件：`src/main/services/booruService.ts`、`src/renderer/pages/BooruServerFavoritesPage.tsx`。
- 修复方案：UPDATE 增加 `AND COALESCE(isLiked, 0) != ?` 值守卫，仅真实状态翻转才计入 changes（NULL 视为 0），`syncPostLikedStates` 的 synced 聚合事件因此只在有真实变更时广播；页面侧防御纵深——忽略 action='synced' 事件（其来源是本页自身拉取触发的同步），真实 liked 事件改为刷新当前页而非固定回到第 1 页。
- 回归验证：`tests/main/services/booruService.appEvents.test.ts`（全部 changes=0 时不广播 synced）、`tests/renderer/pages/BooruServerFavoritesPage.domainEvents.test.tsx`（synced 不触发重新拉取；liked 刷新当前页而非第 1 页）。

### Bug7：removeFromFavorites 对未收藏帖子误发 removed 事件

- 状态：已修复
- 现象：对从未收藏过的帖子执行取消收藏，仍会广播 `booru:post-favorite-changed`（action='removed'）事件，订阅页面被无谓刷新。
- 原因：与 Bug6 同根因——isFavorited=0 的 UPDATE 无值守卫，匹配行即计入 changes，事件发布未以真实变更为前提。
- 涉及文件：`src/main/services/booruService.ts`。
- 修复方案：UPDATE 增加 `AND isFavorited != 0` 守卫（NULL 行经 `NULL != 0` 求值为 NULL 同样被排除，语义上即未收藏），且仅当 `Math.max(deleteResult.changes, updateResult.changes) > 0` 时才发 removed 事件。
- 回归验证：`tests/main/services/booruService.appEvents.test.ts`（changes=0 时不发事件 + 守卫 SQL 断言）。

### Bug8：updateSavedSearch 跨站点移动后旧站点订阅者不刷新

- 状态：已修复
- 现象：保存的搜索从站点 A 移动到站点 B 后，按站点 A 过滤订阅的页面收不到 `booru:saved-searches-changed` 事件，旧站点列表残留已移走的条目。
- 原因：事件 payload 只携带新 siteId，按旧站点过滤的订阅者匹配不到。
- 涉及文件：`src/main/services/booruService.ts`、`src/shared/appEvents.ts`、`src/renderer/hooks/useBooruDomainEvents.ts`。
- 修复方案：payload 增加可选 `previousSiteId`（仅跨站点移动时携带，非移动场景 payload 形状不变）；`useBooruDomainEvents` 派发时匹配 `siteId` 或已定义的 `previousSiteId` 任意一个即可命中订阅者。
- 回归验证：`tests/main/services/booruService.appEvents.test.ts`（跨站点移动事件包含 previousSiteId）、`tests/renderer/hooks/useBooruDomainEvents.test.tsx`（旧站点订阅者收到事件、无关站点不收）。

### Bug9：setActiveBooruSite 对不存在的站点 id 清空全部 active 标记

- 状态：已修复
- 现象：传入不存在的站点 id 时，会先清空所有站点的 active 标记再设置目标（无行受影响），应用失去激活站点，且照常广播 sites-changed 事件。
- 原因：事务内先无条件清零全部 active 标记，未事先校验目标站点存在性。
- 涉及文件：`src/main/services/booruService.ts`。
- 修复方案：在既有事务内先 SELECT 校验目标站点存在，不存在则抛出「站点不存在: <id>」并回滚——不清标记、不发事件；IPC handler 已有 catch 兜底返回 `{ success: false, error }`，无需改动。
- 回归验证：`tests/main/services/booruService.appEvents.test.ts`（不存在 id 时拒绝且不清标记、不发事件）。

### Bug10：详情页主图 onError 回退在 sample/preview 间无限乒乓重试

- 状态：已修复
- 现象：帖子的 sample 与 preview 均不可达时（如已删除帖、离线），`BooruPostDetailsPage` 主图 onError 回退在 sample→preview→sample 间无限交替，每轮重挂 img 元素并发起新的网络请求。
- 原因：回退候选筛选只排除「刚失败的 URL」（`url !== imageUrl && url !== img.src`），不记录历史失败 URL，两个候选互为对方的「未失败」选项。
- 涉及文件：`src/renderer/pages/BooruPostDetailsPage.tsx`。
- 修复方案：新增 `failedImageUrlsRef`（Set）累计本轮回退链中全部失败 URL（同时记录 imageUrl 与 img.src），候选改为查找未失败 URL；候选耗尽时输出 `[BooruPostDetailsPage]` 前缀警告并停止重试（不再 bump imageVersion、不再重挂 img、不再发请求），保留现有失败占位表现；切换帖子（imageLoadKey 变化）时重置 Set，新帖回退链可正常工作。
- 回归验证：`tests/renderer/pages/BooruPostDetailsPage.imageLoading.test.tsx`（全部候选失败后停止乒乓；切换帖子后失败记录复位，2 个新用例）。

### Bug11：BooruPage 站点事件触发 loadSites 后丢弃用户手动选择的站点

- 状态：已修复
- 现象：任何 `booru:sites-changed` 事件（包括与当前站点无关的更新）触发 `loadSites` 后，无条件 `setSelectedSiteId(activeSite.id)`，丢弃用户手动选择的非激活站点，清空帖子并重置回第 1 页，浏览位置丢失。
- 原因：`loadSites` 重载站点列表后未判断原选中站点是否仍然有效，直接重置为 active/首个站点。
- 涉及文件：`src/renderer/pages/BooruPage.tsx`。
- 修复方案：改为函数式 setState——原选中站点仍在重载后的列表中则原样返回（React state bail-out，不触发依赖 `selectedSiteId` 的清空/重载 effect）；仅初次加载（prev 为 null）或选中站点已被删除时回退到 active 站点 ?? 首个站点，空列表分支行为不变。
- 回归验证：`tests/renderer/pages/BooruPage.loadingPagination.test.tsx`（sites-changed 后保持手动选中的非激活站点，不重新拉取帖子）。

### Bug12：BooruFavoritesPage 站点事件触发 loadSites 后重置站点选择

- 状态：已修复
- 现象：与 Bug11 同模式——任何站点事件重载站点列表后无条件 `setSelectedSiteId(siteList[0].id)`，丢弃用户在收藏页手动选择的站点。
- 原因：同 Bug11，`loadSites` 未保留仍然有效的既有选择。
- 涉及文件：`src/renderer/pages/BooruFavoritesPage.tsx`。
- 修复方案：同款函数式 setState——`setSelectedSiteId(prev => siteList.some(s => s.id === prev) ? prev : siteList[0].id)`，并以 `prev !== null` 守卫保证初次挂载仍选中首个站点，空列表重置分支不变。
- 回归验证：`tests/renderer/pages/BooruFavoritesPage.domainEvents.test.tsx`（sites-changed 后保持手动选中的下拉站点，无额外 getFavorites 调用）。

### Bug13：BooruFavoritesPage 收藏事件刷新缺少防抖与请求序号守卫

- 状态：已修复
- 现象：批量取消收藏等场景下，每条 `booru:post-favorite-changed`（removed）事件都立即触发一次 `loadFavorites`，N 条事件产生 N 次请求，且乱序响应可能互相覆盖列表与 loading 状态。
- 原因：事件处理直接调用 `loadFavorites(currentPage)`，没有像 `BlacklistedTagsPage` 那样的防抖合并与请求序号守卫。
- 涉及文件：`src/renderer/pages/BooruFavoritesPage.tsx`。
- 修复方案：按 BlacklistedTagsPage 同款模式补齐——新增 `scheduleFavoritesReload`（50ms 防抖，经 ref 取最新 loadFavorites 闭包与当前页码）合并事件风暴为一次刷新；`loadFavorites` 内加 `loadFavoritesRequestIdRef` 请求序号守卫，过期响应在数据、错误与 loading 路径上一律丢弃；卸载时清理待定定时器。
- 回归验证：`tests/renderer/pages/BooruFavoritesPage.domainEvents.test.tsx`（3 条连发 removed 事件只触发 1 次 getFavorites，无尾部重复刷新）。

### Bug14：useRendererAppEvent 挂起页面脏事件缓冲无上限

- 状态：已修复
- 现象：页面处于非激活（导航缓存挂起）状态时脏事件无限堆积；长时间挂起后内存持续增长，恢复激活时同步逐条重放全部事件，可能瞬间冻结 UI。
- 原因：`dirtyEventsRef` 为无上限平铺数组，恢复时逐条重放，无溢出策略。
- 涉及文件：`src/renderer/hooks/useRendererAppEvent.ts`。
- 修复方案：改为 `DirtyEventBuffer`（有序数组 + 按类型计数 + 溢出最新事件 Map）：每事件类型缓冲上限 50 条；第 51 条到达时丢弃该类型全部已缓冲事件、仅保留最新一条（后续事件覆盖之）并按溢出输出一次 `[useRendererAppEvent]` 前缀 warn；恢复时未溢出类型按到达顺序重放，溢出类型只补发最新一条；typeKey 变化时整体重置。Hook 公开签名不变，7 处调用方无需改动。
- 回归验证：`tests/renderer/hooks/useRendererAppEvent.test.tsx`（单类型 60 连发仅 1 次 warn、恢复时仅重放最新一条；混合类型下未溢出类型按序重放、溢出类型最后补发最新）。

### Bug15：createSystemApi 的 onAppEvent 每个订阅者各注册一个 ipcRenderer 监听器

- 状态：已修复
- 现象：`system.onAppEvent` 每次订阅都执行一次 `ipcRenderer.on(SYSTEM_APP_EVENT, ...)`，订阅者增多时底层监听器线性增长，存在 MaxListeners 告警与重复派发开销风险。
- 原因：未做单监听器多路分发，订阅与底层 IPC 监听一一对应。
- 涉及文件：`src/preload/shared/createSystemApi.ts`。
- 修复方案：闭包内改为多路分发——首次订阅时懒注册唯一一个 SYSTEM_APP_EVENT 监听器，内部 `Set` 维护回调并以快照遍历派发（派发期间增删订阅不影响本轮）；退订幂等（守卫标志防止重复退订误删他人状态），Set 清空时移除底层监听器并允许后续重新懒注册。对外 API 与回调 payload 完全不变。
- 回归验证：`tests/preload/main-exposure.test.ts`（双订阅者共享单个 ipc 注册、均收到事件；移除一个保留监听器、重复退订为 no-op、移除最后一个才 removeListener、再订阅可重新注册）。

### Bug16：备份恢复后未广播 legacy CONFIG_CHANGED 通道

- 状态：已修复
- 现象：备份恢复完成后只在新事件总线发出 `config:changed`，仍订阅 legacy `IPC_CHANNELS.CONFIG_CHANGED` 的 preload 订阅者（`config.onChanged`、`booruPreferences.onAppearanceChanged`）继续持有过期配置。
- 原因：`restoreAppBackupData` 只调用了新总线的 `emitConfigChanged`，缺少与 configHandlers 配置保存路径一致的双通道广播。
- 涉及文件：`src/main/services/backupService.ts`。
- 修复方案：构建一份 `ConfigChangedSummary`，同时发往新总线与 legacy 通道——新增 `broadcastLegacyConfigChanged` 遍历 `BrowserWindow.getAllWindows()` 发送 CONFIG_CHANGED（payload 形状与 `configHandlers.broadcastConfigChanged` 保持一致，含 isDestroyed 守卫，动态 import electron 保证测试环境可运行），两通道携带相同 version。
- 回归验证：`tests/main/services/backupService.test.ts`（恢复成功后存活窗口恰好收到一次 CONFIG_CHANGED 且 payload 符合 ConfigChangedSummary 形状，已销毁窗口不收）。

### Bug17：deleteImage 用 SQL LIKE 前缀匹配归属图库导致兄弟目录误归属

- 状态：已修复
- 现象：删除图片时以 `? LIKE folderPath || '%'` 匹配归属图库：无尾部路径分隔符导致兄弟前缀目录误归属（如 `D:\pics\cats2` 中的图片被归到图库 `D:\pics\cats`）；无 ESCAPE 子句导致 folderPath 含 `_` / `%` 时误匹配，`gallery:images-changed` 事件携带错误 galleryId。
- 原因：用 SQL LIKE 做文件路径前缀判断，既无路径边界约束也未转义 LIKE 元字符。
- 涉及文件：`src/main/services/imageService.ts`。
- 修复方案：改为 TS 内精确匹配——新增 `findGalleryIdForImagePath` 取全部图库行，以既有 `normalizePath` 规范化后比较（win32 下大小写不敏感），要求「完全相等或前缀 + path.sep 边界」，多个命中取最长 folderPath（保留原 ORDER BY LENGTH DESC 的嵌套语义）；图库数量小，全量取行开销可忽略。
- 回归验证：`tests/main/services/imageService.deleteImage.test.ts`（正确归属、兄弟前缀目录不误归、LIKE 元字符不误匹配、嵌套图库取最长、win32 大小写不敏感，共 5 个新用例）。

### Bug18：批量下载页纯 trailing 防抖在事件风暴下刷新饿死

- 状态：已修复
- 现象：下载风暴期间 records-changed 事件（每个文件完成/失败各一条）间隔持续小于 200ms，`BooruBulkDownloadPage.scheduleRefresh` 的纯 trailing 防抖定时器被不断重置，整个风暴期间列表永不刷新。
- 原因：防抖只有 trailing 边沿，无最大等待兜底。
- 涉及文件：`src/renderer/pages/BooruBulkDownloadPage.tsx`。
- 修复方案：补 1000ms maxWait 兜底——`refreshFirstPendingAtRef` 记录本轮防抖窗口首次挂起时间戳，新事件到达时若距首次挂起已超 maxWait 则清掉 trailing 定时器立即强制刷新，否则维持原 200ms trailing 重计时（稀疏事件行为不变）；卸载清理时一并复位时间戳 ref。
- 回归验证：`tests/renderer/pages/BooruBulkDownloadPage.test.tsx`（1.5s 持续事件风暴中 t=1000ms 处发生强制刷新，风暴结束后 trailing 再补刷恰好一次；并经 git stash 验证旧实现无法通过该用例）。

### Bug19：retryFailedRecord 把有副作用的看门调用放在状态校验之前

- 状态：已修复
- 现象：对仍存活的 history 会话重试一条非 failed 记录时，先触发 `ensureCanEnterRunning` 的副作用（软删本 session 或同 taskId 的其他 history session）之后才校验失败并报错，造成无谓且不可逆的数据变更。
- 原因：纯校验 `targetRecord.status !== 'failed'` 原位于看门调用之后，校验仅依赖看门前已查出的记录行，顺序排列错误。
- 涉及文件：`src/main/services/bulkDownloadService.ts`。
- 修复方案：将该纯校验前移到 targetRecord 存在性检查之后、`activeSessionIsHistory` 计算与首次 `ensureCanEnterRunning` 之前，非 failed 记录直接返回「Failed record not found」，不执行任何 mutation；删除原位置的重复检查，并补中文注释说明「纯校验必须先于带副作用的看门」。
- 回归验证：`tests/main/services/bulkDownloadService.retryMerged.test.ts`（history 会话 + 同 taskId 活跃会话 + 非 failed 记录：返回校验错误、无 merged 字段、无任何软删 mutation；同时修正一个原本依赖此 bug 的既有用例 mock）。

### Bug20：downloadRecord 中过期注释与实际广播行为矛盾

- 状态：已修复
- 现象：`bulkDownloadService.ts` 约 2265 行注释写「即使状态更新失败，也继续广播状态，让前端知道下载完成」，与 commit 3795573 之后的实际代码（仅 `statusUpdateSuccess` 为真时才广播）矛盾，误导后续维护。
- 原因：行为在 3795573 中改为「仅成功才广播」，注释未同步更新。
- 涉及文件：`src/main/services/bulkDownloadService.ts`。
- 修复方案：注释更正为「状态更新失败时不广播：只有数据库 mutation 成功后才发布事件（下方以 statusUpdateSuccess 守卫）」，与实际行为一致。无任何代码行为变化。
- 回归验证：纯注释修订，以全部 13 个 `bulkDownloadService.*.test.ts`（110 个测试，含基于源码文本断言的 eventIntegrity 套件）通过确认无行为回归。

## 条目模板

### BugX：标题

- 状态：待查证
- 现象：
- 查证：
- 原因：
- 影响范围：
- 涉及文件：
- 处理建议：
- 验证方式：
