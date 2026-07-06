# 安卓局域网相册 App 需求与设计（v1）

日期：2026-07-03
状态：已确认；M1（桌面端）/M2（安卓骨架）/M3（核心体验）/M4（打磨）已实现
关联：`doc/skill需求文档/API服务与CLI及Skill整体方案设计.md`（API 服务底座）、`docs/superpowers/plans/2026-05-23-api-service-phase1.md`

## 1. 背景与目标

桌面端（yande-gallery-desktop）已管理大量本地图片（图集、标签、SQLite 元数据）。目标是做一个**安卓端相册 app**，通过**局域网 HTTP** 连接桌面端：

- 浏览桌面端本地图库（时间轴、相册、大图、搜索）；
- 交互体验与界面设计**对标小米自带相册应用**；
- 可选下载原图；缩略图/预览在手机端缓存，浏览手感等同本地相册。

曾评估基于 Boorusama 改造，被否决；确定**自研安卓原生 app**。现有 API 服务是给 agent/CLI 设计的，移动端**不受其接口形态约束**，但复用其服务底座。

## 2. 范围

### 2.1 v1 目标

1. 桌面端：API 服务新增移动端所需接口（预览档、同步接口、写操作接口、二进制补强、二维码配对入口）。
2. 安卓端：照片时间轴、相册（图集）、大图浏览、搜索、多选、下载原图到系统相册、设置（服务器/缓存管理）。
3. 安卓端：写操作——删除图片、图集管理（新建/重命名/删除、移入移出）、标签编辑，行为与桌面端一致。
4. 安卓端：元数据本地镜像 + 增量同步，离线可浏览已缓存内容。

### 2.2 v1 非目标

- booru 在线世界（搜索帖子、收藏、下载队列管理）；
- 回收站/软删除（桌面端本无此概念，删除即永久删除）；
- 离线写队列（写操作要求在线）；
- 公网访问、TLS、账号体系；
- mDNS 自动发现（P2，二维码配对已覆盖主流程）；
- iOS、视频播放、图片编辑。

## 3. 已确认的关键决策（决策记录）

| # | 决策 | 说明 |
|---|------|------|
| D1 | 传输协议用 HTTP | Range/ETag/流式天然匹配；移动端图片库全部围绕 HTTP 设计；否决 FTP/SMB/WebDAV/gRPC |
| D2 | 功能范围只做本地图库 | booru 在线部分不进 v1 |
| D3 | 技术栈 Kotlin + Jetpack Compose | 原生手感最接近小米相册；仅做安卓无跨平台税 |
| D4 | 图像三档：800px 缩略图 / 1600px 预览 / 原图 | 800 撑网格、1600 撑全屏；1600 档仅服务移动端（桌面查看器切档的早先要求已由用户撤回） |
| D5 | 「查看原图」=「下载原图」 | 单一语义，无独立"缓存原图"概念 |
| D6 | 原图直接写入系统相册（MediaStore） | 用户知悉隐私影响（可被云同步/其它 app 扫到）后确认 |
| D7 | 手机端做元数据本地镜像（Room） | 时间轴/搜索/相册全走本地查询，对标小米相册手感 |
| D8 | 安卓工程放本仓库 `android/` 子目录 | 与桌面 API、需求文档同步演进 |
| D9 | v1 包含全套写操作 | 删除图片、图集管理（新建/重命名/删除、移入移出）、标签编辑；用户明确要求进 v1（推翻早期只读设定） |
| D10 | 删除为永久删除且双端级联 | 桌面端：与 `imageService.deleteImage` 一致（库记录+磁盘文件+缩略图，无回收站，booru 帖子复位可重下）；手机端：二次确认，并级联清理本地镜像、缓存与已下载到系统相册的副本 |

## 4. 总体架构

```
┌─────────────────────────┐         局域网 HTTP          ┌──────────────────────────┐
│ 安卓 App (Kotlin/Compose)│ ◄──────────────────────────► │ 桌面端 API 服务 (Node http)│
│  Room 元数据镜像          │   Bearer token / 私网IP白名单 │  端口 38947, LAN 模式      │
│  Coil 两级图片缓存        │   JSON + 图片二进制 + SSE     │  SQLite / thumbnailService │
│  MediaStore 原图下载      │                              │  eventHub (SSE)           │
└─────────────────────────┘                              └──────────────────────────┘
```

