# 标签收藏页一键批量下载与图集绑定方案

## 1. 目标

为 `FavoriteTagsPage` 增加一组围绕“收藏标签 -> 批量下载 -> 本地图集”协同的新能力：

1. 在标签收藏页对某个收藏标签一键发起批量下载；
2. 在每一条标签记录上显示当前下载进度；
3. 在每一条标签记录上显示上次下载时间；
4. 支持把该标签的默认下载目录绑定到某个本地图集；
5. 复用现有 bulk download 基础设施，不推翻已有任务 / 会话 / 记录模型；
6. 为后续“按收藏标签查看历史下载”“自动刷新图集”等能力预留扩展空间。

本方案仅定义设计与实现路径，不直接包含代码实现。

## 2. 现状总结

### 2.1 收藏标签

- 页面：`src/renderer/pages/FavoriteTagsPage.tsx`
- 数据模型：`FavoriteTag`
- 数据表：`booru_favorite_tags`
- 当前支持：搜索、编辑、删除、拖拽排序、按站点过滤

当前收藏标签记录只描述“收藏什么标签”，不描述：

- 默认下载目录
- 绑定图集
- 最近一次下载任务 / 会话
- 上次下载时间
- 当前下载状态

### 2.2 批量下载

- 当前 bulk download 架构分为三层：
  - `bulk_download_tasks`：任务模板 / 配置
  - `bulk_download_sessions`：某次运行
  - `bulk_download_records`：逐文件记录
- 现有能力已经支持：
  - 创建任务
  - 创建会话
  - 启动会话
  - 恢复会话
  - 逐记录状态与进度事件推送
- 当前缺口：bulk download 体系并不知道某个任务 / 会话是不是由 favorite tag 发起的。

### 2.3 图集 / gallery

- 图集由 `galleries` 表持久化，已有稳定 `id`
- 图集语义上绑定一个 `folderPath`
- 应用中的写操作和展示操作以 `galleryId` 为主要身份

因此，对 favorite tag 的绑定应优先指向 `galleryId`，而不是只保存裸 `folderPath`。

## 3. 设计原则

### 3.1 不污染 `booru_favorite_tags`

收藏标签表只保留“收藏标签本身”的元数据，不直接承载下载运行态。

### 3.2 复用现有 bulk download 运行模型

不新造并行下载体系。真正的下载依旧通过现有：

1. create task
2. create session
3. start session

### 3.3 配置态与运行态分离

- 配置态：favorite tag 的下载配置、绑定图集、默认路径
- 历史快照：最近一次会话、上次下载时间、最近状态
- 实时运行态：当前进度、当前状态，通过 session/records 聚合并结合事件流刷新

### 3.4 图集绑定优先使用 `galleryId`

`galleryId` 是应用内部最稳定、最自然的关联目标；下载路径仍需单独保留，因为 bulk download 当前直接依赖 `path`。

## 4. 推荐数据模型

## 4.1 新增表：`booru_favorite_tag_download_bindings`

推荐新增一张表，用于描述“某个 favorite tag 的下载配置与最近运行快照”。

建议字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 主键 |
| `favoriteTagId` | INTEGER NOT NULL UNIQUE | 对应 `booru_favorite_tags.id` |
| `galleryId` | INTEGER NULL | 对应 `galleries.id`，可空 |
| `downloadPath` | TEXT NOT NULL | 默认下载目录 |
| `enabled` | INTEGER NOT NULL DEFAULT 1 | 是否启用该标签的一键下载配置 |
| `quality` | TEXT NULL | 默认下载质量策略 |
| `perPage` | INTEGER NULL | 覆盖 bulk download 默认值 |
| `concurrency` | INTEGER NULL | 覆盖 bulk download 默认值 |
| `skipIfExists` | INTEGER NULL | 覆盖默认值 |
| `notifications` | INTEGER NULL | 覆盖默认值 |
| `blacklistedTags` | TEXT NULL | 该标签下载额外黑名单，序列化存储 |
| `lastTaskId` | TEXT NULL | 最近创建的 bulk task，需与现有 bulk task id 类型一致 |
| `lastSessionId` | TEXT NULL | 最近一次运行 session，需与现有 bulk session id 类型一致 |
| `lastStartedAt` | TEXT NULL | 最近启动时间 |
| `lastCompletedAt` | TEXT NULL | 最近完成时间 |
| `lastStatus` | TEXT NULL | 最近一次下载状态快照 |
| `createdAt` | TEXT NOT NULL | 创建时间 |
| `updatedAt` | TEXT NOT NULL | 更新时间 |

