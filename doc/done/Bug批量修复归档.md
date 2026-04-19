# Bug 批量修复归档

## 文档定位

本文件整合原 `doc/done/bug*.md` 中的编号 Bug 修复记录。原先这些文件按单个问题拆分，适合执行阶段；当前已归并为一个历史归档，方便按主题追溯。

归档范围：

- Bug1：一级菜单切换与页面缓存
- Bug2：批量下载开始后活跃会话刷新
- Bug3：批量下载详情弹窗重复关闭入口
- Bug4：收藏标签下载配置路径输入框不显示
- Bug5：收藏标签已完成下载再次触发被误判为任务已存在
- Bug7：批量下载并发闸门与 `queued` 等待队列
- Bug8：单条下载暂停误判失败与取消入口
- Bug9：通知 / 桌面行为设置与 `notificationService`
- Bug10：图集详情返回后被旧偏好恢复
- Bug11：图集卡片右键用单独窗口打开
- Bug12：图集删除级联清理与忽略名单
- Bug13：删除图片查询不存在的 `thumbnailPath`
- Bug16：缓存大小输入框静默 clamp

说明：编号不连续是因为原执行批次只留下了这些最终确认的问题文档。

## 总览表

| 编号 | 主题 | 核心落点 | 规则沉淀位置 |
| --- | --- | --- | --- |
| Bug1 | 一级菜单缓存恢复 | `App.tsx` 统一 `mountedPageIds`，一级菜单切换恢复 pin 或基础页实例 | `doc/注意事项/导航缓存与页面偏好持久化.md` |
| Bug2 | 批量下载启动反馈 | `createSession` 后立即刷新会话，`startSession` 后台执行，避免 UI 等 dryRun 阻塞 | `doc/注意事项/下载与批量会话状态机.md` |
| Bug3 | 弹窗重复关闭入口 | 只保留 Modal 默认 X 或自绘关闭入口之一 | `doc/注意事项/Antd 表单与弹窗约定.md` |
| Bug4 | 表单路径不显示 | `Form.Item name` 的直接子组件必须是受控输入，`Space.Compact` 放外层 | `doc/注意事项/Antd 表单与弹窗约定.md` |
| Bug5 | 收藏标签重新下载 | 任务模板去重和运行会话去重分离；无存活会话时可复用模板启动新会话 | `doc/注意事项/下载与批量会话状态机.md` |
| Bug7 | 批量下载排队 | `bulkDownload.maxConcurrentSessions`、`queued`、`promoteNextQueued` 闭环 | `doc/注意事项/下载与批量会话状态机.md` |
| Bug8 | 单条下载暂停/取消 | 用户主动中断标志优先，新增 `cancelDownload(queueId)` | `doc/注意事项/下载与批量会话状态机.md` |
| Bug9 | 通知与桌面行为 | `notifications` / `desktop` 配置，抽 `notificationService`，通知点击导航 | `doc/注意事项/Electron桌面行为与通知.md` |
| Bug10 | 图集返回偏好清空 | `selectedGalleryId` 支持 `null` 显式清空，返回动作同步落盘 | `doc/注意事项/导航缓存与页面偏好持久化.md` |
| Bug11 | 图集子窗口打开 | `openSecondaryMenu(section, key, tab?, extra?)` 携带 `galleryId`，子窗口禁用偏好污染 | `doc/注意事项/导航缓存与页面偏好持久化.md` |
| Bug12 | 图集删除与忽略名单 | 删除图集级联清 DB / 缩略图 / 偏好，写入 `gallery_ignored_folders` | `doc/注意事项/数据库与删除级联规范.md` |
| Bug13 | 删除图片 schema 错误 | `images` 表没有 `thumbnailPath`，缩略图清理走 `thumbnailService.deleteThumbnail` | `doc/注意事项/数据库与删除级联规范.md` |
| Bug16 | InputNumber 静默 clamp | 不随手写硬 `max`，需要边界时用 `Form.Item rules` 显式校验 | `doc/注意事项/Antd 表单与弹窗约定.md` |