- 复用 `src/main/api/` 底座：同一 http server、端口、`security.ts` 的 Bearer 鉴权与私网 IP 白名单、`eventHub` SSE。
- 移动端权限集：只读 `galleryRead`、`imageRead`、`imageBinary`、`eventsSubscribe`，写 `imageWrite`、`galleryWrite`（新增权限键，沿用现有模块级权限模型）。
- 明文 HTTP 仅限局域网，沿用「不提供公网模式」的既有安全立场。

### 4.1 配对

- 桌面端设置页「API 服务」卡片新增**显示二维码**：内容为 JSON `{"v":1,"name":"<服务器名>","baseUrl":"http://<ip>:<port>","apiKey":"<key>"}`。
- 手机端「添加服务器」：扫码（ML Kit Barcode）或手动输入 baseUrl + apiKey。
- 手机可保存多个服务器配置（DataStore），同时激活一个；连接失败时引导重扫/编辑地址。

## 5. 桌面端改造

### 5.1 1600px 预览档（D4）

- `thumbnailService` 新增第二档：长边 1600px、webp、质量约 88（配置节 `thumbnails.preview`，字段与现有缩略图配置对齐：maxWidth/maxHeight/quality/effort）。
- 独立缓存目录（如 `data/previews/`），命名沿用 `md5(源文件绝对路径)`，按需生成 + 持久缓存，纳入孤儿清理逻辑。
- 新增 API：`GET /api/v1/images/:imageId/preview`（权限 `imageBinary`），行为同 thumbnail 路由（缺失则现场生成再流式返回）。
- 该档仅供移动端使用，桌面端查看器行为不变。GIF 沿用现有动图处理策略，直接回原文件不转码。

### 5.2 二进制路由补强（thumbnail / preview / file 三处统一）

现状缺口（`src/main/api/routes/galleryRoutes.ts`）：无 Range/206、无 ETag/Cache-Control、`/file` 固定 `application/octet-stream`。补强为：

1. `Accept-Ranges: bytes`，支持单段 `Range` 请求返回 206（`Content-Range` + 对应字节流），非法范围返回 416；
2. 弱 ETag：`W/"<size>-<mtimeMs>"`（对源文件或缓存派生文件取 stat）；支持 `If-None-Match` 返回 304；
3. `Cache-Control: private, max-age=604800`（一周），过期后凭 ETag 重校验拿 304——不用 `immutable`，因为源文件可能被原地替换（同路径内容变化），需要保留重校验通道；
4. `Content-Type` 按扩展名映射（`/file` 一并修正），`Content-Length` 齐全。

### 5.3 同步接口（支撑手机元数据镜像，D7）

设计原则：**全量与增量统一为同一个分页接口**（空游标 = 全量），游标为服务端生成的**不透明字符串**（内部按 `(updatedAt, id)` 排序定位），客户端原样带回。

| 接口 | 说明 |
|------|------|
| `GET /api/v1/sync/meta` | `{ serverId, dataVersion, imageCount, latestCursor }`。`dataVersion` 持久化于桌面配置，**备份恢复、根目录迁移等破坏性操作后递增**；手机发现变化即全量重建镜像 |
| `GET /api/v1/sync/images?cursor=&limit=` | 按 `(updatedAt, id)` 升序分页返回**去范式化**的图片元数据：`{ id, filename, width, height, fileSize, format, createdAt, updatedAt, tagIds[], galleryIds[] }`；响应 `{ items, nextCursor, hasMore }`。limit 默认 2000，上限 5000 |
| `GET /api/v1/sync/galleries` | 图集全量（小表）：`{ id, name, coverImageId, imageCount }` |
| `GET /api/v1/sync/tags` | 标签字典全量（小表）：`{ id, name, category }` |
| `GET /api/v1/sync/image-ids` | 现存全部 image id 清单（万级 ≈ 几十 KB），供手机 diff 出**删除**（桌面无 tombstone，这是不改 schema 的删除传播方案） |

