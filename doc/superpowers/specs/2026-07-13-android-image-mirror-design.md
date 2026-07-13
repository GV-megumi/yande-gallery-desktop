# 安卓图片镜像层与高质量图档位设计（v0.7.0）

> 状态：📝 设计完成，待实施。承接 v0.6.0 图库功能补全（`2026-07-09-android-gallery-features-design.md`）。
> 目标版本：安卓 v0.7.0（versionCode 8）；桌面端新增一个 HTTP 端点（版本号发布时按 `doc/版本发布打包规范.md` 定）。

## 0. 背景与决策快照

### 0.1 问题

当前安卓端图片显示完全依赖「对桌面端的懒加载 HTTP 请求 + 机会性 LRU 磁盘缓存」：

- 网格缩略图、大图预览都是实时拉桌面端（`data/image/ImageLoaders.kt:13-14,57-58`），只有「曾经看过的图」会留在 Coil 磁盘缓存里；从未浏览过的图离线必然「加载失败」。
- Room 只镜像元数据（`data/db/Entities.kt` 的 `ImageEntity` 无任何本地像素路径），离线时列表能滚、图出不来。
- 「下载原图」写公共相册 `Pictures/YandeGallery/`（`data/media/AndroidMediaStoreGateway.kt:31`），26-28 还主动触发媒体扫描——与「不被手机其他文件系统扫到」的新要求相反。
- 分享强制「先下载原图再分享」（`domain/download/ShareCoordinator.kt:23-43`），离线或不想下原图时分享不可用。

### 0.2 用户已定决策

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 高质量图定义 | 桌面端**新增独立档位与接口**（非复用 1600px 预览档）；主要考虑手机存储，目标单图几百 KB；桌面端**不加设置 UI**，参数走 config 默认值 |
| D2 | 压缩规则 | 长边 2560px；**同格式压缩**（jpg→mozjpeg q85、webp→webp q85）；**PNG 例外转 JPG q85**（透明区域铺白底）；GIF 不压缩直接回原图 |
| D3 | 全量下载档位 | 按「保存方式」设置决定：高质量模式全量下高质量图；原图模式全量下原图（切换时展示预估占用并确认） |
| D4 | 同步触发 | 连接后自动增量（挂现有元数据同步总线），默认仅 WiFi，可设置允许移动网络 |
| D5 | 存储架构 | **独立图片镜像层**：app 外部私有目录 + Room 登记表；不复用 Coil 缓存、不用 MediaStore+.nomedia |
| D6 | 历史公共相册文件 | 保留不动，不迁移不删除；旧 `downloads` 表废弃删除 |
| D7 | 保存方式切换语义 | 只影响后续下载；**已有原图始终保留**（切回高质量不删原图、不重下高质量图） |
| D8 | 导出到系统相册 | 本轮不做；未来「本机相册管理」功能落地时一并提供（见 §9） |
| D9 | 缓存上限设置 | **移除**缩略图/预览两档上限设置；缩略图缓存实质不设限；1600px 预览档手机端下线 |
| D10 | 分享回退 | 本地无文件且在线→按当前保存方式临时拉一张入镜像再分享；离线且无文件→提示无法分享 |
| D11 | 缩略图来源 | 已镜像的图**手机端本地解码自产**缩略图（零网络）；未镜像的图回退拉桌面端 `/thumbnail` |

### 0.3 现状锚点（实施前以代码为准）

- 图片加载：Coil3 双 loader（`di/AppGraph.kt:121-130`），缩略图档 `cacheDir/thumbnails` 默认 2GB、预览档 `cacheDir/previews` 默认 1GB，上限构建期定死重启生效（`ImageLoaders.kt:26-48,70-74`）。
- 桌面三端点：`/api/v1/images/:id/thumbnail|preview|file`（`src/main/api/routes/galleryRoutes.ts:115-156`），经 `remapToAppNamespace` 克隆到手机面 `/api/app/v1/*`（`src/main/api/apiServiceManager.ts:76`）；权限正则 `permissions.ts:17` 只认这三个；安卓端二进制路径正则同样只认三个（`data/api/ApiClientFactory.kt:16`）。
- 预览档生成机制：实时生成 + md5(源绝对路径) 命名磁盘缓存 + 0 字节视为不存在（`src/main/services/thumbnailService.ts:294-371`）——HQ 档直接镜像此机制。
- 同步总线：激活服务器变化 → `syncScheduler.requestSync` + SSE 重连（`di/AppGraph.kt:82-108`）；`SyncEngine.sync` 只同步元数据（`domain/sync/SyncEngine.kt:20-71`）。
- 下载链路：`DownloadManager`（唯一工作名 KEEP 去重）→ `DownloadWorker`（流式 + Content-Length 校验）→ MediaStore（`domain/download/`、`data/media/`）。
- Room v5，10 张表；`downloads` 表 `(serverId, imageId)` 复合主键（`data/db/Entities.kt:82-88`）。
- 分享：`ShareCoordinator` 先备齐原图再分享 MediaStore URI；FileProvider 已声明但仅 `cache-path`（`AndroidManifest.xml:35-43`、`res/xml/file_paths.xml`）。

