# 方案调研发现

## 当前任务

标签收藏页一键批量下载、逐条进度展示、上次下载时间、图集绑定。

## 已确认现状

### 1. 标签收藏当前模型

- 标签收藏页主文件是 `src/renderer/pages/FavoriteTagsPage.tsx`。
- 当前页面是基于 `FavoriteTag` 的表格视图，已存在行级操作列，天然适合增加“一键批量下载”和状态显示。
- `FavoriteTag` 当前字段主要包括：`id`、`siteId`、`tagName`、`labels`、`queryType`、`notes`、`sortOrder`、`createdAt`、`updatedAt`。
- 收藏标签落在 `booru_favorite_tags` 表中。
- 当前收藏标签模型里**没有**任何下载相关字段，例如：
  - 上次下载时间
  - 当前关联的批量下载任务 / 会话
  - 绑定图集
  - 下载目标路径

### 2. 批量下载当前模型

- 当前批量下载是独立的三层模型：
  - `bulk_download_tasks`：任务模板 / 配置
  - `bulk_download_sessions`：某次运行会话
  - `bulk_download_records`：会话中的逐文件记录
- 批量下载当前已经支持：
  - 创建任务
  - 创建会话
  - 启动会话
  - 恢复未完成会话
  - 逐记录进度事件推送
- 逐文件进度已经能持久化在 `bulk_download_records.progress / downloadedBytes / totalBytes` 中。
- 会话层的“上次运行时间”可以从 `bulk_download_sessions.startedAt / completedAt` 获得。
- 但当前批量下载模型**没有**与收藏标签的关系字段，无法稳定知道“这个会话是由哪个 favorite tag 发起的”。

### 3. 图集当前模型

- 图集 / gallery 是数据库中的一等实体，不只是 UI 分组。
- `galleries` 表中已有：`id`、`folderPath`、`name`、`coverImageId` 等字段。
- 图集在应用内部的可写操作主要围绕 `galleryId` 展开。
- `folderPath` 是语义上的目录身份，`id` 是应用内最合适的外键目标。
- 因此，“将标签绑定到图集”最稳妥的做法应以 `galleryId` 为主，而不是只存裸 `folderPath`。

## 设计结论（初步）

### 1. 不建议直接扩展 `booru_favorite_tags` 承载全部下载状态

原因：

- 下载配置与下载运行状态不是同一层次的数据；
- 一个收藏标签后续可能多次触发下载；
- 当前 bulk download 已经有自己的任务 / 会话 / 记录三层结构；
- 若把运行态字段直接塞进收藏标签表，会导致职责混杂。

### 2. 更适合增加“收藏标签下载配置 / 绑定”这一层

该层应负责描述：

- 某个 favorite tag 是否启用一键下载；
- 该标签默认下载到哪里；
- 绑定哪个图集；
- 默认使用哪些下载参数；
- 最近一次触发下载的任务 / 会话信息；
- 上次下载时间。

### 3. 行内进度展示应优先采用“持久化快照 + 运行时事件补充”

- “上次下载时间”应持久化；
- “当前活动会话 ID”应持久化或可稳定反查；
- “当前百分比/状态”可以从活动 session + records 聚合；
- 实时变化部分通过现有 bulk download 事件流增量刷新；
- 页面首次打开时可先读数据库快照，再接实时事件。

### 4. 图集绑定建议存 `galleryId`，目录可作为派生或冗余信息

- `galleryId` 适合作为正式绑定字段；
- 下载目标路径仍然需要单独存一份，因为批量下载任务当前直接依赖 `path`；
- 若图集存在，则默认要求 `downloadPath` 与该图集的 `folderPath` 保持一致；
- 可以在服务层做一致性校验，而不必在第一版就双写太多冗余字段。
