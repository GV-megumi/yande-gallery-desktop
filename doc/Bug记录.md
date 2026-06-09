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
- 实施记录：已新增 `src/shared/appEvents.ts`、`src/main/services/appEventPublisher.ts`、`useRendererAppEvent`、`useBooruDomainEvents`、`useGalleryDomainEvents`，并将 Booru 收藏 / 服务端喜欢 / 黑名单 / 站点 / 保存搜索 / 分组 / 下载状态 / 投票、Gallery 图片 / 图集 / 无效图 / 忽略文件夹、批量下载任务 / record、配置、备份恢复、API 服务状态纳入统一 `RendererAppEvent`。高频下载进度仍保留专用 IPC。详细设计、落地范围和验证记录见 `doc/superpowers/specs/2026-06-09-global-domain-events-sync-design.md`、`doc/superpowers/plans/2026-06-09-global-domain-events-sync-fix.md` 和 `doc/全局领域事件与跨窗口状态同步缺陷审查.md`。

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
