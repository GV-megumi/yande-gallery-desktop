# Booru 标签页打磨与设置检查更新 - 设计文档

**日期：** 2026-04-11
**范围：** TODO.md 第 1–6 项 + 第 9 项（检查更新）
**作者：** brainstorming 会话产出

---

## 1. 背景

`TODO.md` 列出了 7 个独立的小问题，集中在两个 Booru 标签管理页（收藏标签 / 黑名单）和设置页。这些问题都属于 UI 打磨 + 服务层小扩展，不触及下载、数据库 schema 迁移等深层能力。

原始问题清单（引用并小结）：

| # | 问题 | 目标 |
|---|------|------|
| 1 | 收藏标签页在约 1251px 窄宽下表头换行、操作列被截断 | 操作列始终可见 |
| 2 | "快速搜索"区把所有 tag 列成 chip 墙，量多时无法用 | 改为表格工具栏里的真·搜索框 |
| 3 | 黑名单页没有搜索输入 | 加搜索框 |
| 4 | 收藏标签编辑弹窗无法修改所属站点，导致"全局"标签无法绑定批量下载 | 编辑弹窗支持 **全局 → 具体站点** 的一次性指派 |
| 5 | 导入收藏/黑名单时直接打开文件选择器，无法为 txt 指派站点（全部进全局） | 导入改成"先选站点 → 再选文件"的两步对话框 |
| 6 | 黑名单有"批量添加"功能，收藏页没有 | 收藏页补上批量添加 |
| 9（原文编号跳过 7、8） | 设置 → 关于 Tab 加一个"检查更新"入口 | 展示当前版本、最新版本、是否有更新、跳转下载链接 |

**目标**：在不引入新架构概念、不改数据库 schema 的前提下，一次性把这七件事做完；顺便把两个列表页的分页和搜索一并改成服务端驱动，避免后续数据量增长时重复重构。

## 2. 非目标

- 不做 electron-updater 自动下载 / 安装更新的能力（本次只做"检查版本差异 + 外链跳转"）
- 不改数据库 schema / 迁移（只加 SQL 查询层的 LIMIT / OFFSET / LIKE）
- 不重构收藏/黑名单页的数据模型或下载绑定逻辑
- 不扩展导入支持的文件格式（保持现有 txt / json 能力）
- 不做跨页面的"批量站点指派"工具（本次只解决"编辑单条"和"导入时指派"两个路径）
- 不把 `FavoriteTagsPage.tsx`（1100+ 行）整体拆分——只在本次改动涉及的区域做必要的结构清理

## 3. 顶层决策

这些决策是 brainstorming 过程中和用户逐条确认过的，实现时必须遵守：

| 决策 | 结论 | 原因 |
|------|------|------|
| 检查更新的形态 | 拉 GitHub Releases latest API，只比对版本，不下载 | 当前版本 0.0.1，没有正式发布节奏，electron-updater 太重；纯外链又太弱 |
| 窄宽下操作列不可见 | 操作列 `fixed: 'right'` + Table `scroll.x` | antd 原生能力，零侵入，保留所有列的信息量 |
| 快速搜索 chip 区 | **删除整个 Card**，搜索框合并到表格工具栏 | chip 墙在标签多时就是噪音；删掉一个维护点 |
| 修改所属站点的边界 | 只允许 `null → 具体 siteId`；已有站点显示 disabled Select + tooltip | 避免"改站点导致下载绑定失效"的复杂边界 |
| 搜索 + 分页的实现层级 | 服务端搜索 + 服务端分页（两个页面都改） | 既然动一次就改到位，保持两页一致 |
| 导入站点选择 | 弹窗里必须显式选站点，**无默认值** | TODO 第 5 项核心诉求就是"不要默认进全局" |
| JSON 导入里自带 siteId 的记录 | 文件里的 siteId 优先，对话框的站点只作用于"裸 tag"记录 | 保留结构化数据的语义 |
| 批量添加的组件抽象 | 抽出 `<BatchTagAddModal>` 供两页复用 | CLAUDE.md 第 4 条：通用 UI 能力要沉淀成复用组件 |
| 导入的组件抽象 | 抽出 `<ImportTagsDialog>` 供两页复用 | 同上 |
| spec 文件位置 | `docs/superpowers/specs/` | 用户确认 |

## 4. 架构 / 模块划分

本次改动分布在三层：

