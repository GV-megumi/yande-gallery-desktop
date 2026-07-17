# Yande Gallery 安卓端（局域网相册）

安卓端是桌面端 Yande Gallery 的局域网只读伴侣：通过扫码与桌面端「API 服务」配对后，
把桌面图库的元数据镜像到本机 Room 库，按时间轴/相册浏览缩略图，全程在同一局域网内直连桌面端，
不经公网。本目录（`android/`）是独立的 Gradle 工程，与桌面端（Electron/TS）源码同仓但互不依赖。

设计与契约以 `docs/superpowers/specs/2026-07-03-安卓局域网相册App-design.md` 为准（下文引用的
§6.3 等章节均指该 spec）。

---

## 1. 工具链要求

- **JDK 17+**（工程 `sourceCompatibility`/`targetCompatibility` = 17，Kotlin `jvmTarget` = 17）。
- **Android SDK**：`compileSdk 36`（需要对应的 platforms 与 build-tools）、`minSdk 26`、`targetSdk 35`。

本仓库自带一套**仓库本地工具链**，安装在 `.toolchain/` 下，不污染全局环境。任何 Gradle 调用之前，
先在**当前 shell** 里 source 它：

```bash
source /usr/local/yande-gallery-desktop/.toolchain/env.sh
```

`.toolchain/env.sh` 会设置：

| 变量 | 指向 | 用途 |
|------|------|------|
| `JAVA_HOME` | `.toolchain/jdk` | 本地 JDK 17 |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | `.toolchain/android-sdk` | 本地 Android SDK（cmdline-tools / platform-tools / platforms） |
| `GRADLE_USER_HOME` | `.toolchain/gradle-home` | Gradle 缓存与 wrapper 发行版也落在仓库内 |
| `PATH` | 追加 `jdk/bin`、`gradle/bin`、`cmdline-tools/latest/bin`、`platform-tools` | 直接调用 gradle / adb / sdkmanager |
| `LANG` / `LC_ALL` | `C.UTF-8` | **必须**：中文测试方法名会生成中文 `.class` 文件，POSIX locale 下写盘失败 |

> 每开一个新 shell 都要重新 source（shell 环境变量不跨进程持久）。

---

## 2. 构建与测试命令

先 `source` 工具链，再进入 `android/` 目录：