- 以上 JSON 响应支持 gzip（按 `Accept-Encoding`）。
- 权限均为 `galleryRead`。
- **配套约束（桌面端）**：凡影响某图片可同步元数据的变更——含标签增删、图集归属变化——必须触碰对应 `images.updatedAt`，否则增量同步会漏掉该变化。实现时审计现有写路径并补齐。
- 不下发 `filepath`（手机端不需要绝对路径，减小载荷与信息暴露）。

### 5.4 写操作接口（D9/D10）

全部写接口**复用桌面端既有 service 层**（`imageService` / 图集服务），不得绕过直写 SQL——确保删除/变更走同一套业务语义（booru 帖子复位、imageCount 回写、领域事件发布），并按 §5.3 的约束触碰相关 `images.updatedAt`。

| 接口 | 权限 | 说明 |
|------|------|------|
| `DELETE /api/v1/images/:imageId` | imageWrite | 永久删除（库记录+磁盘文件+缩略图），复用 `imageService.deleteImage`；目标不存在返回 404 |
| `POST /api/v1/images/batch-delete` | imageWrite | `{ imageIds[] }` 批量删除，逐个复用同一 service，响应逐条成败 |
| `POST /api/v1/images/:imageId/tags` | imageWrite | `{ names[] }` 添加标签（不存在的标签自动创建） |
| `DELETE /api/v1/images/:imageId/tags` | imageWrite | `{ names[] }` 移除标签 |
| `POST /api/v1/galleries` | galleryWrite | `{ name }` 新建图集 |
| `PATCH /api/v1/galleries/:galleryId` | galleryWrite | `{ name }` 重命名图集 |
| `DELETE /api/v1/galleries/:galleryId` | galleryWrite | 删除图集（仅图集与归属关系，不删图片文件，与桌面端语义一致） |
| `POST /api/v1/galleries/:galleryId/images` | galleryWrite | `{ imageIds[] }` 图片移入图集 |
| `DELETE /api/v1/galleries/:galleryId/images` | galleryWrite | `{ imageIds[] }` 图片移出图集 |

- 写操作成功后，手机端立即对本地 Room 镜像应用同样变更（不等下一轮同步），随后照常增量同步兜底。
- 手机端写操作要求在线，离线时相关按钮禁用（v1 无离线写队列）。
- 删除图片一律二次确认；删除在手机端**级联清理**：本地镜像行、两级图片缓存、以及已下载到系统相册的副本（凭 `downloads` 表映射删除对应 MediaStore 条目）。桌面端发起的删除经同步对账发现后，同样执行级联清理。

### 5.5 SSE 事件

- 手机前台时订阅 SSE，要求能收到图库变更事件（`gallery:images-changed`、`gallery:galleries-changed`、`app:data-restored` 等，事件类型已存在于 `appEventPublisher`）；若现有频道划分未覆盖 LAN 客户端可订阅的图库事件，则新增 `gallery` 频道。
- 事件仅作**触发器**：收到后手机发起一次增量同步，不依赖事件载荷本身。

### 5.6 设置页

- API 服务卡片新增「显示二维码」弹窗（含当前局域网 IP 列表选择、二维码、明文 baseUrl/key 供手输）。

## 6. 安卓端设计

### 6.1 技术选型与工程

- Kotlin + Jetpack Compose（Material 3），单 Gradle 模块起步，包结构 `data / domain / ui` 分层。
- 依赖：Room、Coil（图片加载）、OkHttp + Retrofit + kotlinx.serialization、OkHttp SSE、DataStore（服务器配置）、WorkManager（原图下载）、ML Kit Barcode（扫码）、Navigation Compose。
- applicationId：`com.bluskysoftware.yandegallery`；minSdk 26，targetSdk 35。
- 工程位置：本仓库 `android/` 目录（D8），独立 Gradle 构建，不接入桌面端 npm 流程。

### 6.2 Room 镜像与本机表

镜像表（与同步载荷一一对应）：`images`、`galleries`、`gallery_images`、`tags`、`image_tags`。

本机自有表：

