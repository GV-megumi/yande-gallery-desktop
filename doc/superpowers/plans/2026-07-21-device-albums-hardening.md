# v0.8.1 手机相册加固轮实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 v0.8.0 终审 DEFER backlog 七类修复（A 复用收敛 / B 批量复制 WorkManager 化 / C 手势让位 / D 导出防御 / E 移动重建降级 / F 测试补强 / G 小 UX），产出 v0.8.1。

**Architecture:** 先补测试锁定现有行为（F），再在测试保护下做零行为差重构（A），随后小改动批（C/D/E/G），最后落最大件 DeviceCopyWorker 三件套（B，镜像 DeviceExportWorker 去掉下载半程），收尾版本与文档。spec：`doc/superpowers/specs/2026-07-21-device-albums-hardening-design.md`（决策 H1-H9）。

**Tech Stack:** Kotlin + Jetpack Compose + WorkManager + MediaStore + Robolectric（JVM 单测）。

## Global Constraints

- 分支 `feature/device-albums-hardening`（base master@6abb2e5，v0.8.0 已合并）；桌面 `src/` 零改动。
- 版本（仅 Task 9 改）：versionCode `10` / versionName `"0.8.1"`。
- 测试命令（仓库根，bash，timeout 600000ms，`--tests` 过滤器本机损坏只跑全量）：`cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`；验证 `android/app/build/test-results/testDebugUnitTest/TEST-*.xml` 聚合 failures=0 errors=0；基线 **90 类 / 530 例**，净增不减。
- A 类任务 = 零行为差：除 import 外不得改动任何既有测试断言；抽取前后全量绿即行为锁定证明。
- 注释/KDoc 中文；commit message 中文（类型前缀英文）；KDoc 内含路径样例时注意 `*/` 提前闭注释坑。
- 文案术语按根 `CONTEXT.md`（复制到/移动到/待落地相册，避免「加入相册」）。
- 通知 id 全景（防撞背景）：Download=imageId.hashCode()（非负）、MirrorSync=-0x4D53、导出进度=-0x4558、导出汇总基值=-0x4559（本轮加盐后占 [-0x4559-63, -0x4559]）、**本轮新增**复制进度=-0x4650、复制汇总=-0x4651。
- MiuiTextField 坑：其 modifier 施加在内部 TextField 上，Row+weight 会塌陷——纵向堆叠（既有注释随 A2 迁移保留）。

### 锚点漂移修正（计划以此为准，覆盖 spec 相应表述）

1. `Pictures/$name/` 构造实为 **6 处**非 2 处（含 DeviceAlbumsViewModel.kt:89 的无尾斜杠比较）——A3 全收。
2. A2 两 picker 手机节非字节级镜像（CopyTargetPicker 是 LazyColumn item{} 宿主 + 多包一层 Column）——抽「三件套行组件」而非整节，桥接结构差异。
3. G1 闪旧快照仅存在于 CopyTargetPicker 三宿主（LaunchedEffect 开后加载）；DeviceAlbumPicker 两宿主为查完再开，无此缺陷，不改。
4. G6 实际缺口是联调计划 **339 行全局退出标准**未提 §L（§L 自己的退出标准行已存在于 306-307）。
5. H7 加盐需改 `notifyCompleted` 签名补 serverId 参数（现签名无 serverId）。
6. D1 前提确认：`DeviceExportManager.enqueue` 现返回 Unit，两批量 VM null 时静默 `return@launch`，三 Screen 无条件 toast 成功。
7. README §11 验证行仍写 528 例（实际基线 530）——T9 顺手更正。

---

### Task 1: F 类补强·纯函数与仓库层（F1 门控 / F2 模型 / F8 moveToGallery 边界）

**Files:**
- Modify: `android/app/src/test/java/com/bluskysoftware/yandegallery/data/device/DeviceCapabilitiesTest.kt`
- Modify: `android/app/src/test/java/com/bluskysoftware/yandegallery/data/device/DeviceModelsTest.kt`
- Modify: `android/app/src/test/java/com/bluskysoftware/yandegallery/domain/write/WriteRepositoryTest.kt`

**Interfaces:**
- Consumes: `DeviceCapabilities.accessLevelOf(sdk, granted)`、`BucketKey.decode(raw)`、`isWritableAlbumPath(path)`、`WriteRepository.moveToGallery(from, to, ids)`（均既有，本任务只钉行为）。
- Produces: 无新接口；行为锁定测试供后续任务回归保护。

> 本任务为**行为锁定**：新测试应一次写就即绿（钉现状）。若任何一条意外变红 = 发现真实缺陷，停下报告，不得改产品代码。

- [ ] **Step 1: F1——DeviceCapabilitiesTest 追加 sdk33 单权限用例**

在 `` `访问级别_全部_部分_拒绝` ``（34-47 行）后追加：

```kotlin
@Test
fun `访问级别_sdk33单权限授予视为拒绝`() {
    // 33 无「部分授权」概念（34+ 才有 READ_MEDIA_VISUAL_USER_SELECTED）——
    // 双媒体权限缺一即 DENIED，不得误判 PARTIAL
    assertEquals(
        DeviceAccessLevel.DENIED,
        DeviceCapabilities.accessLevelOf(33, setOf(DeviceCapabilities.READ_MEDIA_IMAGES)),
    )
    assertEquals(
        DeviceAccessLevel.DENIED,
        DeviceCapabilities.accessLevelOf(33, setOf(DeviceCapabilities.READ_MEDIA_VIDEO)),
    )
}
```

- [ ] **Step 2: F2——DeviceModelsTest 追加空段解码与无尾斜杠路径用例**

在 `` `bucketKey_三态编解码往返` `` 同区追加：

```kotlin
@Test
fun `bucketKey_空段与非法前缀解码为null`() {
    assertNull(BucketKey.decode("p"))    // Pending 空名
    assertNull(BucketKey.decode("b"))    // Bucket 空 id
    assertNull(BucketKey.decode(""))
    assertNull(BucketKey.decode("x9"))
}

@Test
fun `目标目录校验_无尾斜杠前缀同样通过`() {
    // isWritableAlbumPath 以 startsWith 判前缀——真实 RELATIVE_PATH 带尾斜杠，
    // 但 trimEnd 后的比较路径也应稳定通过/拒绝
    assertTrue(isWritableAlbumPath("DCIM/Camera"))
    assertTrue(isWritableAlbumPath("Pictures/Yande"))
    assertFalse(isWritableAlbumPath("Download/Sub"))
}
```

（若 `decode("b")` 实际返回非 null——以代码为准修断言并在报告注明；这是钉现状不是改行为。）