## 1. 范围

### 1.1 本轮做

| # | 内容 | 端 |
|---|---|---|
| F1 | 新增高质量图（HQ）档位端点 `GET /api/v1/images/:id/hq` + 生成服务 + 权限/手机面接线 | 桌面 |
| F2 | 图片镜像层：外部私有目录存储 + Room `image_files` 表 + `MirrorStore` 统一读写入口 | 安卓 |
| F3 | 镜像同步：元数据同步完成后自动增量批量下载（WorkManager，默认仅 WiFi，进度通知） | 安卓 |
| F4 | 网格缩略图本地化：Coil 自定义 Fetcher 优先解码本地镜像文件，回退远程缩略图 | 安卓 |
| F5 | 大图页改读镜像文件；未镜像时在线插队拉取、离线缩略图占位 | 安卓 |
| F6 | 「下载原图」改写镜像层（不写相册），完成后删同图高质量图 | 安卓 |
| F7 | 分享改「本地档位优先」：原图 > 高质量图 > 在线临时拉取 > 离线提示 | 安卓 |
| F8 | 设置：图片保存方式（高质量默认/原图）、允许移动网络同步；缓存页改版为存储页 | 安卓 |
| F9 | 移除：预览档 loader 与缓存、两档上限设置、MediaStore 下载链路、`downloads` 表 | 安卓 |

### 1.2 本轮不做（排除项，理由见 §9）

- 高质量图与原图**双档共存**（每图同一时刻只保留一档文件）。
- 导出到系统相册 / 设为壁纸入口（D8，等本机相册功能）。
- 历史 `Pictures/YandeGallery/` 文件的迁移或清理（D6）。
- 桌面端 HQ 档参数设置 UI（D1）。
- 按相册/标签选择性同步（全库粒度，v1 不细分）。
- 多服务器镜像并存：切换服务器清空镜像重建（与现有元数据镜像单活语义一致）。
- 大图页超高分辨率分块解码（SubsamplingScaleImageView 类能力）；沿用 Coil 按视图尺寸降采样。
- GIF 动图播放能力变化（沿用现有 Coil 解码栈，字节来源从网络变本地）。

## 2. 桌面端：高质量图档（HQ）

### 2.1 生成规则（`thumbnailService.ts` 新增 `generateHq`）

结构镜像 `generatePreviewInternal`（源文件预检 → 缓存命中 → sharp 生成 → 落盘），差异只在格式分支：

| 源格式 | 输出 | 说明 |
|---|---|---|
| jpg/jpeg | mozjpeg q85 | 同格式同扩展名 |
| webp | webp q85（effort 3） | 同格式同扩展名 |
| **png** | **jpeg q85，`.flatten({ background: '#ffffff' })`** | D2：透明铺白底，扩展名变 `.jpg` |
| gif | 不生成，直接回源文件路径 | 与 preview 档 GIF 直通一致 |
| 其他（bmp/tiff 等罕见） | jpeg q85 | 兜底 |

- 统一 `resize(2560, 2560, { fit: 'inside', withoutEnlargement: true })`。
- **体积保护**：每次服务该端点时（含缓存命中路径）`stat` 比较 HQ 产物与源文件字节数，若产物 ≥ 源文件则改回源文件路径——语义「HQ 档体积恒 ≤ 原图」（源图本身已很小时直接给原图，对手机端更优）。GIF 直通天然满足。此回退下响应为原图格式（png 源即 `image/png`），手机端照常按 Content-Type 落盘、登记为 HQ 档。
- 缓存路径：新目录 `hq/`（`getTierCachePath` 的 `ImageTier` 增 `'hq'`），沿用 md5(源绝对路径) 命名 + 0 字节视为不存在的投毒防御（`thumbnailService.ts:360-371`）。
- 并发去重沿用现有 thumbnailQueue 机制（key `hq:${imagePath}`）。

