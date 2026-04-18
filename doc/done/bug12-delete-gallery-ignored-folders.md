# Bug 12: 删除图集不清理关联数据；缺少"已忽略文件夹"机制阻止重扫重建

## 现象 / 需求

### 现象：删除图集后残留很多垃圾

右键"删除"图集后：

- 数据库里 `galleries` 行被删除，但**该图集下属的图片记录、缩略图、无效图片记录、下载绑定的 galleryId 引用**等关联数据**没有被清理**。
- 图集文件夹的路径**也没有被记录**为"用户已主动移除"。
- 后果：
  - 磁盘上的缩略图文件（几十 MB ~ 几 GB 视图集规模）留在缓存目录，用户无法通过界面清除。
  - 数据库里的 `images`、`invalid_images` 残留条目还在被"最近图片/全部图片"等视图查询；甚至会以"找不到所属图集"的状态继续出现。
  - 用户进入 Settings 对同一个根文件夹点"扫描"，[scanSubfoldersAndCreateGalleries](src/main/services/galleryService.ts#L347-L463) 的去重策略只看"`folderPath` 是否已经在 galleries 表里"（[L394-L395](src/main/services/galleryService.ts#L394-L395)），**刚刚被删掉的图集会被重新创建**，相当于"删了个寂寞"。

### 需求：把删除和扫描这对行为闭环起来

1. 删除图集时，把相关数据一并清理（只保留磁盘源文件）。
2. 被删除的文件夹路径写入一张"已忽略文件夹"表，下次扫描时跳过。
3. Settings → "添加文件夹"按钮右侧加一个"**已忽略文件夹**"按钮，点击后弹窗：
   - 列出当前所有已忽略的文件夹（路径 + 备注）。
   - 支持**添加**（手选一条路径加入忽略名单）。
   - 支持**编辑**（修改路径或备注）。
   - 支持**删除**（把该路径从忽略名单移除，下次扫描可再次被发现）。
4. `scanSubfoldersAndCreateGalleries` 需要在"决定是否创建图集"时，额外判断路径是否命中忽略名单；已忽略的路径既不创建图集也不往下递归。

## 代码定位

### 当前 `deleteGallery` 只删了自己那一行

[src/main/services/galleryService.ts:253-276](src/main/services/galleryService.ts#L253-L276)：

```ts
export async function deleteGallery(id: number) {
  // 检查是否存在
  // ...
  await run(db, 'DELETE FROM galleries WHERE id = ?', [id]);
  return { success: true };
}
```

### `images` 表与 `galleries` 没有直接 FK

[database.ts:58-69](src/main/services/database.ts#L58-L69) `images` 没有 `galleryId` 字段：

```sql
CREATE TABLE images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT, filepath TEXT UNIQUE,
  fileSize INTEGER, width INTEGER, height INTEGER,
  format TEXT, createdAt TEXT, updatedAt TEXT
);
```

图集与图片的关联是**隐式的**：通过 `images.filepath` 以该图集 `folderPath` 开头来匹配。这意味着删除图集时不会因为 FK 级联自动删图片。

### 其它会受影响的表

[database.ts](src/main/services/database.ts) 中与某个 gallery 相关的表：

- `invalid_images.galleryId` ([L531-L532](src/main/services/database.ts#L531-L532))：`FOREIGN KEY (galleryId) REFERENCES galleries(id) ON DELETE SET NULL`——会把 galleryId 置空，但记录仍在，且这些图片可能也已被删掉需要清理。
- `booru_favorite_tag_download_bindings.galleryId` ([L447-L467](src/main/services/database.ts#L447-L467))：`ON DELETE SET NULL`——绑定被解除，但绑定配置本身还在。
- `booru_posts.localImageId` ([L188](src/main/services/database.ts#L188))：若 image 被删，这里 SET NULL；但 `downloaded=1` / `localPath` 仍为旧值，导致"已下载"判定错乱。
- `thumbnails` 不是表，是磁盘文件（由 [thumbnailService.ts:140-186](src/main/services/thumbnailService.ts#L140-L186) 管理），存在 `thumbnailService.deleteThumbnail(filepath)` 可以按图片路径清理。

### 扫描流程完全没有忽略名单检查

[galleryService.ts:347-463](src/main/services/galleryService.ts#L347-L463) `scanSubfoldersAndCreateGalleries` 去重只靠一处：

```ts
const existingGalleries = await all<{ folderPath: string }>(
  db, 'SELECT folderPath FROM galleries'
);
const existingPaths = new Set(existingGalleries.map(g => g.folderPath));
// ...
if (!existingPaths.has(normalizedFullPath)) {
  // 创建图集
}
```

这里没有"ignored list"的概念。另外 [L451](src/main/services/galleryService.ts#L451) 是**无条件递归**进子目录，即便当前目录被判为"已存在/忽略"也会继续递归——这条在加忽略名单时需要一起决定"忽略是不是含子树"。

### Settings 页的"添加文件夹"区

[src/renderer/pages/SettingsPage.tsx:490-557](src/renderer/pages/SettingsPage.tsx#L490-L557)：

- `SettingsGroup` 顶部标题：`settings.galleryFolders`
- 列表内每行：扫描 / 删除（[L506-L540](src/renderer/pages/SettingsPage.tsx#L506-L540)）
- 底部 "+ 添加文件夹"按钮（[L544-L556](src/renderer/pages/SettingsPage.tsx#L544-L556)）
- 加"已忽略文件夹"按钮就放在"添加文件夹"按钮右侧的同一行，视觉上两枚 link 并排即可。

### 其它相关入口

右键卡片"删除"会走 [GalleryPage.tsx:145-175](src/renderer/pages/GalleryPage.tsx#L145-L175) `handleDeleteGallery` → `window.electronAPI.gallery.deleteGallery(id)`。只要后端的 `deleteGallery` 改了，这条链路自动受益。

## 实施方案

把"删除清理 + 忽略名单"作为**一次**变更闭环，避免加一半留出新破面。

### ① 新增 `gallery_ignored_folders` 表

[database.ts](src/main/services/database.ts) 初始化里加：

```sql
CREATE TABLE IF NOT EXISTS gallery_ignored_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folderPath TEXT NOT NULL UNIQUE,
  note TEXT,                                -- 备注（例："由删除图集 X 自动添加"）
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gallery_ignored_folders_folderPath
  ON gallery_ignored_folders(folderPath);
```

路径统一用 `normalizePath` 落库（与 `galleries.folderPath` 一致），避免大小写 / 斜杠差异。

### ② `deleteGallery` 改造

在 [galleryService.ts:253-276](src/main/services/galleryService.ts#L253-L276) 内，按顺序（建议在事务里）做：

1. 查出 `folderPath`、`recursive`、相关 image id 列表：
   ```sql
   SELECT id, folderPath, recursive FROM galleries WHERE id = ?
   SELECT id, filepath FROM images
     WHERE filepath = ? || '%' ESCAPE '\'            -- 或按 folderPath 归属匹配
   ```
2. 遍历图片：对每条 `filepath` 调用 `thumbnailService.deleteThumbnail(filepath)` 清磁盘缩略图。
3. `DELETE FROM images WHERE id IN (...)`（触发 `image_tags` CASCADE、`booru_posts.localImageId` SET NULL、`booru_posts.downloaded/localPath` 需要单独用 `UPDATE` 清理）。
4. `DELETE FROM invalid_images WHERE galleryId = ?`（已被 SET NULL 的不在这里清，看数据是否都是同一文件夹下的）。
5. `DELETE FROM galleries WHERE id = ?`。
6. `INSERT OR REPLACE INTO gallery_ignored_folders (folderPath, note, createdAt, updatedAt) VALUES (?, '删除图集自动忽略', ?, ?)`。

注意：

- 步骤 3 要谨慎：`images` 的 filepath 匹配条件得是"属于该图集"——对于 `recursive=0` 的图集，只算直接子文件；对于 `recursive=1` 要算整个子树。可以直接取 `galleries` 的 `recursive` 字段决定匹配范围。
- 上层 [GalleryPage.tsx:145-175](src/renderer/pages/GalleryPage.tsx#L145-L175) 的 `handleDeleteGallery` 弹窗文案要改一下，明确：「同时忽略此文件夹，扫描时不再自动恢复」「不会删除磁盘原图」，避免用户误解成"删除图集 = 删原文件"。
- 产品上可以再加一个"删除图集但不忽略文件夹（留作以后重扫恢复）"的二级选项，但不做也能工作（用户可以之后从忽略列表里手动移除）。
- 此外注意同步修复已归档的 [doc/done/bug13-delete-image-column.md](doc/done/bug13-delete-image-column.md) 所涉及的 `deleteImage` 链路——本任务会逐图调用它，bug13 不修本任务从第一张图就断。

### ③ 扫描流程加忽略名单过滤

在 [galleryService.ts:373-377](src/main/services/galleryService.ts#L373-L377) 的预加载附近补一次查询：

```ts
const ignoredRows = await all<{ folderPath: string }>(
  db, 'SELECT folderPath FROM gallery_ignored_folders'
);
const ignoredPaths = new Set(ignoredRows.map(r => r.folderPath));
```

然后在 `scanSubfolders` 内 ([L380-L457](src/main/services/galleryService.ts#L380-L457))：

```ts
if (item.isDirectory()) {
  const normalizedFullPath = normalizePath(fullPath);
  if (ignoredPaths.has(normalizedFullPath)) {
    skipped++;
    continue;                              // 当前目录忽略，整棵子树也不递归
  }
  // ... 原有逻辑
  // 末尾递归时保持不变
  await scanSubfolders(fullPath);
}
```

产品决定点：**忽略是否连带子树**。推荐"是，整棵子树都跳过"——符合"我主动删了这个图集/不想再看到它"的语义。如果要严格只忽略本身，需要给 `gallery_ignored_folders` 多一个 `cascadeChildren: boolean` 字段，建议先不做。

### ④ IPC / preload 暴露忽略名单 CRUD

通道（[channels.ts](src/main/ipc/channels.ts) 现有的 `GALLERY_*` 命名空间下）：

- `GALLERY_LIST_IGNORED_FOLDERS`
- `GALLERY_ADD_IGNORED_FOLDER`
- `GALLERY_UPDATE_IGNORED_FOLDER`
- `GALLERY_REMOVE_IGNORED_FOLDER`

handler 和 galleryService 对应 CRUD 函数（`listIgnoredFolders` / `addIgnoredFolder` / `updateIgnoredFolder` / `removeIgnoredFolder`）。

preload [src/preload/index.ts](src/preload/index.ts) 的 `gallery` 分域增对应方法，返回 `{ success, data?, error? }`。

### ⑤ Settings UI：按钮 + 弹窗

在 [SettingsPage.tsx:544-556](src/renderer/pages/SettingsPage.tsx#L544-L556) 底部这个 bar 里原来的 `<Button type="link" + icon=<PlusOutlined />>添加文件夹</Button>` 改成一个 flex 容器：

```tsx
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: `${spacing.sm}px ${spacing.lg}px`,
              borderTop: `0.5px solid ${colors.separator}` }}>
  <Button type="link" icon={<PlusOutlined />} onClick={handleAddFolder}>
    {t('settings.addFolder')}
  </Button>
  <Button type="link" icon={<StopOutlined />} onClick={() => setIgnoredModalOpen(true)}>
    已忽略文件夹
  </Button>
</div>
```

弹窗（抽到 `components/IgnoredFoldersModal.tsx` 里）：

- 打开时 `window.electronAPI.gallery.listIgnoredFolders()` 拉列表。
- 表单型 List 或 Table，每行显示 `folderPath + note`，操作列有"编辑"、"删除"。
- 底部"+ 添加"按钮：弹 `selectFolder` 对话框选路径，`addIgnoredFolder({ folderPath, note })`。
- "编辑"允许修改 `note`（不建议让用户随意改 `folderPath`，如果真要改就删了再加，语义更干净）。

国际化 key 统一放在 [zh-CN.ts](src/renderer/locales/zh-CN.ts) / [en-US.ts](src/renderer/locales/en-US.ts)：`settings.ignoredFolders`、`settings.ignoredFoldersAdd` 等。

## 与其它 Bug 的关系

- 已归档的 [doc/done/bug10-gallery-detail-return.md](doc/done/bug10-gallery-detail-return.md)（图集详情返回逻辑）与本 Bug 是"同一个图集对象生命周期"的两端。修本 Bug 时可以顺带把 `pagePreferences.gallery.galleries.selectedGalleryId` 在删除时一并清掉，体验更完整。
- 已归档的 [doc/done/bug13-delete-image-column.md](doc/done/bug13-delete-image-column.md) 修复了 `deleteImage` 的 SQL 错误；本 Bug 的级联清理会逐图调 `deleteImage`，bug13 不修本链路第一张图就断。
- [GalleryCoverImage](src/renderer/components/GalleryCoverImage.tsx) 依赖缩略图文件在磁盘上存在；`deleteGallery` 清缩略图后要同时通过缩略图失效事件（或至少 `loadGalleries` 重拉）通知 UI 清缓存，避免 `getImageUrl` 指向一个已经不存在的文件。
- 与"缓存管理"分组（[SettingsPage.tsx:646](src/renderer/pages/SettingsPage.tsx#L646)）一致：现有 `CacheManagementGroup` 已有能力清缩略图，改 `deleteGallery` 时可以复用其底层清缩略图实现，避免双份代码。

## 影响

- **数据一致性**：`images` 中的残留记录会让"最近图片/全部图片"长期带着已无归属的图片（且缩略图在磁盘上仍占空间），长期使用后数据库与磁盘都会越来越脏。
- **用户预期错配**：用户理解"删除图集"就是"别再出现"；当前"一扫描又回来"直接颠覆预期，是一条易爆的体验 Bug。
- **风险点**：
  - 文件路径匹配（`filepath LIKE folderPath%`）在 Windows 下要注意斜杠 / 大小写；建议统一走 `normalizePath`，并用等号匹配 `galleries.folderPath` 字段范围查询，而不是简单前缀匹配。
  - 删除图片 + 清缩略图不是原子的，若中途失败可能留下"DB 删了但磁盘缩略图在 / 反之亦然"的半残状态；建议做成"先删 DB 记录，再异步清理磁盘缩略图"，并在失败时记录日志，下次清理任务捡起。
  - 忽略名单 CRUD 必须有路径标准化 + 去重，否则用户可能插入两条同路径不同大小写 / 斜杠的忽略项。
