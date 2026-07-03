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

---

## 3. 与桌面端联调步骤（按顺序）

> 无真机时，以第 2 节 MockWebServer 端到端测试为准；本节为实机联调的操作手册。

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

3. **可选：开启 `eventsSubscribe` 权限以启用 SSE 实时刷新**
   `eventsSubscribe` 默认也是关闭的。开启后安卓端订阅 `/api/v1/events/system`（system 频道、无心跳，
   客户端用专用 `readTimeout=0` 的 OkHttp，见 T12），桌面端有 gallery 事件时自动触发一次对账同步；
   不开则退化为进前台/下拉刷新触发。

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

## 5. M3 / M4 待办指引

来自 spec §11 与本 M2 各任务自查记录：

**M3 核心体验**

- 远端删除时的**级联缓存/相册副本清理**（对账删除行执行 §5.4 清理，补齐同步第 2 条语义）。
- **相册写操作 UI**：新建 / 重命名 / 删除（二次确认，说明不删图片文件），复用桌面端 service 层。
- **预览档 / 原图档管线**：预览 1600px（Coil 独立 LRU 缓存，默认 1GB）；原图「查看原图 = 下载原图」
  经 WorkManager 写入 MediaStore `Pictures/YandeGallery/`，`downloads` 表记录映射。
- 大图页（手势/转场/三档加载）、搜索、多选。

**M4 打磨**

- 时间轴 **sticky 分组头**（日视图按天、月视图按月）。
- **双指捏合切换密度**：月视图 ↔ 日视图 3/4/5 列四档，带缩放过渡，档位记忆。
- 右侧**快速滚动滑块**（拖动浮出日期气泡，松手落位）。
- 离线态、缓存管理、性能调优。

---

## 6. 待实机验证清单

以下项无法在无头 CI 上覆盖（无真机、无法在此启动桌面端 Electron GUI），需在真机 + 活桌面端实例上人工验证：

- [ ] **扫码配对**：真机相机扫桌面端设置页二维码，权限弹窗（相机）授权后成功配对；手输 baseUrl+Key 回退可用。
- [ ] **相机 / 存储权限**：首次扫码相机权限、（M3 下载原图时）存储/相册写入权限的 on-device 授权流程。
- [ ] **SSE 长连接行为**：开启 `eventsSubscribe` 后，`/api/v1/events/system` 在真实局域网上的长连稳定性
      （无心跳、`readTimeout=0` 是否如期不被超时误杀；桌面端加图后安卓端是否自动刷新）。
- [ ] **缩略图跨局域网加载**：桌面端开启 `imageBinary` 后，时间轴/相册缩略图能真实加载（未开则应观察到全 403）。
- [ ] **下拉刷新**：对活桌面端实例下拉刷新，桌面端新增/删除图片后安卓端可见对应变化。
