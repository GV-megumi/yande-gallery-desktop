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

1. **桌面端启动 API 服务并选择「局域网」模式**
   桌面端「设置 → API 服务」中：开启 `enabled`，把监听模式 `mode` 从默认的 `localhost` 切到
   **`lan`（局域网）**（绑定局域网地址 / `0.0.0.0`，仍有局域网来源 IP 校验），记下端口（默认 `38947`）与
   Bearer Key。手机与桌面须在同一局域网。

2. **⚠️ 重要：必须在桌面端设置页开启 `imageBinary` 权限（默认关闭）**

   > **`imageBinary` 默认是 OFF。不开启，则所有缩略图（`/images/:id/thumbnail`）请求一律返回 `403`，
   > 界面能配对、能看到时间轴/相册的格子，但每一张缩略图都加载失败。**
   >
   > 这是「配对成功但缩略图全 403」最常见的原因，联调前务必先在设置页勾上 `imageBinary`。
   > （`galleryRead` / `imageRead` 默认已开，元数据同步不受影响；缺的只是二进制这一档。）

3. **⚠️ M3 写操作：必须在桌面端设置页另开 `imageWrite` / `galleryWrite` 权限（默认关闭）**

   > **两者默认都是 OFF。不开启 `imageWrite`，删除图片（含批量删除）与标签编辑一律返回 `403`；
   > 不开启 `galleryWrite`，新建 / 重命名 / 删除图集与批量加入 / 移出图集一律返回 `403`。**
   >
   > 安卓端的写按钮只在离线时置灰，权限不足不会隐藏——表现为操作后弹「失败」提示。
   > 联调写操作前，务必先在桌面端设置页勾上这两项。
   > （「查看原图 / 下载原图」的 `/images/:id/file` 与缩略图、预览同属 `imageBinary` 档，上一步已开即可。）

4. **可选：开启 `eventsSubscribe` 权限以启用 SSE 实时刷新**
   `eventsSubscribe` 默认也是关闭的。开启后安卓端订阅 `/api/v1/events/system`（system 频道、无心跳，
   客户端用专用 `readTimeout=0` 的 OkHttp，见 T12），桌面端有 gallery 事件时自动触发一次对账同步；
   不开则退化为进前台/下拉刷新触发。

5. **安卓端扫码配对**
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
- **相册只读浏览**（§7.2 只读部分 / T11）：图集网格卡片（封面 coverImageId，缺省取图集内最新图 + 名称 + 张数），
  点入为该图集网格页。

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
  级联删相册副本）/ 详情；详情面板：元数据 + 可编辑标签（点标签跳搜索）+ 所属图集（点击跳转）。
- **原图下载进系统相册**（§6.4 / T7·T8）：WorkManager 后台流式下载 `/images/:id/file` → MediaStore
  `Pictures/YandeGallery/`（29+ 走 `IS_PENDING` 挂起写入，26–28 直写 + 媒体扫描），Content-Length
  完整性校验，`downloads` 表记录 imageId→uri 映射；原图 404 触发一次对账同步。
- **搜索**（§7.4 / T5·T12）：本地 Room 即时查询（标签名前缀 OR 文件名包含，多关键词 AND 交集），
  搜索历史（Room v1→2 迁移新增 `search_history` 表）。
- **多选**（§7.5 / T13）：长按进入、角标、全选；批量下载 / 批量分享（已下载项）/ 批量删除
  （走 batch-delete 端点，按逐条结果分条回滚）/ 加入图集 / 移出当前图集。
- **写操作**（§5.4 / T3·T4·T6·T14）：9 个写接口（删图、批量删图、标签增删、图集建/改名/删、
  成员增删）走「乐观改本地镜像 → 请求 → 失败回滚」；404 视为成功（目标已在桌面被删，不回滚）；
  写成功后触发一次冗余对账同步。相册 tab 支持新建 / 重命名 / 删除图集（二次确认，明示不删图片文件）。