```
┌─────────────────────────────────────────────┐
│ Renderer (src/renderer)                      │
│   - FavoriteTagsPage.tsx      (重构)         │
│   - BlacklistedTagsPage.tsx   (重构)         │
│   - SettingsPage.tsx          (新增 Tab 区块) │
│   - components/BatchTagAddModal.tsx   (新)   │
│   - components/ImportTagsDialog.tsx   (新)   │
└─────────────────────────────────────────────┘
           ↓ window.electronAPI
┌─────────────────────────────────────────────┐
│ Preload (src/preload/index.ts)               │
│   - booru.getFavoriteTags(...)        (改签名) │
│   - booru.getFavoriteTagsWithDownloadState (改签名) │
│   - booru.getBlacklistedTags(...)     (改签名) │
│   - booru.updateFavoriteTag(...)      (允许 siteId) │
│   - booru.importFavoriteTagsPickFile  (新) │
│   - booru.importFavoriteTagsCommit    (新) │
│   - booru.importBlacklistedTagsPickFile (新) │
│   - booru.importBlacklistedTagsCommit (新) │
│   - booru.addFavoriteTagsBatch        (新) │
│   - system.checkForUpdate             (新) │
└─────────────────────────────────────────────┘
           ↓ IPC
┌─────────────────────────────────────────────┐
│ Main (src/main)                              │
│   - services/booruService.ts   (改多个函数) │
│   - services/updateService.ts  (新文件)     │
│   - ipc/handlers.ts            (加 handler) │
│   - ipc/channels.ts            (加 channel) │
└─────────────────────────────────────────────┘
```

## 5. 单元 1：共用组件 `<BatchTagAddModal>`

**文件：** `src/renderer/components/BatchTagAddModal.tsx`（新建）

**职责：** 收集"批量添加标签"的用户输入——多行 tag + 站点选择 + 一个可选的辅助字段。不做后端调用，不做错误 toast，不做列表刷新。这些是页面的事。

**Props：**

```typescript
export interface BatchTagAddModalProps {
  open: boolean;
  title: string;
  sites: Array<{ id: number; name: string }>;
  /** 可选的第三字段，收藏用 "分组"（labels），黑名单用 "原因"（reason） */
  extraField?: {
    name: string;
    label: string;
    placeholder?: string;
  };
  onCancel: () => void;
  /** 返回 Promise，Promise 进行中 Modal 按钮 loading 且不可关闭 */
  onSubmit: (values: {
    tagNames: string;            // 用户原始输入，由页面层自行拆分 / 调后端
    siteId: number | null;       // null 代表"全局"
    extra?: string;              // extraField 对应的值
  }) => Promise<void>;
}
```

**UI 规格：**

- antd Modal，标题用 `title` prop，宽度 480
- Form 字段顺序：
  1. `siteId` Select：选项 = `[{ label: '全局', value: null }, ...sites]`，默认 `null`
  2. `tagNames` TextArea：`rows={6}`，placeholder `"支持换行或英文逗号分隔\n例如：\nhatsune miku\nrem, ram"`
  3. （可选）`extraField` Input
- 底部：取消 / 保存按钮
- `onSubmit` Promise 期间保存按钮 `loading`、取消按钮 disabled、`maskClosable=false`

**校验：**
- `tagNames` trim 后必须包含至少一个非空 token：`tagNames.split(/[\n,]/).map(s => s.trim()).filter(Boolean).length > 0`，失败时 Form 字段级错误提示 `"请至少输入一个标签"`
- 其它字段无硬校验，交给后端

**两页的接入：**

- 收藏页：`extraField = { name: 'labels', label: '分组（逗号分隔）', placeholder: '例如: 角色, 风格' }`，`onSubmit` 调新 preload `booru.addFavoriteTagsBatch(tagNames, siteId, labels)`
- 黑名单页：`extraField = { name: 'reason', label: '原因（可选）', placeholder: '例如: 不喜欢' }`，`onSubmit` 调现有 `booru.addBlacklistedTags(tagNames, siteId, reason)`（已经支持批量）

**黑名单页的迁移：** 当前黑名单页用 `batchAddMode` state 在一个 Modal 里做单个/批量切换。迁移后：
- 单个添加保留独立 Modal
- 批量添加独立成 `<BatchTagAddModal>`
- 工具栏 "添加" / "批量添加" 两个按钮分别触发，不再共用 Modal

## 6. 单元 2：共用组件 `<ImportTagsDialog>`

**文件：** `src/renderer/components/ImportTagsDialog.tsx`（新建）

**职责：** 把"选站点 → 选文件 → 执行导入"三步封装成一个对话框。**不直接调文件系统**——"选文件"这一步通过 preload 的 `*PickFile` IPC 交给主进程打开系统对话框、读文件、解析内容并返回结构化记录；对话框再拿解析结果调 `*Commit` IPC 执行真正的入库。

**Props：**