### 2.2 配置（无 UI）

`config.thumbnails.hq` 新增默认段（结构对齐 preview 段）：

```yaml
thumbnails:
  hq:
    cachePath: 'hq'
    maxWidth: 2560
    maxHeight: 2560
    quality: 85
    effort: 3
```

不在桌面设置页暴露；旧 config.yaml 缺段时走默认值合并（沿用现有 config 深合并逻辑）。

### 2.3 端点与接线

- `createImageBinaryRoutes()` 增加第四条路由 `GET /api/v1/images/:imageId/hq`（`galleryRoutes.ts:115`），自动随 `remapToAppNamespace` 出现在手机面 `/api/app/v1/images/:id/hq`。
- 权限正则 `permissions.ts:17` 扩为 `(?:thumbnail|preview|hq|file)`（imageBinary 域）。
- 响应头：`Content-Type` 必须与实际产物格式一致（png→jpg 时为 `image/jpeg`；体积保护回退原图时为原图格式）——手机端靠它决定落盘扩展名。实施时核实 `serveBinaryFile` 按扩展名推断 Content-Type 的行为覆盖此场景。
- 现有 `/preview` 端点**保留**（API 兼容，桌面渲染层或旧客户端可能使用），仅安卓端停用。

## 3. 安卓端：图片镜像层

### 3.1 存储布局

```
getExternalFilesDir(null)/mirror/s{serverId}/i{imageId}/{清洗后文件名.实际扩展名}
```

- **外部私有目录**（`Android/data/com.bluskysoftware.yandegallery/files/`）：天然不被媒体库扫描（无需 `.nomedia`）、不需任何存储权限、卸载即清——同时满足「原图和高质量图都不被扫到」与用户可用 USB/文件管理器手动取文件。`getExternalFilesDir` 返回 null（无外部存储）时回退内部 `filesDir/mirror/`。
- **每图独立子目录 `i{imageId}/`**：图库文件名不保证全局唯一，按图隔离避免碰撞；「原图落定后清除同目录其余文件」天然实现 HQ→原图替换（含 png 的 `foo.jpg`(HQ) → `foo.png`(原图) 异名场景）。
- 文件名规则：**ORIGINAL 档直接用 Room `images.filename` 原文**（避免经 Content-Type 反推出现 `.jpeg`→`.jpg` 漂移）；**HQ 档 = 原图主文件名 + 按响应 Content-Type 定的实际扩展名**（png→jpg 时变 `foo.jpg`；体积保护回退原图时 Content-Type 即原图格式，拼回原名）。对安卓非法字符（`\ / : * ? " < > |`）清洗为 `_`，实际落盘名记录在 DB。
- `serverId` 用本机 `servers.id`（与现有缓存键、`downloads` 表口径一致）。

### 3.2 Room：`image_files` 表（schema v5→v6）

```
image_files(
  serverId  INTEGER NOT NULL,   -- 本机 servers.id
  imageId   INTEGER NOT NULL,
  tier      TEXT NOT NULL,      -- 'HQ' | 'ORIGINAL'
  relPath   TEXT NOT NULL,      -- 相对 mirror 根，如 "s3/i42/foo.jpg"
  bytes     INTEGER NOT NULL,   -- 实际落盘字节数
  createdAt INTEGER NOT NULL,   -- epoch ms
  PRIMARY KEY(serverId, imageId)
)
```

- **每图一行**（档位互斥，D7 下原图行不会降级回 HQ）；HQ→原图升级 = 同行 UPDATE。
- 不建外键（与 `album_prefs` 同理：images 全量对账可能整表重写，靠对账后清理孤儿行，见 §3.4）。
- 迁移 v5→v6：建 `image_files`，**DROP `downloads` 表**（D6；对应 `DownloadEntity`/DAO/「下载记录」UI 一并删除）。

### 3.3 `MirrorStore`：唯一写入口

单例（AppGraph 装配），收敛所有镜像文件写入与登记：