- `servers`：`{ id, name, baseUrl, apiKey, isActive }`；
- `sync_state`：`{ serverId, cursor, dataVersion, lastSyncAt }`；
- `downloads`：`{ imageId, mediaStoreUri, downloadedAt }`——记录已下载原图，用于大图页直读本地原图、避免重复下载、多选时显示状态。

### 6.3 同步引擎

1. **首次连接**：`meta` → 空游标分页拉 `sync/images`（进度条按 `imageCount` 展示）→ `galleries` + `tags` 全量 → 写库完成，记录 cursor 与 dataVersion。
2. **例行同步**（进前台、下拉刷新、SSE 触发）：`meta` 校验 dataVersion（变化→全量重建）→ `sync/images?cursor` 增量 upsert → `image-ids` diff 删除本地多余行 → `galleries`/`tags` 全量覆盖（小表）。对账删除的行执行 §5.4 的级联清理（缓存 + 系统相册副本）。
3. 同步全程后台静默，UI 永远先渲染本地 Room 数据；失败仅在下拉刷新时提示。
4. 二进制请求遇 404 时触发一次 image-ids 对账（文件在桌面端被移除的兜底）。

### 6.4 图片三档管线（D4/D5/D6）

| 档位 | 来源 | 用途 | 手机端缓存 |
|------|------|------|-----------|
| 缩略图 800px | `/images/:id/thumbnail` | 时间轴/相册/搜索网格 | Coil 独立磁盘缓存，**持久**，默认上限 2GB（设置可调/可清理） |
| 预览 1600px | `/images/:id/preview` | 全屏大图默认档 | Coil 独立磁盘缓存，LRU，默认上限 1GB（设置可调/可清理） |
| 原图 | `/images/:id/file` | 「查看原图」 | 不进缓存；WorkManager 下载，写入 MediaStore `Pictures/YandeGallery/`，`downloads` 表记录映射 |

- 所有请求经 OkHttp 拦截器统一附加 `Authorization: Bearer`；Coil 复用同一 OkHttp。
- 大图页左右滑动时预取相邻前后各 1 张的 1600 档。
- 原图下载以 `Content-Length` 校验完整性（本地图库无 md5 列，不做哈希校验）；失败自动重试（WorkManager 退避策略），通知栏显示进度。
- 「已下载」的图片：大图页**跳过 1600 档**，直读 MediaStore 本地原图，操作栏显示「已保存」；若 MediaStore 条目已被用户在系统相册删除（映射失效），回退 1600 档并清理 `downloads` 表该行。

## 7. 页面与交互规范（对标小米相册）

整体：底部两个 tab「照片」「相册」；Material 3 动态取色关闭，使用自定义浅色/深色主题（跟随系统），风格贴近 MIUI 相册（大标题、圆角卡片、留白克制）。

### 7.1 照片 tab（时间轴）

- 全部图片按 `createdAt`（入库时间）倒序，本地时区分组；sticky 分组头（日视图按天、月视图按月）。
- **双指捏合切换密度**：月视图 ↔ 日视图 3 / 4 / 5 列，四档，带平滑缩放过渡；档位记忆。
- 右侧**快速滚动滑块**：拖动浮出「2026年6月」式日期气泡，松手落位。
- 顶部搜索框入口 + 连接状态（离线时细横幅）。

### 7.2 相册 tab

- 图集网格卡片：封面（coverImageId，缺省取图集内最新图）+ 名称 + 张数。
- 点入为该图集网格页（与时间轴同构，无日期分组，按 createdAt 倒序）。
- 右上角「+」新建图集；长按图集卡片弹出菜单：重命名 / 删除（二次确认，说明不删图片文件）。

### 7.3 大图页

- 进入/返回使用共享元素转场；左右滑切换（Pager）。
- 手势：双击缩放循环（适配↔2x）、双指自由缩放（上限约 5x，1600 档像素不足时提示可查看原图）、单击切换沉浸模式（隐藏系统栏与操作栏）、**下滑拖拽关闭**返回网格。
- 底部操作栏：**分享**（未下载则先执行下载原图再唤起系统分享）／**查看原图**（=下载，D5；已下载显示「已保存」并直读本地）／**删除**（二次确认，D10）／**详情**／**更多**（加入图集、移出当前图集）。
- 详情面板（上滑或点详情）：文件名、分辨率、大小、格式、入库时间、标签（可点击跳搜索，**可编辑**：添加/移除，D9）、所属图集（可点击跳图集）。