```typescript
export interface ImportTagsDialogProps {
  open: boolean;
  title: string;                 // "导入收藏标签" / "导入黑名单"
  sites: Array<{ id: number; name: string }>;
  onCancel: () => void;
  /** 调用 preload 选文件并返回解析结果 */
  onPickFile: () => Promise<{
    success: boolean;
    data?: {
      fileName: string;
      records: Array<{
        tagName: string;
        siteId?: number | null;   // 文件里显式带的 siteId（json 来源）
        labels?: string[];
        notes?: string;
        reason?: string;
      }>;
    };
    error?: string;
  }>;
  /** 调用 preload 执行入库 */
  onCommit: (params: {
    records: Array<{ tagName: string; siteId?: number | null; labels?: string[]; notes?: string; reason?: string }>;
    fallbackSiteId: number | null;
  }) => Promise<{
    success: boolean;
    data?: { imported: number; skipped: number };
    error?: string;
  }>;
  /** 成功后页面侧刷新数据 */
  onImported: (result: { imported: number; skipped: number }) => void;
}
```

**UI 结构：**

对话框分两个阶段（同一个 Modal 切换，不是多步向导）：

**阶段 A — 选站点 + 选文件：**
- `siteId` Select：选项 `[{ label: '未选择', value: undefined }, { label: '全局', value: null }, ...sites]`，默认 `undefined`（必须主动选）
- 说明文字：`"未指定 siteId 的记录将被分配到所选站点。文件中显式包含 siteId 的记录会保留其原值。"`
- "选择文件" 按钮：disabled 当 `siteId === undefined`；点击后调 `onPickFile`
- 取消按钮

**阶段 B — 预览 + 确认：**
- 显示文件名
- 显示统计：`"将导入 N 条标签（其中 M 条来自文件自带 siteId，K 条使用所选站点 '全局')"`
- 显示前若干条记录的预览表（tag / siteId 来源）
- "确认导入" 按钮：调 `onCommit`，loading 期间 disabled；成功后调 `onImported` 并关闭对话框
- "返回" 按钮：回到阶段 A

**空文件 / 解析失败处理：** `onPickFile` 返回 `{ success: false, error }` 时在阶段 A 显示红色提示；用户修掉文件后可以再次点击"选择文件"。

**两页的接入：**

- 收藏页：`onPickFile = booru.importFavoriteTagsPickFile`, `onCommit = booru.importFavoriteTagsCommit`
- 黑名单页：`onPickFile = booru.importBlacklistedTagsPickFile`, `onCommit = booru.importBlacklistedTagsCommit`

## 7. 单元 3：服务端搜索 + 分页改造

**影响的后端函数（都在 `src/main/services/booruService.ts`）：**

1. `getFavoriteTags(siteId)` → `getFavoriteTags({ siteId, keyword, offset, limit })`
2. `getFavoriteTagsWithDownloadState(siteId)` → `getFavoriteTagsWithDownloadState({ siteId, keyword, offset, limit })`
3. `getBlacklistedTags(siteId)` → `getBlacklistedTags({ siteId, keyword, offset, limit })`

**新的入参 / 返回结构：** `ListQueryParams` 和 `PaginatedResult<T>` 定义在 `src/shared/types.ts`（见 §15），服务层从 shared 导入：

```typescript
import type { ListQueryParams, PaginatedResult } from '../../shared/types';

// 语义约定：
// - siteId:  undefined = 不过滤站点；null = 只查全局；number = 过滤该站点
// - keyword: undefined 或空字符串表示不搜索；非空时做 COLLATE NOCASE 模糊匹配
// - offset:  默认 0
// - limit:   默认 50；传 0 表示"不分页"，函数内部兜底为 1000 上限
```

**SQL 层：**

- `keyword` 存在时 SQL 加 `AND tag_name LIKE ? COLLATE NOCASE`，参数包装成 `%keyword%`
- `siteId` 的含义保持原语义：`undefined` 不加 where，`null` → `site_id IS NULL`，数字 → `site_id = ?`
- 排序：保持原有排序（`sort_order DESC, id DESC` 或等价），不可改
- `total` 通过一次 `SELECT COUNT(*)` 和主查询分别执行，拼同样的 WHERE
- `LIMIT ? OFFSET ?` 追加到主查询

**向后兼容：** 这是破坏性改动——函数签名从位置参数变成对象参数。所有调用点必须同步更新：
- `src/main/ipc/handlers.ts`（多处调 `getFavoriteTags` / `getBlacklistedTags`）
- `src/main/services/booruService.ts` 内部其它调用点（比如 import 里枚举已有 tag 的地方）
- **对"不分页只想拉全量"的内部调用**：传 `{ siteId, limit: 0 }`，函数内部把 `limit: 0` 当成 1000 上限

**IPC 层（`src/main/ipc/handlers.ts` + `src/main/ipc/channels.ts`）：**

- `BOORU_GET_FAVORITE_TAGS` 的 handler 把参数从 `siteId` 改成 `ListQueryParams`
- `BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE` 同上
- `BOORU_GET_BLACKLISTED_TAGS` 同上
- 返回值改成 `{ items, total }`