```kotlin
interface MirrorStore {
  /** 确保某图某档位就位（幂等）。已有 ORIGINAL 时请求 HQ 直接返回现有文件。 */
  suspend fun ensure(serverId: Long, imageId: Long, tier: Tier): Result<File>
  /** 本地现状查询（供 Fetcher/分享/大图页同步判断）。 */
  suspend fun localFile(serverId: Long, imageId: Long): LocalImage?  // tier + File
  suspend fun stats(serverId: Long): MirrorStats                     // 各档位张数/字节
  suspend fun clear(serverId: Long)
}
```

- `ensure` 内部：per-key `Mutex`（`"s{serverId}:i{imageId}"`）防同图并发双下；下载 = 带 Bearer 的 OkHttp 流式 GET（HQ→`/hq`，原图→`/file`）→ 写 `*.part` 临时文件 → Content-Length 校验 → 原子 rename → 清除同目录其余文件 → upsert `image_files` 行。
- **同步 Worker 与前台插队（大图页/分享）共用 `ensure`**，锁保证不重复下载；插队请求走独立协程（不等 Worker 队列）。
- 「已有 ORIGINAL 时请求 HQ 直接返回」实现 D7 的「原图始终保留」。

### 3.4 镜像同步（`MirrorSyncWorker`）

- **触发**：① 元数据同步成功后链式入队（`SyncEngine.sync` 成功回调 / `SyncScheduler` 尾部）；② 保存方式切换确认后 REPLACE 入队；③ 存储页手动「立即同步」。SSE 触发的元数据增量同步天然带动 ①。
- **唯一工作名** `mirror-sync-{serverId}`，`ExistingWorkPolicy.KEEP`（切换设置用 REPLACE）；约束默认 `NetworkType.UNMETERED`，「允许移动网络同步」开启时降为 `CONNECTED`。
- **每轮算法**（增量天然断点续传——每次重算缺失集合）：
  1. 读当前保存方式 mode（HQ | ORIGINAL）。
  2. 缺失集合：`SELECT i.id FROM images i LEFT JOIN image_files f ... WHERE f.imageId IS NULL OR (mode='ORIGINAL' AND f.tier='HQ')`，按 `createdAt DESC`（新图优先，用户先看得到）。
  3. 有限并发（3 路）逐张 `MirrorStore.ensure(id, mode 对应档位)`。
  4. 单图 404 → 计数跳过（元数据对账会删掉该图行，下轮不再出现）；**仅 HQ 模式下**：连续前 5 张全部 404 且 `service/info` 可达 → 中止本轮并置同步错误「桌面端版本过旧，不支持高质量图档」（旧桌面无 `/hq` 的兼容保护；下轮同步自动重试，误判可自愈）。原图模式走 `/file`（旧桌面也有），404 只按单图跳过处理。
  5. 磁盘可用空间 < 500MB → 暂停，置「存储空间不足」状态。
  6. 网络/IO 错误 → `Result.retry()` 指数退避。
- **进度**：`setProgress(done/total)` + 前台通知（沿用/扩展 `DownloadNotifier` 通道，聚合进度「正在同步图片 x/y」）；存储页与设置同步状态行展示同一数据。
- **对账清理**：
  - `RoomMirrorStore.clearMirror`（切服/dataVersion 变化）追加：清 `image_files` + 后台删除 `mirror/s{serverId}/` 目录。
  - 元数据 image-ids 对账删除图片行后：删除 `image_files` 中 imageId 不在 `images` 的行及其目录。
  - 启动后台孤儿清扫：`mirror/` 下无对应 `image_files` 行的目录删除；有行无文件的行删除（下轮同步自动补）。

## 4. 行为语义

### 4.1 网格缩略图（F4）

- 自定义 Coil `Fetcher.Factory` 注册到 loader：请求模型仍是现有 `thumbnailRequest`（缓存键不变），Fetcher 先查 `MirrorStore.localFile`——有镜像文件则直接以该文件为源（Coil 按网格 cell 尺寸自动降采样解码，**零网络**）；无则回退现有网络路径拉 `/thumbnail`。
- 远程缩略图磁盘缓存**移除上限**：`DiskCache.maxSizeBytes` 置极大值（如 1 TiB，实质仅受磁盘约束）——需求 1「预览缩略图不限制缓存上限」的落点；镜像建成后该缓存流量自然趋零，仅覆盖「刚入库还没同步到」的窗口。
- 预览档 loader（`previewLoader`）、`cacheDir/previews` 目录、预览缓存键全部删除；启动时一次性递归删除旧 `previews` 目录。

### 4.2 大图浏览（F5）