> ⚠️ 写操作与原图下载对桌面端权限的要求见第 3 节第 2、3 步（`imageBinary` + `imageWrite` / `galleryWrite`）。

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
- **下载域修复包**（§6.2/§6.3/§5.4/§8 / T9）：`downloads` 表 serverId 化（切服不串本地副本、
  根治飞行中下载跨切服竞态）；对账删除级联清理全量（系统相册副本 + 两级盘缓存键 + 映射行）；
  批量删除副本级联（30+ 单弹窗批量确认）；API 29 `RecoverableSecurityException` 转
  NeedsConsent 走系统确认弹窗（修 F.12 预判缺陷，30+/29 语义对齐）。
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
- **图集详情页 / 搜索页的密度档与快速滚动滑块**：仅照片时间轴 tab 支持（范围定界）。
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
- [ ] **相机 / 存储权限**：首次扫码相机权限、（M3 下载原图时）存储/相册写入权限的 on-device 授权流程。
- [ ] **SSE 长连接行为**：开启 `eventsSubscribe` 后，`/api/v1/events/system` 在真实局域网上的长连稳定性
      （无心跳、`readTimeout=0` 是否如期不被超时误杀；桌面端加图后安卓端是否自动刷新）。
- [ ] **缩略图跨局域网加载**：桌面端开启 `imageBinary` 后，时间轴/相册缩略图能真实加载（未开则应观察到全 403）。
- [ ] **下拉刷新**：对活桌面端实例下拉刷新，桌面端新增/删除图片后安卓端可见对应变化。

M3 新增（大图/下载/写操作的真机语义无法在 Robolectric 覆盖，e2e 用 fake 网关替身）：

- [ ] **大图页手势手感**：双指捏合（至 5x）、双击切档、单击沉浸、下滑关闭、缩放态下 Pager 不误滑。
- [ ] **原图下载落盘（29+）**：下载原图后在系统相册应用可见于 `Pictures/YandeGallery/`，
      下载过程中（`IS_PENDING=1`）不出现半成品条目。
- [ ] **API 26–28 下载可见性**：26–28 无 `IS_PENDING`，`finalize` 走 `MediaScannerConnection` 扫描——
      需确认下载完成后图片在系统相册应用**真实可见**（T7 审查项：扫描路径取自 content URI 查询，需实机验证）；
      并验证 28- 的 `WRITE_EXTERNAL_STORAGE` 运行时授权流程
      （v0.4.1 起已实现运行时申请：`rememberLegacyStorageGate` 动作门卫接入全部下载/带下载分享触发点，
      见 2026-07-08 联调 Bug 报告 BUG-07；此前仅 manifest 声明、从不弹请求，26-28 下载必然静默失败）。
- [ ] **删除级联的系统确认（30+）**：删除本地有下载副本的图片时，`createDeleteRequest` 系统弹窗出现；
      拒绝后仅清 `downloads` 映射、相册副本保留。
- [ ] **写操作端到端**：开启 `imageWrite`/`galleryWrite` 后，删图 / 批量删 / 标签编辑 / 建改删图集 /
      成员增删在桌面端侧即时可见；未开权限时应观察到 403 失败提示（按钮不隐藏）。
- [ ] **分享**：已下载图片单张 `ACTION_SEND` 与多选 `ACTION_SEND_MULTIPLE`（MediaStore content:// URI）
      在常见目标应用（微信/相册等）可正常接收。

M4 新增实机验证项（前台通知与 33+ 权限 / 捏合切档手感 / 滑块与 sticky 条 / 缓存管理页 /
转场观感 / 完整分享流 / API 29 删除语义 / 断网恢复横幅 / changeSeq 升级路径等）**不重复列于此**——
已展开为 `docs/superpowers/plans/2026-07-05-M3实机联调计划.md` §J 的 J.1-J.10 用例，
联调时照该计划执行（§K 已知限制的验收口径亦已按 M4 修复项更新）。
