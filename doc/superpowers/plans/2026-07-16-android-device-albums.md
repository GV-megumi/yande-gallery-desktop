# 安卓本机相册（手机相册 tab）与复制/移动体系 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec `doc/superpowers/specs/2026-07-16-android-device-albums-design.md`——底导第三 tab「手机相册」（MediaStore bucket 列表/网格/大图、视频一等公民、分享/删除/复制/移动/新建相册），并把桌面域「加入相册」升级为跨域「复制到」、新增桌面域「移动到」与桌面→手机导出。

**Architecture:** 手机域是纯 MediaStore 实时读（不进 Room）：`data/device/` 提供 `DeviceMediaGateway` 接口缝（查询聚合 + 分页 + ContentObserver + 写操作），`ui/device/` 三个页面全部经 fake 网关可 Robolectric 全测。跨域动作复用既有件：复制/移动到桌面相册走 `WriteRepository`（新增 moveToGallery 补偿回滚），桌面→手机导出走 `ImageMirrorStore.ensure(ORIGINAL)` + 网关 insert 的 WorkManager worker。版本门控收敛在 `DeviceCapabilities` 单点。

**Tech Stack:** Kotlin / Jetpack Compose / MediaStore / Paging 3 / WorkManager / Coil3(+coil-video) / DataStore / Robolectric。桌面端**零改动**。

## Global Constraints

- 桌面端零代码改动；收尾任务跑一次 `npm run test` 防漂移。
- 安卓 minSdk 26 / targetSdk 35；收尾任务统一 bump versionCode 9 / versionName "0.8.0"。
- 门控矩阵唯一判定点 `DeviceCapabilities`（spec §7）：26–28 浏览+分享；29+ 复制/新建相册；30+ 删除/移动。不可用 = 入口**隐藏**（不是置灰）。
- 手机域纯 MediaStore 实时读，**不进 Room**；待落地相册 = DataStore stringSet 键 `device_pending_albums`（只存名称，目录恒 `Pictures/<名称>/`）。
- bucketKey 路由编码（spec §2.2）：`all` / `b<BUCKET_ID>` / `p<URL编码名称>`。
- 复制/移动目标限 relativePath 前缀 `DCIM/` 或 `Pictures/`；删除 = `createDeleteRequest` 永久删；移动 = `createWriteRequest` 授权后更新 `RELATIVE_PATH`。
- 命名前缀 `Device*`（`local` 已被镜像域占用）；新包 `data/device/`、`domain/export/`、`ui/device/`；testTag 前缀 `device_`。
- 「加入相册」全局改名「复制到」：testTag `selection_action_add_to_gallery`→`selection_action_copy_to`、`viewer_menu_add_to_gallery`→`viewer_menu_copy_to`，既有测试断言同步迁移。
- 视觉取 `MiuiTokens`（3dp 网格缝、3dp 格圆角、12dp 封面圆角）；弹窗一律 `MiuiDialog`；顶栏用 `MiuiPinnedTopBar`/`MiuiLargeTitle`/`MiuiSubPageTopBar`。
- 手机相册 tab 不依赖服务器配对，离线/未配对功能完整。
- 安卓测试命令（本机）：仓库根执行 `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"` **全量跑**（`--tests` 过滤器在本机是坏的）；结果核对 `android/app/build/test-results/testDebugUnitTest/TEST-*.xml`（failures/errors=0）。
- commit message 中文，类型前缀英文；当前分支 `feature/android-device-albums`。

## 文件结构总览

**新建（主源）**
- `data/device/DeviceCapabilities.kt` — 门控矩阵 + 权限清单/访问级别纯函数
- `data/device/DeviceModels.kt` — DeviceMedia/DeviceAlbum/BucketKey 编解码/排序/校验/时长格式化
- `data/device/DeviceMediaGateway.kt` — 网关接口
- `data/device/MediaStoreDeviceGateway.kt` — MediaStore 真实现（查询/分页/observer/写操作）
- `domain/export/DeviceExportWorker.kt`、`DeviceExportManager.kt`、`DeviceExportNotifier.kt` — 桌面→手机导出
- `ui/device/DeviceAlbumsViewModel.kt`、`DeviceAlbumsScreen.kt` — 相册列表页（含引导页/部分授权横幅/新建）
- `ui/device/DeviceAlbumDetailViewModel.kt`、`DeviceAlbumDetailScreen.kt` — 相册网格页
- `ui/device/DeviceViewerViewModel.kt`、`DeviceViewerScreen.kt`、`DeviceViewerActionBar.kt` — 本机大图页
- `ui/device/DeviceSelectionBars.kt` — 手机域多选底栏
- `ui/device/DeviceAlbumPicker.kt` — 手机相册目标选择（含新建行，跨域共用）
- `ui/common/CopyTargetPicker.kt` — 桌面域「复制到/移动到」两节选择器（替换 GalleryPickerDialog）

**修改**
- `AndroidManifest.xml`（读权限）、`gradle/libs.versions.toml` + `app/build.gradle.kts`（coil-video）
- `data/prefs/PrefsStore.kt`（device_pending_albums）
- `di/AppGraph.kt`（deviceMediaGateway/deviceLoader/deviceExportManager）
- `domain/write/WriteRepository.kt`（moveToGallery）、`ui/common/SelectionActions.kt`（moveToGallery 委托）
- `ui/AppNav.kt`（第三 tab + 3 路由）、`MainActivity.kt`（接线）
- `ui/common/SelectionBars.kt`、`ui/common/PhotosSelectionBars.kt`、`ui/viewer/ViewerActionBar.kt`（复制到改名 + 移动到入口）
- `ui/photos/PhotosScreen.kt`/`PhotosViewModel.kt`、`ui/albums/AlbumDetailScreen.kt`/`AlbumDetailViewModel.kt`、`ui/viewer/ViewerScreen.kt`/`ViewerViewModel.kt`（选择器替换 + 导出触发 + 移动）
- `domain/download/AppWorkerFactory.kt`（DeviceExportWorker 分支）
- `android/README.md`、`docs/superpowers/plans/2026-07-05-M3实机联调计划.md`（§L）

**删除**
- `ui/common/GalleryPickerDialog.kt` 与其测试（被 CopyTargetPicker 吸收）

---

### Task 1: 依赖 + 清单权限 + DeviceCapabilities 门控纯函数

**Files:**
- Modify: `android/gradle/libs.versions.toml`、`android/app/build.gradle.kts`、`android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/device/DeviceCapabilities.kt`
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/data/device/DeviceCapabilitiesTest.kt`

**Interfaces:**
- Consumes: 无（纯新增）。
- Produces: `DeviceCapabilities.canCopy/canCreateAlbum/canDelete/canMove(sdk): Boolean`、`readPermissions(sdk): List<String>`、`accessLevelOf(sdk, granted: Set<String>): DeviceAccessLevel`、`enum DeviceAccessLevel { FULL, PARTIAL, DENIED }`（后续所有 UI 门控/权限任务消费）。

- [ ] **Step 1: 写失败测试**

新建 `DeviceCapabilitiesTest.kt`（纯 JUnit，sdk 显式入参，无需 Robolectric）：

```kotlin
package com.bluskysoftware.yandegallery.data.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** spec §7 门控矩阵 + §3 权限模型的纯函数面。 */
class DeviceCapabilitiesTest {
    @Test
    fun `门控矩阵_26到28只读_29可复制_30全功能`() {
        assertFalse(DeviceCapabilities.canCopy(28))
        assertTrue(DeviceCapabilities.canCopy(29))
        assertFalse(DeviceCapabilities.canDelete(29))
        assertTrue(DeviceCapabilities.canDelete(30))
        assertFalse(DeviceCapabilities.canMove(29))
        assertTrue(DeviceCapabilities.canMove(30))
        // 新建相册与复制同门（spec §2.3：26–28 无法落文件，占位永不落地）
        assertFalse(DeviceCapabilities.canCreateAlbum(28))
        assertTrue(DeviceCapabilities.canCreateAlbum(29))
    }

    @Test
    fun `权限清单按版本分段`() {
        assertEquals(listOf(DeviceCapabilities.READ_EXTERNAL_STORAGE), DeviceCapabilities.readPermissions(32))
        assertEquals(
            listOf(DeviceCapabilities.READ_MEDIA_IMAGES, DeviceCapabilities.READ_MEDIA_VIDEO),
            DeviceCapabilities.readPermissions(33),
        )
        assertTrue(DeviceCapabilities.READ_MEDIA_VISUAL_USER_SELECTED in DeviceCapabilities.readPermissions(34))
    }