- [ ] **Step 3: F8——WriteRepositoryTest 追加 moveToGallery 四条边界**

在既有 moveToGallery 块（775-841 行）后追加，装配沿用该文件 in-memory Room + FakeWriteApi 惯例（nudge 计数器字段名照 178/251/479 行既有用法）：

```kotlin
@Test
fun `移动到相册_空集直接成功不触API`() = runTest {
    val repo = repo(FakeWriteApi())
    val result = repo.moveToGallery(5, 6, emptyList())
    assertEquals(WriteResult.Success, result)
    assertEquals(0, writeApi.calls.size)   // add/remove 均未发
}

@Test
fun `移动到相册_目标已删加入404当成功移除照走`() = runTest {
    // spec §6.2/KDoc 钉过的边界：目标相册已在桌面被删 → add 404 当成功 → remove 照走 → 整体 Success
    seedGallery(5, listOf(1))
    writeApi.failAddToGalleryWith404 = true   // 若无此旋钮，照既有 fail* 字段风格补一个 404 变体
    val result = repo.moveToGallery(5, 6, listOf(1))
    assertEquals(WriteResult.Success, result)
    assertEquals(emptyList<Long>(), db.imageDao().galleryIdsOf(1))   // 已离开 A，图片本体保留
}

@Test
fun `移动到相册_补偿自身失败镜像与服务端一致`() = runTest {
    // 双杀：remove(A) 失败 → 补偿 remove(B) 也失败 → 镜像终态 1 在 A+B（与服务端真相一致，交对账收敛）
    seedGallery(5, listOf(1))
    db.galleryDao().insertOne(GalleryEntity(6, "g6", null, 0))
    writeApi.failRemoveFromGallery = ApiException(500)   // 全局失败连炸补偿
    val result = repo.moveToGallery(5, 6, listOf(1))
    assertTrue(result is WriteResult.Failed)
    assertEquals(listOf(5L, 6L), db.imageDao().galleryIdsOf(1).sorted())
}

@Test
fun `移动到相册_补偿路径触发对账nudge`() = runTest {
    seedGallery(5, listOf(1))
    db.galleryDao().insertOne(GalleryEntity(6, "g6", null, 0))
    writeApi.failRemoveFromGalleryOnCallIndex = 0
    repo.moveToGallery(5, 6, listOf(1))
    assertTrue(syncNudges.count >= 2)   // add 成功 + 补偿链路均应 nudge（计数器字段照 178 行既有装配）
}
```