```bash
source /usr/local/yande-gallery-desktop/.toolchain/env.sh
cd /usr/local/yande-gallery-desktop/android

# JVM 单元测试（引擎/DAO/Compose 冒烟 + 端到端冒烟 EndToEndSyncTest）
./gradlew :app:testDebugUnitTest

# 打 debug APK → app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleDebug

# 一次跑全量测试并出包
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

工程坐标：`applicationId = com.bluskysoftware.yandegallery`；技术栈 Kotlin / Jetpack Compose /
Room / Retrofit + OkHttp / Coil。测试为纯 JVM（Robolectric + MockWebServer），无需连真机/模拟器即可全绿。

`EndToEndSyncTest` 用 MockWebServer 脚本化桌面端六个同步响应（`meta` → `images` 两页 →
`image-ids` → `galleries` → `tags`，真实 envelope JSON），经 `AppGraph`（in-memory Room 注入缝）
跑完整 `SyncEngine.sync()`，断言落库总数、时间轴倒序、相册卡片与标签关联——是 T3–T7 装配正确性的最终闸门。

M3 追加两个端到端测试：`WriteReconcileE2ETest`（AppGraph + MockWebServer 走 `WriteRepository`
完整写链路——请求形状/镜像行删除与建链/404 当成功不回滚/写成功后对账 `sync/meta` 请求真实发出）与
`DownloadE2ETest`（`TestListenableWorkerBuilder` 全链路——激活服务器行动态 Bearer → 流式
`/images/:id/file` → 网关写入完整字节 → `downloads` 表记录 uri 与时间）。

M4 追加 `M4DensityPrefsE2ETest`（真 DataStore 临时文件 + AppGraph 装配链——密度档位记忆跨
VM 实例回读持久档；切档驱动分页流月/日分组粒度端到端翻转）。

---

## 3. 与桌面端联调步骤（按顺序）

> 无真机时，以第 2 节 MockWebServer 端到端测试为准；本节为实机联调的操作手册。
> （M3、M4 收尾时本环境均无真机、无法启动桌面端 GUI，实机联调未执行——以 e2e 测试为准；
> M2/M3 待验证项见第 7 节「待实机验证清单」，M4 新增项统一登记在联调计划 §J。）

> **配套升级**：API 权限拆分后手机接口已整体迁至 `/api/app/v1` 独立命名空间，App 与桌面端需同时
> 升级——旧 APK 连新桌面时，同步等接口在新桌面上全部 404（旧路径未挂载）；新 APK 连旧桌面时，
> 新路径在旧桌面同样未挂载，连接测试会直接失败。

1. **桌面端开启「设置 → API 服务 → 手机端连接 → 允许手机端连接」**
   这是安卓端全部接口——服务信息/健康检查、同步 5 路由、相册与图片写 9 路由、缩略图/高质量/原图
   3 档二进制（安卓端 v0.7.0 起改用高质量档 `hq` 替代预览档，桌面端 `/preview` 端点本身保留供兼容，
   见 §10）、SSE 事件——共同挂载的手机面 `/api/app/v1/*` 唯一的门：开启即自动运行服务器并强制
   绑定局域网地址 `0.0.0.0`（应用层仍有局域网来源 IP 白名单兜底）。这个开关与「Agent API」分组下的
   `enabled` / 监听模式相互独立、互不影响——那两项只管面向 CLI/智能体的 `/api/v1` Agent 面，跟手机
   连接无关，联调安卓端无需碰它们。记下端口（默认 `38947`）与 Bearer Key，手机与桌面须在同一局域网。

2. **⚠️ 该开关默认关闭；不开，手机端一切请求一律 403**

   > **「允许手机端连接」默认是 OFF。不开启，安卓端仍可完成扫码配对（配对弹窗会提示未开启），
   > 但配对后的时间轴/相册元数据同步、缩略图与原图加载、删图/标签编辑/建改删相册等写操作、SSE
   > 事件订阅——全部请求都会返回 `403`。**
   >
   > 这是「配对成功但界面空白、缩略图全 403、写操作全失败」最常见的原因。手机面**没有**细分到
   > 每个功能的独立权限开关（细分权限只对 Agent 面的 11 个键生效，与手机端无关），联调前只需确认
   > 这一个开关已打开即可，不存在「这个功能对应那个权限」的对照关系。安卓端的写按钮只在离线时
   > 置灰，开关未开不会隐藏按钮——表现为操作后弹「失败」提示。

3. **SSE 实时刷新随手机端连接开关一并启用，无需单独配置**
   开关打开后，安卓端即可订阅 `/api/app/v1/events/system`（system 频道、无心跳，客户端用专用
   `readTimeout=0` 的 OkHttp，见 T12），桌面端有 gallery 事件时自动触发一次对账同步；开关关闭时
   该订阅请求同样返回 `403`，退化为进前台/下拉刷新触发对账。

4. **安卓端扫码配对**
   桌面端设置页弹出配对二维码 → 安卓端「添加服务器」扫码（或手动输入 baseUrl + Key 作为回退）。
   配对即激活（多服务器、同时只激活一个）；随后自动首次全量同步。

---

## 4. M2 完成范围

对齐 spec §11-2「M2 安卓骨架 = 工程搭建、配对流程、同步引擎、照片时间轴 + 相册 tab」：

- **工程搭建**（§6.1 / T1）：Kotlin + Compose + Room + Retrofit/OkHttp + Coil 单模块工程；
  `applicationId = com.bluskysoftware.yandegallery`，`minSdk 26 / targetSdk 35 / compileSdk 36`。
- **配对流程**（§4.1 / T5·T8）：扫码 + 手输回退；多服务器（Room `servers` 表），同时只激活一个。
- **同步引擎**（§6.3 四条语义 / T3·T6·T7·T12）：
  1. 首次连接：`meta` → 空游标分页拉 `sync/images` → `galleries` + `tags` 全量 → 记录 cursor 与 dataVersion；
  2. 例行同步：`meta` 校验 dataVersion（变化触发全量重建）→ `sync/images?cursor` 增量 upsert →
     `image-ids` diff 删除本地多余行 → `galleries`/`tags` 全量覆盖；
  3. 全程后台静默，UI 永远先渲染本地 Room 数据，失败仅在下拉刷新时提示；
  4. 二进制请求遇 404 时触发一次 `image-ids` 对账（桌面端删文件的兜底，T3 拦截器钩子 + T12 接线）。
- **缩略图管线**（§6.4 缩略图档 / T9）：`/images/:id/thumbnail`，Coil 独立持久磁盘缓存（默认 2GB），
  复用带 `Authorization: Bearer` 的同一 OkHttp。
- **照片时间轴**（§7.1 基础形态 / T10）：全部图片按 `createdAt` 倒序的网格。
- **相册只读浏览**（§7.2 只读部分 / T11）：相册网格卡片（封面 coverImageId，缺省取相册内最新图 + 名称 + 张数），
  点入为该相册网格页。

### 明确后置到后续里程碑的部分（如实记录，非本 M2 范围）

- **同步第 2 条语义里「对账删除行的级联清理」**（§5.4：清缓存 + 删系统相册副本）在 M2 **暂缺**，
  后置 M3（T6 已注明取舍：M2 仅删 Room 行，不做缓存/相册副本的级联清理）。
- **相册写操作 UI**（新建 / 重命名 / 删除，§7.2 后半）属 **M3**，M2 只读。
- **预览档（1600px）与原图档**（§6.4 preview / `/file`）属 **M3**，M2 只做缩略图档。
- **时间轴 sticky 分组头**（§7.1）在 M2 主动后置——spec 未把它分配进 M2；
  **双指捏合切换密度（3/4/5 列）与右侧快速滚动滑块**属 §11-M4。

---

## 5. M3 完成范围

对齐 spec §11-3「M3 核心体验 = 大图页（手势/三档加载）、原图下载、搜索、多选、写操作」：

- **大图三档加载**（§6.4 / T2·T9·T10）：缩略图 → 预览 1600px（`/images/:id/preview`，Coil 独立
  1GB 持久盘缓存，复用带 Bearer 的 OkHttp）→ 原图；已下载的图直接跳原图档（MediaStore uri，
  副本被用户在系统相册手动删除时自动回退预览档）；相邻页预取。
- **大图页**（§7.3 / T10·T11）：HorizontalPager 横滑、双击 1x/2x、双指捏合最高 5x、单击沉浸、
  下滑关闭；底部操作栏：分享（已下载项）/ 查看原图（=下载原图）/ 删除（本地有副本时经系统确认
  级联删相册副本）/ 详情；详情面板：元数据 + 可编辑标签（点标签跳搜索）+ 所属相册（点击跳转）。
- **原图下载进系统相册**（§6.4 / T7·T8）：WorkManager 后台流式下载 `/images/:id/file` → MediaStore
  `Pictures/YandeGallery/`（29+ 走 `IS_PENDING` 挂起写入，26–28 直写 + 媒体扫描），Content-Length
  完整性校验，`downloads` 表记录 imageId→uri 映射；原图 404 触发一次对账同步。
  **（v0.7.0 起该链路整体退役：MediaStore 写入、`downloads` 表、`WRITE_EXTERNAL_STORAGE` 权限均已
  删除，原图下载改写 app 私有镜像目录，见 §10——本条为 M3 历史记录，不代表当前行为）**
- **搜索**（§7.4 / T5·T12）：本地 Room 即时查询（标签名前缀 OR 文件名包含，多关键词 AND 交集），
  搜索历史（Room v1→2 迁移新增 `search_history` 表）。
- **多选**（§7.5 / T13）：长按进入、角标、全选；批量下载 / 批量分享（已下载项）/ 批量删除
  （走 batch-delete 端点，按逐条结果分条回滚）/ 加入相册 / 移出当前相册。
- **写操作**（§5.4 / T3·T4·T6·T14）：9 个写接口（删图、批量删图、标签增删、相册建/改名/删、
  成员增删）走「乐观改本地镜像 → 请求 → 失败回滚」；404 视为成功（目标已在桌面被删，不回滚）；
  写成功后触发一次冗余对账同步。相册 tab 支持新建 / 重命名 / 删除相册（二次确认，明示不删图片文件）。

> ⚠️ 写操作与原图下载对桌面端开关的要求见第 3 节第 1、2 步——单开关「允许手机端连接」一门制，
> 不区分二进制 / 写操作等细化权限。

### M3 已知后置项（M4 已全部落地，见第 6 节；保留原文存档决策脉络）

- **共享元素转场**（网格 ↔ 大图，§7.3）→ M4 已做：方案 B fade+scale 转场（方案 A hero 层留联调后可选）。
- **下载前台进度通知** → M4 已做（确定进度通知 + 33+ 运行时权限）。
- **双指捏合切换网格密度**（3/4/5 列）→ M4 已做（月/日四档，连同 sticky 分组头、快速滚动滑块）。
- **下载后自动分享完整版** → M4 已做（单张与批量：未下载项自动下载后拉起分享）。
- **对账删除的级联清理**（§5.4 后半）→ M4 已做：对账删行级联清系统相册副本 + 两级缓存键 +
  `downloads` 映射行（唯「所有权丢失的副本」仅清行保留文件——定界见第 6 节 M4 已知后置项）。

---

## 6. M4 完成范围

对齐 spec §11-4「M4 打磨 = 捏合切档动画、快速滚动滑块、离线态、缓存管理、性能调优」与上节
「M3 已知后置项」：

- **时间轴密度四档 + 捏合切档**（§7.1 / T1-T3）：月视图 6 列 ↔ 日视图 3/4/5 列，双指捏合离散
  切档（格子 `animateItem` 过渡）；**档位记忆**持久化（全仓首个 DataStore Preferences）；
  月↔日切换按原顶部日期锚定回位，纯列数变化不重建分页流、滚动位置天然保留。
- **时间轴导航**（§7.1 / T4）：sticky 顶部日期条（overlay 实现，月/日档随分组粒度切换文案）+
  右侧快速滚动滑块（拖动浮出日期气泡、松手落位；与 sticky 条共用同一日期查找）。
- **离线态完善**（§8 / T5·T6）：未缓存图离线占位 + 点按重试（`ACCESS_NETWORK_STATE` 预判快速
  失败）；系统网络回调直驱连接横幅（断网即时显示，不等下次同步失败推断）；网络恢复自动收横幅 +
  增量同步 + SSE 重连。
- **设置页三区**（§7.6 / T7·T8）：服务器管理（含编辑）/ 缓存管理 / 关于。缓存管理页显示缩略图、
  预览两档磁盘占用、一键清理、上限可调（§6.4）——**缓存上限调整重启后生效**（Coil DiskCache
  maxSize 构建期定死，页内有文案注明）。
  **（两档上限选择器已随 Task 9 存储页改版下线，「缓存管理」亦改名「存储管理」，见 §10；
  本条为 M4 历史记录，不代表当前行为）**
- **下载域修复包**（§6.2/§6.3/§5.4/§8 / T9）：`downloads` 表 serverId 化（切服不串本地副本、
  根治飞行中下载跨切服竞态）；对账删除级联清理全量（系统相册副本 + 两级盘缓存键 + 映射行）；
  批量删除副本级联（30+ 单弹窗批量确认）；API 29 `RecoverableSecurityException` 转
  NeedsConsent 走系统确认弹窗（修 F.12 预判缺陷，30+/29 语义对齐）。
  **（v0.7.0 起本条整体退役：`downloads` 表已 DROP、`RecoverableSecurityException`/系统确认弹窗
  链路随 MediaStore 一并删除，本条为 M4 历史记录，不代表当前行为，见 §10）**
- **下载前台进度通知**（§6.4 / T10）：确定进度前台通知，完成即消失；**33+ 首启请求
  `POST_NOTIFICATIONS` 运行时权限，拒绝仅无进度通知、下载本身照常完成**（静默降级，不弹阻断框）。
- **完整分享流**（§7.3/§7.5 / T11）：单图与批量分享中未下载项自动入队下载、终态后拉起分享；
  批量部分失败时成功项照常分享并提示失败数。
- **壳级收敛**（T12）：照片 tab 多选栏上提 AppScaffold 壳级 swap，消除多选态双顶栏/双底栏。
- **债务包 A/B + 性能收敛**（T13-T15）：M3 台账债清理——删除确认文案条件化、FAB 离线语义、
  搜索 LIKE `%`/`_` 转义、空查询不建 Pager、大图旋转不再回初始图、上滑死区、批删去重分块、
  SSE null url 短重试等；性能项——albums stateIn 三态、FullSync tick 重组隔离、冷启动引导
  闪帧门控、批量 exists 校验下移 IO。
- **大图转场方案 B**（§7.3 / T17）：Viewer 目的地 NavHost 四参数转场——进入 `fadeIn+scaleIn`
  （220ms，近似「从网格放大展开」）；**非返回退出仅 `fadeOut`**（前进离场如跳标签搜索，无 scaleOut）；
  返回进入 `fadeIn`（160ms）；**`scaleOut` 只在 popExit（返回退出，`fadeOut+scaleOut`，160ms）**——
  不动 Pager 定位与黑色占位层时序。
- **桌面端 changeSeq 同步协议**（M1 Issue 1 / T16）：单调 `changeSeq` 游标替换 `updatedAt`
  墙钟键集分页，根治同毫秒批量导入漏同步；迁移 bump `dataVersion`，安卓端零改动（桌面升级后
  手机端一次全量重建、之后增量正常）。

### M4 已知后置项（如实记录，联调后按需取舍）

- **共享元素转场方案 A**（SharedTransitionLayout + 缩略图 hero 层）：hero 与大图页按 id 定位的
  黑色占位层时序无法无头验证，留作实机联调后的可选增强（联调计划 J.6 有集成点清单）。
- **大图页上滑呼出详情面板**（spec §7.3 的『上滑或点详情』）——后置：详情按钮为唯一入口，
  上滑手势与下滑关闭/缩放协调器的冲突面留实机评估（联调计划 J.11）。
- **捏合连续缩放**：档位间为离散切换 + `animateItem` 过渡，非连续 scale 跟手；实机若掉帧按
  T3 注释退化「瞬时换列 + 100ms crossfade」（联调计划 J.2）。
- **Paging placeholders**：维持 `enablePlaceholders = false`（滑块按 index 比例落位已够用）。
- **相册详情页 / 搜索页的密度档与快速滚动滑块**：仅照片时间轴 tab 支持（范围定界）。
- **对账级联中所有权丢失的副本**：桌面端删图对账时，本机已失去所有权的系统相册副本仅清映射行、
  文件保留（对账是后台流程，无 UI 可挂系统确认弹窗——定界，T9）。
- **桌面端 `applyImagePage` 批量化**：changeSeq 同步页写入仍逐行走事务，未批量化（性能达标，后置）。

> 实机联调：本环境无真机、无法启动桌面端 GUI，M4 实机项**未执行**（同 M3 收尾惯例）——已全部
> 登记至 `docs/superpowers/plans/2026-07-05-M3实机联调计划.md` §J（M4 新增项）与 §K（验收口径），
> 联调时统一验证。

---

## 7. 待实机验证清单

以下项无法在无头 CI 上覆盖（无真机、无法在此启动桌面端 Electron GUI），需在真机 + 活桌面端实例上人工验证：

- [ ] **扫码配对**：真机相机扫桌面端设置页二维码，权限弹窗（相机）授权后成功配对；手输 baseUrl+Key 回退可用。
- [ ] **相机权限**：首次扫码相机权限的 on-device 授权流程。~~（M3 下载原图时）存储/相册写入权限~~——
      v0.7.0 起原图下载不再写系统相册，无需该运行时权限，此部分作废。
- [ ] **SSE 长连接行为**：开启「允许手机端连接」后，`/api/app/v1/events/system` 在真实局域网上的长连稳定性
      （无心跳、`readTimeout=0` 是否如期不被超时误杀；桌面端加图后安卓端是否自动刷新）。
- [ ] **缩略图跨局域网加载**：桌面端开启「允许手机端连接」后，时间轴/相册缩略图能真实加载（未开则应观察到全 403）。
- [ ] **下拉刷新**：对活桌面端实例下拉刷新，桌面端新增/删除图片后安卓端可见对应变化。

M3 新增（大图/下载/写操作的真机语义无法在 Robolectric 覆盖，e2e 用 fake 网关替身）：

- [ ] **大图页手势手感**：双指捏合（至 5x）、双击切档、单击沉浸、下滑关闭、缩放态下 Pager 不误滑。
- ~~**原图下载落盘（29+）**：下载原图后在系统相册应用可见于 `Pictures/YandeGallery/`，
  下载过程中（`IS_PENDING=1`）不出现半成品条目。~~
  **v0.7.0 起本项作废**——原图不再写 MediaStore/系统相册，改落 app 私有镜像目录，见 §10。
- ~~**API 26–28 下载可见性**：26–28 无 `IS_PENDING`，`finalize` 走 `MediaScannerConnection` 扫描——
  需确认下载完成后图片在系统相册应用真实可见；并验证 28- 的 `WRITE_EXTERNAL_STORAGE` 运行时授权
  流程。~~ **v0.7.0 起本项作废**——`WRITE_EXTERNAL_STORAGE` 权限、`MediaScannerConnection` 扫描
  链路与 `rememberLegacyStorageGate` 门卫均已随镜像层整体删除。
- ~~**删除级联的系统确认（30+）**：删除本地有下载副本的图片时，`createDeleteRequest` 系统弹窗出现；
  拒绝后仅清 `downloads` 映射、相册副本保留。~~
  **v0.7.0 起本项作废**——`downloads` 表与 `createDeleteRequest` 系统确认链路已删除；App 内删除
  现直接级联清理私有镜像文件（Task 8/10），无需系统确认弹窗，见 §10。
- [ ] **写操作端到端**：开启「允许手机端连接」后，删图 / 批量删 / 标签编辑 / 建改删相册 /
      成员增删在桌面端侧即时可见；未开开关时应观察到 403 失败提示（按钮不隐藏）。
- [ ] **分享**：已下载图片单张 `ACTION_SEND` 与多选 `ACTION_SEND_MULTIPLE`（v0.7.0 起经 FileProvider
      转发私有镜像文件的 `content://` URI，不再是 MediaStore URI，见 §10）在常见目标应用
      （微信/相册等）可正常接收。

M4 新增实机验证项（前台通知与 33+ 权限 / 捏合切档手感 / 滑块与 sticky 条 / 缓存管理页 /
转场观感 / 完整分享流 / API 29 删除语义 / 断网恢复横幅 / changeSeq 升级路径等）**不重复列于此**——
已展开为 `docs/superpowers/plans/2026-07-05-M3实机联调计划.md` §J 的 J.1-J.10 用例，
联调时照该计划执行（§K 已知限制的验收口径亦已按 M4 修复项更新）。

---

## 8. v0.5.0 UI 重塑（仿 MIUI 相册）

2026-07-09 完成组件级仿 MIUI 相册的整体换皮（规格 `doc/superpowers/specs/2026-07-08-android-miui-ui-redesign-design.md`、
实施计划 `doc/superpowers/plans/2026-07-08-android-miui-ui-redesign.md`）。行为契约、写路径与既有交互零改动，
testTag 仅一处改名（`albums_new_fab`→`albums_new`）。要点：

- **主题基座**：浅色纯白 / 深色 OLED 真黑 + `#1C1C1E` 卡片，MIUI 蓝主色保留；字号层级
  （大标题 30/W700、小标题 17/W600、中文零字距）；圆角体系 12/16/20dp 全局注册；
  `enableEdgeToEdge` + 系统栏图标深浅随主题（大图页强制白）。
- **壳重构**：顶栏从 AppScaffold 下放各 tab 页自持；大标题随内容滚走（nestedScroll
  exitUntilCollapsed + 松手 settle，折叠态 rememberSaveable 持久化），居中小标题+发丝线滚动后浮现；
  底部导航去胶囊指示器（选中实心主色/未选线框灰）；多选桥瘦身为底栏五字段。
- **照片页**：日期头 MIUI 文案（今天/昨天/M月d日 周X/跨年带年）；网格 3dp 等距缝 + 3dp 圆角
  （照片/相册详情/搜索三网格统一取 `MiuiTokens`）；sticky 日期胶囊改「仅滚动中浮现」（修与列表头重叠）；
  多选态空心圈/蓝底白勾/选中微缩；快滚把手细条化。
- **相册页**：FAB 移除、顶栏右上「+」；封面 12dp 圆角 + 名称/数量下置；相册详情居中双行顶栏（名称+张数）。
- **大图页**：上下渐变遮罩 chrome + 顶部居中「日期 / 时间」双行（located 门控同 BUG-06 口径）；
  chrome 隐显 150ms fade；详情面板换 20dp 圆角深色卡。
- **统一弹窗 `MiuiDialog`**：20dp 圆角、标题居中、等宽双胶囊按钮（灰取消/蓝确认/危险红），
  替换全部 9 处 AlertDialog；相册选择器同步换皮。
- **搜索页**：灰底胶囊搜索框（无下划线）+ 胶囊历史 chip + 垃圾桶清空。
- **设置族**：卡片分组（`MiuiCardGroup`/`MiuiListItem`）、二级页居中标题、表单灰底圆角输入框 +
  48dp 胶囊主按钮、服务器卡片蓝点+「当前」标记；连接横幅柔和化（琥珀/红 12-15% 底）。

验证：全量 Robolectric 61 类 / 332 例 / 0 失败；MuMu（API 32）深浅双主题逐页截图对照规格通过
（多选长按视觉 adb 无法驱动，由 SelectionActions/selection_ring 契约用例覆盖）；折叠头手感实机核验
（上滑收起/中途下滑不弹头/settle 无半截标题）。红魔与小米平板待用户上手抽验（安装包 versionCode 6 / 0.5.0）。

~~已知测试基建隐患：DataStore 类偶发 `UncompletedCoroutinesError` 60s 空转~~ **已于 2026-07-10 根治**
（spec：`doc/superpowers/specs/2026-07-10-android-test-flake-root-fix-design.md`），双层根因与修复：

1. **Robolectric 每测试方法实例化真实 YandeGalleryApp**→AppGraph→Room 库永不释放——
   `app/src/test/resources/robolectric.properties` 换裸 Application 替身；全量从 2m36s 降至 **~30s**。
2. **flake 真身：DataStore data flow 的 lost-wakeup 竞态**——runTest 内谓词 `first { 条件 }` 等
   「写后新值」，收集者初读旧值后若写完成通知发生在其注册前则永久挂起（实证：挂死用例内裸
   `first()` 能读到目标值）。修复为 `awaitValue({ flow.first() }) { 条件 }` 轮询等值
   （`TestAwait.kt`，每轮全新收集读现值 + Default 真实调度器）。
   **测试纪律：今后 runTest 内等真实回环（DataStore/Room）产生的值，一律 awaitValue，
   禁用谓词 first{} 与 turbine 等发射。**

验证：全量 **五连真跑全绿**（71 类/385 例/0 失败，每轮 ~30s），三惯犯类（CacheViewModelTest/
PhotosViewModelTest/M4DensityPrefsE2ETest）单跑复证绿。排查中证伪并撤销：forkEvery 分片、
java.io.tmpdir 迁移、双调度器分裂假说（详见 spec 排查记录）。

## 9. v0.6.0 通用图库功能补全

对标一般手机图库（MIUI 相册为参照）补功能面，spec 见 `doc/superpowers/specs/2026-07-09-android-gallery-features-design.md`：

- **照片页**：顶栏改 [搜索][⋯]，「⋯」面板收敛 排序（时间/大小/文件名+方向）、网格密度四档（原捏合仍可用）与设置入口；
  非时间排序进平铺模式（无日期分组头、sticky 胶囊与快滚气泡隐藏）；大图页与网格同源排序（ViewPrefs 共享态）。
- **相册页**：自适应网格（Adaptive 104dp，手机竖屏约 3 列）；三分区 置顶/全部相册/「其他相册」折叠行；
  长按菜单扩 置顶/取消置顶、移入/移出其他相册（纯本机、离线可用）；排序 手动/名称/张数/创建时间；
  「⋯」面板进拖拽重排模式（区内长按拖动，完成落盘手动序并自动切手动档）。
- **其他相册**：独立路由 `albums_other` 二级页，移出即回主列表，清空自动返回。
- **详情页**：「⋯」面板排序 + 列数 3/4/5（捏合同步生效，PinchStepState 泛型化共用）；多选恰 1 张出现「设为封面」。
- **桌面封面能力包**（唯一桌面改动，0.4.0）：`PATCH /galleries/:id` 接受 `coverImageId`（成员校验/null 清除）；
  `/sync/galleries` 与 `/galleries` 统一下发「有效封面」（显式 ?? 最近加入，读侧不回写）并新增 `createdAt`。
- **本机数据**：Room v5——新表 `album_prefs`（置顶/收纳/手动序，互斥与跨区清序在 DAO 事务收敛，
  换服 clearMirror 全清防撞号附身）+ `galleries.createdAt`；DataStore 新键 `photos_sort`/`albums_sort`/
  `album_detail_sort`/`album_detail_columns`。组织状态为设备级偏好，不跨设备同步（spec 定界）。

验证：全量 Robolectric 71 类 / 385 例（净增 53 例，含终审补落的平铺模式断言）——收官日 DataStore flake
达阻塞级（见 §8 升级记录），按「全量（381 例非 DataStore 用例七轮全绿）+ 失败类单独复证全绿」组合口径判绿；
桌面主进程 gate 130 文件 / 1676 例全绿 + typecheck 干净。
拖拽跟手手感与自适应列数观感为实机验证项（Robolectric 无法驱动拖拽手势，状态机/落盘已有单测）。

## 10. v0.7.0 图片镜像层与高质量图档位

对齐 spec `doc/superpowers/specs/2026-07-13-android-image-mirror-design.md`：安卓端图片落地方式整体切换——
不再借道系统相册/MediaStore，改为 app 私有目录镜像；桌面端新增「高质量」档位，控制手机端默认落盘体积。
共 10 个任务（桌面 HQ 生成/路由 2 个 + 安卓镜像层/同步/缩略图/下载/分享/设置/收尾 8 个），本节汇总最终形态；
本节生效后，第 5/6/7 节里凡涉及 MediaStore/`downloads` 表/`WRITE_EXTERNAL_STORAGE` 的描述均为历史记录
（已加删除线/说明标注），不代表当前行为。

- **桌面新增 HQ 档**：`GET /api/app/v1/images/:id/hq`（agent 面 `/api/v1/images/:imageId/hq` 经
  `remapToAppNamespace` 克隆到手机面，权限正则并入既有 `imageBinary`）。长边 ≤2560px（`config.yaml`
  `thumbnails.hq.maxWidth/maxHeight`，默认 2560/2560、quality 85，可调）；同格式压缩——webp→webp，
  jpg/png/罕见格式→jpeg（png 先以白底 `flatten` 再转 jpeg）；GIF 不转码直通原图；体积保护——产物
  字节数 ≥ 原图时直接回退原图路径（HQ 档体积恒 ≤ 原图）。安卓端二进制档位由「缩略图/预览/原图」
  改为「缩略图/高质量/原图」——**桌面端 `/preview` 端点本身保留**（API 兼容，供旧版 APK 或桌面渲染层
  使用），仅安卓端停止调用；安卓本地 `cacheDir/previews` 缓存目录随本次改版启动时一次性递归删除。

- **安卓镜像层**：Room `image_files` 表（Task 3 引入 v6）按 `serverId + imageId` 登记每张图已落盘的
  档位（HQ/原图）与本地路径；文件落 app 私有目录（`s{serverId}/i{imageId}/` 下），不写 MediaStore、
  不进系统相册，不再需要 `WRITE_EXTERNAL_STORAGE`。`ImageMirrorStore.ensure(serverId, imageId, tier)`
  是唯一落盘入口——网格缩略图（本地已镜像的图零网络自产缩略图，未镜像回退拉 `/thumbnail`）、大图页、
  下载、分享全部经它按需取图或触发拉取；启动时 `sweepOrphans` 兜底三类孤儿（无行目录、有行无文件、
  `images` 表行已先行消失的登记行+目录）。

- **同步**：`MirrorSyncWorker`（WorkManager）按当前保存方式重算「缺失集合」（无登记行，或原图模式下
  仅有 HQ 登记行）——前 5 张串行探测（HQ 模式下连续 5 个 404 判定桌面端版本过旧，中止本轮标记
  `SERVER_TOO_OLD`，下轮自动重试自愈），其余并发 3 路。触发时机：元数据同步成功后自动顺带触发一次
  （连接、周期性同步、SSE 收到桌面事件、下拉刷新等既有元数据同步触发点，事后都会顺带补一次镜像
  增量同步，无需单独配置）；存储页/设置页「立即同步」手动触发；清空镜像、切换保存方式或移动网络
  开关后以 `replace` 语义重新全量入队。网络约束：默认仅 WiFi（`NetworkType.UNMETERED`），设置页
  「允许移动网络同步」（默认关）打开后放宽为任意网络（`NetworkType.CONNECTED`）；指数退避 30s 起。
  同步进度/错误态（`MirrorSyncMonitor`：运行中/完成数/总数/错误——桌面过旧、磁盘满、网络中断三种）
  在设置页与存储页共享同一套文案，另有前台通知（节流更新，未授权时静默降级纯后台）。

- **保存方式**（设置页「图片同步」分组）：二选一——「高质量」（约几百 KB/张，默认，切换即时生效，
  不影响已有原图）与「原图」（完整体积，切换前先算「预计补充下载量 / 可用空间」弹确认框，确认后
  新图与存量高质量图逐步替换为原图、替换完成即删对应 HQ 副本）。

- **下载「原图」**：`DownloadWorker` 不再写系统相册，改为委托 `ImageMirrorStore.ensure(serverId,
  imageId, ORIGINAL)` 落私有镜像（流式下载 + Content-Length 校验 + 临时文件原子改名 + 完成后清理
  同图 HQ 副本 + 跨切服拦截，细节全收敛在 `ImageMirrorStore`）；worker 只剩 WorkManager 外壳
  （重试/退避/前台通知）与结果分流（404 失败、磁盘满重试、其余重试）；通知降级为不确定态
  （不再有字节级进度，聚合进度由 `MirrorSyncNotifier` 承担）。

- **分享**：`ShareCoordinator.shareFiles` 四级规则——本地已有原图 > 本地已有高质量图（`localFile`
  按行登记档位返回，天然覆盖前两级）> 在线时按当前保存方式临时拉一张入镜像（顺带补齐该图同步）>
  离线且本地无文件才计入 `failedIds`。文件经 `FileProvider`（`${applicationId}.fileprovider`）把
  私有镜像文件转 `content://` 授权给分享目标 App，不再是 MediaStore URI。

- **存储管理页**（`CacheScreen`，原「缓存管理」，Task 9 改版）：三个 MIUI 卡片组——①图片镜像
  （HQ/原图分档张数+字节统计、「立即同步」、「清空图片镜像」二次确认后连清 DB 行与磁盘文件并以
  `replace=true` 重新全量入队）；②缩略图缓存（占用展示 + 清理，逻辑不变）；③同步状态（与设置页
  同款文案）。两档磁盘缓存上限选择器、预览档统计区块、「已下载记录」列表三项均已下线。

- **兼容/迁移**：Room `MIGRATION_6_7`（本任务）DROP `downloads` 表（历史下载记录随之作废；用户
  此前下载到系统相册 `Pictures/YandeGallery/` 的历史文件本身**保留不动**，只是不再有 app 内映射）；
  `DownloadDao`/`MediaStoreGateway`/`AndroidMediaStoreGateway`/legacy 存储权限门卫
  （`rememberLegacyStorageGate`/`LEGACY_STORAGE_DENIED_TEXT`）随之整体删除；`AndroidManifest.xml`
  移除 `WRITE_EXTERNAL_STORAGE`。旧桌面端（无 `/hq`）探测到 404 会明确提示需升级，元数据同步不受
  影响。versionCode 8 / versionName `0.7.0`。

- **App 内删除的镜像级联**（Task 8 审查遗留项，本任务补齐）：`WriteRepository` 删图/批量删图成功后
  主动级联清理对应 `image_files` 行与磁盘镜像文件（按「事后现状」ground truth 判定真正消失的 id，
  失败回滚的 id 天然被排除在外）；`ImageMirrorStore.sweepOrphans` 新增第三类孤儿兜底（`images` 表行
  已消失但镜像登记行与目录还在时兜底清理）；两者与既有对账级联共同构成三层防护，互为补位。

验证：全量 Robolectric 77 类 / 440 例 / 0 失败 / 0 错误（`gradlew :app:testDebugUnitTest` BUILD SUCCESSFUL）；
桌面 `npm run test`（typecheck + vitest）全绿。

## 11. v0.8.0 本机相册与复制/移动体系

对齐 spec `doc/superpowers/specs/2026-07-16-android-device-albums-design.md`：底部导航新增第三 tab
「手机相册」，把本机系统相册（MediaStore 的相机 / 截图 / 微信等 bucket）补成一等公民——浏览 + 分享 +
删除 + 手机相册间复制 / 移动 + 视频外抛系统播放器；并借势把桌面域的「加入相册」升级为跨域的
「复制到 / 移动到」体系。手机域与桌面镜像域（照片 / 相册）**完全隔离**：不混排、不互通、不进 Room，
纯 MediaStore 实时读。**桌面端零改动**（复制 / 移动到桌面相册全部复用既有手机面写接口）。
versionCode 9 / versionName `0.8.0`。

### 功能面

- **手机相册 tab（F1/F8）**：相册列表页（置顶「全部照片」聚合卡 + 相机 / 截图置顶、其余按张数降序的
  bucket 卡）→ 相册网格页（默认 4 列、捏合 3/4/5，档位不持久化）→ 本机大图页（`DeviceViewer`，
  轻量件，独立于桌面域 Viewer）。数据层 `data/device/` 纯 MediaStore 实时读：bucket 聚合 + Paging 3
  分页 + `ContentObserver` 自动刷新——app 内外的增删改（含本 app 自己的复制 / 删除落地）统一走这一条
  刷新链，操作代码不手工刷列表；`content://` URI 走 Coil 默认数据源，视频海报帧加 `VideoFrameDecoder`。
- **权限模型（F2）**：33+ 运行时申请 `READ_MEDIA_IMAGES` + `READ_MEDIA_VIDEO`（一次双弹）；34+ 追加
  `READ_MEDIA_VISUAL_USER_SELECTED`，「仅可访问部分照片」时 tab 顶常驻横幅 + 「管理」重拉系统选择器；
  26–32 走 `READ_EXTERNAL_STORAGE`（`maxSdkVersion="32"`）。首次进 tab 才申请（不在启动时打扰），
  未授权显引导页，永久拒绝后按钮变「去设置」跳 app 详情页。**不声明任何 WRITE 权限**（29+ 写自有新
  文件免权限，改 / 删他人文件走 30+ 系统弹窗），与 v0.7.0「无媒体写权限」架构决策一致。
- **手机域操作（F3/F4）**：分享（`ACTION_SEND` / `ACTION_SEND_MULTIPLE`，MediaStore URI 直发，无需
  FileProvider）；删除（30+ `createDeleteRequest` 系统弹窗批量一次，**永久删除**不走回收站，规避国产
  ROM 回收站入口碎片化）；复制到手机相册（29+，读源字节 `MediaStore.insert` 到 `DCIM/`、`Pictures/`
  下目标 bucket，同名交系统自动改名）；移动到手机相册（30+ `createWriteRequest` 授权后改
  `RELATIVE_PATH` 物理移动，「全部照片」聚合里同样可用）；只读详情面板。视频一等公民：网格时长角标、
  大图页海报帧 + 中央播放键 `ACTION_VIEW` 外抛系统播放器（app 内不做播放器），删除 / 分享 / 复制 /
  移动与图片同权。
- **新建手机相册（F5）**：选择器内「新建相册」命名即建（目录固定 `Pictures/<名称>`，文件落入即真实
  存在）；列表页「+」写一条**待落地相册**记录（DataStore：名称 + 相对路径），列表合并显示为 0 张相册，
  首个文件复制进来后由真实 bucket 接管（按相对路径去重删占位）；重名（对既有 bucket 或待落地记录）拒绝。
- **桌面域「复制到」（F6）**：多选栏与大图页的「加入相册」入口改名「复制到」，选择器升级为两节
  （`CopyTargetPicker`）——桌面相册节（等于原「加入相册」：`WriteRepository` 成员添加、乐观镜像 + 失败
  回滚 + 事后对账）+ 手机相册节（29+ 显示、离线置灰整节：对每张图 `ImageMirrorStore.ensure(ORIGINAL)`
  取原图 → 字节拷贝 `MediaStore.insert` 落目标相册，WorkManager 后台串行 + 计数进度通知
  「正在复制到手机相册 x/y」+ 404 跳过 / 磁盘满中止的镜像同款分流）。**成功 / 失败 snackbar 文案随
  入口统一为复制语义**（「已复制到相册（N 张）」/「复制到相册失败」），杜绝残留旧称「加入相册」。
- **桌面域「移动到」（F7）**：入口**仅在相册详情上下文**出现，选择器**只有桌面相册节**（D5：禁止移动
  到手机相册，不允许以移动之名删桌面图）；执行 = 目标相册成员添加成功 → 当前相册成员移除，移除失败
  补偿回滚（撤销刚才的添加），两步全程乐观镜像 + 事后对账兜底。
- **领域词汇表（F9）**：根级 `CONTEXT.md` 固定 手机相册 / 相册 / 照片 / 图片镜像 / 复制到 / 移动到 /
  待落地相册 / 全部照片 等术语边界（尤其「复制到」避免旧称「加入相册」「导出」「保存到相册」）。

### 版本门控矩阵（spec §7）

| API 区间 | 手机相册 tab | 复制（→手机相册，两来源同门） | 删除（手机域） | 移动（手机域） |
|---|---|---|---|---|
| 26–28 | 浏览 + 分享 + 详情 | ✗（insert 需 WRITE 权限，已架构性移除） | ✗ | ✗ |
| 29 | 同上 | ✓（`IS_PENDING` 挂起写入，自有新文件免权限） | ✗ | ✗ |
| 30+ | 同上 | ✓ | ✓ `createDeleteRequest` | ✓ `createWriteRequest` |

不可用 = 入口**隐藏**（非置灰），杜绝「点了弹失败」；全部现役真机均 30+，功能全量可用。桌面域复制 /
移动到桌面相册是纯网络写，不受此矩阵约束（26+ 全可用）。

### 待实机验证清单

系统删除 / 写授权弹窗真实交互、34+ 部分授权选择器与重选、复制产物在系统相册 app 的可见性、视频外抛各
ROM 播放器兼容、`ContentObserver` 在 MIUI 上的触发时延、桌面→手机导出通知观感——均无法在无头 CI 上
覆盖（接口缝 + fake 网关只验 VM/UI 逻辑），已展开为 `docs/superpowers/plans/2026-07-05-M3实机联调计划.md`
§L 的逐条真机用例（MuMu API32 测 26–32 读 + 29 复制路径、红魔 API34 测部分授权与 30+ 写弹窗），
联调时照该计划执行。

验证：全量 Robolectric 90 类 / 528 例 / 0 失败 / 0 错误（`gradlew :app:testDebugUnitTest` BUILD SUCCESSFUL）；
桌面 `npm run test`（typecheck + vitest）全绿。
