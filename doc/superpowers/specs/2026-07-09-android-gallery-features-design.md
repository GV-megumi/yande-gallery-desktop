# 安卓通用图库功能补全设计（v0.6.0）

> 状态：✅ 已实施（安卓 v0.6.0 / versionCode 7，桌面 0.4.0，2026-07-10）。承接 v0.5.0 仿 MIUI UI 重塑（`2026-07-08-android-miui-ui-redesign-design.md`）。
> 实施偏离记录：菜单 testTag 带 `_${id}` 后缀（沿用仓内惯例）；ModalBottomSheet 补 skipPartiallyExpanded+可滚动列（矮屏面板尾行可达）；clearMirror 全清 album_prefs（换服撞号防附身，评审加固）；createGallery 乐观行带本机 createdAt（CREATED 排序不垫底）。其余按 spec 落地，排除项未越界。
> 终审补记（2026-07-10）：文件名排序加 `COLLATE NOCASE`（BINARY 会把 Z 排 a 前，违背一般图库直觉）；详情页切排序补回顶（照片页同款）；已知边界——搜索结果进大图沿用时间轴上下文，用户改排序后搜索网格（固定时间序）与大图滑动序会分叉（§1.2 排除项的后果，接受）；PATCH name+coverImageId 同传非原子（自家客户端恒单字段提交，已注释）。
> 面板改版（2026-07-11）：「⋯」交互从底部 ModalBottomSheet（MiuiOptionsSheet，已删）改为**右上角锚定的多级下拉菜单**（`ui/common/MiuiMoreMenu.kt`）——一级放分类行（排序方式/网格密度/列数，右侧带当前值预览）与直达行（设置/拖拽排序），点分类滑入二级明细页（带「‹ 返回」头行）。行部件 MiuiSortRow/MiuiChoiceRow 及全部行级 testTag 原样迁移；§3.1/§4.4/§5.1 中的「面板/sheet」按此口径理解。

## 0. 背景与决策快照

v0.5.0 完成 MIUI 风格换皮后，功能面仍然很薄：照片/相册无排序、无置顶、无分组、网格密度只剩捏合手势（无可见入口）、相册页写死 2 列、详情页写死 4 列。本轮对标一般手机图库软件（以 MIUI 相册为参照）补全通用功能。

**用户已定决策**：

1. 组织状态（置顶/其他相册/手动序）**只存安卓本机**，不同步桌面（照片排序、密度档本来就是本机偏好）。
2. 「把相册移到其他相册」= **MIUI 式「其他相册」收纳**（单层折叠区，非嵌套、非多分组）。
3. 相册页**整页自适应网格**（置顶区与普通区同列数，按屏宽自适应）。
4. 附加项全要：**封面能力包**（唯一桌面改动）、**相册详情页补齐**（排序+密度）、**相册手动拖拽排序**。

**现状锚点**（两端盘点结论，实施前以代码为准）：

- 照片排序写死在 3 处 DAO SQL（`ImageDao.timelinePagingSource`、`buildSearchQuery` 两分支、`GalleryDao` 图集成员分页），全部 `ORDER BY createdAt DESC, id DESC`；API 无排序参数（排序发生在本地 Room 镜像上）。
- 密度四档（`DensityTier`：MONTH 6 列/DAY_5/DAY_4/DAY_3）+ 捏合手势（`PinchDensityState`）+ DataStore 记忆（`timeline_density`）机制完整，仅缺可见入口；只作用照片页。
- `GalleryEntity` 只有 id/name/coverImageId/imageCount；`SyncGalleryDto` 同四字段；两端都无置顶/排序/分组字段。
- 图集元数据变更**不在 changeSeq 增量协议内**（协议只覆盖 images，经 image_tags/gallery_images 触发器 bump）；`/sync/galleries` 是无游标全量快照。
- 桌面从不自动写图集封面（仅桌面 UI 打开图集时机会性补写），安卓端「取第一张」兜底造成 N+1 查询（M2 审查 Issue 5）。
- `PATCH /api/v1/galleries/:id` 已存在（仅接受 name），权限已在 `galleryWrite` 域；`setGalleryCover` 服务函数已存在但无 HTTP 入口。