**Preload 层（`src/preload/index.ts`）：**

```typescript
booru.getFavoriteTags(params: ListQueryParams): Promise<{ success; data?: PaginatedResult<FavoriteTag>; error? }>
booru.getFavoriteTagsWithDownloadState(params: ListQueryParams): Promise<{ success; data?: PaginatedResult<FavoriteTagWithDownloadState>; error? }>
booru.getBlacklistedTags(params: ListQueryParams): Promise<{ success; data?: PaginatedResult<BlacklistedTag>; error? }>
```

**渲染层的使用模式：**

两个页面都按下面的 state 管理接入：

```typescript
const [keyword, setKeyword] = useState('');
const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState(20);
const [total, setTotal] = useState(0);
const [items, setItems] = useState<FavoriteTagWithDownloadState[]>([]);

const load = useCallback(async () => {
  const offset = (page - 1) * pageSize;
  const res = await window.electronAPI.booru.getFavoriteTagsWithDownloadState({
    siteId: filterSiteId,
    keyword: keyword.trim() || undefined,
    offset,
    limit: pageSize,
  });
  if (res.success && res.data) {
    setItems(res.data.items);
    setTotal(res.data.total);
  }
}, [filterSiteId, keyword, page, pageSize]);

// 搜索框 debounce 300ms，变化时 setPage(1) + 重载
// 站点筛选变化时 setPage(1) + 重载
```

Table 配置：

```typescript
pagination={{
  current: page,
  pageSize,
  total,
  showSizeChanger: true,
  pageSizeOptions: ['20', '50', '100'],
  onChange: (p, ps) => { setPage(p); setPageSize(ps); },
}}
```

**"拖拽排序"和分页的关系：** 收藏页支持拖拽排序（`sortOrder` 字段）。服务端分页后，拖拽只影响当前页内部的行之间；`arrayMove` 的逻辑保持不变，只是跨页拖拽不支持（原本也基本不支持）。这点不做特殊处理。

## 8. 单元 4：`updateFavoriteTag` 支持修改 siteId

**文件：** `src/main/services/booruService.ts`

当前签名：

```typescript
updateFavoriteTag(id: number, updates: Partial<Pick<FavoriteTag, 'tagName' | 'labels' | 'queryType' | 'notes' | 'sortOrder'>>)
```

**改动：**

1. 在 Pick 中加入 `'siteId'`
2. 函数内部新增校验：
   - 如果 `updates.siteId !== undefined`，先查当前这条记录
   - 若 `current.siteId !== null && current.siteId !== updates.siteId` → 抛错 `"已指派到具体站点的收藏标签不允许修改站点"`
   - 若 `current.siteId === null && typeof updates.siteId === 'number'` → 允许
   - 若 `updates.siteId === null` 且当前也是 `null` → 允许（no-op）
   - 若 `updates.siteId === null` 且当前是数字 → 抛错同上
3. 校验通过后再走原有的 UPDATE

**IPC / preload：** 签名不变（`updateFavoriteTag(id, updates)`），只是 `updates` 支持多一个字段。渲染层编辑弹窗里的 Form 新增 `siteId` 字段即可。

**错误对外展示：** 渲染层捕获到后端抛错时 `message.error(error.message)`，弹窗保持打开。

## 9. 单元 5：拆分 import 接口（支持对话框在渲染层）

**文件：** `src/main/services/booruService.ts` + `src/main/ipc/handlers.ts`

**当前实现推断：** `importFavoriteTags()` / `importBlacklistedTags()` 在主进程里调 `dialog.showOpenDialog` → 读文件 → 解析 → 直接 insert。用户点一次按钮就完成了整个流程，没法在中间弹一个对话框。

**改动：** 拆成两个 IPC：

### 9.1 收藏导入

```typescript
// Service
export async function importFavoriteTagsPickFile(): Promise<ImportPickResult<FavoriteTagImportRecord>>;
export async function importFavoriteTagsCommit(params: {
  records: FavoriteTagImportRecord[];
  fallbackSiteId: number | null;
}): Promise<{ imported: number; skipped: number }>;

export interface FavoriteTagImportRecord {
  tagName: string;
  siteId?: number | null;          // 文件里显式包含的 siteId；undefined 代表"没写"
  labels?: string[];
  notes?: string;
  queryType?: 'tag' | 'raw' | 'list';
}

export interface ImportPickResult<T> {
  fileName: string;
  records: T[];
}
```

**`importFavoriteTagsPickFile` 行为：**
- `dialog.showOpenDialog`，filter `[{ name: 'Tags', extensions: ['txt', 'json'] }]`
- 用户取消 → 返回 `{ success: true, data: undefined }`（或 `cancelled: true`，需要一个明确的区分）
- 读文件、按扩展名解析：
  - `.txt`：按行拆，每行一个 `tagName`，不带其它字段
  - `.json`：JSON.parse，期望是数组；每项至少含 `tagName`，可选 `siteId` / `labels` / `notes` / `queryType`