    @Test
    fun `访问级别_全量_部分_拒绝`() {
        val bothMedia = setOf(DeviceCapabilities.READ_MEDIA_IMAGES, DeviceCapabilities.READ_MEDIA_VIDEO)
        assertEquals(DeviceAccessLevel.FULL, DeviceCapabilities.accessLevelOf(34, bothMedia))
        assertEquals(
            DeviceAccessLevel.PARTIAL,
            DeviceCapabilities.accessLevelOf(34, setOf(DeviceCapabilities.READ_MEDIA_VISUAL_USER_SELECTED)),
        )
        assertEquals(DeviceAccessLevel.DENIED, DeviceCapabilities.accessLevelOf(34, emptySet()))
        assertEquals(
            DeviceAccessLevel.FULL,
            DeviceCapabilities.accessLevelOf(30, setOf(DeviceCapabilities.READ_EXTERNAL_STORAGE)),
        )
        assertEquals(DeviceAccessLevel.DENIED, DeviceCapabilities.accessLevelOf(30, emptySet()))
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD FAILED（编译错，`DeviceCapabilities` 未定义）。

- [ ] **Step 3: 实现 DeviceCapabilities**

```kotlin
package com.bluskysoftware.yandegallery.data.device

import android.os.Build

/** 手机域访问级别（spec §3）：34+ 可能处于「部分照片」授权。 */
enum class DeviceAccessLevel { FULL, PARTIAL, DENIED }

/**
 * 门控矩阵唯一判定点（spec §7）：分界线是「要不要动本机文件」——
 * 26–28 浏览+分享；29+ 复制/新建（自有新文件免权限落盘）；30+ 删除/移动
 * （createDeleteRequest/createWriteRequest 是 30+ API）。不可用 = 入口隐藏（不是置灰）。
 */
object DeviceCapabilities {
    const val READ_MEDIA_IMAGES = "android.permission.READ_MEDIA_IMAGES"
    const val READ_MEDIA_VIDEO = "android.permission.READ_MEDIA_VIDEO"
    const val READ_MEDIA_VISUAL_USER_SELECTED = "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
    const val READ_EXTERNAL_STORAGE = "android.permission.READ_EXTERNAL_STORAGE"

    fun canCopy(sdk: Int = Build.VERSION.SDK_INT): Boolean = sdk >= 29

    /** 新建相册与复制同门（spec §2.3：26–28 建了也永远无法落地）。 */
    fun canCreateAlbum(sdk: Int = Build.VERSION.SDK_INT): Boolean = canCopy(sdk)

    fun canDelete(sdk: Int = Build.VERSION.SDK_INT): Boolean = sdk >= 30

    fun canMove(sdk: Int = Build.VERSION.SDK_INT): Boolean = sdk >= 30

    /** 运行时申请清单：33+ 双媒体权限（34+ 追加部分授权项），26–32 旧读权限。 */
    fun readPermissions(sdk: Int = Build.VERSION.SDK_INT): List<String> = when {
        sdk >= 34 -> listOf(READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_VISUAL_USER_SELECTED)
        sdk >= 33 -> listOf(READ_MEDIA_IMAGES, READ_MEDIA_VIDEO)
        else -> listOf(READ_EXTERNAL_STORAGE)
    }

    /**
     * 授权结果 → 访问级别（spec §3）：33+ 双媒体权限齐 = FULL；34+ 仅部分授权项 = PARTIAL
     * （FULL 分支先判，双权限齐时不误报 PARTIAL）；26–32 旧读权限 = FULL；其余 DENIED。
     */
    fun accessLevelOf(sdk: Int, granted: Set<String>): DeviceAccessLevel = when {
        sdk >= 33 && READ_MEDIA_IMAGES in granted && READ_MEDIA_VIDEO in granted -> DeviceAccessLevel.FULL
        sdk >= 34 && READ_MEDIA_VISUAL_USER_SELECTED in granted -> DeviceAccessLevel.PARTIAL
        sdk in 26..32 && READ_EXTERNAL_STORAGE in granted -> DeviceAccessLevel.FULL
        else -> DeviceAccessLevel.DENIED
    }
}
```

- [ ] **Step 4: 清单权限 + coil-video 依赖**

`AndroidManifest.xml` 在 `ACCESS_NETWORK_STATE` 权限行后追加：

```xml
    <!-- 手机相册 tab（本机相册 spec §3）：本机媒体读取；33+ 细分图片/视频，34+ 部分授权，26–32 旧读权限 -->
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    <uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
```

`gradle/libs.versions.toml` 在 `coil-network-okhttp` 行后追加：

```toml
coil-video = { group = "io.coil-kt.coil3", name = "coil-video", version.ref = "coil" }
```

`app/build.gradle.kts` 在 `implementation(libs.coil.network.okhttp)` 后追加：

```kotlin
    implementation(libs.coil.video)
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；`TEST-com.bluskysoftware.yandegallery.data.device.DeviceCapabilitiesTest.xml` failures=0。

- [ ] **Step 6: Commit**

```bash
git add android/gradle/libs.versions.toml android/app/build.gradle.kts android/app/src/main/AndroidManifest.xml android/app/src/main/java/com/bluskysoftware/yandegallery/data/device/DeviceCapabilities.kt android/app/src/test/java/com/bluskysoftware/yandegallery/data/device/DeviceCapabilitiesTest.kt
git commit -m "feat(android): 手机相册基建——媒体读权限、门控矩阵纯函数与 coil-video 依赖"
```

### Task 2: 手机域模型 + bucketKey 编解码 + 排序/校验纯函数

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/device/DeviceModels.kt`
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/data/device/DeviceModelsTest.kt`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `data class DeviceMedia(val mediaId: Long, val uri: android.net.Uri, val isVideo: Boolean, val displayName: String, val relativePath: String, val width: Int, val height: Int, val sizeBytes: Long, val takenAtMs: Long, val durationMs: Long?)`
  - `data class DeviceAlbum(val key: BucketKey, val name: String, val relativePath: String?, val count: Int, val coverUri: android.net.Uri?, val isPending: Boolean)`
  - `sealed interface BucketKey { data object All; data class Bucket(val bucketId: Long); data class Pending(val name: String) }` + `BucketKey.encode(): String` / `companion decode(raw: String): BucketKey?`
  - `sortDeviceAlbums(albums: List<DeviceAlbum>): List<DeviceAlbum>`、`isWritableAlbumPath(relativePath: String): Boolean`、`validateNewAlbumName(name: String, existingNames: Set<String>): String?`（返回 null=合法，非 null=错误文案）、`formatDurationMs(ms: Long): String`

- [ ] **Step 1: 写失败测试**

```kotlin
package com.bluskysoftware.yandegallery.data.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class DeviceModelsTest {
    @Test
    fun `bucketKey_三态编解码往返`() {
        assertEquals("all", BucketKey.All.encode())
        assertEquals("b42", BucketKey.Bucket(42L).encode())
        assertEquals(BucketKey.All, BucketKey.decode("all"))
        assertEquals(BucketKey.Bucket(42L), BucketKey.decode("b42"))
        // 待落地相册名 raw 往返（含中文/空格/加号——URI 转义交给 navigate 侧 Uri.encode，
        // Navigation 层收参时自动解码一次，这里若再做 URL 编解码会双重解码把 + 错转空格）
        val pending = BucketKey.Pending("我的 相册+1")
        assertEquals(pending, BucketKey.decode(pending.encode()))
        assertNull(BucketKey.decode("bogus"))
        assertNull(BucketKey.decode("bNotANumber"))
    }

    @Test
    fun `相册排序_相机截图置顶_其余按张数降序_待落地垫底`() {
        fun album(name: String, path: String?, count: Int, pending: Boolean = false) = DeviceAlbum(
            key = if (pending) BucketKey.Pending(name) else BucketKey.Bucket(name.hashCode().toLong()),
            name = name, relativePath = path, count = count, coverUri = null, isPending = pending,
        )
        val sorted = sortDeviceAlbums(
            listOf(
                album("WeChat", "Pictures/WeChat/", 500),
                album("新相册", null, 0, pending = true),
                album("Camera", "DCIM/Camera/", 100),
                album("小图", "Pictures/小图/", 3),
                album("Screenshots", "Pictures/Screenshots/", 50),
            ),
        )
        assertEquals(listOf("Camera", "Screenshots", "WeChat", "小图", "新相册"), sorted.map { it.name })
    }

    @Test
    fun `目标目录校验_仅DCIM与Pictures前缀`() {
        assertTrue(isWritableAlbumPath("DCIM/Camera/"))
        assertTrue(isWritableAlbumPath("Pictures/WeChat/"))
        assertFalse(isWritableAlbumPath("Download/"))
        assertFalse(isWritableAlbumPath("Movies/x/"))
    }

    @Test
    fun `新建相册名校验_非法字符与重名拒绝`() {
        assertNull(validateNewAlbumName("旅行 2026", emptySet()))
        assertNotNull(validateNewAlbumName("", emptySet()))
        assertNotNull(validateNewAlbumName("  ", emptySet()))
        assertNotNull(validateNewAlbumName("a/b", emptySet()))     // 路径分隔符
        assertNotNull(validateNewAlbumName("a\\b", emptySet()))
        assertNotNull(validateNewAlbumName("x:y", emptySet()))
        assertNotNull(validateNewAlbumName("Camera", setOf("Camera")))  // 重名
    }

    @Test
    fun `视频时长格式化`() {
        assertEquals("0:07", formatDurationMs(7_000))
        assertEquals("1:05", formatDurationMs(65_000))
        assertEquals("1:00:01", formatDurationMs(3_601_000))
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD FAILED（编译错，符号未定义）。

- [ ] **Step 3: 实现 DeviceModels**

```kotlin
package com.bluskysoftware.yandegallery.data.device

import android.net.Uri

/** 本机媒体（spec §4.2）：MediaStore 一行的内存态投影，非 Room Entity。 */
data class DeviceMedia(
    val mediaId: Long,
    val uri: Uri,
    val isVideo: Boolean,
    val displayName: String,
    val relativePath: String,
    val width: Int,
    val height: Int,
    val sizeBytes: Long,
    val takenAtMs: Long,          // DATE_TAKEN ?: DATE_MODIFIED*1000（网关侧收敛）
    val durationMs: Long?,        // 仅视频
)

/** 手机相册（spec 术语「手机相册」；isPending = 待落地相册，relativePath 恒非 null）。 */
data class DeviceAlbum(
    val key: BucketKey,
    val name: String,
    val relativePath: String?,    // 真实 bucket 取自成员行；待落地 = Pictures/<名称>/
    val count: Int,
    val coverUri: Uri?,
    val isPending: Boolean,
)

/**
 * 相册网格页上下文三态（spec §2.2）：路由字符串编码 `all` / `b<BUCKET_ID>` / `p<名称>`。
 * encode/decode 是 raw 往返（名称不做 URL 编解码）：URI 层转义收敛在 Routes 构造函数的
 * `Uri.encode`（对照 Routes.search 先例），Navigation 收参自动解码一次——这里再编解码会双重解码。
 */
sealed interface BucketKey {
    data object All : BucketKey
    data class Bucket(val bucketId: Long) : BucketKey
    data class Pending(val name: String) : BucketKey

    fun encode(): String = when (this) {
        All -> "all"
        is Bucket -> "b$bucketId"
        is Pending -> "p$name"
    }

    companion object {
        fun decode(raw: String): BucketKey? = when {
            raw == "all" -> All
            raw.startsWith("b") -> raw.drop(1).toLongOrNull()?.let { Bucket(it) }
            raw.startsWith("p") -> Pending(raw.drop(1))
            else -> null
        }
    }
}

/**
 * 相册列表排序（spec §4.3）：相机（DCIM/Camera）→ 截图（*/Screenshots）置顶，
 * 其余按张数降序（同数按名称稳定），待落地相册垫底。
 */
fun sortDeviceAlbums(albums: List<DeviceAlbum>): List<DeviceAlbum> {
    fun rank(a: DeviceAlbum): Int = when {
        a.isPending -> 3
        a.relativePath?.startsWith("DCIM/Camera") == true -> 0
        a.relativePath?.trimEnd('/')?.endsWith("Screenshots") == true -> 1
        else -> 2
    }
    return albums.sortedWith(compareBy({ rank(it) }, { -it.count }, { it.name }))
}

/** 复制/移动目标目录约束（spec §5.3）：三方写入限 DCIM/ 与 Pictures/ 下。 */
fun isWritableAlbumPath(relativePath: String): Boolean =
    relativePath.startsWith("DCIM/") || relativePath.startsWith("Pictures/")

/** 新建相册名校验（spec §5.5）：空白/路径与文件系统保留字符/重名拒绝；返回错误文案，null=合法。 */
fun validateNewAlbumName(name: String, existingNames: Set<String>): String? {
    val trimmed = name.trim()
    if (trimmed.isEmpty()) return "名称不能为空"
    if (trimmed.any { it in "\\/:*?\"<>|" }) return "名称含有非法字符"
    if (trimmed in existingNames) return "已存在同名相册"
    return null
}

/** 视频时长角标文案：m:ss，≥1h 为 h:mm:ss。 */
fun formatDurationMs(ms: Long): String {
    val totalSec = ms / 1000
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；DeviceModelsTest failures=0。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/data/device/DeviceModels.kt android/app/src/test/java/com/bluskysoftware/yandegallery/data/device/DeviceModelsTest.kt
git commit -m "feat(android): 手机域模型——DeviceMedia/DeviceAlbum、bucketKey 三态编解码与排序校验纯函数"
```

### Task 3: DeviceMediaGateway 接口 + MediaStore 实现 + 待落地相册偏好

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/device/DeviceMediaGateway.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/device/MediaStoreDeviceGateway.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/data/prefs/PrefsStore.kt`
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/data/device/MediaStoreDeviceGatewayTest.kt`、`android/app/src/test/java/com/bluskysoftware/yandegallery/data/prefs/PrefsStoreDeviceTest.kt`

**Interfaces:**
- Consumes: Task 2 全部模型；`PrefsStore` 既有 `safeData`/`dataStore.edit` 惯例。
- Produces（后续 VM/worker 全部只依赖此接口，测试注入 fake）:

```kotlin
interface DeviceMediaGateway {
    suspend fun queryAlbums(): List<DeviceAlbum>                       // 真实 bucket 聚合（不含待落地，不排序）
    fun pagingSource(key: BucketKey): PagingSource<Int, DeviceMedia>   // 网格分页（时间倒序）
    suspend fun mediaByIds(ids: List<Long>): List<DeviceMedia>
    fun observeChanges(): Flow<Unit>                                   // ContentObserver 变更脉冲
    suspend fun insertCopy(source: DeviceSource, targetRelativePath: String): Result<Uri>
    fun deleteRequest(uris: List<Uri>): PendingIntent                   // createDeleteRequest（30+ 调用方门控）
    fun writeRequest(uris: List<Uri>): PendingIntent                    // createWriteRequest（30+ 调用方门控）
    suspend fun moveTo(uris: List<Uri>, targetRelativePath: String): Result<Int>  // 授权后更新 RELATIVE_PATH
}
sealed interface DeviceSource {                                        // 复制源二态（spec §5.3/§6.1）
    data class Media(val media: DeviceMedia) : DeviceSource            // 手机→手机
    data class LocalFile(val file: java.io.File, val displayName: String, val mime: String) : DeviceSource  // 桌面→手机（镜像文件）
}
```

- `PrefsStore` 新增：`val devicePendingAlbums: Flow<Set<String>>`、`suspend fun addPendingAlbum(name: String)`、`suspend fun removePendingAlbum(name: String)`（键 `stringSetPreferencesKey("device_pending_albums")`，默认空集）。

**实现要点（MediaStoreDeviceGateway，构造参数 `(context: Context)`）：**
- 查询统一走 `MediaStore.Files.getContentUri("external")`，selection `MEDIA_TYPE IN (MEDIA_TYPE_IMAGE, MEDIA_TYPE_VIDEO)`；列：`_ID, BUCKET_ID, BUCKET_DISPLAY_NAME, RELATIVE_PATH, DISPLAY_NAME, MIME_TYPE, MEDIA_TYPE, WIDTH, HEIGHT, SIZE, DATE_TAKEN, DATE_MODIFIED, DURATION`。26–28 无 `RELATIVE_PATH` 列（29+）——`Build.VERSION.SDK_INT < 29` 时该列不进 projection，行内回退用 `DATA` 路径推导 `relativePath`（截 `/storage/emulated/0/` 后的目录段）；`takenAtMs = DATE_TAKEN 有效值 ?: DATE_MODIFIED*1000`。
- 每行 uri：按 MEDIA_TYPE 用 `ContentUris.withAppendedId(MediaStore.Images/Video.Media.EXTERNAL_CONTENT_URI, id)`（删除/写请求要求具体类型 uri，Files uri 不行）。
- `queryAlbums()`：全量游标按 BUCKET_ID 分组聚合（`count`、封面 = 组内 takenAtMs 最大行 uri、relativePath 取首行）；`BucketKey.Bucket(bucketId)`。
- `pagingSource(key)`：`LIMIT/OFFSET` 分页查询包成 PagingSource（`ORDER BY DATE_TAKEN DESC, _ID DESC`；`Bucket` 加 `BUCKET_ID = ?`；`Pending` 返回空页）。26–30 用 `query(uri, projection, selection, args, "DATE_TAKEN DESC, _id DESC LIMIT n OFFSET m")` 排序串拼接；`observeChanges()` 脉冲到达时 VM 侧 invalidate。
- `observeChanges()`：`callbackFlow` 注册两个 `ContentObserver`（Images/Video EXTERNAL_CONTENT_URI，notifyForDescendants=true），`trySend(Unit)`，`awaitClose` 注销。
- `insertCopy(source, target)`：`ContentValues { DISPLAY_NAME, MIME_TYPE, RELATIVE_PATH=target, IS_PENDING=1 }` → `contentResolver.insert(按 mime 选 Images/Video EXTERNAL_CONTENT_URI)` → `openOutputStream` 拷字节（Media 源经 `openInputStream(media.uri)`，LocalFile 源经 `file.inputStream()`）→ `IS_PENDING=0` update。失败清理半成品行（delete 该 uri）后 `Result.failure`。同名冲突 MediaStore 自动改名，无需处理。
- `moveTo(uris, target)`：逐条 `contentResolver.update(uri, ContentValues { RELATIVE_PATH=target }, null, null)` 计数成功条数；单条 update 抛异常时该条跳过、继续后续（授权已由调用方先走 writeRequest 取得），全部失败才 `Result.failure`。
- `deleteRequest`/`writeRequest`：`MediaStore.createDeleteRequest(contentResolver, uris)` / `createWriteRequest(...)`——方法本身 `@RequiresApi(30)`，调用方经 `DeviceCapabilities` 门控，内部不再判版本。

- [ ] **Step 1: 写失败测试（网关 Robolectric + Prefs）**

`MediaStoreDeviceGatewayTest.kt`（Robolectric 的 ShadowContentResolver 对 MediaStore 复杂查询支持很弱——本测试聚焦**可注入行为**：insertCopy 的 ContentValues 形状与 IS_PENDING 两段式、字节拷贝正确性，经 Robolectric `contentResolver.insert` 真调 shadow provider；queryAlbums 的**聚合分组逻辑**抽成包内纯函数直接测。游标行 → 聚合输入用显式行类型（`DeviceMedia` 不带 bucketId，聚合必须显式携带）：`internal data class AlbumRow(val media: DeviceMedia, val bucketId: Long, val bucketName: String)`、`internal fun aggregateAlbums(rows: List<AlbumRow>): List<DeviceAlbum>`）：

```kotlin
package com.bluskysoftware.yandegallery.data.device

import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MediaStoreDeviceGatewayTest {
    private fun row(id: Long, bucket: Long, name: String, path: String, taken: Long, video: Boolean = false) = AlbumRow(
        media = DeviceMedia(
            mediaId = id, uri = Uri.parse("content://media/external/images/media/$id"),
            isVideo = video, displayName = "f$id.jpg", relativePath = path,
            width = 100, height = 100, sizeBytes = 1000, takenAtMs = taken,
            durationMs = if (video) 5_000 else null,
        ),
        bucketId = bucket, bucketName = name,
    )

    @Test
    fun `aggregateAlbums_按bucket分组_计数_封面取最新`() {
        val rows = listOf(
            row(1, 10, "Camera", "DCIM/Camera/", taken = 100),
            row(2, 10, "Camera", "DCIM/Camera/", taken = 300),
            row(3, 20, "WeChat", "Pictures/WeChat/", taken = 200),
        )
        val albums = aggregateAlbums(rows)
        assertEquals(2, albums.size)
        val camera = albums.first { it.relativePath == "DCIM/Camera/" }
        assertEquals("Camera", camera.name)
        assertEquals(2, camera.count)
        assertEquals(rows[1].media.uri, camera.coverUri)   // 组内 takenAtMs 最大
        assertEquals(BucketKey.Bucket(10), camera.key)
    }

    @Test
    fun `aggregateAlbums_空表`() {
        assertEquals(emptyList<DeviceAlbum>(), aggregateAlbums(emptyList()))
    }
}
```

`PrefsStoreDeviceTest.kt`（照 `data/prefs` 既有测试的临时文件 DataStore 注入 + `TestAwait.awaitValue` 纪律）：

```kotlin
package com.bluskysoftware.yandegallery.data.prefs

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.bluskysoftware.yandegallery.awaitValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class PrefsStoreDeviceTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val file = File.createTempFile("device_prefs_test", ".preferences_pb")
    private val store = PrefsStore(PreferenceDataStoreFactory.create(scope = scope) { file })

    @After fun teardown() { scope.cancel(); file.delete() }

    @Test
    fun `待落地相册_增删读`() = runTest {
        assertEquals(emptySet<String>(), store.devicePendingAlbums.first())
        store.addPendingAlbum("旅行")
        store.addPendingAlbum("美食")
        awaitValue({ store.devicePendingAlbums.first() }) { it == setOf("旅行", "美食") }
        store.removePendingAlbum("旅行")
        awaitValue({ store.devicePendingAlbums.first() }) { it == setOf("美食") }
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD FAILED（符号未定义）。

- [ ] **Step 3: 实现接口 + MediaStore 网关 + Prefs 三成员**

按上方 Interfaces 与实现要点完整实现三个文件。`AlbumRow`/`aggregateAlbums` 放 `MediaStoreDeviceGateway.kt` 顶层（internal），网关 `queryAlbums()` 游标读出 AlbumRow 列表后委托它。PrefsStore 追加：

```kotlin
    /** 待落地相册名集合（本机相册 spec §5.5）：已命名但尚无文件的手机相册占位。 */
    val devicePendingAlbums: Flow<Set<String>> = safeData.map { it[KEY_DEVICE_PENDING_ALBUMS] ?: emptySet() }

    suspend fun addPendingAlbum(name: String) {
        dataStore.edit { it[KEY_DEVICE_PENDING_ALBUMS] = (it[KEY_DEVICE_PENDING_ALBUMS] ?: emptySet()) + name }
    }

    suspend fun removePendingAlbum(name: String) {
        dataStore.edit { it[KEY_DEVICE_PENDING_ALBUMS] = (it[KEY_DEVICE_PENDING_ALBUMS] ?: emptySet()) - name }
    }
```

companion 加 `private val KEY_DEVICE_PENDING_ALBUMS = stringSetPreferencesKey("device_pending_albums")`（import `androidx.datastore.preferences.core.stringSetPreferencesKey`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；两个新测试类 failures=0，既有全量不退化。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/data/device/ android/app/src/main/java/com/bluskysoftware/yandegallery/data/prefs/PrefsStore.kt android/app/src/test/java/com/bluskysoftware/yandegallery/data/device/ android/app/src/test/java/com/bluskysoftware/yandegallery/data/prefs/PrefsStoreDeviceTest.kt
git commit -m "feat(android): 手机域数据层——DeviceMediaGateway 接口、MediaStore 实现与待落地相册偏好"
```

### Task 4: 底导第三 tab + 三路由 + AppGraph 接线（页面占位）

**Files:**
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/AppNav.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/di/AppGraph.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/MainActivity.kt`
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/AppNavTest.kt`（追加用例）

**Interfaces:**
- Consumes: Task 2 `BucketKey`、Task 3 `MediaStoreDeviceGateway`。
- Produces:
  - `Routes.DeviceAlbums = "device_albums"`、`Routes.DeviceAlbumDetail = "device_albums/{bucketKey}"`、`Routes.DeviceViewer = "device_viewer/{mediaId}?bucketKey={bucketKey}"`、`Routes.deviceAlbumDetail(key: BucketKey)`、`Routes.deviceViewer(mediaId: Long, key: BucketKey)` 构造函数
  - `AppScaffold` 新增参数：`deviceAlbumsContent: @Composable () -> Unit`、`deviceAlbumDetailContent: @Composable (String) -> Unit`、`deviceViewerContent: @Composable (mediaId: Long, bucketKey: String) -> Unit`、`deviceSelectionBars: PhotosSelectionBars`（手机域多选桥复用同一个类，Task 7 接真回调）
  - `AppGraph.deviceMediaGateway: DeviceMediaGateway`（lazy）、`AppGraph.deviceLoader: ImageLoader`（lazy，含 coil-video 解码器）

**改动内容：**

1. `Routes` 追加三常量 + 两构造（放 `Scan` 常量之后）：

```kotlin
    const val DeviceAlbums = "device_albums"
    const val DeviceAlbumDetail = "device_albums/{bucketKey}"
    const val DeviceViewer = "device_viewer/{mediaId}?bucketKey={bucketKey}"

    // Uri.encode 收敛在此（对照 search 先例）：Pending 名称可含任意字符，路径段必须转义
    fun deviceAlbumDetail(key: com.bluskysoftware.yandegallery.data.device.BucketKey) =
        "device_albums/${Uri.encode(key.encode())}"

    fun deviceViewer(mediaId: Long, key: com.bluskysoftware.yandegallery.data.device.BucketKey) =
        "device_viewer/$mediaId?bucketKey=${Uri.encode(key.encode())}"
```

2. `bottomTabs` 加第三项（图标 `Icons.Filled/Outlined.PhoneAndroid`，需补 import）：

```kotlin
    BottomTab(Routes.DeviceAlbums, "手机相册", Icons.Filled.PhoneAndroid, Icons.Outlined.PhoneAndroid),
```

3. `AppScaffold`：`showBottomBar` 条件加 `|| currentRoute == Routes.DeviceAlbums`；bottomBar 的多选 swap 分支加手机域（`deviceSelectionBars.model` 非空且 currentRoute 是 DeviceAlbums/DeviceAlbumDetail 时 swap——手机域多选栏 Task 7 实现，本任务先接桥参数）；NavHost 注册三 destination：

```kotlin
            composable(Routes.DeviceAlbums) { deviceAlbumsContent() }
            composable(Routes.DeviceAlbumDetail) { entry ->
                deviceAlbumDetailContent(entry.arguments?.getString("bucketKey") ?: "all")
            }
            composable(
                Routes.DeviceViewer,
                arguments = listOf(
                    navArgument("mediaId") { type = NavType.LongType },
                    navArgument("bucketKey") { type = NavType.StringType; defaultValue = "all" },
                ),
                enterTransition = { fadeIn(animationSpec = tween(220)) + scaleIn(initialScale = 0.92f, animationSpec = tween(220)) },
                exitTransition = { fadeOut(animationSpec = tween(160)) },
                popEnterTransition = { fadeIn(animationSpec = tween(160)) },
                popExitTransition = { fadeOut(animationSpec = tween(160)) + scaleOut(targetScale = 0.92f, animationSpec = tween(160)) },
            ) { entry ->
                deviceViewerContent(
                    entry.arguments?.getLong("mediaId") ?: -1L,
                    entry.arguments?.getString("bucketKey") ?: "all",
                )
            }
```

`AppNavForTest` 同步补三个占位参数（`deviceAlbumsContent = { Text("手机相册占位") }` 等）与 `deviceSelectionBars = remember { PhotosSelectionBars() }`。

4. `AppGraph` 追加（`thumbnailLoader` 之后）：

```kotlin
    /** 手机域 MediaStore 网关（本机相册 spec §4）：UI/worker 全经此接口，测试注入 fake。 */
    val deviceMediaGateway: com.bluskysoftware.yandegallery.data.device.DeviceMediaGateway by lazy {
        com.bluskysoftware.yandegallery.data.device.MediaStoreDeviceGateway(appContext)
    }

    /** 手机域图片 loader：content:// 走 Coil 默认数据源 + 视频海报帧解码；与镜像域两 loader 互不干扰。 */
    val deviceLoader by lazy {
        coil3.ImageLoader.Builder(appContext)
            .components { add(coil3.video.VideoFrameDecoder.Factory()) }
            .build()
    }
```

5. `MainActivity`：`AppScaffold` 调用处补三个 content 参数——本任务先占位（`deviceAlbumsContent = { Text("手机相册") }` 级别即可，Task 5/6/8 逐个换真件）与 `deviceSelectionBars = remember { PhotosSelectionBars() }`（提升到与 photosBars 同级：`val deviceBars = remember { PhotosSelectionBars() }`）。

- [ ] **Step 1: 追加失败测试**

`AppNavTest.kt` 追加两用例（既有结构照抄——真 NavHost + `AppNavForTest`）：

```kotlin
    @Test
    fun `底导含手机相册tab_点击落到device_albums路由`() {
        composeRule.setContent { AppNavForTest() }
        composeRule.onNodeWithTag("tab_device_albums").performClick()
        composeRule.onNodeWithText("手机相册占位").assertIsDisplayed()
    }

    @Test
    fun `手机相册tab上底部导航栏保持可见`() {
        composeRule.setContent { AppNavForTest() }
        composeRule.onNodeWithTag("tab_device_albums").performClick()
        composeRule.onNodeWithTag("tab_photos").assertIsDisplayed()   // 底导仍在
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD FAILED（tab_device_albums 不存在/编译错）。

- [ ] **Step 3: 按上方改动内容实现五处**

- [ ] **Step 4: 跑测试确认通过**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；AppNavTest 新旧用例全绿。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ui/AppNav.kt android/app/src/main/java/com/bluskysoftware/yandegallery/di/AppGraph.kt android/app/src/main/java/com/bluskysoftware/yandegallery/MainActivity.kt android/app/src/test/java/com/bluskysoftware/yandegallery/ui/AppNavTest.kt
git commit -m "feat(android): 底导第三 tab「手机相册」——三路由注册与 AppGraph 手机域网关/loader 接线"
```

---

### Task 5: 相册列表页（权限引导 / 全部照片卡 / bucket 网格 / 新建 / 部分授权横幅）

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumsViewModel.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumsScreen.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/MainActivity.kt`（换真件）
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumsViewModelTest.kt`、`DeviceAlbumsScreenTest.kt`

**Interfaces:**
- Consumes: Task 1 `DeviceCapabilities`/`DeviceAccessLevel`、Task 2 模型与 `sortDeviceAlbums`/`validateNewAlbumName`、Task 3 网关 + `PrefsStore.devicePendingAlbums`、`MiuiPinnedTopBar`/`MiuiLargeTitle`/`rememberMiuiHeaderState`/`MiuiDialog`、`RetryableAsyncImage`。
- Produces: `DeviceAlbumsViewModel(gateway, prefsStore, accessLevel: StateFlow<DeviceAccessLevel>)` + `factory(graph, accessLevel)`；`DeviceAlbumsScreen(viewModel, loader, onOpenAlbum: (BucketKey) -> Unit, onRequestPermission: () -> Unit, onManagePartial: () -> Unit)`。testTag：`device_albums_grid`、`device_album_card_all`、`device_album_card_b<id>`、`device_album_card_p<名>`、`device_albums_new`、`device_permission_gate`、`device_partial_banner`。

**VM 形态：**

```kotlin
class DeviceAlbumsViewModel(
    private val gateway: DeviceMediaGateway,
    private val prefsStore: PrefsStore,
    val accessLevel: StateFlow<DeviceAccessLevel>,   // MainActivity 权限桥喂入（Screen 侧申请，见下）
) : ViewModel() {
    /** 相册列表三源合成：网关真实 bucket + 待落地占位 + 变更脉冲重查；DENIED 时空列表。 */
    val albums: StateFlow<List<DeviceAlbum>> = combine(
        refreshTick, prefsStore.devicePendingAlbums, accessLevel,
    ) { _, pending, level -> Triple(pending, level, Unit) }
        .mapLatest { (pending, level, _) ->
            if (level == DeviceAccessLevel.DENIED) emptyList()
            else buildAlbums(gateway.queryAlbums(), pending)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    // refreshTick = merge(flowOf(Unit), gateway.observeChanges())；
    // buildAlbums：真实相册 + 「全部照片」聚合卡（count=Σ，封面=首个真实相册封面，key=BucketKey.All，置列表首位）
    //            + 待落地占位（名字被真实 bucket 命中的自动 removePendingAlbum 收编，Pictures/<名>/ 路径去重）
    //            → sortDeviceAlbums（All 卡不参与排序，恒首位）

    fun createPendingAlbum(name: String): String?   // validateNewAlbumName（existing=真实+待落地名集）通过后 addPendingAlbum；返回错误文案或 null
    fun deletePendingAlbum(name: String)            // removePendingAlbum（仅占位记录，spec §5.5）
}
```

**Screen 形态：**
- `accessLevel == DENIED` → 引导页（`device_permission_gate`：说明文案 + 「授权」按钮回调 `onRequestPermission`；权限申请本体在 MainActivity 用 `rememberLauncherForActivityResult(RequestMultiplePermissions)` + `DeviceCapabilities.readPermissions()`，结果重算 accessLevel 喂 VM——参照 `NotificationPermissionEffect` 的写法但需带回调）。
- `PARTIAL` → 列表上方常驻横幅（`device_partial_banner`：「仅可访问部分照片」+「管理」按钮回调 `onManagePartial` 重拉系统选择器）。
- 正常态：`MiuiPinnedTopBar("手机相册", actions = { 「+」IconButton（`DeviceCapabilities.canCreateAlbum()` 才渲染，tag `device_albums_new`）})` + `MiuiLargeTitle` + `LazyVerticalGrid(GridCells.Adaptive(104.dp))`。卡片复用 AlbumCardItem 视觉但自绘（封面 `coverUri` 直接给 `RetryableAsyncImage(model = coverUri, imageLoader = deviceLoader)`；「全部照片」卡副标题为总数；待落地卡灰底占位 + 长按菜单「删除」）。
- 「+」→ `MiuiDialog(title="新建相册", content={ MiuiTextField }, confirm)` 调 `createPendingAlbum`，错误文案就地显示。

- [ ] **Step 1: 写失败测试**

`DeviceAlbumsViewModelTest.kt`（fake 网关 + 临时 DataStore，Robolectric）核心用例：

```kotlin
class FakeDeviceGateway : DeviceMediaGateway {
    var albums: List<DeviceAlbum> = emptyList()
    val changes = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    override suspend fun queryAlbums() = albums
    override fun observeChanges(): Flow<Unit> = changes
    override fun pagingSource(key: BucketKey): PagingSource<Int, DeviceMedia> = throw UnsupportedOperationException()
    override suspend fun mediaByIds(ids: List<Long>) = emptyList<DeviceMedia>()
    override suspend fun insertCopy(source: DeviceSource, targetRelativePath: String) = Result.failure<Uri>(UnsupportedOperationException())
    override fun deleteRequest(uris: List<Uri>) = throw UnsupportedOperationException()
    override fun writeRequest(uris: List<Uri>) = throw UnsupportedOperationException()
    override suspend fun moveTo(uris: List<Uri>, targetRelativePath: String) = Result.failure<Int>(UnsupportedOperationException())
}
```

用例：①「全部照片聚合卡置首位_计数为总和」；②「待落地相册合并显示_真实bucket出现同名即收编删记录」（fake 先无 bucket → addPending → albums 含占位；再让 fake 返回同名真实 bucket + changes 脉冲 → awaitValue 占位消失、DataStore 键被清）；③「DENIED时列表为空」；④「新建重名拒绝返回文案」。

`DeviceAlbumsScreenTest.kt`（compose 冒烟）：①DENIED 渲染 `device_permission_gate`；②PARTIAL 渲染 `device_partial_banner`；③正常态卡片可点、回调收到正确 BucketKey；④sdk 28（`@Config(sdk = [28])`）时 `device_albums_new` 不存在。

- [ ] **Step 2: 跑测试确认失败**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD FAILED。

- [ ] **Step 3: 实现 VM + Screen + MainActivity 换真件**

MainActivity 侧：`deviceAlbumsContent` 换成权限桥（`remember { MutableStateFlow(初始 accessLevel) }`，`rememberLauncherForActivityResult` 申请后重算）+ 真 Screen；`onOpenAlbum = { nav.navigate(Routes.deviceAlbumDetail(it)) }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；新增两测试类全绿。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/ android/app/src/main/java/com/bluskysoftware/yandegallery/MainActivity.kt android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/
git commit -m "feat(android): 手机相册列表页——权限引导/部分授权横幅/全部照片聚合卡/待落地相册新建与收编"
```

### Task 6: 相册网格页（分页网格 / 捏合列数 / 视频角标）

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailViewModel.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailScreen.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/MainActivity.kt`（换真件）
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailViewModelTest.kt`、`DeviceAlbumDetailScreenTest.kt`

**Interfaces:**
- Consumes: Task 3 `pagingSource(key)`/`observeChanges()`、Task 2 `BucketKey.decode`/`formatDurationMs`、`PinchStepState`/`detectPinchStep`、`SelectableCell`、`SelectionState`、`MiuiSubPageTopBar`、`MiuiTokens`、`RetryableAsyncImage`。
- Produces: `DeviceAlbumDetailViewModel(gateway, bucketKeyRaw: String)` + `factory(graph, bucketKeyRaw)`——`val bucketKey: BucketKey`（decode 失败回退 All）、`val title: StateFlow<String>`（All=「全部照片」，Bucket=相册名，Pending=名称）、`val count: StateFlow<Int>`、`val media: Flow<PagingData<DeviceMedia>>`（`Pager(PagingConfig(pageSize = 60), pagingSourceFactory = { gateway.pagingSource(bucketKey) })`，`observeChanges()` 收脉冲 → 持有的当前 PagingSource `invalidate()`；`.cachedIn(viewModelScope)`）、`val selection = SelectionState()`、`val columns: MutableStateFlow<Int>`（默认 4，档 3/4/5，不持久化——spec §2.3 YAGNI）。
- Produces: `DeviceAlbumDetailScreen(viewModel, loader, onOpenViewer: (mediaId: Long) -> Unit, onBack: () -> Unit, selectionBars: PhotosSelectionBars)`（多选底栏回填 Task 7 接真回调，本任务先渲染顶部选择栏与角标）。testTag：`device_grid`、`device_cell_<mediaId>`、`device_video_badge_<mediaId>`。

**Screen 结构（对照 AlbumDetailScreen 网格部分裁剪）：**
- `MiuiSubPageTopBar(title, subtitle = "N 张", onBack)`；多选态顶部换 `SelectionTopBar(insetStatusBar = true)`。
- `LazyVerticalGrid(GridCells.Fixed(columns), spacedBy(MiuiTokens.GridGap))` 外包 `pointerInput` 挂 `detectPinchStep`（larger=列数-1 钳 3、smaller=+1 钳 5，与既有语义一致：格子变大=列变少）。
- 格子 = `SelectableCell` 包 `RetryableAsyncImage(model = media.uri, imageLoader = loader, contentScale = Crop, imageModifier = Modifier.clip(MiuiTokens.CellShape))`；`media.isVideo` 时右下角时长角标（黑 55% 圆角底白字 `formatDurationMs(durationMs ?: 0)`，tag `device_video_badge_<id>`）。
- 空态（Pending 相册恒空）：居中「相册还没有照片\n通过「复制到」把图片放进来」。

- [ ] **Step 1: 写失败测试**

VM 测试（fake 网关返回 `TestPager` 可驱动的假 PagingSource——直接用 `List<DeviceMedia>` 包 `PagingSource`，仿 `paging-testing` 既有用法）：①「bucketKey解码_Bucket上下文标题取相册名」；②「decode失败回退All」；③「observeChanges脉冲触发invalidate」（断言旧 PagingSource.invalid==true）。
Screen 测试：①网格渲染 N 格、视频格有角标文案「0:05」；②单击格子回调 mediaId；③长按进多选后顶栏变 SelectionTopBar；④捏合状态机直接测 `PinchStepState`（列数 4→3）纯逻辑即可（手势驱动 Robolectric 不可靠，既有惯例）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD FAILED。

- [ ] **Step 3: 实现 VM + Screen + MainActivity 换真件**

MainActivity：`deviceAlbumDetailContent = { raw -> ... DeviceAlbumDetailScreen(vm, graph.deviceLoader, onOpenViewer = { nav.navigate(Routes.deviceViewer(it, vm.bucketKey)) }, onBack = { nav.popBackStack() }, selectionBars = deviceBars) }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/ android/app/src/main/java/com/bluskysoftware/yandegallery/MainActivity.kt android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/
git commit -m "feat(android): 手机相册网格页——MediaStore 分页网格、捏合列数与视频时长角标"
```

---

### Task 7: 手机域操作面（删除 / 分享 / 复制 / 移动 / 多选栏 / 目标选择器）

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceSelectionBars.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumPicker.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceAlbumDetailViewModel.kt`、`DeviceAlbumDetailScreen.kt`、`DeviceAlbumsViewModel.kt`（暴露目标相册列表复用）
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/AppNav.kt`、`MainActivity.kt`（手机域多选底栏 swap 接线）
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/DeviceActionsTest.kt`、`DeviceAlbumPickerTest.kt`

**Interfaces:**
- Consumes: Task 1 门控、Task 2 `isWritableAlbumPath`/`validateNewAlbumName`、Task 3 网关写操作 + `PrefsStore` 待落地、`SelectionState`、`MiuiDialog`。
- Produces:
  - `DeviceSelectionBars.Model(canDelete: Boolean, canCopy: Boolean, canMove: Boolean, onShare/onDelete/onCopyTo/onMoveTo: () -> Unit)` + `@Composable DeviceSelectionBottomBar(model)`（tag：`device_action_share/delete/copy_to/move_to`；门控=false 的项**不渲染**）
  - `@Composable DeviceAlbumPicker(albums: List<DeviceAlbum>, canCreate: Boolean, excludeKey: BucketKey?, onPick: (relativePath: String) -> Unit, onCreate: (name: String) -> String?, onDismiss)`——只列 `isWritableAlbumPath` 的真实相册 + 待落地相册；`excludeKey` 滤当前相册（防自指）；`canCreate` 时首行「新建相册」展开内联输入（确认回调 onCreate，返回错误文案 null=成功并顺带以 `Pictures/<名>/` 调 onPick）
  - VM 新增（DeviceAlbumDetailViewModel）：
    - `suspend fun shareSelected(context 无关，返回 List<DeviceMedia>)`——Screen 侧组 `ACTION_SEND(_MULTIPLE)`（uri 直接用 media.uri，mime 单张取实际、混合 `*/*`）
    - `fun deleteSelected(): PendingIntent?`（选中 uri → `gateway.deleteRequest`；Screen 用 `rememberLauncherForActivityResult(StartIntentSenderForResult)` 发射，RESULT_OK 后 `selection.clear()`——列表刷新靠 observer）
    - `fun moveWriteRequest(): PendingIntent?`（同上包装 `gateway.writeRequest`）+ `suspend fun moveSelectedTo(path: String): Result<Int>`（授权 RESULT_OK 后调 `gateway.moveTo`）
    - `suspend fun copySelectedTo(path: String): Int`（逐张 `gateway.insertCopy(DeviceSource.Media(it), path)` 计成功数；返回成功数，失败数 = 选中数-成功数由 Screen 提示）
- 多选桥：MainActivity 的 `deviceBars` 回填 `PhotosSelectionBars.Model` 已有五字段不匹配手机域——**改为** AppNav 的 swap 分支直接消费新的 `DeviceSelectionBars`（`AppScaffold` 的 `deviceSelectionBars` 参数类型从 PhotosSelectionBars 换成 `DeviceSelectionBars`，Task 4 的临时接线在此修正）。

**语义要点：**
- 删除/移动的系统弹窗批量一次（uris 全量传入）；`RESULT_OK` 才继续，取消则无操作。
- 复制目标路径 = picker 回调的 `relativePath`（真实相册取自身路径；待落地/新建 = `Pictures/<名>/`）；复制成功 ≥1 张且目标是待落地名时调 `prefsStore.removePendingAlbum`（真实 bucket 已诞生，Task 5 的收编逻辑兜底）。
- 手机域移动在 All 聚合上下文同样可用（spec §5.4 不对称点）；复制/移动的目标 picker `excludeKey` = 当前 Bucket 上下文（All 不排除任何目标）。
- 大图页操作栏（Task 8）复用同一套 VM 方法，单张 = `listOf(current)`。

- [ ] **Step 1: 写失败测试**

`DeviceActionsTest.kt`（Robolectric + FakeDeviceGateway 扩展：记录 insertCopy/moveTo 入参、可配置结果）：
①「复制到_逐张insert_计数成功数」（3 选 2 成功 → 返回 2，入参 relativePath 正确）；
②「移动到_授权后moveTo_目标路径传递」；
③「删除_uris正确传入deleteRequest」（fake 返回记录用 PendingIntent 占位——Robolectric `PendingIntent.getActivity` 可构造）；
④「sdk28_Model门控三写操作全false」（`DeviceCapabilities` 直接断言 + Model 构造）。
`DeviceAlbumPickerTest.kt`（compose）：①非法路径相册（Download/）不出现；②excludeKey 滤自指；③canCreate=false 无「新建相册」行；④新建重名错误文案就地显示。

- [ ] **Step 2: 跑测试确认失败**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD FAILED。

- [ ] **Step 3: 实现（VM 方法 → 两个新组件 → AppNav/MainActivity swap 修正 → Screen 接线）**

Screen 侧接线：多选态 `SideEffect { selectionBars.model = DeviceSelectionBars.Model(...) }`（离开清 null，对照 PhotosScreen 惯例）；分享 `ACTION_SEND_MULTIPLE` 组装：

```kotlin
val intent = if (medias.size == 1) Intent(Intent.ACTION_SEND).apply {
    type = medias[0].mime(); putExtra(Intent.EXTRA_STREAM, medias[0].uri)
} else Intent(Intent.ACTION_SEND_MULTIPLE).apply {
    type = "*/*"; putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(medias.map { it.uri }))
}
context.startActivity(Intent.createChooser(intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), null))
```

（`DeviceMedia.mime()` = isVideo ? "video/*" : `mimeOf(displayName.substringAfterLast('.', ""))`——复用 `ui/common/UiText.kt` 的 mimeOf。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/ android/app/src/main/java/com/bluskysoftware/yandegallery/ui/AppNav.kt android/app/src/main/java/com/bluskysoftware/yandegallery/MainActivity.kt android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/
git commit -m "feat(android): 手机域操作面——系统弹窗删除/移动、相册间复制、分享与目标选择器（含新建）"
```

### Task 8: 本机大图页（Pager / 缩放 / 视频外抛 / 操作栏 / 详情）

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceViewerViewModel.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceViewerScreen.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/DeviceViewerActionBar.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/MainActivity.kt`（换真件）
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/DeviceViewerViewModelTest.kt`、`DeviceViewerScreenTest.kt`

**Interfaces:**
- Consumes: Task 3 网关（`pagingSource`/`mediaByIds` + 写操作）、Task 7 的 picker 与操作语义、`ZoomableImage`/`ZoomableImageState`、`SelectionState` 不用（单张上下文）、`MiuiDialog`、`formatDurationMs`。
- Produces:
  - `DeviceViewerViewModel(gateway, prefsStore, mediaIdInitial: Long, bucketKeyRaw: String)` + factory——`val media: Flow<PagingData<DeviceMedia>>`（同 bucketKey 上下文分页，`cachedIn`）、`val initialMediaId`；操作方法与 Task 7 同形态但单张：`fun deleteRequest(media): PendingIntent?`、`suspend fun copyTo(media, path): Boolean`、`fun moveWriteRequest(media): PendingIntent?`、`suspend fun moveTo(media, path): Boolean`、`suspend fun albumTargets(): List<DeviceAlbum>`（供 picker）
  - `DeviceViewerActionBar(isVideo: Boolean, onShare/onDelete/onCopyTo/onMoveTo/onDetail: () -> Unit)`——门控项不渲染（复用 `DeviceCapabilities`）；tag `device_viewer_action_*`
  - `DeviceViewerScreen(viewModel, loader, onBack)`：黑底 HorizontalPager + 首屏 `initialMediaId` 定位（照 ViewerScreen 的 `located` + `rememberSaveable` 模式裁剪——peek indexOfFirst → scrollToPage）；图片格子 = `ZoomableImage(model = media.uri, imageLoader = loader, state, onSingleTap = chrome切换, onDismiss = onBack)`；**视频格子** = 海报帧 `RetryableAsyncImage` + 中央播放键（tag `device_viewer_play`），点击外抛：

```kotlin
context.startActivity(Intent(Intent.ACTION_VIEW).apply {
    setDataAndType(media.uri, "video/*")
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
})
```

  - 详情面板：底部弹层（`ModalBottomSheet`）列 文件名/相对路径/大小（`Formatter.formatFileSize`）/分辨率/拍摄时间（`SimpleDateFormat("yyyy-MM-dd HH:mm")`）/（视频）时长——只读（spec §5.6）。tag `device_viewer_detail_sheet`。
- chrome：顶部渐变遮罩 + 居中「日期/时间」双行（对照 ViewerScreen）；单击沉浸切换；缩放态 Pager 禁横滑（`userScrollEnabled = !state.consumesHorizontalDrag`）。

**删除后的翻页语义：** RESULT_OK → observer 脉冲 → PagingSource invalidate → Pager 自然收缩；当前页被删后 Pager 落到相邻页（Paging 默认行为，无需手工跳页）；列表清空时 `LaunchedEffect(itemCount==0 && located)` `onBack()`。

- [ ] **Step 1: 写失败测试**

VM 测试：①「初始定位id透传」；②「copyTo委托网关_路径正确」；③「albumTargets只含可写路径相册」。
Screen 测试（compose 冒烟）：①视频页渲染播放键与时长角标、图片页渲染 ZoomableImage（用 tag 断言）；②操作栏 sdk28 下只余 分享/详情；③详情面板字段文案齐全（构造一条 DeviceMedia 断言各行文本）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD FAILED。

- [ ] **Step 3: 实现三文件 + MainActivity 换真件**

- [ ] **Step 4: 跑测试确认通过**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ui/device/ android/app/src/main/java/com/bluskysoftware/yandegallery/MainActivity.kt android/app/src/test/java/com/bluskysoftware/yandegallery/ui/device/
git commit -m "feat(android): 本机大图页——缩放翻页、视频海报帧外抛系统播放器、操作栏与只读详情"
```

---

### Task 9: WriteRepository.moveToGallery（桌面域移动，补偿回滚）

**Files:**
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/write/WriteRepository.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/SelectionActions.kt`
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/domain/write/WriteRepositoryTest.kt`（追加）

**Interfaces:**
- Consumes: 既有 `addToGallery`/`removeFromGallery`（乐观镜像 + 分块 + 404 当成功惯例）。
- Produces: `suspend fun moveToGallery(fromGalleryId: Long, toGalleryId: Long, imageIds: List<Long>): WriteResult`；`SelectionActions.moveToGallery(fromGalleryId, toGalleryId, ids)` 一行委托（先 `filterExisting`）。

- [ ] **Step 1: 追加失败测试**

`WriteRepositoryTest.kt` 追加（沿用该文件既有 in-memory Room + FakeWriteApi 装配）：

```kotlin
    @Test
    fun `移动到相册_目标加入且当前移除`() = runTest {
        // 装配：image 1 在 gallery A；moveToGallery(A→B)
        // 断言：WriteResult.Success；本地镜像 gallery_images 中 1 只在 B 不在 A；
        //       writeApi 收到 addImagesToGallery(B,[1]) 与 removeImagesFromGallery(A,[1]) 各一次
    }

    @Test
    fun `移动到相册_移除失败时补偿回滚目标加入`() = runTest {
        // FakeWriteApi.failRemoveFromGallery = ApiException(500)
        // 断言：返回 Failed；镜像回到初始态（1 仍在 A、不在 B）；
        //       writeApi 收到 removeImagesFromGallery(B,[1]) 的补偿调用（撤销刚才的目标加入）
    }

    @Test
    fun `移动到相册_加入失败直接失败不发移除`() = runTest {
        // FakeWriteApi.failAddToGallery = ApiException(500)
        // 断言：Failed；removeImagesFromGallery 从未被调用；镜像不变
    }

    @Test
    fun `移动到相册_移除404当成功`() = runTest {
        // 移除返回 404（目标已在桌面被移出）——整体 Success，不补偿
    }
```

（FakeWriteApi 需补 `failAddToGallery` 可配置项与 `removeFromGalleryInputs` 记录，照其既有字段风格。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD FAILED（moveToGallery 未定义）。

- [ ] **Step 3: 实现 moveToGallery**

```kotlin
    /**
     * 移动到相册（本机相册 spec §6.2）：目标加入成功 → 当前移除；移除失败补偿回滚（撤销目标加入）。
     * 两步各自复用 addToGallery/removeFromGallery 的乐观镜像与 404-当成功语义——404 语义组合出的
     * 边界（目标已删=加入404当成功→移除照走）与 spec 一致；补偿调用自身失败不再级联处理，
     * 交给每步写成功后已触发的对账 nudge 收敛（BUG-02 同族口径）。
     */
    suspend fun moveToGallery(fromGalleryId: Long, toGalleryId: Long, imageIds: List<Long>): WriteResult {
        if (imageIds.isEmpty()) return WriteResult.Success
        val added = addToGallery(toGalleryId, imageIds)
        if (added is WriteResult.Failed) return added
        val removed = removeFromGallery(fromGalleryId, imageIds)
        if (removed is WriteResult.Failed) {
            removeFromGallery(toGalleryId, imageIds)   // 补偿：撤销目标加入（结果不再分流）
            return removed
        }
        return WriteResult.Success
    }
```

`SelectionActions` 追加：

```kotlin
    /** 移动到相册（仅相册详情多选，spec §6.2）；死 id 先滤（M4-T14 同族）。 */
    suspend fun moveToGallery(fromGalleryId: Long, toGalleryId: Long, ids: List<Long>): WriteResult =
        writeRepository.moveToGallery(fromGalleryId, toGalleryId, filterExisting(ids))
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；WriteRepositoryTest 新旧全绿。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/domain/write/WriteRepository.kt android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/SelectionActions.kt android/app/src/test/java/com/bluskysoftware/yandegallery/domain/write/WriteRepositoryTest.kt
git commit -m "feat(android): WriteRepository 新增 moveToGallery——目标加入+当前移除、移除失败补偿回滚"
```

### Task 10: 桌面→手机导出 worker（DeviceExportWorker + Manager + 通知）

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/export/DeviceExportWorker.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/export/DeviceExportManager.kt`
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/export/DeviceExportNotifier.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/domain/download/AppWorkerFactory.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/di/AppGraph.kt`（deviceExportManager）
- Test: `android/app/src/test/java/com/bluskysoftware/yandegallery/domain/export/DeviceExportWorkerTest.kt`

**Interfaces:**
- Consumes: `ImageMirrorStore.ensure(serverId, imageId, MirrorTier.ORIGINAL): Result<File>`（spec §6.1：导出即升原图档，同 D7 语义）、Task 3 `insertCopy(DeviceSource.LocalFile(...), path)`、`mimeOf`（ui/common/UiText.kt——**移入** `data/device/DeviceModels.kt` 顶层并把 ui 处改为转发引用，worker 不该依赖 ui 包）、`DownloadNotifier` 的通知惯例（IMPORTANCE_LOW、setForeground runCatching 降级）。
- Produces:
  - `DeviceExportWorker(context, params, ensureOriginal, insertCopy, activeServerId, notifier)`：inputData `KEY_SERVER_ID: Long`、`KEY_IMAGE_IDS: LongArray`、`KEY_TARGET_PATH: String`。逐张（串行）：`ensureOriginal(serverId, id)` → 成功则 `insertCopy(LocalFile(file, file.name, mimeOf(file.extension)), targetPath)`；计数进度经 `notifier.foregroundInfo(done, total, targetPath)` 节流更新（复用 `shouldUpdateNotification`）。分流：ensure 404 → 该张计失败继续；DiskFullException → `Result.retry()`；切服（activeServerId != serverId）→ `Result.success()` 丢弃（对照 DownloadWorker 惯例）；结束 outputData `KEY_FAILED_COUNT: Int` → `Result.success()`。
  - `DeviceExportManager(context)`：`fun enqueue(serverId: Long, imageIds: List<Long>, targetPath: String)`——唯一工作名 `device-export-$serverId`，`ExistingWorkPolicy.APPEND_OR_REPLACE`（多次导出排队不互踩）；Constraints CONNECTED；退避 EXPONENTIAL 10s。`fun observeState(serverId): Flow<WorkInfo.State?>`。
  - `DeviceExportNotifier` 接口 + `AndroidDeviceExportNotifier`（channel `device_export`「复制到手机相册」，「正在复制到手机相册 x/y」确定进度、FGS dataSync 类型——对照 AndroidDownloadNotifier 全套）。
  - `AppWorkerFactory` 加分支（构造依赖全从 graph 取：`graph.imageMirrorStore::ensure` 柯里化 ORIGINAL、`graph.deviceMediaGateway::insertCopy`、`graph.serverRepository`）；`AppGraph.deviceExportManager by lazy { DeviceExportManager(appContext) }`。

- [ ] **Step 1: 写失败测试**

`DeviceExportWorkerTest.kt`（`TestListenableWorkerBuilder` + fake 依赖，对照 `DownloadE2ETest` 装配）：
①「全成功_逐张ensure后insert_失败计数0」（3 张：断言 insertCopy 收到 3 次、LocalFile.file 是 ensure 返回的、targetPath 透传）；
②「单张404_计失败继续_其余成功」（第 2 张 ensure 失败 404 → failedCount=1、insertCopy 2 次）；
③「磁盘满_Result为retry」；
④「切服_直接success不动手」（activeServerId 返回别的 id → insertCopy 0 次）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD FAILED。

- [ ] **Step 3: 实现四件套 + mimeOf 迁移**

`mimeOf` 移到 `DeviceModels.kt` 顶层（同名同逻辑），`ui/common/UiText.kt` 原函数体改 `= com.bluskysoftware.yandegallery.data.device.mimeOf(format)` 转发（既有调用零迁移）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/domain/export/ android/app/src/main/java/com/bluskysoftware/yandegallery/domain/download/AppWorkerFactory.kt android/app/src/main/java/com/bluskysoftware/yandegallery/di/AppGraph.kt android/app/src/main/java/com/bluskysoftware/yandegallery/data/device/DeviceModels.kt android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/UiText.kt android/app/src/test/java/com/bluskysoftware/yandegallery/domain/export/
git commit -m "feat(android): 桌面→手机导出 worker——原图入镜像后复制落 MediaStore、计数进度通知与 404/磁盘满分流"
```

---

### Task 11: 桌面域「复制到」两节选择器 + 「移动到」入口（改名收口）

**Files:**
- Create: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/CopyTargetPicker.kt`
- Delete: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/GalleryPickerDialog.kt`
- Modify: `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/SelectionBars.kt`、`PhotosSelectionBars.kt`、`ui/viewer/ViewerActionBar.kt`
- Modify: `ui/photos/PhotosScreen.kt`/`PhotosViewModel.kt`、`ui/albums/AlbumDetailScreen.kt`/`AlbumDetailViewModel.kt`、`ui/viewer/ViewerScreen.kt`/`ViewerViewModel.kt`、`ui/AppNav.kt`、`MainActivity.kt`
- Test: 改造 `GalleryPickerDialogTest.kt` → `CopyTargetPickerTest.kt`；追加/迁移 `SelectionBarsTest.kt`、`PhotosScreenTest.kt`、`AlbumDetailMoreMenuTest.kt`、`ViewerScreen` 相关断言

**Interfaces:**
- Consumes: Task 7 `DeviceAlbumPicker` 的手机相册节数据（`DeviceAlbum` 列表 + 新建回调）、Task 9 `SelectionActions.moveToGallery`、Task 10 `DeviceExportManager.enqueue`、Task 1 门控、`GalleryEntity`。
- Produces:

```kotlin
/** 复制/移动目标选择器（spec §6.1/§6.2）：桌面相册节恒在；手机相册节仅 mode=Copy 且 canCopy 且 online。 */
enum class PickerMode { Copy, Move }

@Composable
fun CopyTargetPicker(
    mode: PickerMode,
    galleries: List<GalleryEntity>,                    // 桌面相册节（excludeIds 已滤）
    deviceAlbums: List<DeviceAlbum>,                   // 手机相册节数据（Move 模式忽略）
    deviceEnabled: Boolean,                            // canCopy && online（Copy 模式下节显隐）
    canCreateDeviceAlbum: Boolean,
    onPickGallery: (Long) -> Unit,
    onPickDeviceAlbum: (relativePath: String) -> Unit,
    onCreateDeviceAlbum: (name: String) -> String?,
    onDismiss: () -> Unit,
    excludeIds: Set<Long> = emptySet(),
)
```

标题：Copy=「复制到」、Move=「移动到」；两节小节头「相册」/「手机相册」；tag：`copy_picker_gallery_<id>`、`copy_picker_device_<encode后key>`、`copy_picker_create_device`。**Move 模式永不渲染手机相册节**（spec D5，硬编码非参数）。

**改名与入口收口（testTag 一并迁移，见 Global Constraints）：**
- `SelectionBottomBar`：`onAddToGallery` 参数改名 `onCopyTo`、文案「加入相册」→「复制到」、图标不变；新增 `onMoveTo: (() -> Unit)? = null`（非 null 才渲染，仅相册详情传入；文案「移动到」，图标 `Icons.AutoMirrored.Filled.DriveFileMove`，tag `selection_action_move_to`，enabled=online）。
- `PhotosSelectionBars.Model`：`onAddToGallery` → `onCopyTo`（时间轴无移动，spec §6.2）。
- `ViewerActionBar`：菜单项「加入相册」→「复制到」（tag 迁移）；新增「移动到」菜单项（`onMoveTo: (() -> Unit)?`，null 置灰——仅相册上下文非 null）。
- 三处调用点（Photos/AlbumDetail/Viewer）把 `GalleryPickerDialog` 换成 `CopyTargetPicker`：
  - **Copy 流**：`onPickGallery` → 原 addToGallery 逻辑不变；`onPickDeviceAlbum(path)` → `deviceExportManager.enqueue(serverId, selectedIds, path)` + 提示「已开始复制到手机相册」+ 清选择。
  - **Move 流**（仅 AlbumDetail 多选 + 相册上下文 Viewer）：打开 `CopyTargetPicker(mode = Move, excludeIds = setOf(当前相册id))`，`onPickGallery` → `SelectionActions.moveToGallery(当前, 目标, ids)`（Viewer 单张走 `writeRepository.moveToGallery(当前, 目标, listOf(id))`），成功提示「已移动到「X」」。
  - 手机相册节数据源：`graph.deviceMediaGateway.queryAlbums()`（VM 内 suspend 取一次 + `prefsStore.devicePendingAlbums` 合成，滤 `isWritableAlbumPath`）——三个 VM 各加一个 `suspend fun deviceAlbumTargets(): List<DeviceAlbum>`。
- `AlbumDetailViewModel` 补 `suspend fun moveTo(targetGalleryId: Long, ids: List<Long>): WriteResult`（委托 actions.moveToGallery(galleryId, target, ids)）；`ViewerViewModel` 补同名单张方法。

- [ ] **Step 1: 迁移/追加失败测试**

`CopyTargetPickerTest.kt`（吸收原 GalleryPickerDialogTest 的 excludeIds/空态断言）核心新用例：
①「Copy模式_两节齐全_手机节按deviceEnabled显隐」；
②「Move模式_手机节永不渲染」（deviceEnabled=true 也不渲染）；
③「excludeIds滤自指」（原断言迁移）；
④「点桌面相册回调id_点手机相册回调路径」。
`SelectionBarsTest.kt`：追加「onMoveTo非null才渲染移动项」「copy_to 新tag存在、旧tag不存在」。
既有引用 `selection_action_add_to_gallery`/`viewer_menu_add_to_gallery`/「加入相册」的断言全部批量迁移（grep 这两个 tag 与文案定位）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD FAILED。

- [ ] **Step 3: 实现（组件 → 改名波及 → 三调用点 → VM 方法）**

- [ ] **Step 4: 跑测试确认通过**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；全量无 `GalleryPickerDialog` 引用残留（`grep -rn "GalleryPickerDialog" android/app/src` 零命中）。

- [ ] **Step 5: Commit**

```bash
git add -A android/app/src
git commit -m "feat(android): 「加入相册」升级「复制到」——两节目标选择器（桌面相册/手机相册）与桌面域「移动到」入口"
```

### Task 12: 收尾——版本号 / 文档 / 联调计划 §L / 全量回归

**Files:**
- Modify: `android/app/build.gradle.kts`（versionCode 9 / versionName "0.8.0"）
- Modify: `android/README.md`（新增「§11 v0.8.0 本机相册与复制/移动体系」——功能面、门控矩阵、待实机验证清单指针）
- Modify: `docs/superpowers/plans/2026-07-05-M3实机联调计划.md`（新增 §L：手机相册实机用例——权限三态（含 34+ 部分授权）、系统删除/移动弹窗、复制落盘系统相册可见、视频外抛、桌面→手机导出通知、MuMu API32 + 红魔 API34 分工）
- Modify: `doc/superpowers/specs/2026-07-16-android-device-albums-design.md`（状态行改「✅ 已实施」）

**Interfaces:**
- Consumes: 全部前置任务完成。
- Produces: 可发布状态。

- [ ] **Step 1: 版本号 bump + 三文档更新**

- [ ] **Step 2: 安卓全量回归**

Run: `cmd //c "D:\Android\gw.bat :app:testDebugUnitTest --console=plain"`
Expected: BUILD SUCCESSFUL；`android/app/build/test-results/testDebugUnitTest/` 全部 XML failures=0 errors=0（对照基线 77 类 440 例只增不减）。

- [ ] **Step 3: 桌面 gate 防漂移（虽零桌面改动）**

Run: 仓库根 `npm run test`
Expected: typecheck + vitest 全绿。

- [ ] **Step 4: 出 debug 包冒烟（可选，真机联调前置）**

Run: `cmd //c "D:\Android\gw.bat :app:assembleDebug --console=plain"`
Expected: BUILD SUCCESSFUL，产物 `android/app/build/outputs/apk/debug/app-debug.apk`。

- [ ] **Step 5: Commit**

```bash
git add android/app/build.gradle.kts android/README.md docs/superpowers/plans/2026-07-05-M3实机联调计划.md doc/superpowers/specs/2026-07-16-android-device-albums-design.md
git commit -m "chore(android): v0.8.0 收尾——版本号、README 本机相册章节与实机联调计划 §L"
```

---

## 任务依赖图

```
T1(门控/权限/依赖) → T2(模型) → T3(网关+Prefs) → T4(路由/tab/Graph)
T4 → T5(列表页) → T6(网格页) → T7(操作面) → T8(大图页)
T9(moveToGallery) 仅依赖既有代码，可与 T5-T8 并行
T10(导出worker) 依赖 T3；T11(两节选择器) 依赖 T7+T9+T10
T12(收尾) 依赖全部
```

## 实机联调项（无头环境无法覆盖，登记 §L 不阻塞合并）

系统删除/写授权弹窗真实交互、34+ 部分授权选择器、复制产物在系统相册 app 可见性、视频外抛各 ROM 播放器兼容、ContentObserver 在 MIUI 上的触发时延、导出通知观感。