## 1. 范围

### 1.1 本轮做

| # | 功能 | 端 |
|---|---|---|
| F1 | 照片页排序（时间/大小/文件名 + 方向），非时间排序进平铺模式 | 安卓 |
| F2 | 照片页「⋯」菜单：排序 + 密度四档可见入口 + 设置入口迁移 | 安卓 |
| F3 | 相册页自适应网格（置顶区/全部相册/其他相册折叠行） | 安卓 |
| F4 | 置顶相册（长按菜单，置顶区展示） | 安卓 |
| F5 | 「其他相册」收纳（长按移入/移出，二级页查看） | 安卓 |
| F6 | 相册排序（手动/名称/张数/创建时间 + 方向） | 安卓（创建时间字段靠 F9） |
| F7 | 相册拖拽重排模式（区内拖动，落盘手动序） | 安卓 |
| F8 | 相册详情页排序 + 列数档（3/4/5，捏合+菜单）+ 设为封面 | 安卓（设封面靠 F9） |
| F9 | 封面能力包：PATCH 接受 coverImageId、有效封面兜底、sync 载荷补 createdAt | 桌面 + 安卓 |

### 1.2 本轮不做（排除项）

- 多自定义分组、相册真嵌套（桌面库无层级概念）。
- 组织状态跨设备同步（本机偏好定位，MIUI 同款取舍）。
- 搜索结果页排序（维持固定时间新→旧）。
- 按「加入图集时间」排序（`gallery_images.addedAt` 未镜像到安卓，不为此动同步协议）。
- 回收站、收藏、幻灯片、照片编辑。
- 其他相册二级页内拖拽重排（v1 只在主页两区）。
- 「其他相册」内相册的置顶入口（置顶与收纳互斥，先移出再置顶）。

## 2. 本机数据与状态

### 2.1 Room 新表 `album_prefs`（组织状态）

```
album_prefs(
  galleryId   INTEGER PRIMARY KEY,   -- 对应 galleries.id
  pinned      INTEGER NOT NULL DEFAULT 0,
  pinnedAt    INTEGER,               -- epoch ms，置顶区默认序（新置顶在前）
  inOther     INTEGER NOT NULL DEFAULT 0,
  manualOrder INTEGER                -- 区内手动序，NULL=未定序
)
```

- **独立表、不建外键**：图集同步是全量对账（可能整表重写），外键 CASCADE 会误清偏好。孤儿行在每轮图集同步对账完成后清理：`DELETE FROM album_prefs WHERE galleryId NOT IN (SELECT id FROM galleries)`。
- **置顶与收纳互斥**：`setPinned(true)` 同时置 `inOther=0`；`moveToOther(true)` 同时置 `pinned=0, pinnedAt=NULL`。
- 无记录 = 默认值（未置顶、不在其他相册、无手动序）。
- `manualOrder` 只在所属分区内比较；拖拽落点后对该分区重编号（0..n 连续整数）。新相册无手动序，手动模式下排区尾、按名称升序兜底。
- **跨区迁移清手动序**：置顶/取消置顶/移入/移出其他相册时同时置 `manualOrder=NULL`（旧区序号带进新区无意义，进新区默认排尾）。

### 2.2 `GalleryEntity` 补列 `createdAt`

- 与 `SyncGalleryDto` 同步新增可空 `createdAt`（类型对齐 `ImageEntity.createdAt` 现状，实施时核实），Room schema 版本 +1 并写迁移（新列可空，旧数据 NULL）。
- 旧桌面（不带 F9）载荷缺字段时反序列化为 NULL，「创建时间」排序把 NULL 排尾按名称兜底——不做能力探测（两端同仓同发）。