## 详细归档

### Bug1：一级菜单切换未恢复 pin 缓存 + 基础页常驻缓存

问题：一级菜单只切左侧分组时，没有检查目标 section 的当前 subKey 是否已固定；缓存实例仍在树里，但前台看到的是基础层新实例，导致页面状态丢失。

修复：

- 将原 `mountedPinnedIds` 统一为 `mountedPageIds`，基础页和固定页共用一个页面缓存层。
- 引入 `renderPageForId(section, key, isActive)` 工厂，避免页面渲染依赖全局 `selectedKey`。
- 二级菜单切换时维护 `mountedPageIds`，固定项保留，非固定旧页按需释放。
- 一级菜单切换时若目标页是 pin，走 `handlePinnedClick`；否则清 `activePinnedId` 回到基础页。
- 首次进入 section 时自动把当前页加入缓存集合。

保留规则：不要再恢复 base / pinned 双层渲染同一页面的结构；任何页面同一时刻只应有一个激活实例。

### Bug2：批量下载“开始”已保存任务后活跃会话列表要手动刷新

问题：从已保存任务点击“开始”后，UI 等待 `startSession` 完成才刷新；而 `startSession` 内含 dryRun / 扫描，可能阻塞数秒甚至更久，用户看不到新会话卡片。

修复：

- `createSession` 成功后立即 `loadSessions()`，先展示 `pending` 会话。
- `startSession` 放进后台 IIFE，不阻塞当前交互。
- `startSession` 完成或失败后再刷新一次，让卡片从 `pending` 自然流转到 `dryRun` / `running` / `failed`。

保留规则：长后端调用前后要有“立刻一次 + 完成后一次”两次刷新，避免 UI 反馈被后端耗时吞掉。

### Bug3：批量下载详情弹窗关闭按钮与 X 重复

问题：批量下载详情 Modal 默认 `closable=true`，内容区又自绘“关闭”按钮，导致同一个弹窗出现两个关闭入口。

修复：

- 删除内容区自绘关闭按钮，保留 Antd Modal 默认 X。
- Modal 的关闭语义统一走 `onCancel`。

保留规则：一个 Modal 只保留一个关闭入口；如果内容区自画按钮，必须显式 `closable={false}`。

### Bug4：配置标签下载弹窗中“自动下载目录”输入框不显示路径

问题：`Form.Item name="downloadPath"` 的直接子组件是 `Space.Compact`，Antd 注入的 `value/onChange` 被布局容器截住，内部 `Input` 拿不到表单值。

修复：

- 外层 `Form.Item` 只负责 label / layout。
- 内层用 `Form.Item name="downloadPath" noStyle` 包真正的 `Input`。
- 保留选择目录按钮在同一个 `Space.Compact` 布局里。

保留规则：`Form.Item name` 的直接子组件必须是真正受控输入，布局容器不能直接承接注入。

### Bug5：收藏标签已完成下载再次点击“下载”被误判为“任务已存在”

问题：收藏标签一键下载命中 `bulk_download_tasks` 的 `path + tags` 模板去重后，直接返回 `deduplicated=true`，没有检查该任务是否还有存活会话；结果历史会话已完成后也无法重新下载。

修复：

- `createBulkDownloadTask` 的 `deduplicated` 只表示任务模板已存在。
- `startFavoriteTagBulkDownload` 命中模板去重后，调用 `hasActiveSessionForTask(taskId)`。
- 只有存在存活会话时才返回“任务已存在”；没有存活会话时继续 `createSession + startSession`。

保留规则：任务模板去重和运行会话去重不能合并；一个任务模板可以对应多次会话。

### Bug7：批量下载没有并发会话上限，缺少等待队列