推荐约束：

- `UNIQUE(favoriteTagId)`
- `FOREIGN KEY(favoriteTagId) REFERENCES booru_favorite_tags(id) ON DELETE CASCADE`
- `FOREIGN KEY(galleryId) REFERENCES galleries(id) ON DELETE SET NULL`

补充说明：

- `lastTaskId` / `lastSessionId` 第一阶段必须与当前 `src/shared/types.ts` 中 bulk download ID 的实际类型保持一致。
- 当前 bulk download 的共享类型以字符串 ID 为主，因此 binding 表不应假设这两个字段是整数。
- 第一阶段不要求为每个 favorite tag 预先创建 binding 记录；只有用户首次保存下载配置后才创建对应行。

## 4.2 为什么不直接给 `booru_favorite_tags` 加字段

不推荐直接往 `booru_favorite_tags` 添加如下字段：

- `galleryId`
- `downloadPath`
- `lastSessionId`
- `lastDownloadAt`
- `progress`

原因：

1. 收藏标签和下载运行态不是同一类数据；
2. 一个标签后续可能多次发起下载；
3. 当前 bulk download 已经有独立 task/session/record 模型；
4. 若混放到收藏标签表中，后续扩展会快速失控。

## 4.3 第一阶段不改 bulk download 三张主表

第一阶段建议不修改：

- `bulk_download_tasks`
- `bulk_download_sessions`
- `bulk_download_records`

原因：

- 当前已经能通过 binding 表中的 `lastSessionId` 找到对应进度和历史时间；
- 先用最小改动让链路跑通；
- 等未来需要“按 favorite tag 查看完整下载历史”时，再考虑在 session 上增加来源字段。

## 4.4 第二阶段增强（可选）

后续若需要增强可追踪性，可考虑给 `bulk_download_sessions` 增加：

- `originType`（如 `favorite_tag`）
- `originId`（即 `favoriteTagId`）

这可以让历史追溯更自然，但不是第一阶段必需项。

## 4.5 Shared Types 补充

第一阶段需要同步补充共享类型，避免 renderer / preload / main 各自定义数据结构。

建议新增：

```ts
type FavoriteTagDownloadBinding = {
  id: number
  favoriteTagId: number
  galleryId: number | null
  downloadPath: string
  enabled: boolean
  quality?: string | null
  perPage?: number | null
  concurrency?: number | null
  skipIfExists?: boolean | null
  notifications?: boolean | null
  blacklistedTags?: string[] | null
  lastTaskId?: string | null
  lastSessionId?: string | null
  lastStartedAt?: string | null
  lastCompletedAt?: string | null
  lastStatus?: string | null
  createdAt: string
  updatedAt: string
}

type FavoriteTagDownloadRuntimeProgress = {
  sessionId: string
  status: string
  completed: number
  total: number
  percent: number
  failed?: number
}

type FavoriteTagWithDownloadState = FavoriteTag & {
  downloadBinding?: FavoriteTagDownloadBinding
  runtimeProgress?: FavoriteTagDownloadRuntimeProgress | null
  galleryName?: string | null
}
```

以及 payload 类型：

```ts
type UpsertFavoriteTagDownloadBindingInput = {
  favoriteTagId: number
  galleryId?: number | null
  downloadPath: string
  enabled?: boolean
  quality?: string | null
  perPage?: number | null
  concurrency?: number | null
  skipIfExists?: boolean | null
  notifications?: boolean | null
  blacklistedTags?: string[] | null
}
```

## 5. 状态协调方案

## 5.1 需要持久化的状态

以下状态建议落库：

- `galleryId`
- `downloadPath`
- 默认下载参数
- `lastTaskId`
- `lastSessionId`
- `lastStartedAt`
- `lastCompletedAt`
- `lastStatus`

原因是这些状态用于：

- 页面初始渲染
- 历史快照展示
- 页面刷新后恢复上下文

## 5.2 不建议直接持久化的实时状态

以下状态不建议额外在 binding 表中冗余保存：

- 当前百分比
- 当前已完成数 / 总数
- 当前下载字节数

这些数据应从：

- `bulk_download_sessions`
- `bulk_download_records`
- IPC 实时事件

进行运行时聚合。

## 5.3 行内进度展示来源

favorite tag 行中的状态应由两层组成：

### 历史快照层

来自 binding 表：

- `lastSessionId`
- `lastStartedAt`
- `lastCompletedAt`
- `lastStatus`