### 2.3 DataStore 新键（沿用 `PrefsStore` 单例，enum name 字符串存法，非法值收敛默认）

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `photos_sort` | String | `TIME_DESC` | 照片页排序（PhotoSort 枚举名） |
| `albums_sort` | String | `NAME_ASC` | 相册页排序（AlbumSort 枚举名，对齐现状按名） |
| `album_detail_sort` | String | `TIME_DESC` | 相册详情排序（PhotoSort 枚举名，全部图集共用） |
| `album_detail_columns` | Int | `4` | 相册详情列数档（3/4/5，对齐现状 4 列） |

现有 `timeline_density` 不动。写入照 density 模式：内存态即时生效、异步落盘、冷启动回填一次。

### 2.4 排序枚举

```kotlin
enum class PhotoSort { TIME_DESC, TIME_ASC, SIZE_DESC, SIZE_ASC, NAME_ASC, NAME_DESC }
enum class AlbumSort { MANUAL, NAME_ASC, NAME_DESC, COUNT_DESC, COUNT_ASC, CREATED_DESC, CREATED_ASC }
```

- PhotoSort 映射 SQL：TIME→`createdAt`、SIZE→`fileSize`、NAME→`filename`；二级键恒为 `id`，方向跟随主键方向（保证分页稳定序）。
- 字段默认方向（菜单点未选字段时采用）：时间↓新→旧、大小↓大→小、文件名↑A→Z；张数↓多→少、创建时间↓新→旧、名称↑。
- MANUAL 无方向概念。

## 3. 照片页（F1/F2）

### 3.1 顶栏与「⋯」选项面板

- 常驻顶栏动作改为 **[搜索] [⋯]**，原「设置」图标移除，设置入口挪进「⋯」面板（MIUI 同款层级）。plan 阶段核实：现有设置图标**无 testTag**，sheet 内设置行用新 tag `sheet_settings_row`（§8.2）；覆盖设置跳转的既有测试（AppNavTest/PhotosScreenTest）随顶栏签名变化同步迁移。
- 「⋯」打开 **MiuiOptionsSheet**（新公共组件，见 §7）：MIUI 皮 ModalBottomSheet，内容为卡片组：
  1. **排序方式**卡片：时间 / 文件大小 / 文件名 三行，选中行行尾显示方向箭头（↓/↑）；
  2. **网格密度**卡片：四档单选行——「月视图(6列)」「大图(3列)」「标准(4列)」「紧凑(5列)」，联动现有 `setDensityTier`，与捏合手势共用同一状态；
  3. **设置**导航行（chevron，跳设置页）。
- 排序行交互（照片页/详情页同规则）：点**未选**字段行 → 切到该字段+其默认方向；点**已选**行 → 翻转方向。选择即生效即收面板不留确认键。
- 捏合手势保留，行为不变。

### 3.2 平铺模式（非时间排序）

`photos_sort` 为 SIZE_*/NAME_* 时：

- 不渲染日期分组头（月/日粒度语义整体失效）；MONTH 档退化为纯 6 列（无月分组）。
- 滚动中的 sticky 日期胶囊不显示；快滚滑块保留、**日期气泡整体隐藏**。
- 多选、打开大图、下载等行为不变。
- 恢复 TIME_* 后分组头/胶囊/气泡全部恢复。

### 3.3 DAO 与分页

- `ImageDao.timelinePagingSource` 改为 `@RawQuery(observedEntities=[ImageEntity::class])` 变体，SQL 由 PhotoSort 白名单枚举拼接（字段名/方向均出自枚举映射，无用户输入，不存在注入面）。
- 现有固定序查询保留给搜索页（搜索排序不动）。
- `GalleryDao` 图集成员分页同样加 RawQuery 变体（供 §5 详情页排序）。
- 排序切换 = Pager 依赖 key 变化重建 paging flow（照现有密度档切换的重建模式），列表回顶。