问题：多个批量下载会话可无上限同时进入 `dryRun` / `running`，容易触发站点限流、本地 IO 争抢和 UI 混乱。

修复：

- `BulkDownloadSessionStatus` 增加 `queued`。
- `StatusTag` 增加 `queued` 文案。
- 配置新增 `bulkDownload.maxConcurrentSessions`，默认 3。
- 后端新增 `countActiveSessions`、`schedulerMutex`、`getNextQueuedSessionId`、`promoteNextQueued`。
- `startBulkDownloadSession` 超过运行槽位时写 `queued` 并返回；`queued` 分支幂等。
- 完成 / 失败 / 暂停 / 取消 / allSkipped 等离开运行槽位时推进队首。
- 启动恢复先把待恢复会话置 `queued`，再按并发上限推进。
- 前端活跃会话集合包含 `queued`，被排队时提示“已加入队列”。

保留规则：并发上限必须覆盖状态枚举、UI 映射、前端过滤、后端闸门、所有释放槽位出口和启动恢复。

### Bug8：下载管理暂停误判失败与缺单条取消入口

问题：

- 单条下载暂停时 abort 可能抛 `ECONNRESET` / `socket hang up` 等错误，旧逻辑靠字符串匹配识别用户中止，导致暂停被覆盖成 `failed`。
- 进行中列表缺少单条取消入口。

修复：

- `downloadManager` 使用 `userInterruptedStatuses` 记录用户主动 `paused` / `cancelled`。
- `handleDownloadError` 只看该显式标志，不再用错误字符串二次判断。
- 新增 `cancelDownload(queueId)`，接入 service、IPC、preload 和前端按钮。
- 取消正在下载的任务时 abort 请求、删除 active 记录、清理 `.part` 临时文件，并广播 `cancelled`。

保留规则：用户主动中断的显式标志是权威；下载失败清理只针对临时文件，不应误删最终目标。

### Bug9：Settings 加通知 / 桌面行为开关 + 抽 notificationService

问题：底层已有部分通知能力，但设置页没有开关；单图下载不接通知；通知点击只聚焦窗口不导航；关闭行为、开机自启、启动最小化缺 UI 和配置闭环。

修复：

- 配置新增 `notifications` 与 `desktop` 顶层字段。
- 新增 `getNotificationsConfig()` / `getDesktopConfig()`，旧配置缺字段时有默认值兜底。
- 抽出 `notificationService.ts`，统一批量会话通知和单图通知。
- 批量下载通知走三级判断：全局开关、终态开关、任务级开关。
- 单图下载成功 / 真实失败接入通知，用户暂停 / 取消不通知。
- 新增 `system:navigate` 事件，通知点击可跳到下载中心或会话详情。
- 主窗口关闭按 `desktop.closeAction` 分流为缩到托盘 / 退出 / 询问。
- 启动和配置变更时应用 `app.setLoginItemSettings({ openAtLogin, openAsHidden })`。
- 设置页新增“通知”和“桌面行为”两个分组，并做 optimistic update + 失败回滚。

保留规则：新增设置项必须 source of truth、service、IPC/preload、UI、验收五层闭环。

### Bug10：图集详情“返回”后仍自动恢复到旧图集

问题：图集详情页返回只清了页面内存状态，`pagePreferences.gallery.galleries.selectedGalleryId` 的落盘清理可能被防抖 effect 取消；切走再回来时旧 id 又被水合回来。

修复：

- 主进程 `rebuildPagePreferences` 支持 `selectedGalleryId: null` 表示显式删除字段。
- 返回按钮同步保存清空后的偏好，不依赖防抖。
- 图库页回到列表后不再被旧详情 id 自动拉回。

保留规则：用户主动“返回 / 关闭”这类明确动作要同步落盘清空偏好，不能依赖卸载时可能被取消的防抖。

### Bug11：图集卡片右键新增“用单独窗口打开”

