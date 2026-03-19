# TODO

## 说明

本文档用于记录当前仓库后续要推进的功能任务与实施拆解。

当前这份 TODO 已根据**实际代码状态**重新整理，不再保留“全部未勾选但代码已完成”的失真状态。

相关方案文档：

- `.sisyphus/plans/favorite-tag-bulk-download-plan.md`

---

## 当前结论（已按代码核对）

### 已明确完成

- 收藏标签页支持一键批量下载
- 每条收藏标签显示：
  - 下载状态
  - 下载进度
  - 上次下载时间
  - 绑定图集
- 支持下载配置保存 / 解除绑定
- 支持绑定已有图集
- 支持 `queryType` / `siteId` / `gallery-folderPath` 校验
- 已接入真实的 bulk download progress / status 事件推送
- 已持久化 recent task/session/status/time 快照

### 已实现，但超出原始 P0 范围

- `bulk_download_sessions.originType / originId`
- 收藏标签下载历史查询与历史弹窗
- `autoCreateGallery`
- `autoSyncGalleryAfterDownload`

### 仍需持续关注 / 后续可增强

- 更强的真实集成测试（当前已比初稿更好，但仍偏“规则验证 + 关键入口验证”）
- `getFavoriteTagsWithDownloadState()` 在大列表下的查询成本优化
- 收藏标签下载历史的更完整统计视图
- raw/list queryType 的下载语义设计

---

## P0：标签收藏页一键批量下载与图集绑定（已完成）

### 数据库与类型层

- [x] 在 `src/main/services/database.ts` 中新增表 `booru_favorite_tag_download_bindings`
- [x] 为 `favoriteTagId`、`galleryId`、`lastSessionId` 增加必要索引
- [x] 按现有数据库演进方式实现迁移：`CREATE TABLE IF NOT EXISTS` + 必要时 `columnExists(...)`
- [x] 确保 `favoriteTagId` 外键使用 `ON DELETE CASCADE`
- [x] 确保 `galleryId` 外键使用 `ON DELETE SET NULL`
- [x] 在 `src/shared/types.ts` 中新增：
  - [x] `FavoriteTagDownloadBinding`
  - [x] `FavoriteTagDownloadRuntimeProgress`
  - [x] `FavoriteTagWithDownloadState`
  - [x] `UpsertFavoriteTagDownloadBindingInput`
- [x] 保证 `lastTaskId` / `lastSessionId` 使用与现有 bulk download 一致的字符串 ID 语义

### Main Process / Service

- [x] 在 Booru 相关 service 中新增 favorite tag download binding CRUD
- [x] 新增 `getFavoriteTagsWithDownloadState(siteId?)`，返回 enriched favorite tag 数据
- [x] 新增 `startFavoriteTagBulkDownload(favoriteTagId)` 主流程封装
- [x] 在主进程统一完成以下流程：
  - [x] 读取 favorite tag
  - [x] 读取 binding 配置
  - [x] 校验 `siteId`
  - [x] 校验 `queryType`
  - [x] 校验 `galleryId` 与 `downloadPath`
  - [x] 创建 bulk download task
  - [x] 创建 bulk download session
  - [x] 启动 session
  - [x] 回写 `lastTaskId` / `lastSessionId` / `lastStartedAt` / `lastStatus`
- [x] 明确失败回写规则：
  - [x] 配置错误
  - [x] gallery/path 校验失败
  - [x] createTask 失败
  - [x] createSession 失败
  - [x] session 终态失败

### 业务规则

- [x] 第一阶段只允许 `FavoriteTag.queryType === 'tag'` 触发一键下载
- [x] `queryType === 'raw' | 'list'` 时禁用下载按钮并显示说明
- [x] `siteId == null` 的 favorite tag 第一阶段禁止直接启动下载，需先有明确站点
- [x] 绑定图集时必须校验：`downloadPath === gallery.folderPath`
- [x] 第一阶段只支持绑定**已有图集**（在未显式启用自动创建前）

### IPC / Preload