### 3.4 大图页顺序一致性

Viewer 与照片页/详情页共用同一查询与同一排序参数：排序切换后打开大图，左右滑动顺序必须与网格一致（索引对位不错乱）。实施时核实 Viewer 数据源接线并带上排序参数。

## 4. 相册页（F3-F7）

### 4.1 自适应网格

- `GridCells.Fixed(2)` → `GridCells.Adaptive(minSize = 104.dp)`（手机竖屏约 3 列、平板 4 列以上随宽度自适应），间距随卡片缩小相应收紧（8dp），卡片构成不变：1:1 圆角封面 + 名称单行省略 +「N 张」。
- 置顶区与普通区**同一列宽**（用户选定：整页自适应，无大小卡差异）。

### 4.2 分区结构（单一 LazyVerticalGrid，分区头 span 整行）

自上而下：

1. **「置顶」头 + 置顶区**：仅存在置顶相册时显示；默认按 `pinnedAt` 新→旧，手动模式（albums_sort=MANUAL）按 `manualOrder`。
2. **「全部相册」头 + 普通区**（未置顶且不在其他相册）：按 `albums_sort` 排序；MANUAL 时按 `manualOrder` 升序，无序值排尾按名称升序兜底。
3. **「▸ 其他相册 (N)」折叠行**（span 整行，仅 N>0 时显示）：点击进二级页。

- 排序组装在 ViewModel 内存中完成（图集数量级小，DAO 返回全量卡片 + album_prefs 全量后拼装），不追求 SQL 级 join 排序。
- 空态：无任何相册时维持现状空态；其他相册为空时折叠行隐藏。

### 4.3 长按菜单（DropdownMenu 扩展）

- 主页相册卡片：**置顶/取消置顶 → 移入其他相册 → 重命名 → 删除**（置顶态显示「取消置顶」，其余同理互斥显示）。
- 其他相册二级页卡片：**移出其他相册 → 重命名 → 删除**（无置顶项，先移出再置顶）。
- 置顶/移入移出为**纯本机操作，离线可用**；重命名/删除维持现状在线门控。

### 4.4 相册页「⋯」面板

顶栏动作 **[+] [⋯]**。面板卡片组：

1. **排序方式**：手动 / 名称 / 张数 / 创建时间 四行（交互同 §3.1；「手动」行无方向箭头）；
2. **拖拽排序**导航行：进入重排模式。

### 4.5 拖拽重排模式

- 入口：「⋯」→「拖拽排序」。进入后顶栏切换为「取消 / 拖动调整顺序 / 完成」（MiuiSubPageTopBar 形态），其他相册折叠行隐藏，分区头保留。
- 长按卡片抬起后跟手拖动，**仅限所在分区内**换位（置顶区⇄普通区不通过拖拽转换，走长按菜单）；拖动中目标位实时让位动画。
- 「完成」：两分区分别按当前视觉顺序重编号写 `manualOrder`（0..n），`albums_sort` 自动切 `MANUAL`，退出模式。
- 「取消」/系统返回：丢弃改动退出。
- 重排模式内长按不再弹菜单、点击不进详情。

### 4.6 其他相册二级页

- 新路由（AppNav 注册），MiuiSubPageTopBar（标题「其他相册」+ 返回），同款自适应网格。
- 排序沿用 `albums_sort`（MANUAL 时按 manualOrder，无序值按名称兜底）；无「⋯」面板、无拖拽。
- 长按菜单见 §4.3。移出后该相册回主页普通区，二级页列表即时刷新；清空后自动返回主页（或显示空态并保留返回，实施取其一并写测试锁定——**取自动返回**）。

## 5. 相册详情页（F8）

### 5.1 「⋯」面板

顶栏动作区加 [⋯]，面板卡片组：