### 7.4 搜索页

- 本地 Room 即时查询（逐字出结果）：标签名前缀匹配 + 文件名包含匹配；多关键词空格分隔取交集。
- 搜索历史本地保存（可清空）；结果网格与时间轴同构。

### 7.5 选择模式

- 网格长按进入多选：角标勾选、顶部计数 + 全选、底部操作栏 **下载 / 分享 / 删除 / 加入图集 / 取消**（在图集内浏览时另有「移出图集」）；批量下载进 WorkManager 队列，批量删除二次确认（明示数量）。

### 7.6 设置页

- 服务器管理：列表、扫码添加、编辑、切换激活、删除。
- 缓存管理：缩略图/预览两档缓存占用展示与分别清理、上限调整。
- 关于：版本、开源协议。

## 8. 错误处理与边界

- **离线/断连**：顶部细横幅「未连接到 <服务器名>」；已缓存内容可浏览，未缓存图显示占位 + 点按重试；恢复后自动增量同步。
- **鉴权失败（401）**：提示密钥失效，引导重扫二维码。
- **IP 变化**：连接超时引导编辑地址/重扫。
- **dataVersion 变化**（桌面恢复备份/迁移根目录）：提示后全量重建镜像。
- **大库**：首次同步分页拉取 + 进度展示；10 万张级别元数据（约 20-50MB gzip 前）在局域网内可接受。
- **系统相册写入失败**（存储权限/空间）：明确报错，不静默。
- **写操作冲突**：删除时目标已在桌面端被删（404）→ 视为成功并触发一次 image-ids 对账；其余写操作失败给出明确错误并回滚本地镜像的乐观变更。
- **离线时写操作**：相关按钮置灰（删除/图集操作/标签编辑），不排队。
- **MediaStore 副本级联删除的所有权限制**：本 app 创建的条目可直接删除；app 重装后失去旧条目所有权，此时批量走 `MediaStore.createDeleteRequest` 系统确认弹窗，用户拒绝则仅清理 `downloads` 映射（系统相册中残留该文件，属用户自主选择）。

## 9. 性能目标

- 首次全量同步 1 万张 ≤ 10s（局域网）；例行增量同步 ≤ 1s。
- 时间轴滚动稳定 60fps；缓存命中的网格图即时显示。
- 大图页切换到相邻图（1600 档已预取）无感加载；未预取时 ≤ 500ms（局域网）。

## 10. 测试策略

- **桌面端**（vitest，现有测试体系）：Range/206/416、ETag/304、Content-Type 映射；sync 游标分页正确性（边界：同 updatedAt 多行、空库）；image-ids 与 dataVersion 行为；preview 档生成与缓存复用；写接口全套（删除含 404 幂等与磁盘清理、图集增删改与成员变更、标签增删、`updatedAt` 触碰、领域事件发布、权限键校验）。
- **安卓端**：同步引擎纯 JVM 单测（全量重建、增量 upsert、ids 删除对账、dataVersion 触发重建）；Room DAO 查询测试（时间轴分组、搜索交集）；少量 Compose UI 冒烟（时间轴渲染、大图操作栏状态）。

## 11. 里程碑建议

1. **M1 桌面端**：preview 档、二进制补强、sync 五接口、写操作接口（含新权限键）、updatedAt 触碰审计、二维码弹窗。
2. **M2 安卓骨架**：工程搭建、配对流程、同步引擎、照片时间轴 + 相册 tab（可浏览缩略图）。
3. **M3 核心体验**：大图页（手势/转场/三档加载）、原图下载（MediaStore + WorkManager）、搜索、多选、写操作 UI（删除/图集管理/标签编辑）。
4. **M4 打磨**：捏合切档动画、快速滚动滑块、离线态、缓存管理、性能调优。

每个里程碑单独出实现计划（writing-plans），M1 与 M2 可并行开工（接口契约以本文为准）。