### 实时运行层

如果 `lastSessionId` 对应的 session 当前仍处于活跃状态，则：

- 从 session 聚合总体状态
- 从 records 聚合总数、完成数、失败数、百分比
- 通过现有 `system.onBulkDownloadRecordProgress / Status` 持续刷新

## 6. 服务与模块协作

## 6.1 推荐新增主进程服务能力

建议在主进程侧新增一组 favorite tag download binding 相关方法，例如：

- `getFavoriteTagDownloadBinding(favoriteTagId)`
- `upsertFavoriteTagDownloadBinding(input)`
- `deleteFavoriteTagDownloadBinding(favoriteTagId)`
- `getFavoriteTagsWithDownloadState(siteId?)`
- `startFavoriteTagBulkDownload(favoriteTagId)`

其中：

### `getFavoriteTagsWithDownloadState(siteId?)`

返回 enriched 数据，避免 renderer 自己拼多段异步 join。

建议返回结构：

```ts
type FavoriteTagWithDownloadState = FavoriteTag & {
  downloadBinding?: {
    galleryId: number | null
    galleryName?: string
    downloadPath: string
    lastTaskId?: string | null
    lastSessionId?: string | null
    lastStartedAt?: string | null
    lastCompletedAt?: string | null
    lastStatus?: string | null
  }
  runtimeProgress?: {
    sessionId: string
    status: string
    completed: number
    total: number
    percent: number
    failed?: number
  } | null
}
```

### `startFavoriteTagBulkDownload(favoriteTagId)`

建议由主进程统一封装，不建议让 renderer 自己串联：

- 读 favorite tag
- 读 binding
- 校验 gallery 与 path
- create task
- create session
- start session
- 回写 lastTaskId / lastSessionId / lastStartedAt / lastStatus

统一放在主进程有几个好处：

1. 避免页面逻辑过重；
2. 校验逻辑集中；
3. 后续更容易补日志和回溯；
4. 可以更自然地做失败处理与状态回写。

### 6.1.1 `queryType` 规则

这是第一阶段必须先定死的产品 / 技术边界。

推荐规则：

- 第一阶段只支持 `FavoriteTag.queryType === 'tag'` 的一键下载；
- `queryType === 'raw'` 和 `queryType === 'list'` 在第一阶段不支持直接一键下载；
- UI 上应禁用下载按钮，并给出说明文案；
- 若未来要支持 `raw` / `list`，需要单独定义其映射到 bulk download `tags` 输入的规则，而不是在第一阶段模糊兼容。

## 6.2 图集与目录一致性校验

当 binding 中设置了 `galleryId` 时，服务层应执行：

1. 读取 gallery；
2. 确认 gallery 存在；
3. 确认 `downloadPath === gallery.folderPath`；
4. 若不一致，则拒绝启动并返回可读错误。

第一阶段不建议自动修正路径，优先明确报错，避免隐式行为。

### 6.2.1 失败回写规则

`startFavoriteTagBulkDownload` 的失败路径需要明确，避免“最后状态”不可验证：

1. **读取 favorite tag / binding 失败**
   - 不写入新的 `lastTaskId` / `lastSessionId`
   - 可选择更新 `lastStatus = 'configError'`，或保持原快照不变
2. **gallery / path 校验失败**
   - 不创建 task / session
   - 写入 `lastStatus = 'validationError'`
3. **createTask 失败**
   - 不写入 `lastTaskId`
   - 写入 `lastStatus = 'taskCreateFailed'`
4. **createSession 失败**
   - 可保留 `lastTaskId`
   - 不写入 `lastSessionId`
   - 写入 `lastStatus = 'sessionCreateFailed'`
5. **startSession 调用成功**
   - 写入 `lastTaskId`、`lastSessionId`、`lastStartedAt`、`lastStatus = 'starting'`
6. **session 运行中失败 / 完成**
   - 由后续状态刷新逻辑更新 `lastStatus`
   - 完成时写入 `lastCompletedAt`

## 6.3 bulk download 复用路径

`startFavoriteTagBulkDownload` 内部仍然走现有 bulk download 链路：

1. 根据 favorite tag 和 binding 组装 task input
2. create bulk download task
3. create session
4. start session
5. 更新 binding 快照字段

其中 task input 典型来源：

- `siteId`：来自 `favoriteTag.siteId`
- `tags`：默认仅使用 `[favoriteTag.tagName]`
- `path`：来自 binding.downloadPath
- 其他参数：来自 binding 配置或 bulk 默认值