1. **排序方式**：时间 / 文件大小 / 文件名（交互同 §3.1），存 `album_detail_sort`，全部图集共用；
2. **列数**：3 列 / 4 列 / 5 列 三档单选行，存 `album_detail_columns`。

详情页**无日期分组头**（现状如此），排序切换不涉及平铺模式概念，仅换 ORDER BY。

### 5.2 捏合切列数

- 复用 `PinchDensityState` 状态机模式（阈值同照片页），映射到 3/4/5 三档（放大→列数减、缩小→列数增），与面板选项共用同一状态、同一偏好键。

### 5.3 设为封面

- 多选底栏在 `inGallery == true` 且**恰好选中 1 张**时追加「设为封面」动作项（图标+小字，风格同现有项）；选中 ≠1 张时不显示（不占位）。
- 在线门控同删除等写动作（离线置灰）。
- 执行：`PATCH /api/v1/galleries/{id}` body `{"coverImageId": <选中图 id>}` → 成功后**立即更新本地 Room `galleries.coverImageId`**（相册卡片即时换封面，下轮同步回读同值幂等）、toast「已设为封面」、退出多选；失败 toast 报错、保持多选态。

## 6. 桌面端「封面能力包」（F9，唯一桌面改动）

### 6.1 `PATCH /api/v1/galleries/:galleryId` 扩展

- body 接受 `{ name?: string, coverImageId?: number | null }`，**至少一项**，否则 422（仓内 `validationError` 惯例，`VALIDATION_ERROR`；plan 阶段由 400 收敛）。
- `coverImageId` 为数字时校验：图片存在**且**是该图集成员（查 `gallery_images`），否则 422（不静默忽略）；为 `null` 时清除显式封面（回落 §6.2 兜底）。
- 实现复用/对齐既有 `setGalleryCover` 服务函数（实施时核实其校验行为，缺成员校验则补上）；`name` 分支行为不变。
- 权限：路径已在 `galleryWrite` 映射内，**不新增权限规则**；`permissions` 相关测试补 coverImageId 用例即可。

### 6.2 有效封面兜底（根治安卓 N+1）

- `/api/v1/sync/galleries` 与 `/api/v1/galleries`（列表及按 id 查询）返回的 `coverImageId` 统一为**有效封面**：`COALESCE(显式 coverImageId, 该图集最近加入的一张)`，「最近加入」按 `gallery_images.addedAt DESC, imageId DESC`；空图集为 `null`。
- 两处共用同一 SQL 片段/查询函数，避免口径漂移；`/galleries` 的 `coverImage{...}` 联查对象随之对齐。
- 显式 `coverImageId` 字段本身**不回写数据库**（兜底只发生在读侧），桌面 UI 既有「打开图集补写第一张」逻辑不动（继续无害）。
- 安卓端现状修正（plan 阶段核实）：N+1 已在早前修复——`GalleryDao.observeAlbumCards` 用相关子查询一次性算出兜底封面。**保留该 SQL 兜底作双保险**（兼容旧桌面载荷），卡片语义不变；桌面兜底使同步下发值直接有效，仅空图集为 null（占位图标）。

### 6.3 `/sync/galleries` 载荷补 `createdAt`

- `SyncGalleryDto` 增加 `createdAt`（ISO 字符串，取 `galleries.createdAt`），供相册「创建时间」排序；安卓 DTO/实体/同步落库链路同步加列（§2.2）。

### 6.4 变更可见性口径

- 图集元数据（名称/封面/createdAt）**不进 changeSeq 协议、不加触发器、不加 SSE**。
- 依赖安卓**每轮前台同步无条件全量拉 `/sync/galleries`**（列表小、成本可忽略）。实施时核实安卓 SyncEngine 现状：若存在「latestCursor 未变则跳过 galleries 拉取」的短路，改为必拉；若本就每轮必拉，写测试锁定该行为。
- 桌面侧改封面/改名对安卓的可见延迟 = 下一轮同步，接受。

### 6.5 兼容性