- 有镜像文件（HQ 或原图）→ 直接加载本地文件（按视图尺寸降采样，不整幅解码超大原图）。
- 无镜像文件且在线 → 触发 `MirrorStore.ensure`（插队，不排 Worker 队列），期间显示缩略图占位 + 加载指示；完成后切换清晰版（顺带把这张图的同步补齐了）。
- 无镜像文件且离线 → 显示缩略图缓存（若有）+「未同步」角标提示；连缩略图都没有才显示占位错误。

### 4.3 下载原图按钮（F6）

- 语义变更：从「下载到系统相册」改为「获取原图到本机镜像」。入口不变（大图页/多选批量）。
- 实现：`DownloadWorker` 重写为调 `MirrorStore.ensure(id, ORIGINAL)`（保留 WorkManager 外壳：大文件可靠性 + 单图进度通知 + 批量队列）；**成功后同目录 HQ 文件已被 ensure 的「清除其余文件」逻辑删除**，Room 行升为 ORIGINAL——需求 3。
- 已是 ORIGINAL 的图按钮态为「已有原图」（禁用/打勾）。
- `MediaStoreGateway`/`AndroidMediaStoreGateway` 及媒体扫描调用**整体删除**（需求 5：原图不再进相册、不触发扫描）。

### 4.4 分享（F7，需求 4）

单张规则（`ShareCoordinator` 重写）：

1. 本地有 ORIGINAL → 分享原图；
2. 否则本地有 HQ → 分享高质量图（**不再强制先下原图**）;
3. 否则在线 → `ensure(当前保存方式档位)` 临时拉取入镜像后分享（D10）;
4. 否则（离线且无文件）→ 提示「该图未同步且当前离线，无法分享」。

- 多张分享：对缺失项按规则 3 先补齐，任一失败则中止并提示（保持现有「先备齐再分享」的整体语义）。
- URI 改用 **FileProvider**（`file_paths.xml` 增加 `<external-files-path name="mirror" path="mirror/" />`；内部 filesDir 回退时对应 `files-path`），`ACTION_SEND(_MULTIPLE)` + `FLAG_GRANT_READ_URI_PERMISSION`；MIME 按实际扩展名，混合多选用 `image/*`。接收方看到的文件名 = 镜像文件名（主名与原图一致、扩展名与内容一致，无兼容性问题）。
- MediaStore URI 分享路径删除。

### 4.5 保存方式切换（F8，D3/D7）

- 高质量 → 原图：弹确认框，展示**预估补量** `SELECT SUM(fileSize) FROM images WHERE 无 ORIGINAL 行`（GB 级展示）与当前磁盘可用空间；确认 → 写偏好 + REPLACE 入队镜像同步（逐张原图落定即删对应 HQ）；取消 → 还原选项。
- 原图 → 高质量：直接生效，无弹窗；已有原图全部保留，仅新图/缺失图按 HQ 档补。

### 4.6 离线可用性（需求「保持未连接时基本可用」）

- 元数据浏览：Room 本就离线可用（现状保持）。
- 图片：镜像建成后网格/大图/分享全部本地文件直出，**不依赖连接**；未同步窗口内的图退化为「缩略图缓存 + 未同步提示」。
- 写操作/同步按现状置灰或排队，不在本轮变更。

## 5. 设置与存储页改版（F8/F9）

### 5.1 设置页（`SettingsScreen`）

新增「图片同步」分组：

- **图片保存方式**：单选 高质量（默认）/ 原图；选原图走 §4.5 确认流。
- **允许移动网络同步**：开关，默认关（D4）。
- **同步状态行**：已同步 x/y（点击进存储页）。

### 5.2 存储页（`CacheScreen` 改版）

- **移除**：缩略图/预览两档上限选择（D9）、预览缓存区块、「下载记录」列表（表已删）。
- **展示**：图片镜像占用（高质量 n 张 xx MB / 原图 n 张 xx GB，来自 `MirrorStore.stats`）、缩略图缓存占用、同步进度与最近错误（含「桌面端版本过旧」「存储空间不足」等 §3.4 状态）。
- **操作**：「立即同步」、「清理缩略图缓存」（保留现状）、「清空图片镜像」（二次确认；清后自动重新入队同步）。

### 5.3 偏好持久化（`PrefsStore`）