## 7. Renderer / UI 方案

## 7.1 页面位置

功能落在：

- `src/renderer/pages/FavoriteTagsPage.tsx`

原因：

- 当前 already 是表格行视图；
- 已存在行级操作列；
- 最适合展示“状态、进度、上次下载时间、绑定图集”。

## 7.2 建议新增列

在 favorite tags 表格中建议新增：

- `绑定图集`
- `下载状态`
- `下载进度`
- `上次下载时间`

## 7.3 建议新增操作

行级操作建议变为：

- 搜索
- 下载
- 配置下载
- 绑定图集
- 编辑
- 删除

## 7.4 推荐交互流程

### 场景 A：已配置过下载

点击“下载”后：

1. 直接发起 `startFavoriteTagBulkDownload(favoriteTagId)`
2. 行内状态立即切到“启动中 / 扫描中 / 下载中”
3. 进度列开始随 events 更新

### 场景 B：未配置下载

点击“下载”后：

1. 弹出配置对话框
2. 至少要求设置：
   - 下载目录
   - 可选绑定图集
   - 可选下载参数
3. 保存配置后可直接启动第一次下载

### 场景 C：绑定图集

第一阶段建议只支持“选择已有图集”。

不建议第一阶段同时支持：

- 选择目录并自动创建图集
- 自动扫描图集
- 自动同步图集封面

这些可以作为第二阶段增强。

## 7.5 行内状态文案建议

建议统一一套状态映射：

- 未配置
- 就绪
- 启动中
- 扫描中
- 下载中
- 已完成
- 已暂停
- 失败

其中：

- `上次下载时间` 建议优先展示 `lastCompletedAt`，若无则回退 `lastStartedAt`
- `下载进度` 建议显示为 `completed / total` + 百分比

## 7.6 数据刷新与事件契约

FavoriteTagsPage 的数据刷新需要明确区分“初始查询”和“实时更新”。

### 初始查询

- 页面初始加载时调用 `getFavoriteTagsWithDownloadState(siteId?)`
- 切换站点过滤、保存配置、删除 binding、启动下载成功后，重新调用一次该接口

### 实时更新

- 只对当前表格中存在 `downloadBinding.lastSessionId` 且该 session 仍活跃的行做运行态刷新
- `system.onBulkDownloadRecordProgress / Status` 到达时，只有当事件中的 `sessionId === row.downloadBinding.lastSessionId` 才更新对应行
- 实时更新优先更新 `runtimeProgress`
- 当 session 进入终态（completed / failed / paused / cancelled）时，触发一次该行或整表重取，以刷新 `lastStatus` / `lastCompletedAt`

### 聚合来源

- `total`、`completed`、`failed` 第一阶段统一从 `bulk_download_records` 聚合
- 第一阶段不依赖当前仓库中尚未稳定使用的 `bulk_download_session_stats`

## 8. 推荐接口边界

## 8.1 preload / IPC 推荐新增能力

建议通过 `window.electronAPI.booru.*` 暴露：

- `getFavoriteTagsWithDownloadState(siteId?)`
- `getFavoriteTagDownloadBinding(favoriteTagId)`
- `upsertFavoriteTagDownloadBinding(payload)`
- `removeFavoriteTagDownloadBinding(favoriteTagId)`
- `startFavoriteTagBulkDownload(favoriteTagId)`

这样 feature 仍然在 Booru 域下，避免 renderer 同时理解太多内部 service 细节。

## 8.2 不建议第一阶段暴露过多低层组合接口

第一阶段不建议额外给 renderer 暴露很多“半成品”组合能力，例如：

- `linkFavoriteTagToBulkTask`
- `resolveFavoriteTagDownloadRuntimeProgress`

这些逻辑应放在主进程集中聚合。

## 8.3 Binding 删除语义

需要明确“删除 favorite tag”与“删除下载绑定”不是同一动作：

- 删除 favorite tag：依赖 FK cascade 自动删除 binding
- 删除下载绑定：保留 favorite tag，只移除其下载配置

第一阶段建议在 UI 中提供“清除下载配置 / 解除绑定”能力，而不是把它隐藏成纯内部 API。

## 8.4 Migration 策略

本仓库当前数据库演进方式以 `src/main/services/database.ts` 为准，第一阶段应沿用现有风格：