- 解析失败 → 返回 `{ success: false, error }`
- 成功 → 返回 `{ success: true, data: { fileName, records } }`

**`importFavoriteTagsCommit` 行为：**
- 对每个 record：
  - 实际 siteId = `record.siteId !== undefined ? record.siteId : fallbackSiteId`
  - 调现有的 `addFavoriteTag(...)` 或等价的批量 insert
  - 已存在（按 `(siteId, tagName)` 查重）→ 计入 `skipped`
- 返回 `{ imported, skipped }`

### 9.2 黑名单导入

同样拆成 `importBlacklistedTagsPickFile` + `importBlacklistedTagsCommit`，参数用 `BlacklistedTagImportRecord`（`tagName` + 可选 `siteId` + 可选 `reason`）。

**旧接口处理：** `importFavoriteTags()` / `importBlacklistedTags()` 这两个旧的单步接口**直接删除**——它们只有 UI 按钮一个调用点，且语义和"导入全部进全局"耦合，保留反而会混淆。preload 和 handlers 也同步删除。

## 10. 单元 6：`updateService` + 检查更新

**新文件：** `src/main/services/updateService.ts`

**职责：** 读当前 `package.json` 版本号，拉 GitHub Releases latest，返回对比结果。

**对外接口：**

```typescript
export interface UpdateCheckResult {
  currentVersion: string;         // 如 "0.0.1"
  latestVersion: string | null;   // 如 "0.0.2"；拉取失败或没有 release 时 null
  hasUpdate: boolean;             // latestVersion 比 currentVersion 大
  releaseUrl: string | null;      // release 页面 URL，用户点击跳浏览器
  releaseName: string | null;
  publishedAt: string | null;     // ISO 8601
  error: string | null;           // 拉取失败时的可读错误
  checkedAt: string;              // ISO 8601，本次检查时间
}

export async function checkForUpdate(): Promise<UpdateCheckResult>;
```

**实现细节：**

- 当前版本从 `package.json` 的 `version` 字段读取（通过 `app.getVersion()` 或 `import pkg from '../../package.json'`）
- GitHub API: `GET https://api.github.com/repos/{owner}/{repo}/releases/latest`
  - owner / repo 硬编码：从 SettingsPage 关于 Tab 里已有的 GitHub 链接推断（`gVentsky/yande-gallery-desktop` 或类似，**实现时读取现有关于 Tab 代码确认**）
  - 请求头 `User-Agent: yande-gallery-desktop`，Accept `application/vnd.github+json`
- 超时 10s（用 `AbortController`）
- 404 / 网络错误 → 返回 `{ error, latestVersion: null, hasUpdate: false, ... }`，不抛异常
- 版本比较：使用简单的 semver 比较——把版本字符串按 `.` 拆成数字数组逐位比较；不引入 `semver` npm 包（本项目的版本号形态简单，避免依赖）
  - 如果 latest 的 tag 带 `v` 前缀（如 `v0.0.2`），去掉 `v`
  - 非数字段（如 `-beta.1`）出现时视为更新（保守展示），给用户看

**网络访问：** 遵循 CLAUDE.md 第 1 条——主进程调 `fetch`（Node 20 内置），不绕回渲染层。

**限流保护：** GitHub 未登录的 API 限流是 60/hour/IP。对普通用户来说足够，但主进程加一个 60 秒的内存缓存：如果距离上次成功检查 < 60s 直接返回缓存，避免用户连点。

**IPC：**
- channel: `SYSTEM_CHECK_FOR_UPDATE`
- handler 调 `updateService.checkForUpdate()`，返回 `UpdateCheckResult`

**Preload：** `system.checkForUpdate(): Promise<{ success: boolean; data?: UpdateCheckResult; error?: string }>`

## 11. 单元 7：`FavoriteTagsPage` 重构

**文件：** `src/renderer/pages/FavoriteTagsPage.tsx`

### 11.1 结构变更

- **删除** 顶部"快速搜索" Card（含所有 chips）——彻底删除渲染代码、相关 state（`allTagNames` 之类）、相关 effect
- **顶部工具栏** Card 内字段顺序（从左到右）：
  1. 站点筛选 Select（`filterSiteId`）
  2. 搜索 Input（新增，`keyword`，带 debounce 300ms）
  3. 右侧按钮组：添加 / 批量添加（新） / 导出 / 导入