问题：图集详情只能在主窗口内部打开，缺少把某个图集直接放进子窗口查看的入口；若借页面偏好传 id，会污染主窗口记忆。

修复：

- `window.openSecondaryMenu(section, key, tab?, extra?)` 增加 `extra` query。
- 主进程屏蔽 `extra` 中的保留键 `section` / `key` / `tab`。
- `SubWindowApp` 解析 `galleryId` 并传给 `GalleryPage`。
- `GalleryPage` 支持 `initialGalleryId` 和 `disablePreferencesPersistence`，子窗口模式不写回主窗口偏好。
- 图集卡片右键菜单新增“用单独窗口打开”。

保留规则：子窗口上下文用 URL query / prop 显式传递，不借共享 `pagePreferences` 做临时通信。

### Bug12：删除图集级联清理 + 已忽略文件夹机制

问题：删除图集若只删 `galleries` 一行，会留下 `images`、缩略图、Booru 本地关联、无效图片记录和页面偏好残留；扫描根目录时还可能把刚删的图集重新创建回来。

修复：

- 新增 `gallery_ignored_folders` 表，存归一化目录路径和备注。
- `deleteGallery(id)` 按 `galleries.recursive` 决定清理范围：
  - `recursive=1` 清整棵子树。
  - `recursive=0` 只清直接子文件。
- 删除流程清理图片元数据、缩略图缓存、`booru_posts.localImageId` / 下载状态、本地无效图片记录和图库偏好里的 `selectedGalleryId`。
- 删除后写入忽略名单，扫描 / 同步命中后跳过整棵子树。
- 暴露忽略名单 CRUD：list / add / update / remove。
- 设置页新增忽略文件夹管理入口。

保留规则：删除和扫描 / 恢复必须成对设计；会被扫描重建的数据，删除时要同时堵住再发现路径。

### Bug13：删除图片报 `SQLITE_ERROR: no such column: thumbnailPath`

问题：`deleteImage` 查询 `images.thumbnailPath`，但当前 schema 的 `images` 表没有这个字段；`thumbnailPath` 只存在于 `invalid_images`。

修复：

- `deleteImage` 的 SELECT 只查 `images` 表真实存在字段。
- 缩略图清理改走 `thumbnailService.deleteThumbnail(imagePath)`，由服务按哈希规则反推路径。
- 删除图片时继续清理数据库记录、磁盘原图和缩略图。

保留规则：写 SELECT 前必须回到 `database.ts` 核对当前 schema；跨表字段名不能靠记忆。

### Bug16：缓存目录最大大小被硬夹到 5000 MB

问题：Booru 外观配置里的缓存目录最大大小输入框写了 `InputNumber max={5000}`，Antd 会静默 clamp，用户输入更大的值会被自动改掉且没有提示；后端配置本身没有同等上限。

修复：

- 去掉或提高不合理的硬 `max`。
- 需要产品边界时使用 `Form.Item rules` 做显式校验，给出错误文案。
- 顺带复核 `Form.Item + Space.Compact` 包法，避免表单值被布局容器截住。
- 体检其它数值输入框，确认 `min/max` 都是产品真实边界。

保留规则：`InputNumber max/min` 是静默修正，不是用户可感知校验；不要用拍脑袋上限。

## 长期维护入口

这些 Bug 的执行细节已经归入当前文档体系：

- 下载和批量会话状态：`doc/注意事项/下载与批量会话状态机.md`
- 导航缓存和页面偏好：`doc/注意事项/导航缓存与页面偏好持久化.md`
- 数据库与删除级联：`doc/注意事项/数据库与删除级联规范.md`
- Antd 表单与弹窗：`doc/注意事项/Antd 表单与弹窗约定.md`
- 桌面行为与通知：`doc/注意事项/Electron桌面行为与通知.md`
- Electron 安全边界：`doc/注意事项/Electron安全边界.md`

如当前文档与代码不一致，以代码为准，并同步更新对应主文档或注意事项。