1. `CREATE TABLE IF NOT EXISTS booru_favorite_tag_download_bindings`
2. 如后续新增字段，沿用 `columnExists(...)` + `ALTER TABLE ... ADD COLUMN`
3. 为 `favoriteTagId`、`galleryId`、`lastSessionId` 增加必要索引
4. 不做 destructive migration
5. 不做历史 backfill：已有 favorite tag 默认没有 binding 行，只有用户首次配置后才创建

## 9. 分阶段实施建议

## Phase 1：最小可用版本

目标：让标签收藏页具备“配置下载 + 一键下载 + 状态展示 + 绑定图集”能力。

包括：

1. 新增 `booru_favorite_tag_download_bindings`
2. 新增主进程 binding CRUD
3. 新增 enriched favorite tag 查询
4. 新增一键下载启动接口
5. FavoriteTagsPage 增加列与操作
6. 显示上次下载时间、状态、进度、绑定图集

## Phase 2：增强可追踪性

目标：让 favorite tag 与 download history 的关系更可追溯。

可选增强：

1. 在 `bulk_download_sessions` 增加 `originType / originId`
2. 支持按 favorite tag 查看历史下载会话
3. 支持失败原因归档与重试入口联动

## Phase 3：增强自动化

目标：让 favorite tag、下载目录和本地图集更紧密联动。

可选增强：

1. 绑定图集时支持自动创建图集
2. 下载完成后自动触发图集刷新 / 扫描
3. 支持图集绑定一致性修复提示

## 10. 风险与注意事项

### 10.1 `siteId` 可空时的启动策略

当前 favorite tag 支持 `siteId` 可空。对于 bulk download，这意味着：

- 若标签未绑定具体站点，则无法可靠发起下载
- 第一阶段建议：未指定 `siteId` 的 favorite tag 禁用一键下载或要求先选择站点

这是必须明确的产品规则。

### 10.2 查询成本

如果 favorite tags 很多，而每行都需要实时聚合 session/record 进度，则需要注意查询成本。

第一阶段建议：

- 只对当前页面上存在 `lastSessionId` 且状态活跃的行做运行态聚合
- 历史行优先用快照展示

### 10.3 gallery 与 path 一致性

若 `galleryId` 已设置但 `downloadPath` 和 `gallery.folderPath` 不一致，会造成用户认知错位。

必须在主进程强校验，而不是依赖 renderer 自觉保持一致。

### 10.4 第一阶段范围控制

第一阶段应严格限制为：

- 单 favorite tag -> 单次 bulk download 启动
- 仅支持已有图集绑定
- 仅支持当前 favorite tag 的默认参数配置

不要在第一阶段混入：

- 自动创建图集
- 复杂 saved search 复用
- 多标签模板化下载
- 完整历史统计面板

## 11. 建议实施顺序

1. 数据库新增 binding 表与迁移
2. shared types 增加 binding / enriched row 类型
3. main service 增加 binding CRUD 与 startFavoriteTagBulkDownload
4. preload / IPC 暴露新能力
5. FavoriteTagsPage 增加列与操作
6. 接入 existing bulk download event 流进行行内刷新
7. 校验 gallery-path 一致性与 siteId 规则

## 11.1 第一阶段验证清单

进入实现前，方案至少要能覆盖以下可验证结果：

1. 数据库能成功创建 `booru_favorite_tag_download_bindings`
2. existing favorite tag 在无 binding 时仍能正常显示
3. `queryType !== 'tag'` 的 favorite tag 会禁用一键下载
4. `siteId == null` 的 favorite tag 会禁用一键下载或要求先选站点
5. 绑定 `galleryId` 后若 `downloadPath !== gallery.folderPath`，启动会被拒绝
6. 启动成功后页面能显示“启动中 / 扫描中 / 下载中”中的至少一种状态
7. 页面刷新后仍能看到 `lastStatus` 与 `上次下载时间`
8. session 终态后页面可重新获取到最终快照

## 12. 最终推荐结论

本功能的第一阶段推荐落地方式是：

- **新增 `booru_favorite_tag_download_bindings` 表**，不要把下载运行态直接塞入 `booru_favorite_tags`
- **以 `galleryId` 作为图集绑定主键**，同时保留 `downloadPath` 作为实际下载目标
- **复用现有 bulk download task/session/record 架构**，不在第一阶段修改三张 bulk 主表
- **通过 binding 表保存最近运行快照**，并以 `lastSessionId` 为桥接点聚合当前实时进度
- **由主进程提供一键启动与 enriched 查询能力**，不要让 renderer 自己拼整条链路

这条路线改动范围可控、与现有架构兼容、可逐步增强，是当前仓库下最稳妥的方案。