- **表格** 改成服务端分页模式：`pagination.mode='server'`（见单元 3）
- **操作列** `fixed: 'right'`，`width` 固定足够放所有操作图标（根据实际图标数决定，约 240）
- **Table** 整体包一层 `scroll={{ x: 1400 }}`（x 值根据其它列总宽估算）

### 11.2 编辑弹窗

在现有"分组 / 备注" Form 的最上方加一个 `siteId` 字段：

```tsx
<Form.Item name="siteId" label="所属站点">
  {editingTag?.siteId == null ? (
    <Select
      placeholder="选择站点"
      allowClear={false}
      options={[{ label: '全局', value: null }, ...sites.map(s => ({ label: s.name, value: s.id }))]}
    />
  ) : (
    <Tooltip title="已指派到具体站点，无法修改">
      <Select disabled value={editingTag.siteId} options={sites.map(s => ({ label: s.name, value: s.id }))} />
    </Tooltip>
  )}
</Form.Item>
```

提交时如果 `editingTag?.siteId == null && values.siteId != null` 才把 `siteId` 传给 `updateFavoriteTag`；否则不传（避免传 null 触发后端的 no-op 校验）。

### 11.3 批量添加

- 工具栏新增"批量添加"按钮
- 点击后打开 `<BatchTagAddModal>`，`extraField` 配成 `{ name: 'labels', label: '分组（逗号分隔）' }`
- `onSubmit` 调新增的 `booru.addFavoriteTagsBatch(tagNames, siteId, labels)`
- 成功后关闭 Modal + 刷新列表 + `message.success("已添加 N 个标签，跳过 M 个")`

### 11.4 新后端接口 `addFavoriteTagsBatch`

**文件：** `src/main/services/booruService.ts`

```typescript
export async function addFavoriteTagsBatch(
  tagString: string,            // 用户原始输入，内部拆分
  siteId: number | null,
  labels?: string,              // 可选的分组字符串，和 addFavoriteTag 一致的语义
): Promise<{ added: number; skipped: number }>;
```

实现：
- 把 `tagString` 按 `/[\n,]/` 拆，trim，过滤空值，去重
- 对每个 tag 调现有 `addFavoriteTag(siteId, tagName, { labels })`
- 已存在的 → skipped++；成功的 → added++
- 和 `addBlacklistedTags` 保持返回结构一致

IPC + preload 按现有模式加。

### 11.5 导入

- 现有"导入"按钮改成打开 `<ImportTagsDialog>`
- 对话框的 `onPickFile` / `onCommit` / `onImported` 分别接到新的 `importFavoriteTagsPickFile` / `importFavoriteTagsCommit` 和"刷新列表 + 提示"逻辑

## 12. 单元 8：`BlacklistedTagsPage` 重构

**文件：** `src/renderer/pages/BlacklistedTagsPage.tsx`

### 12.1 结构变更

- **顶部工具栏** 字段顺序：站点筛选 / 搜索 Input（新） / 添加 / 批量添加 / 导出 / 导入
- **表格** 改成服务端分页模式
- **移除** `batchAddMode` 相关的 state 和 Modal 共用逻辑；改为独立的 `<BatchTagAddModal>`

### 12.2 批量添加

- 工具栏"批量添加"按钮打开 `<BatchTagAddModal>`
- `extraField = { name: 'reason', label: '原因（可选）' }`
- `onSubmit` 调 `booru.addBlacklistedTags(tagNames, siteId, reason)`（已有接口，无需新增）

### 12.3 导入

- 现有"导入"按钮改成打开 `<ImportTagsDialog>`
- 对话框接 `importBlacklistedTagsPickFile` / `importBlacklistedTagsCommit`

## 13. 单元 9：`SettingsPage` 关于 Tab 加检查更新

**文件：** `src/renderer/pages/SettingsPage.tsx`（关于 Tab 的区块）

**UI 规格：**

- 在关于 Tab 的"版本信息"区块下方加一行：
  - 按钮"检查更新"
  - 右侧状态文字：初始"点击检查是否有新版本"
- 点击按钮：
  - 按钮进入 loading 状态
  - 调 `system.checkForUpdate()`
  - 成功且 `hasUpdate === true`：状态文字变绿 `"发现新版本 v{latestVersion}（当前 v{currentVersion}）"` + 按钮变成"查看发布页"（点击 `shell.openExternal(releaseUrl)`）
  - 成功且 `hasUpdate === false`：状态文字变灰 `"当前已是最新版本 v{currentVersion}"`
  - 失败：状态文字变红 `"检查失败：{error}"`，按钮变回"检查更新"供重试
- "上次检查时间"：本次检查成功后展示 `"上次检查：{时间}"`，不持久化到配置（只在本次会话内有效）

**实现顺序：** SettingsPage 里的关于 Tab 是否已经用 Tabs 组件——实现时读一次现有代码，按既有模式加 Form 项或直接在 div 里加一个区块。