- [x] 在 IPC 层增加 favorite tag download binding 相关通道与 handler
- [x] 在 `src/preload/index.ts` 的 `window.electronAPI.booru.*` 下新增：
  - [x] `getFavoriteTagsWithDownloadState(siteId?)`
  - [x] `getFavoriteTagDownloadBinding(favoriteTagId)`
  - [x] `upsertFavoriteTagDownloadBinding(payload)`
  - [x] `removeFavoriteTagDownloadBinding(favoriteTagId)`
  - [x] `startFavoriteTagBulkDownload(favoriteTagId)`

### Renderer / FavoriteTagsPage

- [x] 将 `FavoriteTagsPage` 的数据源从 `FavoriteTag[]` 升级为 `FavoriteTagWithDownloadState[]`
- [x] 新增表格列：
  - [x] `绑定图集`
  - [x] `下载状态`
  - [x] `下载进度`
  - [x] `上次下载时间`
- [x] 新增行级操作：
  - [x] `下载`
  - [x] `配置下载`
  - [x] `解除下载配置 / 解除绑定`
- [x] 为“未配置下载”的标签补充首次配置弹窗
- [x] 配置弹窗至少支持：
  - [x] 下载目录
  - [x] 绑定已有图集
  - [x] 并发数
  - [x] 分页大小
  - [x] 是否跳过已存在
  - [x] 是否通知
- [x] 配置保存成功后支持直接启动首次下载

### 实时进度与刷新策略

- [x] 页面初始加载时调用 `getFavoriteTagsWithDownloadState(siteId?)`
- [x] 切换站点过滤后重新获取 enriched 列表
- [x] 保存下载配置后重新获取对应行或整表数据
- [x] 启动下载成功后重新获取对应行或整表数据
- [x] 监听现有：
  - [x] `system.onBulkDownloadRecordProgress`
  - [x] `system.onBulkDownloadRecordStatus`
- [x] 仅当事件 `sessionId === row.downloadBinding.lastSessionId` 时更新该行运行态
- [x] session 进入终态后重新拉取快照，刷新 `lastStatus` 和 `lastCompletedAt`
- [x] 第一阶段运行态聚合统一基于 `bulk_download_records`，不依赖 `bulk_download_session_stats`

### 验证项

- [x] 无 binding 的 existing favorite tag 仍可正常显示
- [x] `queryType !== 'tag'` 的收藏标签下载按钮禁用
- [x] `siteId == null` 的收藏标签不能直接启动下载
- [x] `galleryId` 与 `downloadPath` 不一致时启动被拒绝
- [x] 启动成功后页面可见“启动中 / 扫描中 / 下载中”状态变化
- [x] 页面刷新后仍能看到上次下载时间与最近状态
- [x] 删除 favorite tag 后 binding 自动删除
- [x] 删除 binding 后 favorite tag 仍保留

---

## P1：可追踪性增强（已完成）

- [x] 给 `bulk_download_sessions` 新增：
  - [x] `originType`
  - [x] `originId`
- [x] 支持按 favorite tag 查看历史下载 session
- [x] 补充 favorite tag 最近多次运行的历史视图
- [ ] 失败原因摘要与重试入口联动（仅完成历史中的 error 展示，未做专门重试 UI）

---

## P2：图集协同增强（已部分完成）

- [x] 支持绑定图集时自动创建图集
- [x] 下载完成后自动刷新 / 扫描对应图集
- [ ] 支持图集绑定一致性修复提示
- [ ] 支持按图集查看“来源 favorite tag”

---

## 当前剩余事项（真实剩余，而不是文档滞后）

### 收口与增强

- [x] 为 favorite tag 下载流补更强的 DB/service/IPC 契约测试（仍可继续增强到更重的集成测试）
- [ ] 评估并优化 `getFavoriteTagsWithDownloadState()` 在大量标签下的聚合查询成本
- [ ] 为 `FavoriteTagDownloadDisplayStatus` 建立更集中统一的状态映射工具，减少 renderer 内散落分支

### 已完成的审查收口项

- [x] 补齐 favorite tag 导入/导出真实 IPC 链路
- [x] 确认真正存在的 `bulk-download:record-progress` / `bulk-download:record-status` main 侧发射逻辑

### 未来扩展

- [ ] 设计 `queryType === 'raw' | 'list'` 的下载语义
- [ ] 提供更完整的历史统计面板
- [ ] 提供基于图集维度的反向追踪视图