- 新安卓 + 旧桌面：`createdAt` 反序列化 NULL（§2.2 兜底）、PATCH coverImageId 旧桌面会忽略未知字段或改名接口报错——两端同仓同发，不做能力探测，不为旧组合专门兜底。
- 旧安卓 + 新桌面：多下发的 `createdAt` 被旧 DTO 忽略；有效封面兜底让旧安卓的 N+1 兜底自然少触发，无害。

## 7. 新增/改动组件与文件清单

**安卓新增**：

| 文件 | 职责 |
|---|---|
| `ui/common/MiuiOptionsSheet.kt` | MIUI 皮 ModalBottomSheet 容器 + 排序单选行/档位单选行部件（照片页/相册页/详情页共用） |
| `ui/albums/AlbumReorderState.kt`（或就近于 AlbumsScreen） | 拖拽重排模式状态机（纯逻辑可单测：抬起/换位/落点重编号/取消） |
| `data/db/AlbumPrefsEntity` + `AlbumPrefsDao`（并入现有 Entities.kt/新 Dao 文件） | §2.1 表与读写 |
| `ui/photos/PhotoSort.kt`（或并入 TimelineModels.kt） | PhotoSort/AlbumSort 枚举与 SQL 映射 |

**安卓改动**：`ImageDao`/`GalleryDao`（RawQuery 排序变体）、`PrefsStore`（4 新键）、`PhotosViewModel`/`PhotosScreen`（排序状态+平铺模式+「⋯」面板+设置入口迁移）、`AlbumsViewModel`/`AlbumsScreen`（分区组装+自适应网格+菜单扩展+重排模式）、`AlbumDetailViewModel`/`AlbumDetailScreen`（排序+列数+设封面）、`AppNav`（其他相册路由）、`Entities`/`ApiModels`/`DesktopApi`（createdAt、PATCH body）、数据库 Migration、SyncEngine（对账清孤儿 + galleries 必拉核实）、Viewer 数据源接线（排序参数）。

**桌面改动**：`src/main/api/routes/galleryWriteRoutes.ts`（PATCH body 扩展）、`src/main/api/`/`src/main/services/` 中 gallery/sync 服务（有效封面 SQL、createdAt 载荷）、对应 `tests/main/` 用例。

## 8. 测试与验证口径

### 8.1 安卓自动化（Robolectric/单测，全量套件保持绿）

- **DAO**：PhotoSort 六变体 SQL 生成与排序正确性（含 id 二级键方向）；album_prefs 读写、互斥规则（置顶⇄收纳）、孤儿清理。
- **PhotosViewModel**：排序偏好读写回环（照 M4DensityPrefsE2ETest 模式）；平铺模式开关（非时间排序 → 无分组头/胶囊隐藏标志位）。
- **AlbumsViewModel**：分区组装（置顶/普通/其他三集合的归属、各排序模式下顺序、手动序缺值兜底、createdAt NULL 兜底）。
- **AlbumReorderState**：换位/落点重编号/取消丢弃/完成落盘切 MANUAL。
- **AlbumDetailViewModel**：排序+列数偏好回环；设为封面成功路径（PATCH 调用 + 本地 coverImageId 更新）与失败路径。
- **SyncEngine**：galleries 对账后孤儿清理触发；每轮必拉 galleries 行为锁定。
- **UI 契约**（compose 测试）：「⋯」面板各行可点且状态正确、选择栏「设为封面」仅 count==1 时出现、长按菜单条目随 pinned/inOther 互斥切换、其他相册折叠行 N>0 才显示。

### 8.2 新增 testTag（既有 testTag 一律不改名）