## 14. IPC channels 清单（新增 / 改动）

**新增：**
- `BOORU_ADD_FAVORITE_TAGS_BATCH`
- `BOORU_IMPORT_FAVORITE_TAGS_PICK_FILE`
- `BOORU_IMPORT_FAVORITE_TAGS_COMMIT`
- `BOORU_IMPORT_BLACKLISTED_TAGS_PICK_FILE`
- `BOORU_IMPORT_BLACKLISTED_TAGS_COMMIT`
- `SYSTEM_CHECK_FOR_UPDATE`

**变更（参数/返回结构改动）：**
- `BOORU_GET_FAVORITE_TAGS`：入参 `ListQueryParams`，出参 `PaginatedResult<FavoriteTag>`
- `BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE`：同上，`PaginatedResult<FavoriteTagWithDownloadState>`
- `BOORU_GET_BLACKLISTED_TAGS`：同上，`PaginatedResult<BlacklistedTag>`
- `BOORU_UPDATE_FAVORITE_TAG`：`updates` 接受 `siteId`

**删除：**
- `BOORU_IMPORT_FAVORITE_TAGS`（旧的一步导入）
- `BOORU_IMPORT_BLACKLISTED_TAGS`（同上）

## 15. 共享类型（`src/shared/types.ts`）

新增：

```typescript
export interface ListQueryParams {
  siteId?: number | null;
  keyword?: string;
  offset?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

export interface FavoriteTagImportRecord {
  tagName: string;
  siteId?: number | null;
  labels?: string[];
  notes?: string;
  queryType?: 'tag' | 'raw' | 'list';
}

export interface BlacklistedTagImportRecord {
  tagName: string;
  siteId?: number | null;
  reason?: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  error: string | null;
  checkedAt: string;
}
```

## 16. 测试策略

本项目以 vitest 为主。本次改动涉及服务层、shared 工具、渲染层组件三层，测试覆盖如下：

**服务层单元测试（新增 / 修改）：**

1. `updateService.checkForUpdate` — mock `fetch`，覆盖：
   - 返回更新版本 → `hasUpdate: true`
   - 返回同版本 → `hasUpdate: false`
   - 返回带 `v` 前缀 tag → 正确去掉前缀
   - 网络错误 / 非 200 → `error` 字段有值、`hasUpdate: false`
   - 60 秒内重复调用 → 返回缓存（第二次不实际调 fetch）
   - 简单 semver 比较：`0.0.2 > 0.0.1`、`0.1.0 > 0.0.9`、`1.0.0 > 0.9.9`

2. `booruService.addFavoriteTagsBatch` — 用内存 sqlite：
   - 换行 + 逗号混合输入拆分正确
   - 去重（同一输入里的重复）
   - 已存在（siteId + tagName 组合）计入 skipped
   - 空输入返回 `{ added: 0, skipped: 0 }`

3. `booruService.updateFavoriteTag` 的 siteId 校验 — 用内存 sqlite：
   - current=null, updates.siteId=5 → 成功
   - current=5, updates.siteId=3 → 抛错
   - current=5, updates.siteId=null → 抛错
   - current=null, updates.siteId=null → 无变化，成功
   - updates 不含 siteId → 走原路径

4. `booruService.getFavoriteTags` / `getBlacklistedTags` 的分页 + 搜索：
   - keyword 搜索匹配（大小写不敏感）
   - siteId=undefined / null / number 的三种过滤
   - offset / limit 边界
   - total 和 items.length 的一致性（total 不受 limit 影响）

5. `importFavoriteTagsPickFile` — mock `dialog.showOpenDialog` 和 `fs.readFile`：
   - txt 文件逐行解析
   - json 文件解析带 siteId / labels
   - 用户取消 → cancelled 标志

6. `importFavoriteTagsCommit`：
   - 有 siteId 的记录保留原 siteId
   - 无 siteId 的记录套用 fallbackSiteId
   - 去重跳过计数

**共享层单元测试：**

7. （可选，如果拆成了独立函数）semver 比较函数的单元测试

**渲染层组件测试（vitest + @testing-library/react）：**

8. `<BatchTagAddModal>`：
   - 打开时字段正确渲染
   - 校验：空 tagNames 禁止提交
   - 提交 Promise 期间按钮 loading、取消禁用
   - 提交成功后调用 onSubmit 并收到正确参数

9. `<ImportTagsDialog>`：
   - 初始 site 未选择时"选择文件"按钮 disabled
   - `onPickFile` 成功后进入阶段 B
   - `onPickFile` 失败后显示错误
   - 阶段 B 的"返回"可以回到阶段 A
   - "确认导入"调用 onCommit 并在成功后调 onImported