- 新键：`image_save_mode`（`"HQ"` 默认 / `"ORIGINAL"`，enum name 存法非法值收敛默认——沿用现有惯例）、`mirror_sync_cellular`（Boolean 默认 false）。
- 删除：两档缓存上限键的访问器与 UI（DataStore 里的陈旧键无害，不做清理迁移）。

## 6. 错误处理与健壮性

- **半截文件防御**：`*.part` 临时写 + 校验后原子 rename，镜像目录里永远不存在可被读到的半截/0 字节文件（呼应桌面端 0 字节缩略图投毒的既往修复，`thumbnailService.ts:360-371` 同款思路）。
- **单图失败不阻塞全局**：404 跳过靠对账收敛；其他错误退避重试；缺失集合每轮重算，天然幂等可续。
- **旧桌面兼容**：`/hq` 全 404 保护（§3.4 第 4 条）给出明确「升级桌面端」提示，而不是静默同步失败。
- **磁盘空间**：同步前与每张落盘前查可用空间（阈值 500MB），不足即暂停并可视化提示；切原图模式的确认框预先展示预估占用 vs 可用空间。
- **进程内一致性**：所有写走 `MirrorStore` 单入口 + per-key Mutex；Worker 与插队路径不会双写同一图。
- **跨切服拦截**：`ensure` 落行前校验 serverId 仍为当前激活服务器，不是则丢弃结果（沿用旧 `DownloadWorker`「飞行中下载跨切服拦截」的既有先例）；切服时取消旧 serverId 的镜像同步工作。

## 7. 兼容与迁移

| 项 | 处理 |
|---|---|
| Room v5→v6 | 建 `image_files`、DROP `downloads`；无数据搬迁（旧下载记录作废，D6） |
| 历史相册文件 | `Pictures/YandeGallery/` 保留不动（D6） |
| 旧预览缓存目录 | 启动一次性删除 `cacheDir/previews` |
| 旧桌面端 | 手机端探测 `/hq` 404 → 明确提示升级；元数据同步不受影响 |
| 桌面 `/preview` 端点 | 保留（API 兼容），安卓不再调用 |
| 安卓二进制路径正则 | `ApiClientFactory.kt:16` 增加 `hq` |

## 8. 测试策略

**桌面（vitest）**：

- `generateHq` 格式分支：jpg/webp 同格式、png→jpg 白底（含透明 png）、gif 直通、体积保护回退原图、0 字节缓存视为未命中。
- 路由：`/hq` agent 面 + 手机面 remap 各一条；permissions 正则含 `hq`；Content-Type 与产物一致（png 源出 `image/jpeg`）。

**安卓（JUnit/Robolectric，沿用现有测试惯例）**：

- Room v5→v6 迁移（含 `downloads` 表删除后旧库可开）。
- `MirrorStore`：ensure 幂等、并发同图单次下载（Mutex）、part→rename 原子性、原图落定清 HQ、非法字符文件名清洗、`localFile`/`stats` 正确性。
- `MirrorSyncWorker`：缺失集合计算（HQ/ORIGINAL 两模式）、404 跳过与全 404 中止、磁盘不足暂停、进度上报（mock API/文件系统）。
- Coil Fetcher：本地命中零网络、缺失回退远程、镜像升级后仍正常显示。
- `ShareCoordinator`：四级规则（原图/HQ/在线临时拉/离线提示）、多张补齐失败中止、FileProvider URI 正确。
- 设置：切原图确认框预估值、取消还原、切回高质量不删原图；两档上限设置移除后存储页渲染。
- 大图页：本地直出、在线插队拉取占位切换、离线未同步提示（组件测试）。

## 9. 排除项理由与后续

- **双档共存**：存储翻倍无收益——HQ 是原图的严格降级，有原图时 HQ 无任何用途（D7 的删除语义即基于此）。
- **导出到系统相册**：用户明确规划到未来「本机相册管理」功能（查看/管理本机图片、移动/复制到相册），届时以「复制到系统相册」动作承载；本轮镜像层的 FileProvider 分享已覆盖「把图给出去」的即时需求。
- **选择性同步**：v1 全库粒度足够（HQ 档全量也就几百 KB × 库容）；若未来库容膨胀到移动端不可承受，再按相册/标签圈选，届时缺失集合查询天然可加 WHERE。
- **切服清镜像**：与元数据镜像单活语义一致，避免多服文件归属/配额的复杂度；`mirror/s{serverId}/` 目录结构已为未来多服并存留好命名空间。