- [ ] **Step 4: 全量测试确认绿（行为锁定）**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；聚合 ≥537 例（530+7）failures=0 errors=0。任何新用例红 = 停下报告缺陷。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/test
git commit -m "test(android): 加固轮 F 类补强·纯函数层——sdk33 门控/bucketKey 空段/moveToGallery 四边界锁定"
```

---

### Task 2: F 类补强·VM 与 UI 层（F3-F7、F9、D3 顺序断言）

**Files:**
- Modify: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/DeviceActionsTest.kt`（F3 rows-affected 对账）
- Modify: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumsViewModelTest.kt`（F4 收编双路径）
- Modify: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumsScreenTest.kt`（F4 删除确认框）
- Modify: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailViewModelTest.kt`（F5 Pending 空页）
- Modify: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/AppNavTest.kt`（F6 device swap 桥）
- Modify: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailScreenTest.kt`（F6 分享 intent 组装）
- Create: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/DeviceViewerLabelsTest.kt`（F7 日期标签直测）
- Modify: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/photos/PhotosViewModelTest.kt`（F9 分块入队）
- Modify: `android/app/src/test/java/com/bluskysoftware/yandegallery/domain/export/DeviceExportWorkerTest.kt`（D3 先查后插顺序断言）

**Interfaces:**
- Consumes: `FakeDeviceGateway`（moveToCalls/media/pagingSource 旋钮）、`DeviceCopyTargets.EXPORT_BATCH`（=500）、`WorkManagerTestInitHelper`（androidx.work:work-testing 已在依赖）、`deviceViewerDateLabel`/`deviceViewerTimeLabel`（DeviceViewerScreen.kt:543-552 internal）。
- Produces: 行为锁定；D3 要求 DeviceExportWorkerTest 的 fake 记录**统一 call log**（`calls: MutableList<String>` 形如 `"find:name"`/`"insert:name"`）——Task 8 的 DeviceCopyWorkerTest 沿用此形态。

> 同 Task 1：行为锁定，全部即写即绿；意外红 = 报缺陷停。

- [ ] **Step 1: F3——DeviceActionsTest 追加 rows-affected 对账用例**

```kotlin
@Test
fun `移动到_部分行未生效时成功数按rows-affected对账`() {
    // 网关 moveTo 计数 = resolver.update 返回行数之和；0 行的 uri 不计成败——
    // UI 侧以 successCount vs 选中数 对账提示（T3(c) 语义钉板）
    runBlocking {
        val gateway = FakeDeviceGateway().apply {
            media = listOf(mediaOf(1), mediaOf(2), mediaOf(3))
            moveToResult = Result.success(2)   // 3 选 2 行生效
        }
        val vm = detailVm(gateway)
        vm.selection.selectAll(listOf(1L, 2L, 3L))
        val moved = vm.moveSelectedTo("Pictures/Target/").getOrDefault(0)
        assertEquals(2, moved)
        assertEquals(3, gateway.moveToCalls.single().first.size)   // 三 uri 全量传入
    }
}
```

（`mediaOf`/`detailVm` 用该文件既有工厂；若名称不同照现有写法对齐。）

- [ ] **Step 2: F4——收编双路径 + 删除确认框**

DeviceAlbumsViewModelTest 追加（照 86 行既有收编用例装配）：

```kotlin
@Test
fun `待落地收编_同路径不同名的真实bucket同样收编`() {
    // absorbedPendingNames 双判据：同名 OR 同 Pictures/<名> 路径——钉「路径命中」分支
    val real = listOf(albumOf(1, "旅拍", "Pictures/Trip/"))
    val pending = setOf("Trip")
    assertEquals(listOf("Trip"), absorbedPendingNames(real, pending).toList())
}
```

（`absorbedPendingNames` 现为 private——改 `internal` 供测试直调，这是唯一允许的产品代码改动，零行为差。）

DeviceAlbumsScreenTest 追加删除确认框用例（对照该文件 98/105 行既有 compose 装配）：

```kotlin
@Test
fun `待落地相册长按删除_确认框确认后移除`() {
    // DeviceAlbumsScreen.kt:150-156 的确认框：长按 pending 卡 → 弹确认 → 确认 → removePendingAlbum
    setScreenWithPending("旅行")
    compose.onNodeWithTag("device_album_p旅行").performTouchInput { longClick() }
    compose.onNodeWithText("删除").performClick()
    awaitValue(prefsStore.devicePendingAlbums) { "旅行" !in it }
}
```

（tag/文案以 DeviceAlbumsScreen.kt 实际为准先 grep 再写；性质为钉现状。）

- [ ] **Step 3: F5——Pending 空页分支消费**

DeviceAlbumDetailViewModelTest 追加：

```kotlin
@Test
fun `Pending上下文分页恒空页`() = runTest {
    val gateway = FakeDeviceGateway().apply { media = listOf(mediaOf(1)) }
    val vm = DeviceAlbumDetailViewModel(gateway, prefsStore, BucketKey.Pending("旅行").encode())
    val snapshot = vm.media.asSnapshot()
    assertEquals(emptyList<DeviceMedia>(), snapshot)   // FakeMediaPagingSource Pending 分支 + 生产语义一致
}
```

- [ ] **Step 4: F6——AppNav device swap 桥 + 分享 intent 组装**

AppNavTest 追加（镜像 61 行照片域 swap 用例的装配）：

```kotlin
@Test
fun `手机相册tab多选激活时壳级swap为DeviceSelectionBottomBar`() {
    setAppNav(startRoute = Routes.DeviceAlbums)
    deviceBars.model = DeviceSelectionBars.Model(
        canDelete = true, canCopy = true, canMove = true,
        onShare = {}, onDelete = {}, onCopyTo = {}, onMoveTo = {},
    )
    compose.waitForIdle()
    compose.onNodeWithTag("device_action_share").assertIsDisplayed()
    compose.onNodeWithTag("miui_nav_bar").assertDoesNotExist()
}
```

DeviceAlbumDetailScreenTest 追加分享 intent 断言（Robolectric `Shadows.shadowOf(application)` 取 nextStartedActivity）：

```kotlin
@Test
fun `分享_单张实际mime_多张SEND_MULTIPLE通配`() {
    // 单张：ACTION_SEND + 实际 mime；多张：ACTION_SEND_MULTIPLE + */* + FLAG_GRANT_READ_URI_PERMISSION
    setScreenWithMedia(listOf(imageMedia(1, "a.jpg"), videoMedia(2, "b.mp4")))
    enterSelection(1L)
    clickShare()
    val single = shadowOf(ApplicationProvider.getApplicationContext<Application>()).nextStartedActivity
    val singleInner = single.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!
    assertEquals(Intent.ACTION_SEND, singleInner.action)
    assertEquals("image/jpeg", singleInner.type)

    toggleSelect(2L)
    clickShare()
    val multi = shadowOf(ApplicationProvider.getApplicationContext<Application>()).nextStartedActivity
    val multiInner = multi.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!
    assertEquals(Intent.ACTION_SEND_MULTIPLE, multiInner.action)
    assertEquals("*/*", multiInner.type)
    assertTrue(multiInner.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
}
```

（chooser 包装层级以实际 createChooser 结构为准调 EXTRA_INTENT 解包；装配助手照该文件既有写法。）

- [ ] **Step 5: F7——日期标签直测（新文件）**

```kotlin
package com.bluskysoftware.yandegallery.ui.device

import java.util.Calendar
import org.junit.Assert.assertEquals
import org.junit.Test

/** deviceViewerDateLabel/TimeLabel 纯函数直测（同/跨年分支）；本地时区构造期望防脆断言（照 TimelineModelsTest:53 惯例）。 */
class DeviceViewerLabelsTest {
    private fun epochOf(y: Int, mo: Int, d: Int, h: Int, mi: Int): Long =
        Calendar.getInstance().apply { clear(); set(y, mo - 1, d, h, mi) }.timeInMillis

    @Test
    fun `日期标签_同年不带年份_跨年带年份`() {
        val thisYear = Calendar.getInstance().get(Calendar.YEAR)
        assertEquals("6月9日", deviceViewerDateLabel(epochOf(thisYear, 6, 9, 10, 0)))
        assertEquals("2024年6月9日", deviceViewerDateLabel(epochOf(2024, 6, 9, 10, 0)))
    }

    @Test
    fun `时间标签_HH_mm`() {
        assertEquals("09:05", deviceViewerTimeLabel(epochOf(2025, 1, 1, 9, 5)))
    }
}
```

（格式串以 DeviceViewerScreen.kt:543-552 实际实现为准先读后写。）

- [ ] **Step 6: F9——EXPORT_BATCH 分块入队**

PhotosViewModelTest 追加（`WorkManagerTestInitHelper.initializeTestWorkManager(context)` 于装配处；活动服务器按该文件既有 seed 惯例）：

```kotlin
@Test
fun `导出分块_超500拆多批保序尾批余数`() = runTest {
    val vm = PhotosViewModel(graph)
    val ids = (1L..1001L).toList()
    vm.exportSelectedToDevice(ids, "Pictures/Yande/")
    advanceUntilIdle()
    val infos = WorkManager.getInstance(context)
        .getWorkInfosForUniqueWork("device-export-$SEED_SERVER_ID").get()
    assertEquals(3, infos.size)   // 500+500+1，APPEND_OR_REPLACE 链三节
}
```

- [ ] **Step 7: D3——DeviceExportWorkerTest 统一 call log 顺序断言**

把 fake 的 `findCopyCalls`/`insertCalls` 双列表**改造**为共享 `calls: MutableList<String>`（元素 `"find:$name"` / `"insert:$name"`，原两列表保留为派生只读或同步追加），在 `` `全成功——逐张先查重后 insertCopy，失败计数 0` `` 中追加：

```kotlin
// 逐张严格「先查后插」交错序（防未来改成批查或先插后查）
assertEquals(
    listOf("find:1.jpg", "insert:1.jpg", "find:2.jpg", "insert:2.jpg", "find:3.jpg", "insert:3.jpg"),
    calls,
)
```

- [ ] **Step 8: 全量测试确认绿**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；聚合 ≥546 例 failures=0 errors=0（Task1 基础上 +8 类新用例）。意外红 = 报缺陷停（唯一允许的产品侧改动：`absorbedPendingNames` private→internal）。

- [ ] **Step 9: Commit**

```bash
git add android/app/src
git commit -m "test(android): 加固轮 F 类补强·VM/UI 层——rows-affected 对账/收编双路径/swap 桥/分享 intent/日期标签/导出分块/先查后插顺序"
```

---

### Task 3: A 类·系统栏辅助与工具收敛（A1 SystemBarUtil / A3 pendingAlbumPath / A4 mime 迁址）

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/SystemBarUtil.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/viewer/ViewerScreen.kt`（删私有三件，改引用）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceViewerScreen.kt`（同上）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/theme/Theme.kt`（删私有 findActivity，改引用）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/device/DeviceModels.kt`（+pendingAlbumPath、+DeviceMedia.mime()）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumsViewModel.kt`（89/121 行改调用）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumPicker.kt`（94 行改调用）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/CopyTargetPicker.kt`（152 行改调用）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceViewerViewModel.kt`（102 行改调用）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailViewModel.kt`（175 行改调用）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailScreen.kt`（删 301-302 mime()，改 import）

**Interfaces:**
- Produces:
  - `ui/common/SystemBarUtil.kt` 顶层：`internal tailrec fun Context.findActivity(): Activity?`、`internal fun applySystemBars(activity: Activity?, view: View, hide: Boolean)`、`internal fun setSystemBarAppearanceLight(activity: Activity?, view: View, light: Boolean)`——函数体与现三份/两份逐字一致（锚点 §A1/§A2 报告）。
  - `DeviceModels.kt` 顶层：`fun pendingAlbumPath(name: String): String = "Pictures/${name.trim()}/"`；成员或扩展 `fun DeviceMedia.mime(): String`（体照 DeviceAlbumDetailScreen.kt:301-302 原样，`mimeOf` 同文件已在）。
- Consumes: 六处 `Pictures/$name/` 构造点（锚点修正 #1 全清单）。

**零行为差纪律**：所有函数体逐字搬运；`DeviceAlbumsViewModel.kt:89` 的无尾斜杠比较改为 `pendingAlbumPath(it).trimEnd('/') in realPaths`（realPaths 本就 trimEnd 过——语义等价，KDoc 注明）；除 import 外不改任何测试。

- [ ] **Step 1: 建 SystemBarUtil.kt（三函数逐字迁入，internal + KDoc 注明来源收敛）**

```kotlin
package com.bluskysoftware.yandegallery.ui.common

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.View
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Context → Activity 解包（原 ViewerScreen/DeviceViewerScreen/Theme 三份私有副本收敛，v0.8.1 A1）。 */
internal tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** 沉浸态系统栏显隐（原 ViewerScreen/DeviceViewerScreen 两份私有副本收敛）。 */
internal fun applySystemBars(activity: Activity?, view: View, hide: Boolean) {
    val window = activity?.window ?: return
    val controller = WindowCompat.getInsetsController(window, view)
    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    if (hide) controller.hide(WindowInsetsCompat.Type.systemBars())
    else controller.show(WindowInsetsCompat.Type.systemBars())
}

/** 状态栏/导航栏图标明暗（同上收敛）。 */
internal fun setSystemBarAppearanceLight(activity: Activity?, view: View, light: Boolean) {
    val window = activity?.window ?: return
    val controller = WindowCompat.getInsetsController(window, view)
    controller.isAppearanceLightStatusBars = light
    controller.isAppearanceLightNavigationBars = light
}
```

- [ ] **Step 2: 三文件删私有副本改 import；DeviceModels.kt 加 pendingAlbumPath + mime()；八处调用点改引用**

ViewerScreen.kt 删 627-648 三私有函数；DeviceViewerScreen.kt 删 555-576；Theme.kt 删 91-95；各加 `import com.bluskysoftware.yandegallery.ui.common.findActivity` 等（Theme.kt 只需 findActivity）。

DeviceModels.kt 追加：

```kotlin
/** 待落地相册的固定落盘路径（六处构造点收敛，v0.8.1 A3）：`Pictures/<名>/`，名先 trim。 */
fun pendingAlbumPath(name: String): String = "Pictures/${name.trim()}/"

/** 分享用 mime（原 DeviceAlbumDetailScreen internal 件迁址，v0.8.1 A4）：视频通配，图片按扩展名。 */
fun DeviceMedia.mime(): String =
    if (isVideo) "video/*" else mimeOf(displayName.substringAfterLast('.', ""))
```

调用点逐处替换（grep `Pictures/` 复核零残留，`isWritableAlbumPath` 的前缀字面量除外）：
- DeviceAlbumsViewModel.kt:121 → `relativePath = pendingAlbumPath(name)`；89 → `pendingAlbumPath(it).trimEnd('/') in realPaths`
- DeviceAlbumPicker.kt:94 → `onPick(pendingAlbumPath(newName))`
- CopyTargetPicker.kt:152 → `onPickDeviceAlbum(pendingAlbumPath(newName))`
- DeviceViewerViewModel.kt:102 与 DeviceAlbumDetailViewModel.kt:175 → `pending.firstOrNull { pendingAlbumPath(it) == path }`
- DeviceAlbumDetailScreen.kt 删 299-302，import 改指 `data.device.mime`；DeviceViewerScreen.kt:161 引用随 import 解析（同包名函数迁包需显式 import）。

- [ ] **Step 3: 全量测试确认绿（重构保护网）**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；例数与 Task 2 结束时持平（零新增零删除）failures=0 errors=0。

- [ ] **Step 4: Commit**

```bash
git add android/app/src
git commit -m "refactor(android): A 类复用收敛一——系统栏三件套入 ui/common、pendingAlbumPath 六点归一、mime() 迁 DeviceModels"
```

---

### Task 4: A 类·手机相册节共享组件 + 过滤层级统一（A2 DeviceAlbumSection / A5 buildWritableTargets）

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumSection.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumPicker.kt`（改组合共享件）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/CopyTargetPicker.kt`（改组合共享件；DeviceCopyTargets.targets 改走 buildWritableTargets）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumsViewModel.kt`（+buildWritableTargets）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailViewModel.kt`（targetAlbums 改走 buildWritableTargets）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceViewerViewModel.kt`（albumTargets 改走 buildWritableTargets，删内联 filter）

**Interfaces:**
- Produces:
  - `DeviceAlbumSection.kt`：三件行组件（供两 picker 以各自宿主结构组合，桥接 LazyColumn item{} vs 嵌套 LazyColumn 的结构差异——**不抽整节**）：

```kotlin
/** 手机相册行（真实/待落地通用）：名称 + 待落地徽标 + 张数；tag 由调用方传入保留两侧既有命名。 */
@Composable
fun DeviceAlbumRow(album: DeviceAlbum, tag: String, onClick: () -> Unit)

/** 「新建相册」入口行。 */
@Composable
fun DeviceCreateRow(tag: String, onClick: () -> Unit)

/** 内联新建输入区（纵向堆叠——MiuiTextField 的 modifier 施加在内部 TextField 上，Row+weight 会塌陷，坑注释随迁）：
 *  确认回调返回错误文案（null=成功）；成功时以 pendingAlbumPath(name) 回调 onPicked 并复位输入态。 */
@Composable
fun DeviceCreateInline(nameTag: String, confirmTag: String, onCreate: (String) -> String?, onPicked: (String) -> Unit)
```

  - `DeviceAlbumsViewModel.kt`：`internal fun buildWritableTargets(realAlbums: List<DeviceAlbum>, pendingNames: Set<String>): List<DeviceAlbum> = buildTargetAlbums(realAlbums, pendingNames).filter { it.isPending || it.relativePath?.let(::isWritableAlbumPath) == true }`——目标候选与重名校验快照统一到「已过滤」层（终审 N3 收敛：与不可写 bucket 同名的新建，三入口一致拒绝）。
- Consumes: Task 3 的 `pendingAlbumPath`；既有 `buildTargetAlbums`/`isWritableAlbumPath`/`validateNewAlbumName`。

**零行为差例外声明**：A5 是**微行为统一**（非零差）——DeviceAlbumDetail/DeviceCopyTargets 两入口的重名校验从「含不可写 bucket」改为「不含」（与 DeviceViewer 对齐）。这是 spec H5 明示的唯一例外；两 picker 的**展示**候选原本就经 picker 侧过滤，展示零变化。三 VM 的 `lastTargetAlbums` 快照均改存过滤后列表。

- [ ] **Step 1: 写 DeviceAlbumSection 三件 + buildWritableTargets 的失败测试**

DeviceAlbumPickerTest 追加（新组件经既有 picker 间接钉 + 直测新建校验统一）：

```kotlin
@Test
fun `重名校验_与不可写bucket同名的新建被拒`() {
    // A5 统一后：Download/ 下的同名 bucket 也参与重名判定？——否。统一口径 = 校验对「可写候选」进行，
    // 不可写 bucket 不在候选、不参与重名；三入口一致（此前 DeviceViewer 已如此，另两入口对齐）
    val real = listOf(
        albumOf(1, "Pics", "Download/Pics/"),   // 不可写
        albumOf(2, "Cam", "DCIM/Cam/"),
    )
    val targets = buildWritableTargets(real, emptySet())
    assertEquals(listOf("Cam"), targets.map { it.name })   // Download 项不入候选
}
```

（三 VM 的 createTargetAlbum 行为经此纯函数 + 既有 VM 用例覆盖。）

- [ ] **Step 2: RED 确认（buildWritableTargets 未定义编译红）→ 实现 → 两 picker 改组合**

实现顺序：DeviceAlbumsViewModel 加 buildWritableTargets → 三 VM 目标方法改走它（DeviceViewerViewModel 删内联 filter）→ 建 DeviceAlbumSection.kt（行/入口/内联新建三件，函数体从 DeviceAlbumPicker.kt 76-157 逐字抽出，MiuiTextField 坑注释随迁）→ DeviceAlbumPicker 与 CopyTargetPicker device 节改组合三件（各自保留宿主结构与 testTag 字符串——tag 经参数传入，两侧命名 `device_pick_*`/`copy_picker_*` 不变）。

- [ ] **Step 3: 全量测试确认绿**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；两 picker 既有 16 条 UI 用例零改动全绿（组件抽取行为锁定证明）；+1 新用例。

- [ ] **Step 4: Commit**

```bash
git add android/app/src
git commit -m "refactor(android): A 类复用收敛二——手机相册节三件套共享组件、目标候选可写过滤统一到 buildWritableTargets"
```

---

### Task 5: C 类·RetryableAsyncImage 手势让位

**Files:**
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/RetryableAsyncImage.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/photos/PhotosScreen.kt`（395 行调用点 +gesturePassthrough）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/albums/AlbumDetailScreen.kt`（301 行同）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailScreen.kt`（DeviceMediaCell 326 行同）
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/common/RetryableAsyncImageTest.kt`（追加）

**Interfaces:**
- Produces: `RetryableAsyncImage(..., gesturePassthrough: Boolean = false)` 新尾参——true 时错误占位不挂 clickable（点击/长按透传给外层 SelectableCell）；false 保持现状。占位内部新增小号「重试」角标按钮（tag `image_error_retry_badge`），在 gesturePassthrough=true 时仍可单独点按重试（不占满格）。
- Consumes: `SelectableCell` combinedClickable（SelectionBars.kt:210-213，onLongClick 恒 onToggle）。

**语义矩阵（spec §3）**：
- 非多选（passthrough=false，默认）：整格点击=重试（现状保留）；**长按仍被吞是现状缺陷**——修法：占位 clickable 换成 `combinedClickable(onClick = onRetry, onLongClick = null)`？不行，null 不透传。实现取向：占位层不再自挂手势，改由**角标按钮**承载重试（badge 恒在）；整格点击/长按天然透传外层。三网格调用点传 `gesturePassthrough = true`；非网格调用点（ZoomableImage/SearchScreen/AlbumCardItem/DeviceAlbumsScreen 封面/DeviceViewer 海报）不传参保持旧行为（整格点击重试）。
- 多选：透传后点击=切选中、长按=进多选/切选中（SelectableCell 既有路由），重试仍走角标。

- [ ] **Step 1: 追加失败测试（RetryableAsyncImageTest）**

```kotlin
@Test
fun `gesturePassthrough时占位不消费点击_角标按钮承载重试`() {
    var retried = 0
    var outerClicked = 0
    compose.setContent {
        Box(Modifier.size(96.dp).clickable { outerClicked++ }) {
            RetryableAsyncImage(
                model = "http://x/fail.png", imageLoader = failingLoader(),
                contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize(),
                gesturePassthrough = true,
            )
        }
    }
    compose.waitUntil { compose.onAllNodesWithTag("image_error_placeholder").fetchSemanticsNodes().isNotEmpty() }
    compose.onNodeWithTag("image_error_placeholder").performClick()
    assertEquals(1, outerClicked)   // 点击透传外层
    assertEquals(0, retried)
    compose.onNodeWithTag("image_error_retry_badge").performClick()
    // 角标点按触发重试（failed 复位——以占位消失或 retryEpoch 变化断言，照该文件既有用例形态）
}

@Test
fun `默认passthrough为false保持整格点击重试`() {
    // 既有 `失败占位渲染且点按触发重试回调` 用例即此语义——确认不因新参回归即可（跑既有用例）
}
```

（failingLoader 用该文件既有 fake loader 装配；断言细节照 17 行既有用例。）

- [ ] **Step 2: RED → 实现（占位手势下沉角标）→ 三网格调用点传 true**

RetryableAsyncImage.kt 改造：`ImageErrorPlaceholder` 拆手势——`gesturePassthrough=false` 时 Column 保留 `clickable(onRetry)`（现状）；true 时 Column 无 clickable，右下角新增 `Box(Modifier.size(28.dp).clip(CircleShape).background(bg).clickable(onClick = onRetry).testTag("image_error_retry_badge"))` 内置刷新 icon。角标两态恒渲染（视觉一致），仅手势宿主随参切换。

- [ ] **Step 3: 全量测试确认绿**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；+2 用例；既有 `失败占位渲染且点按触发重试回调` 零改动仍绿。

- [ ] **Step 4: Commit**

```bash
git add android/app/src
git commit -m "fix(android): C 类手势让位——三网格失败格点击/长按透传可选中，重试下沉角标按钮"
```

---

### Task 6: D+E 类·导出防御与移动重建降级（D1 enqueue Boolean / D2 findCopy 守护 / E1 空选中放弃）

**Files:**
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/export/DeviceExportManager.kt`（enqueue 返 Boolean）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/photos/PhotosViewModel.kt`（exportSelectedToDevice 返 Boolean 语义上浮）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/albums/AlbumDetailViewModel.kt`（同）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/viewer/ViewerViewModel.kt`（exportToDevice 返 Boolean）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/photos/PhotosScreen.kt`（508-514 行 toast 分流）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/albums/AlbumDetailScreen.kt`（379-385 行同）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/viewer/ViewerScreen.kt`（348-352 行同）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/device/MediaStoreDeviceGateway.kt`（findCopy runCatching）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailScreen.kt`（moveLauncher 109-124 行空选中守护）
- Test: `PhotosViewModelTest.kt`、`DeviceActionsTest.kt`（或 DeviceAlbumDetailScreenTest）追加

**Interfaces:**
- Produces:
  - `DeviceExportManager.enqueue(serverId, imageIds, targetPath): Boolean`——包 runCatching { enqueueUniqueWork }，异常 false。
  - VM 层：`suspend fun exportSelectedToDevice(ids, targetPath): Boolean`（Photos/AlbumDetail——从 fire-and-forget 改为 suspend 返回；serverId null → false；任一批 enqueue false → false）；`ViewerViewModel.exportToDevice(imageId, targetPath): Boolean`。
  - `MediaStoreDeviceGateway.findCopy` 内 `runCatching { resolver.query(...)...  }.getOrNull()`——OEM 异常降级为查无副本（放行 insert），KDoc 注明。
- Consumes: 既有三 Screen onPickDeviceAlbum 块。

**E1 语义**：DeviceAlbumDetailScreen moveLauncher RESULT_OK 分支入口加 `if (viewModel.selection.selected.isEmpty()) return@rememberLauncherForActivityResult`（进程重建丢选中 → 静默放弃，不调 moveSelectedTo 不弹 snackbar）；DeviceViewerScreen 的 pendingMove plain remember 重建即 null 已天然放弃——确认现状加一行 KDoc，不改代码。

- [ ] **Step 1: 追加失败测试**

PhotosViewModelTest：

```kotlin
@Test
fun `导出_无激活服务器返回false不入队`() = runTest {
    clearActiveServer()   // 照该文件 seed 惯例反向清空
    val vm = PhotosViewModel(graph)
    assertFalse(vm.exportSelectedToDevice(listOf(1L), "Pictures/Yande/"))
    val infos = WorkManager.getInstance(context).getWorkInfosForUniqueWork("device-export-1").get()
    assertTrue(infos.isEmpty())
}
```

DeviceActionsTest（E1）：

```kotlin
@Test
fun `移动授权回调_空选中静默放弃不弹提示`() {
    // 进程重建丢选中场景：RESULT_OK 但 selection 空 → 不调 moveTo、无 snackbar（compose 断言无「已移动」文案）
    setDetailScreen(gateway)
    // 直接驱动 launcher 回调路径：授权前清空选中模拟重建（装配照该文件 launcher 测试惯例；
    // 若 launcher 结果不可直接驱动，则退化为 VM 级断言 moveSelectedTo 未被调用 + 快照无 snackbar）
}
```

（E1 测试若 Robolectric 下 launcher 回调不可靠，允许降级为「代码走查 + KDoc」并在报告注明——守护本体一行 if。）

- [ ] **Step 2: RED → 实现 D1/D2/E1 → toast 分流**

三 Screen 的 onPickDeviceAlbum 块改为：

```kotlin
onPickDeviceAlbum = { path ->
    showCopyPicker = false
    val ids = viewModel.selection.selected.toList()
    scope.launch {
        val ok = viewModel.exportSelectedToDevice(ids, path)
        if (ok) {
            viewModel.selection.clear()
            snackbarHostState.showSnackbar("已开始复制到手机相册")
        } else {
            snackbarHostState.showSnackbar("复制启动失败")   // 不清选择，可重试
        }
    }
},
```

（Viewer 单张同型无清选择。）

- [ ] **Step 3: 全量测试确认绿**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；+2 用例；F9 分块用例（Task 2）随签名改 suspend 需同步 await——该用例改动属接口跟随，允许。

- [ ] **Step 4: Commit**

```bash
git add android/app/src
git commit -m "fix(android): D+E 类防御——导出入队返回成败分流提示、findCopy OEM 异常降级、移动授权回调空选中静默放弃"
```

---

### Task 7: G 类·小 UX 批（G1 loading 态 / G2 防抖 / G3 auto-back / G4 加盐 / G5 settle 翻转 / G6 文档行）

**Files:**
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/CopyTargetPicker.kt`（+deviceLoading 参数）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/photos/PhotosScreen.kt`、`ui/albums/AlbumDetailScreen.kt`、`ui/viewer/ViewerScreen.kt`（G1 三宿主 loading 态接线；G3 ViewerScreen move 空清单 auto-back）
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/DebouncedClick.kt`（G2）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/SelectionBars.kt`（SelectionAction 184 行接防抖）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceSelectionBars.kt`（107 行同）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumSection.kt`（行组件接防抖——Task 4 产物）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/export/DeviceExportNotifier.kt`（G4 notifyCompleted +serverId 加盐）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/export/DeviceExportWorker.kt`（notifyCompleted 调用传 serverId）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceViewerScreen.kt`（G5 settle null 跳过清理，214-221 行）
- Modify: `docs/superpowers/plans/2026-07-05-M3实机联调计划.md`（G6：339 行全局退出标准补 §L）
- Test: `DeviceExportWorkerTest.kt`（G4）、`SelectionBarsTest.kt`（G2）追加

**Interfaces:**
- Produces:
  - `ui/common/DebouncedClick.kt`：`fun Modifier.debouncedClickable(enabled: Boolean = true, windowMs: Long = 300, onClick: () -> Unit): Modifier`（内部 remember 上次触发时间戳，窗口内吞点击；组合入 clickable）。
  - `CopyTargetPicker(..., deviceLoading: Boolean = false)`——true 时手机节显示「加载中…」行替代列表（不再闪旧快照）；三宿主打开 picker 时先 `deviceAlbums = emptyList(); deviceLoading = true`，加载完成落数据置 false。
  - `DeviceExportNotifier.notifyCompleted(serverId: Long, ok: Int, failed: Int, targetPath: String)`（签名+serverId）；Android 实现通知 id = `SUMMARY_NOTIFICATION_ID - (serverId % 64).toInt()`（占位 [-0x4559-63, -0x4559]，与全景 id 无撞）。
  - ViewerScreen（桌面）move 成功分支：`if (moved && listNowEmpty) onBack()`——对齐删除语义（listNowEmpty 以该 Screen 现有列表状态源判空，实现时以实际状态名为准）。
- Consumes: Task 4 的 DeviceAlbumSection（G2 行防抖）；锚点 §24 settle 块。

- [ ] **Step 1: 追加失败测试（G2 防抖 + G4 加盐）**

SelectionBarsTest：

```kotlin
@Test
fun `底栏动作_300ms内连点只触发一次`() {
    var fired = 0
    compose.setContent {
        SelectionBottomBar(online = true, inGallery = false,
            onDownload = { fired++ }, onShare = {}, onDelete = {}, onCopyTo = {})
    }
    compose.onNodeWithTag("selection_action_download").performClick()
    compose.onNodeWithTag("selection_action_download").performClick()   // 同帧连点
    compose.waitForIdle()
    assertEquals(1, fired)
}
```

DeviceExportWorkerTest（照既有 completedCalls fake，签名跟随 +serverId）：

```kotlin
@Test
fun `汇总通知_不同服务器id落不同通知位`() = runTest {
    // fake notifier 记录 (serverId, ok, failed, path)；两次不同 serverId 的 worker 跑完，
    // 断言 completedCalls 两条各携 serverId（id 加盐公式在 Android 实现内，worker 层只验参数传递）
}
```

- [ ] **Step 2: RED → 实现六项**

- G5（一行翻转，DeviceViewerScreen.kt:218-220）：

```kotlin
}.collect { settledId ->
    // 快照瞬空（invalidate 重拉窗口）时跳过清理——避免放大态被外部 MediaStore 脉冲误清（终审复核裁定）
    if (settledId == null) return@collect
    zoomStates.keys.filter { it != settledId }.forEach { zoomStates.remove(it) }
}
```

- G6（联调计划 339 行）：`**退出标准：** A-I 节全部 ✅ ...` → `**退出标准：** A-I 节与 L 节全部 ✅ ...`（其余不动）。
- G1/G2/G4 按 Interfaces 块实现；G3 在 ViewerScreen move 成功分支后接列表判空 auto-back。

- [ ] **Step 3: 全量测试确认绿**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；+2 用例；G4 签名改动波及的既有两条汇总用例做接口跟随修正（断言值不变仅参数位移）。

- [ ] **Step 4: Commit**

```bash
git add android/app/src docs/superpowers/plans/2026-07-05-M3实机联调计划.md
git commit -m "fix(android): G 类小 UX 批——picker 加载态、底栏防抖、桌面 Viewer 移空返回、汇总通知按服务器加盐、settle 瞬空跳过清理、联调退出标准补 §L"
```

---

### Task 8: B 类·DeviceCopyWorker 三件套（手机→手机批量复制 WorkManager 化）

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/copy/DeviceCopyWorker.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/copy/DeviceCopyManager.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/export/DeviceExportNotifier.kt`（+复制域进度/汇总方法或泛化——见 Interfaces）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/download/AppWorkerFactory.kt`（+分支）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/di/AppGraph.kt`（+deviceCopyManager lazy）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailViewModel.kt`（copySelectedTo 改入队；收编逻辑迁 worker）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailScreen.kt`（COPY 分支改 toast「已开始复制到手机相册」+清选择）
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/domain/copy/DeviceCopyWorkerTest.kt`（新）

**Interfaces:**
- Consumes: `DeviceMediaGateway.mediaByIds/insertCopy/findCopy`、`PrefsStore.devicePendingAlbums/removePendingAlbum`、`pendingAlbumPath`（Task 3）、`isDiskFull()`（DeviceExportWorker.kt:138-147 internal——**迁至 domain/copy/DiskFull.kt 或保留原址跨包 internal 引用均可，实施者依可见性定，报告注明**）、`DeviceCopyTargets.EXPORT_BATCH`（分块常量复用，KDoc 注明双域共用）。
- Produces:

```kotlin
class DeviceCopyWorker(
    context: Context, params: WorkerParameters,
    private val mediaByIds: suspend (List<Long>) -> List<DeviceMedia>,
    private val insertCopy: suspend (DeviceSource, String) -> kotlin.Result<Uri>,
    private val findCopy: suspend (String, String) -> Uri?,
    private val removePendingIfMatch: suspend (targetPath: String) -> Unit,   // 收编：worker 成功≥1 张时调
    private val notifier: DeviceExportNotifier,
    private val timeMs: () -> Long = { System.currentTimeMillis() },
) : CoroutineWorker(context, params)
// companion: KEY_MEDIA_IDS = "mediaIds"; KEY_TARGET_PATH = "targetPath"; KEY_FAILED_COUNT = "failedCount"

class DeviceCopyManager(private val context: Context) {
    /** 入队（>EXPORT_BATCH 自动分块多批；runCatching 包裹）；false=入队失败。唯一工作名 device-copy，APPEND_OR_REPLACE，无网络约束，EXPONENTIAL 10s。 */
    fun enqueue(mediaIds: List<Long>, targetPath: String): Boolean
}
```

- doWork 结构（镜像 DeviceExportWorker 去掉 ensure 半程与切服检查）：入参校验→failure；`mediaByIds` 还原（查无的 id 计失败——源已删）；逐张 `findCopy(path, media.displayName)` 命中跳过计成功 → `insertCopy(DeviceSource.Media(media), path)`：成功 ok++；失败 `isDiskFull()` → `Result.retry()`，否则 failed++（**本机 IO 无瞬时网络错，无 retryable 桶**）；进度经 notifier 节流；尾：成功≥1 调 removePendingIfMatch(targetPath)；failed>0 发汇总；`Result.success(workDataOf(KEY_FAILED_COUNT to failed))`。
- 通知：复用 `device_export` channel（名「复制到手机相册」语义已通用）；notifier 接口泛化——现有 `foregroundInfo`/`notifyCompleted` 增加可选 `progressId: Int = NOTIFICATION_ID` / `summaryId: Int = ...` 参数或新增平行方法 `copyForegroundInfo`/`notifyCopyCompleted`（实施者取其一，id 用 Global Constraints 的 -0x4650/-0x4651），fake 同步。
- VM/Screen 改造：`DeviceAlbumDetailViewModel.copySelectedTo(path)` 改为 `fun copySelectedTo(path: String): Boolean = deviceCopyManager.enqueue(selection.selected.toList(), path)`（同步收编逻辑删除——迁 worker 的 removePendingIfMatch）；Screen COPY 分支改：

```kotlin
DevicePickerMode.COPY -> {
    val ok = viewModel.copySelectedTo(path)
    scope.launch {
        if (ok) { viewModel.selection.clear(); snackbarHostState.showSnackbar("已开始复制到手机相册") }
        else snackbarHostState.showSnackbar("复制启动失败")
    }
}
```

  **大图页单张 `DeviceViewerViewModel.copyTo` 保持同步不动**（spec H2）。

- [ ] **Step 1: 写 DeviceCopyWorkerTest 失败测试（六条，装配照 DeviceExportWorkerTest 65-94 行 TestListenableWorkerBuilder + lambda fakes + 统一 call log）**

```kotlin
@Test fun `全成功_先查后插_失败计数0`()            // 3 张；calls 交错序 find→insert；outputData failedCount=0
@Test fun `查重命中跳过计成功`()                    // landed 预置 1 张；insert 仅 2 次；failedCount=0
@Test fun `源已删_mediaByIds缺项计失败继续`()        // ids 3 个还原 2 条；failedCount=1；insert 2 次
@Test fun `insert侧ENOSPC_整批retry`()             // insertResult=failure(ErrnoException ENOSPC 链)；Result.retry
@Test fun `部分失败_发汇总通知`()                   // 1 张 insert 失败；notifyCompleted(-, ok=2, failed=1, path) 恰一次
@Test fun `成功后目标为待落地路径_触发收编回调`()      // removePendingIfMatch 收到 targetPath 恰一次；全失败时不调
```

（每条完整装配照 DeviceExportWorkerTest 同名形态成对翻译；无 serverId/切服/ensure 相关旋钮。）

- [ ] **Step 2: RED（类未定义编译红）确认**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD FAILED（Unresolved reference DeviceCopyWorker）。

- [ ] **Step 3: 实现三件套 + 工厂/Graph 接线 + VM/Screen 改造（按 Interfaces 块）**

- [ ] **Step 4: 全量测试确认绿**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；+6 用例；DeviceActionsTest 既有 `复制到_逐张insert_计数成功数` 等同步复制用例改造为入队断言（接口跟随，断言语义等价迁移，删除的同步语义用例数在报告列明）。

- [ ] **Step 5: Commit**

```bash
git add android/app/src
git commit -m "feat(android): B 类批量复制 WorkManager 化——DeviceCopyWorker 三件套，离屏/杀进程可续跑，查重防重复，失败汇总通知"
```

---

### Task 9: 收尾——版本 / README / spec 状态 / 全量回归 / 真机冒烟

**Files:**
- Modify: `android/app/build.gradle.kts:17-18`（versionCode 10 / versionName "0.8.1"）
- Modify: `android/README.md`（§11 末尾追加「v0.8.1 加固」小节；顺手把 477 行「528 例」更正为当前实测数）
- Modify: `doc/superpowers/specs/2026-07-21-device-albums-hardening-design.md`（状态行 → ✅ 已实施（日期））
- Modify: `docs/superpowers/plans/2026-07-05-M3实机联调计划.md`（§L 追加 L.8 加固轮冒烟行：批量复制离屏续跑）

**Interfaces:** Consumes 全部前置任务。Produces 可发布状态。

- [ ] **Step 1: 版本 bump + 三文档更新**

README「v0.8.1 加固」小节内容：七类修复一段一行（A 收敛清单/B worker 化行为说明——离屏杀进程可续、C 失败格可选中重试走角标、D 启动失败有提示、E 重建静默放弃、F 补强数、G 各项）；验证行写实测例数。

- [ ] **Step 2: 安卓全量回归**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；聚合 failures=0 errors=0；例数 ≥555（530 基线 + F 类 ~16 + C/D/G/B 新增 ~11，实测为准写进 README）。

- [ ] **Step 3: 桌面 gate 防漂移**

Run: 仓库根 `npm run test`
Expected: typecheck + vitest 全绿（本轮桌面零改动；若渲染层出现与本分支无关的既有 flake，以 `git diff master..HEAD -- src/` 为空为准记录为预存）。

- [ ] **Step 4: assembleDebug + 真机冒烟（B 类验收，spec §7）**

Run: `cmd //c "D:\Android\gw.bat :app:assembleDebug --console=plain"`
装 MuMu（若 adb 已恢复；否则红魔）：批量复制 30 张 → 复制中离屏/杀进程 → 回来确认复制完成且目标相册无重复（findCopy 查重生效）。截图留证 `.superpowers/sdd/`。真机不可用则此步标 BLOCKED 交人工，不阻提交。

- [ ] **Step 5: Commit**

```bash
git add android/app/build.gradle.kts android/README.md doc/superpowers/specs/2026-07-21-device-albums-hardening-design.md docs/superpowers/plans/2026-07-05-M3实机联调计划.md
git commit -m "chore(android): v0.8.1 收尾——版本号、README 加固小节、spec 状态与联调 L.8 冒烟项"
```

---

## 任务依赖图

```
T1(F 纯函数层) → T2(F VM/UI 层) → T3(A 工具收敛) → T4(A 组件收敛+过滤统一)
T4 → T5(C 手势) → T6(D+E 防御) → T7(G 小 UX 批) → T8(B copy worker) → T9(收尾)
（严格串行：F 先锁行为，A 在保护下重构，B 依赖 T3 pendingAlbumPath/T7 notifier 泛化基建）
```

## 真机项（无头环境无法覆盖，T9 冒烟 + 后续人工）

批量复制离屏/杀进程续跑观感、防抖真机手感、失败格角标可点面积、汇总通知多服务器并发观感。