**页面级测试：** 本次不新增 FavoriteTagsPage / BlacklistedTagsPage 的完整页面级测试（成本太高、收益低），靠组件级 + 服务层单测覆盖。手动验证见 §17。

## 17. 手动验证清单

本次是 UI 打磨为主，实现完成后必须人工过一遍以下场景（在 `npm run dev` 下）：

**收藏标签页：**

- [ ] 窗口宽度 1251px 下，表格横向滚动正常，"操作"列始终贴在右边可见
- [ ] 快速搜索 chip 区已经不存在
- [ ] 工具栏搜索框输入 "yande" 后表格只剩匹配行，清空后恢复
- [ ] 站点筛选切换 → 分页 reset 到第 1 页 + 重新拉数据
- [ ] 分页切换（page / pageSize）正常重新拉数据
- [ ] 编辑一个全局标签：弹窗里 siteId 可选，保存后表格里该行所属站点更新
- [ ] 编辑一个已指派站点的标签：siteId 字段禁用且显示 tooltip
- [ ] "批量添加"按钮打开对话框；输入多行 tag + 选站点 + 填分组 → 成功后刷新列表并 toast
- [ ] "导入"按钮打开 `<ImportTagsDialog>`：未选站点时"选择文件"禁用；选完站点选 txt 文件 → 预览 → 确认 → 刷新列表

**黑名单页：**

- [ ] 工具栏搜索框按 tag 名模糊过滤
- [ ] 分页切换正常
- [ ] "批量添加"按钮打开对话框；和收藏页一致但字段是"原因"
- [ ] "导入"按钮打开对话框；txt / json 两种文件都能走通

**设置 - 关于 Tab：**

- [ ] "检查更新"按钮点击后状态从 loading → 结果文字
- [ ] 有更新时按钮变"查看发布页"，点击跳外部浏览器
- [ ] 断网情况下错误提示可读
- [ ] 60 秒内再次点击走缓存（可以在 devtools 看不到新的 fetch）

## 18. 实现顺序建议

虽然写计划的事交给下一个 skill，这里先给一个拓扑顺序参考：

1. 共享类型（`src/shared/types.ts` 新增 interface）
2. 服务端：`booruService` 分页 + 搜索改造（函数签名 + SQL + 所有内部调用点更新）
3. 服务端：`updateFavoriteTag` 支持 siteId + 校验
4. 服务端：`addFavoriteTagsBatch` 新增
5. 服务端：`import*PickFile` / `import*Commit` 新增，删除旧的一步导入
6. 服务端：`updateService` 新文件
7. IPC / preload：新增 channels + 改动已有 channels
8. 渲染层：共用组件 `BatchTagAddModal` + `ImportTagsDialog`
9. 渲染层：`FavoriteTagsPage` 重构
10. 渲染层：`BlacklistedTagsPage` 重构
11. 渲染层：`SettingsPage` 关于 Tab 检查更新
12. 手动验证清单（§17）

## 19. 风险与权衡

- **服务端分页破坏了所有内部调用点** —— 本次要统一改完，不留半吊子。实现时 grep 所有 `getFavoriteTags(` / `getBlacklistedTags(` / `getFavoriteTagsWithDownloadState(` 的调用点，确认全部更新。
- **`importFavoriteTags` 旧接口被删** —— 没有任何外部消费者（只有一个 UI 按钮），安全。
- **GitHub API 限流** —— 60 秒缓存 + 10 秒超时已缓解；极端场景（多机器同 IP）命中限流会返回 403，用户看到 "检查失败：API rate limit exceeded"，可以接受。
- **semver 比较用手写函数** —— 项目版本号形态简单（`x.y.z`），手写够用，不引入 `semver` 包；若未来版本号出现预发布后缀，手写函数要相应增强。
- **`FavoriteTagsPage.tsx` 1100+ 行** —— 本次不整体拆分，只在涉及的区域做结构清理。如果后续还有大改动，考虑抽 `FavoriteTagsTable` / `FavoriteTagsToolbar` 子组件，但不是本次目标。
- **拖拽排序和服务端分页** —— 跨页拖拽不支持；原本也基本不会发生（同一个 label 分组内的 tag 通常在同一页）。不特殊处理。

## 20. 开放问题（实现阶段再定）

以下细节留给计划 / 实现阶段决定，不影响整体设计：

- GitHub repo owner / repo 的确切字符串——实现时从现有 SettingsPage 关于 Tab 的 GitHub 链接里读取
- `addFavoriteTagsBatch` 对 `queryType` 的默认值——沿用 `addFavoriteTag` 的现有默认行为
- Table `scroll.x` 的具体数值——根据所有列的 `width` 总和估算后给一个略大的整数
- 操作列 `width` 的具体数值——数清当前的图标数 × 每个 28px + padding
- 搜索 debounce 的具体毫秒数——300ms 为起点，手感调整