| 页面 | testTag |
|---|---|
| 照片页 | `photos_more`、`options_sheet`、`sort_option_time` / `sort_option_size` / `sort_option_name`、`density_option_month` / `density_option_day3` / `density_option_day4` / `density_option_day5` |
| 相册页 | `albums_more`、`album_sort_option_manual` / `_name` / `_count` / `_created`、`albums_reorder_enter`、`reorder_done`、`reorder_cancel`、`albums_section_pinned`、`albums_section_all`、`other_albums_row`、`album_menu_pin` / `album_menu_unpin`、`album_menu_to_other` / `album_menu_from_other` |
| 详情页 | `detail_more`、`detail_sort_option_time` / `_size` / `_name`、`detail_columns_3` / `_4` / `_5`、`selection_action_set_cover` |

### 8.3 桌面自动化（`tests/main/` gate，vitest）

- PATCH：coverImageId 成员图 → 200 生效；非成员图 → 400；不存在图 → 400；null → 清除；与 name 同传 → 两者生效；body 空 → 400；权限映射仍在 galleryWrite。
- sync/galleries：无显式封面 → 返回最近加入一张；有显式 → 原样；空图集 → null；载荷含 createdAt。
- /galleries 列表与 sync 口径一致（同一兜底）。

### 8.4 实机验证（沿用安全纪律）

- 置顶/收纳/拖拽/排序/密度/列数全是**本机操作**，MuMu/真机自由验证。
- **写路径（设封面/重命名/删除）不在实机上对真实图库执行**——桌面 apiService 权限全开，实机写=改真库；写路径以自动化测试为准，实机只做界面只读观察（按钮出现与置灰态）。
- DataStore 全量套件偶发 60s 协程饥饿超时为既有基建债（README §8），口径照旧：重跑至真绿，以 test-results XML 数字为准。

## 9. 版本与文档

- 安卓 `versionName 0.6.0` / `versionCode 7`；桌面版本按 `doc/版本发布打包规范.md` minor 递进（API 加字段/参数）。
- 文档同步：`android/README.md` 新增 §9（v0.6.0 功能补全：功能清单/偏好键/验证口径）；桌面 `syncService.ts` 头注释（/sync 契约权威描述）补 createdAt 与有效封面口径；`galleryWriteRoutes` 相关注释补 PATCH body 形态；本 spec 实施后回填状态行。
- commit 规范照旧：英文类型前缀 + 中文描述，直接提交 master。

## 10. 验收清单

- [ ] 照片页「⋯」可切排序与密度，非时间排序无日期头、胶囊/气泡隐藏，重进 App 记忆生效
- [ ] 大图页左右滑动顺序与当前排序一致
- [ ] 相册页自适应列数（MuMu 竖屏 ≥3 列），置顶/全部/其他三区结构正确
- [ ] 长按可置顶/取消置顶、移入/移出其他相册，离线可用；重命名/删除在线门控不变
- [ ] 拖拽重排完成后顺序持久、排序自动切「手动」；取消不落盘
- [ ] 其他相册二级页可查看/移出，清空自动返回
- [ ] 详情页排序/列数（菜单+捏合）生效且记忆；恰选 1 张时出现「设为封面」
- [ ] 桌面 PATCH coverImageId 全用例过 `tests/main/`；sync 载荷含 createdAt 与有效封面
- [ ] 桌面有效封面兜底生效（sync 载荷仅空图集为 null）；安卓 SQL 兜底保留作双保险
- [ ] 安卓全量测试真绿；两端文档/版本号更新

## 11. 实施时核实项（plan 阶段落定，不留到编码中途）

1. `ImageEntity.createdAt` 实际类型（ISO 字符串或 epoch），`GalleryEntity.createdAt` 与之对齐。
2. Viewer 数据源接线方式（与网格共用 paging 还是独立查询），确保排序参数贯通。
3. 安卓 SyncEngine 是否已每轮必拉 `/sync/galleries`（有短路则去掉）。
4. `setGalleryCover` 现有校验（是否已含成员校验）。
5. PhotosScreen 现有设置入口 testTag 名（迁移沿用）。
6. Room 当前 schema 版本号与迁移注册位置。

