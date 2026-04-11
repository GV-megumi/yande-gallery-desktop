# Booru 标签页打磨 + 设置检查更新（v0.0.2）

## 背景

v0.0.2 版本的主实现计划。目标是解决 Booru 收藏标签页 / 黑名单页的 7 个使用打磨问题，顺带在设置的关于 Tab 增加"检查更新"入口。原始执行计划放在 `TODO.md`，完成后归档为本文件。

相关文档：

- 设计文档：`docs/superpowers/specs/2026-04-11-booru-tag-pages-polish-design.md`
- 发布说明：`dist-v0.0.2/release-notes.md`

## 架构方针（已落地）

- 服务端新增 `ListQueryParams` / `PaginatedResult` 通用查询类型，list 类 IPC handler 统一参数签名
- 收藏标签 / 黑名单两个页面切到服务端驱动的 Table（分页 + 关键词搜索）
- 抽出 `<BatchTagAddModal>` 和 `<ImportTagsDialog>` 两个共用组件，两个页面共享
- 导入 handler 拆成 `pickFile` + `commit` 两段式，支持预览后选择性导入
- 新增 `updateService.ts`，通过 GitHub Releases API 实现版本检查（带短时缓存）
- 所有外部网络调用仍然保持在主进程

## 实际执行情况

执行期间全部 24 个 Task 按计划完成，对应 36 次提交（参见 `git log 8546a27..v0.0.2`）。关键里程碑如下：

### 数据与服务层

- **Task 1**：`src/shared/types.ts` 新增 `ListQueryParams` / `PaginatedResult` / `FavoriteTagImportRecord` / `BlacklistedTagImportRecord` / `ImportPickFileResult` / `UpdateCheckResult`
- **Task 2**：`getBlacklistedTags` 改为分页 + 关键词搜索（`COLLATE NOCASE` LIKE）
- **Task 3**：`getFavoriteTags` 改为分页 + 关键词搜索
- **Task 4**：`getFavoriteTagsWithDownloadState` 对应改造
- **Task 6**：`updateFavoriteTag` 支持把全局标签（`siteId === null`）指派到某个站点，已绑定站点的标签拒绝再次变更
- **Task 7**：`addFavoriteTagsBatch` 新服务函数，批量解析 + 跳过已存在项
- **Task 9**：`importFavoriteTagsPickFile` + `importFavoriteTagsCommit`，文件 round-trip 保留 label 分组
- **Task 10**：`importBlacklistedTagsPickFile` + `importBlacklistedTagsCommit`
- **Task 12**：`src/main/services/updateService.ts`，GitHub Releases API + 60s 成功缓存（错误不缓存，便于重试）

### IPC / Preload 层

- **Task 5**：3 个 list handler 的签名统一迁移到 `ListQueryParams` / `PaginatedResult<T>`
- **Task 8**：暴露 `booru.addFavoriteTagsBatch`
- **Task 11**：新 import 两段式接入，旧的一步 `importFavoriteTags` / `importBlacklistedTags` handler 被删除
- **Task 13**：暴露 `system.checkForUpdate`

### 渲染层组件

- **Task 14**：`src/renderer/components/BatchTagAddModal.tsx`，可配置 `extraField`（收藏页是"分组"、黑名单页是"原因"）
- **Task 15**：`src/renderer/components/ImportTagsDialog.tsx`，两阶段：选站点 → 选文件 → 预览 → 确认

### 页面接入

- **Task 16–19**：`FavoriteTagsPage.tsx`
  - 去掉旧的"快速搜索"chip 区
  - 工具栏搜索框 + 服务端分页
  - 操作列固定在右侧（`fixed: 'right'`）
  - 编辑弹窗支持把"全局"标签指派到某个站点
  - 批量添加按钮走 `<BatchTagAddModal>`
  - 导入流程换成 `<ImportTagsDialog>`
- **Task 20–22**：`BlacklistedTagsPage.tsx`
  - 工具栏搜索框 + 服务端分页
  - 批量添加迁移到 `<BatchTagAddModal>`
  - 导入迁移到 `<ImportTagsDialog>`
- **Task 23**：`SettingsPage.tsx` 关于 Tab 新增"检查更新"行

### 回归修复与收尾

- `c075dab`：`limit <= 0` 返回真正的无分页全量，不再截断到 1000 条（导出场景依赖）
- `f66e64e`：`TagsSection` 跟上新的分页返回结构
- `dede8ca`：拖拽排序使用绝对 offset，避免第二页拖动后与第一页冲突；关键词过滤状态下禁止拖拽
- `c52481d`：label 分组在 export/import round-trip 中得以保留

### 打包 / 视觉（和本计划一起发的）

以下几项不在原设计文档里，是 v0.0.2 发布阶段顺带做的：

- 应用图标全平台接入：`assets/icon.ico`（多尺寸 16/24/32/48/64/128/256）/ `icon.icns` / `icon.png`；侧边栏 Logo 从字母"Y"改成图标
- 去除 Electron 默认 File / Edit / View / Window / Help 系统菜单栏
- 修复 antd Table 固定列表头透明背景导致的"操作"列滚动时文字叠字问题（主题 `Table.headerBg: 'transparent'` 配合 `fixed` 列导致）

## 结论

- v0.0.2 的全部计划项已完成并发布
- 后续如果要重做批量下载或收藏标签分组体验，关注：分页返回结构 (`PaginatedResult<T>`)、导入两段式、`limit <= 0` 的全量语义
- 已知遗留：打包体积较大（主因是 antd 整包 gzip 后约 393 KB）；mac / linux 目前没进 CI artifact

## 相关提交

```text
v0.0.2 (4626bb3)
├─ 打包 / 视觉收尾
│  ├─ chore: bump version to 0.0.2
│  ├─ feat(icon): add app icon across all platforms and sidebar
│  ├─ fix(table): opaque background for sticky fixed column headers
│  ├─ feat(menu): remove default electron application menu bar
│  └─ chore(launch): clean up debug task config
├─ 回归修复
│  ├─ fix(booruService): restore label group round-trip in favorite tags import
│  ├─ fix(FavoriteTagsPage): DnD sortOrder uses absolute offset + guards against filtered view
│  ├─ fix(TagsSection): use paginated getFavoriteTags API shape
│  └─ fix(booruService): limit<=0 returns unbounded rows instead of capping at 1000
├─ 页面接入
│  ├─ Task 16–19 FavoriteTagsPage 一揽子
│  ├─ Task 20–22 BlacklistedTagsPage 一揽子
│  └─ Task 23 SettingsPage 检查更新
├─ 组件与更新服务
│  ├─ Task 14 BatchTagAddModal
│  ├─ Task 15 ImportTagsDialog
│  ├─ Task 12/13 updateService + IPC
│  └─ Task 11 新 import IPC 接入
├─ 服务层
│  ├─ Task 9/10 import pickFile + commit 拆分
│  ├─ Task 7/8 addFavoriteTagsBatch
│  └─ Task 6 updateFavoriteTag 支持 siteId
├─ 分页改造
│  ├─ Task 5 list handlers ListQueryParams
│  ├─ Task 2/3/4 get*Tags 分页 + 搜索
│  └─ Task 1 共享类型扩展
└─ docs: add spec for booru tag pages polish + settings update check
```
