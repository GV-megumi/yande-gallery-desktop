# 安卓通用图库功能补全（v0.6.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给安卓伴侣 App 补全通用图库功能——照片/相册排序、置顶相册、「其他相册」收纳、密度可见入口、自适应网格、拖拽重排、设为封面（唯一桌面改动：封面能力包）。

**Architecture:** 组织状态（置顶/分组/手动序）存安卓本机 Room 新表 `album_prefs`；排序/列数偏好经 AppGraph 级共享 holder `ViewPrefs`（内存真源 + DataStore 落盘），照片页/详情页/大图页共读同一实例保证顺序一致；DAO 排序走 `@RawQuery` 白名单枚举拼接。桌面端只扩 `PATCH /galleries/:id`（coverImageId）+ `/sync/galleries` 载荷（有效封面兜底 + createdAt）。

**Tech Stack:** Jetpack Compose Material3 + Room v5 + Paging 3 + DataStore Preferences + Retrofit/kotlinx-serialization（安卓）；Node HTTP 路由 + sqlite3 + vitest（桌面）。

**Spec:** `doc/superpowers/specs/2026-07-09-android-gallery-features-design.md`（含 plan 阶段修正：§6.1 422、§6.2 N+1 已修保留双保险、§3.1 设置行新 tag）。

---

## 全局约定（每个任务都适用）

- **只改列出的文件**；桌面任务只动 `src/main/` + `tests/main/`，安卓任务只动 `android/`。
- **禁止运行任何 adb / 模拟器 / 桌面应用启动命令**——设备验证统一在 Task 11 由主会话执行。
- **既有 testTag 一律不改名不删除**（本轮唯一签名变化是 `PhotosPinnedTopBar`，其影响面已在 Task 6 列出）。
- 安卓测试命令（在 `android/` 目录下；`--tests` 必须用**全限定类名**，通配符前缀会报 "No tests found"）：
  ```bash
  cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.data.prefs.ViewPrefsTest"
  ```
  全量：`cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest"`。判定成败以输出中 `BUILD SUCCESSFUL/FAILED` 为准（成功尾部还有 configuration cache 提示行，别只看最后一行）；DataStore 类偶发 60s 协程饥饿超时是既有基建债（android/README.md §8），同类失败重跑一次再判。
  编译门（改动不带新测试时）：`cd android && cmd //c "D:\\Android\\gw.bat :app:compileDebugKotlin"`。
- 桌面测试命令（仓库根）：`npx vitest run tests/main/api/routes.galleryWrite.test.ts`（单文件）；`npx vitest run tests/main`（主进程 gate）；`npm run typecheck`。
- **commit 规范**：英文类型前缀 + 中文描述，直接提交 master，每个任务至少一个 commit。
- 新增测试的装置（Robolectric runner、in-memory db、MockWebServer、vi.mock 形态）**沿用同目录既有测试文件的写法**；本计划给出的测试代码如与既有装置的构造细节有出入，以既有装置为准改写构造部分，用例逻辑与断言不变。

## 文件结构总览

**安卓新增**：`data/prefs/SortModels.kt`（PhotoSort/AlbumSort/字段组枚举）、`data/prefs/ViewPrefs.kt`（共享偏好 holder）、`data/db/TimelineQueries.kt`（RawQuery 构造）、`data/db/AlbumPrefsDao.kt`、`ui/common/MiuiOptionsSheet.kt`（sheet 容器+行部件）、`ui/common/PinchStepState.kt`（泛型捏合，替代 PinchDensityState）、`ui/albums/AlbumSections.kt`（分区组装纯函数）、`ui/albums/AlbumCardItem.kt`（卡片抽出共用）、`ui/albums/OtherAlbumsScreen.kt`、`ui/albums/AlbumReorderState.kt`（重排状态机+拖拽控制器）。

**安卓修改**：`Entities.kt`、`AppDatabase.kt`（v5 迁移）、`GalleryDao.kt`、`ImageDao.kt`、`PrefsStore.kt`、`ApiModels.kt`、`WriteModels.kt`、`DesktopApi.kt`、`RoomMirrorStore.kt`、`WriteApi.kt`/`RetrofitWriteApi.kt`/`WriteRepository.kt`、`AppGraph.kt`、`PhotosViewModel.kt`/`PhotosScreen.kt`、`AlbumsViewModel.kt`/`AlbumsScreen.kt`、`AlbumDetailViewModel.kt`/`AlbumDetailScreen.kt`、`ViewerViewModel.kt`、`SelectionBars.kt`、`AppNav.kt`、`MainActivity.kt`、删除 `PinchDensityState.kt`。

**桌面修改**：`src/main/api/routes/galleryWriteRoutes.ts`、`src/main/services/galleryService.ts`、`src/main/services/syncService.ts`；测试 `tests/main/api/routes.galleryWrite.test.ts`、`tests/main/services/syncService.test.ts`、新增 `tests/main/services/galleryService.setCover.test.ts`。

安卓包根 `android/app/src/main/java/com/bluskysoftware/yandegallery/`、测试根 `android/app/src/test/java/com/bluskysoftware/yandegallery/`，下文相对路径均省略此前缀。

---

### Task 1: 排序模型 + PrefsStore 新键 + ViewPrefs 共享 holder

**Files:**
- Create: `data/prefs/SortModels.kt`
- Create: `data/prefs/ViewPrefs.kt`
- Modify: `data/prefs/PrefsStore.kt`（4 新键）
- Modify: `di/AppGraph.kt`（挂 viewPrefs）
- Test: `data/prefs/SortModelsTest.kt`（新建）、`data/prefs/ViewPrefsTest.kt`（新建）、`data/prefs/PrefsStoreTest.kt`（追加用例）

- [ ] **Step 1: 写失败测试**

`data/prefs/SortModelsTest.kt`（纯 JVM，无 Robolectric）：

```kotlin
package com.bluskysoftware.yandegallery.data.prefs

import org.junit.Assert.assertEquals
import org.junit.Test

class SortModelsTest {
    @Test
    fun `PhotoSort orderBy 生成二级键方向随主键`() {
        assertEquals("createdAt DESC, id DESC", PhotoSort.TIME_DESC.orderBy())
        assertEquals("createdAt ASC, id ASC", PhotoSort.TIME_ASC.orderBy())
        assertEquals("fileSize DESC, id DESC", PhotoSort.SIZE_DESC.orderBy())
        assertEquals("filename ASC, id ASC", PhotoSort.NAME_ASC.orderBy())
        assertEquals("i.createdAt DESC, i.id DESC", PhotoSort.TIME_DESC.orderBy("i."))
    }

    @Test
    fun `PhotoSort isTime 只有时间字段为真`() {
        assertEquals(listOf(true, true, false, false, false, false),
            listOf(PhotoSort.TIME_DESC, PhotoSort.TIME_ASC, PhotoSort.SIZE_DESC,
                PhotoSort.SIZE_ASC, PhotoSort.NAME_ASC, PhotoSort.NAME_DESC).map { it.isTime })
    }

    @Test
    fun `fromName 非法值收敛默认`() {
        assertEquals(PhotoSort.TIME_DESC, PhotoSort.fromName(null))
        assertEquals(PhotoSort.TIME_DESC, PhotoSort.fromName("BOGUS"))
        assertEquals(PhotoSort.SIZE_ASC, PhotoSort.fromName("SIZE_ASC"))
        assertEquals(AlbumSort.NAME_ASC, AlbumSort.fromName(null))
        assertEquals(AlbumSort.MANUAL, AlbumSort.fromName("MANUAL"))
    }

    @Test
    fun `PhotoSortField next 未选切默认方向_已选翻方向`() {
        // 当前时间↓：点大小 → 大小默认↓；再点大小 → 翻成↑；点时间 → 时间默认↓
        assertEquals(PhotoSort.SIZE_DESC, PhotoSortField.SIZE.next(PhotoSort.TIME_DESC))
        assertEquals(PhotoSort.SIZE_ASC, PhotoSortField.SIZE.next(PhotoSort.SIZE_DESC))
        assertEquals(PhotoSort.SIZE_DESC, PhotoSortField.SIZE.next(PhotoSort.SIZE_ASC))
        assertEquals(PhotoSort.TIME_DESC, PhotoSortField.TIME.next(PhotoSort.SIZE_ASC))
        assertEquals(PhotoSort.NAME_ASC, PhotoSortField.NAME.next(PhotoSort.TIME_DESC))  // 文件名默认升序
    }

    @Test
    fun `AlbumSortField next 同规则`() {
        assertEquals(AlbumSort.COUNT_DESC, AlbumSortField.COUNT.next(AlbumSort.NAME_ASC))
        assertEquals(AlbumSort.COUNT_ASC, AlbumSortField.COUNT.next(AlbumSort.COUNT_DESC))
        assertEquals(AlbumSort.NAME_ASC, AlbumSortField.NAME.next(AlbumSort.MANUAL))
        assertEquals(AlbumSort.CREATED_DESC, AlbumSortField.CREATED.next(AlbumSort.NAME_ASC))
    }
}
```

`data/prefs/ViewPrefsTest.kt`（装置沿用 `PrefsStoreTest` 的独立 DataStore 构造；用 `runTest` + `backgroundScope` 承载持久化协程）：

```kotlin
package com.bluskysoftware.yandegallery.data.prefs

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

@OptIn(ExperimentalCoroutinesApi::class)
class ViewPrefsTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private fun kotlinx.coroutines.test.TestScope.newStore(): PrefsStore = PrefsStore(
        PreferenceDataStoreFactory.create(
            scope = kotlinx.coroutines.CoroutineScope(backgroundScope.coroutineContext + UnconfinedTestDispatcher(testScheduler)),
        ) { tmp.newFile("view_prefs_${System.nanoTime()}.preferences_pb") },
    )

    @Test
    fun `setter 即改内存态并落盘`() = runTest {
        val store = newStore()
        val prefs = ViewPrefs(store, backgroundScope)
        prefs.setPhotoSort(PhotoSort.SIZE_DESC)
        prefs.setAlbumsSort(AlbumSort.MANUAL)
        prefs.setDetailSort(PhotoSort.NAME_ASC)
        prefs.setDetailColumns(5)
        assertEquals(PhotoSort.SIZE_DESC, prefs.photoSort.value)   // 内存态即时
        testScheduler.advanceUntilIdle()
        assertEquals("SIZE_DESC", store.photosSortName.first())    // 已落盘
        assertEquals("MANUAL", store.albumsSortName.first())
        assertEquals("NAME_ASC", store.albumDetailSortName.first())
        assertEquals(5, store.albumDetailColumns.first())
    }

    @Test
    fun `冷启动回填持久化值且非法列数夹取`() = runTest {
        val store = newStore()
        store.setPhotosSortName("NAME_DESC")
        store.setAlbumDetailColumns(99)
        val prefs = ViewPrefs(store, backgroundScope)
        testScheduler.advanceUntilIdle()
        assertEquals(PhotoSort.NAME_DESC, prefs.photoSort.value)
        assertEquals(5, prefs.detailColumns.value)   // coerceIn 3..5
        assertEquals(AlbumSort.NAME_ASC, prefs.albumsSort.value)  // 未存过 → 默认
    }

    @Test
    fun `回填前用户已切档则不回冲`() = runTest {
        val store = newStore()
        store.setPhotosSortName("NAME_DESC")
        val prefs = ViewPrefs(store, backgroundScope)
        prefs.setPhotoSort(PhotoSort.SIZE_ASC)   // 回填协程 advance 前抢先操作
        testScheduler.advanceUntilIdle()
        assertEquals(PhotoSort.SIZE_ASC, prefs.photoSort.value)   // compareAndSet 不回冲
    }
}
```

`PrefsStoreTest.kt` 追加（沿用该文件既有装置与命名）：

```kotlin
@Test
fun `排序与列数四键读写回环_未设置为null`() = runTest {
    val store = newStore()   // ← 用该文件既有的 PrefsStore 构造 helper
    assertNull(store.photosSortName.first())
    assertNull(store.albumsSortName.first())
    assertNull(store.albumDetailSortName.first())
    assertNull(store.albumDetailColumns.first())
    store.setPhotosSortName("TIME_ASC")
    store.setAlbumsSortName("COUNT_DESC")
    store.setAlbumDetailSortName("SIZE_DESC")
    store.setAlbumDetailColumns(3)
    assertEquals("TIME_ASC", store.photosSortName.first())
    assertEquals("COUNT_DESC", store.albumsSortName.first())
    assertEquals("SIZE_DESC", store.albumDetailSortName.first())
    assertEquals(3, store.albumDetailColumns.first())
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.data.prefs.SortModelsTest --tests com.bluskysoftware.yandegallery.data.prefs.ViewPrefsTest"
```
预期：编译失败（PhotoSort/ViewPrefs 未定义）。

- [ ] **Step 3: 实现**

新建 `data/prefs/SortModels.kt`：

```kotlin
package com.bluskysoftware.yandegallery.data.prefs

/**
 * 照片排序（spec §2.4）：照片时间轴与图集详情共用；字段 × 方向平铺成枚举，DataStore 存 name。
 * [orderBy] 由白名单枚举拼 SQL（无用户输入，无注入面）；二级键恒为 id、方向随主键（分页稳定序）。
 */
enum class PhotoSort(val column: String, val ascending: Boolean, val isTime: Boolean) {
    TIME_DESC("createdAt", false, true),
    TIME_ASC("createdAt", true, true),
    SIZE_DESC("fileSize", false, false),
    SIZE_ASC("fileSize", true, false),
    NAME_ASC("filename", true, false),
    NAME_DESC("filename", false, false);

    /** ORDER BY 片段；[prefix] 供 JOIN 场景加表别名（如 "i."）。 */
    fun orderBy(prefix: String = ""): String {
        val dir = if (ascending) "ASC" else "DESC"
        return "$prefix$column $dir, ${prefix}id $dir"
    }

    companion object {
        val DEFAULT = TIME_DESC
        fun fromName(name: String?): PhotoSort = entries.firstOrNull { it.name == name } ?: DEFAULT
    }
}

/** 排序面板字段行（spec §3.1 交互）：点未选字段 → 该字段默认方向；点已选 → 翻方向。 */
enum class PhotoSortField(val label: String, val defaultSort: PhotoSort, val flipped: PhotoSort) {
    TIME("时间", PhotoSort.TIME_DESC, PhotoSort.TIME_ASC),
    SIZE("文件大小", PhotoSort.SIZE_DESC, PhotoSort.SIZE_ASC),
    NAME("文件名", PhotoSort.NAME_ASC, PhotoSort.NAME_DESC);

    fun contains(sort: PhotoSort): Boolean = sort == defaultSort || sort == flipped

    fun next(current: PhotoSort): PhotoSort = when (current) {
        defaultSort -> flipped
        flipped -> defaultSort
        else -> defaultSort
    }
}

/** 相册排序（spec §2.4）：MANUAL 无方向；CREATED 依赖同步载荷 createdAt（旧桌面为 NULL 排尾）。 */
enum class AlbumSort {
    MANUAL, NAME_ASC, NAME_DESC, COUNT_DESC, COUNT_ASC, CREATED_DESC, CREATED_ASC;

    companion object {
        val DEFAULT = NAME_ASC
        fun fromName(name: String?): AlbumSort = entries.firstOrNull { it.name == name } ?: DEFAULT
    }
}

/** 相册排序面板字段行（手动档走单选行，不在此列）。 */
enum class AlbumSortField(val label: String, val defaultSort: AlbumSort, val flipped: AlbumSort) {
    NAME("名称", AlbumSort.NAME_ASC, AlbumSort.NAME_DESC),
    COUNT("张数", AlbumSort.COUNT_DESC, AlbumSort.COUNT_ASC),
    CREATED("创建时间", AlbumSort.CREATED_DESC, AlbumSort.CREATED_ASC);

    fun contains(sort: AlbumSort): Boolean = sort == defaultSort || sort == flipped

    fun next(current: AlbumSort): AlbumSort = when (current) {
        defaultSort -> flipped
        flipped -> defaultSort
        else -> defaultSort
    }
}
```

`PrefsStore.kt`：import 增加 `androidx.datastore.preferences.core.intPreferencesKey`；类内追加（放在 previewCacheMaxBytes 之后）：

```kotlin
    /** 照片页排序（PhotoSort.name）；未设置为 null，映射与默认收敛在 ViewPrefs（spec §2.3）。 */
    val photosSortName: Flow<String?> = safeData.map { it[KEY_PHOTOS_SORT] }

    suspend fun setPhotosSortName(name: String) {
        dataStore.edit { it[KEY_PHOTOS_SORT] = name }
    }

    /** 相册页排序（AlbumSort.name）。 */
    val albumsSortName: Flow<String?> = safeData.map { it[KEY_ALBUMS_SORT] }

    suspend fun setAlbumsSortName(name: String) {
        dataStore.edit { it[KEY_ALBUMS_SORT] = name }
    }

    /** 相册详情排序（PhotoSort.name，全部图集共用）。 */
    val albumDetailSortName: Flow<String?> = safeData.map { it[KEY_DETAIL_SORT] }

    suspend fun setAlbumDetailSortName(name: String) {
        dataStore.edit { it[KEY_DETAIL_SORT] = name }
    }

    /** 相册详情列数档（3/4/5）。 */
    val albumDetailColumns: Flow<Int?> = safeData.map { it[KEY_DETAIL_COLUMNS] }

    suspend fun setAlbumDetailColumns(columns: Int) {
        dataStore.edit { it[KEY_DETAIL_COLUMNS] = columns }
    }
```

companion object 追加键：

```kotlin
        private val KEY_PHOTOS_SORT = stringPreferencesKey("photos_sort")
        private val KEY_ALBUMS_SORT = stringPreferencesKey("albums_sort")
        private val KEY_DETAIL_SORT = stringPreferencesKey("album_detail_sort")
        private val KEY_DETAIL_COLUMNS = intPreferencesKey("album_detail_columns")
```

新建 `data/prefs/ViewPrefs.kt`：

```kotlin
package com.bluskysoftware.yandegallery.data.prefs

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * 视图偏好共享态（spec §2.3/§3.4）：排序/列数的内存真源，DataStore 只是持久化介质
 * （PhotosViewModel 密度档 BUG-18 同款「内存态为准」模式）。挂 AppGraph 单例：照片/相册/
 * 详情三个 VM 与 ViewerViewModel 共读同一实例——Viewer 开页同步读 `.value` 取当前排序，
 * 网格与大图翻页顺序不错位（spec §3.4）。
 */
class ViewPrefs(private val prefs: PrefsStore, private val scope: CoroutineScope) {

    private val _photoSort = MutableStateFlow(PhotoSort.DEFAULT)
    val photoSort: StateFlow<PhotoSort> = _photoSort.asStateFlow()

    private val _albumsSort = MutableStateFlow(AlbumSort.DEFAULT)
    val albumsSort: StateFlow<AlbumSort> = _albumsSort.asStateFlow()

    private val _detailSort = MutableStateFlow(PhotoSort.DEFAULT)
    val detailSort: StateFlow<PhotoSort> = _detailSort.asStateFlow()

    private val _detailColumns = MutableStateFlow(DEFAULT_DETAIL_COLUMNS)
    val detailColumns: StateFlow<Int> = _detailColumns.asStateFlow()

    init {
        // 冷启动回填一次；compareAndSet 防手快用户被回冲（密度档同款）
        scope.launch {
            _photoSort.compareAndSet(PhotoSort.DEFAULT, PhotoSort.fromName(prefs.photosSortName.first()))
            _albumsSort.compareAndSet(AlbumSort.DEFAULT, AlbumSort.fromName(prefs.albumsSortName.first()))
            _detailSort.compareAndSet(PhotoSort.DEFAULT, PhotoSort.fromName(prefs.albumDetailSortName.first()))
            prefs.albumDetailColumns.first()?.let { persisted ->
                _detailColumns.compareAndSet(DEFAULT_DETAIL_COLUMNS, persisted.coerceIn(MIN_DETAIL_COLUMNS, MAX_DETAIL_COLUMNS))
            }
        }
    }

    fun setPhotoSort(sort: PhotoSort) {
        _photoSort.value = sort
        scope.launch { prefs.setPhotosSortName(sort.name) }
    }

    fun setAlbumsSort(sort: AlbumSort) {
        _albumsSort.value = sort
        scope.launch { prefs.setAlbumsSortName(sort.name) }
    }

    fun setDetailSort(sort: PhotoSort) {
        _detailSort.value = sort
        scope.launch { prefs.setAlbumDetailSortName(sort.name) }
    }

    fun setDetailColumns(columns: Int) {
        val clamped = columns.coerceIn(MIN_DETAIL_COLUMNS, MAX_DETAIL_COLUMNS)
        _detailColumns.value = clamped
        scope.launch { prefs.setAlbumDetailColumns(clamped) }
    }

    companion object {
        const val DEFAULT_DETAIL_COLUMNS = 4
        const val MIN_DETAIL_COLUMNS = 3
        const val MAX_DETAIL_COLUMNS = 5
    }
}
```

`di/AppGraph.kt`：`prefsStore` 声明之后追加：

```kotlin
    /** 视图偏好共享态（排序/列数，v0.6）：VM 与 Viewer 共读同一实例保证顺序一致（spec §3.4）。 */
    val viewPrefs by lazy { com.bluskysoftware.yandegallery.data.prefs.ViewPrefs(prefsStore, scope) }
```

- [ ] **Step 4: 跑测试确认通过**

同 Step 2 命令 + PrefsStoreTest；预期 BUILD SUCCESSFUL。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/data/prefs/ android/app/src/main/java/com/bluskysoftware/yandegallery/di/AppGraph.kt android/app/src/test/java/com/bluskysoftware/yandegallery/data/prefs/
git commit -m "feat(android): 排序模型与 ViewPrefs 共享偏好——PhotoSort/AlbumSort 枚举、PrefsStore 四新键、AppGraph 级内存真源"
```

### Task 2: Room v5——album_prefs 表 + galleries.createdAt + 同步链路

**Files:**
- Modify: `data/db/Entities.kt`（GalleryEntity +createdAt、新增 AlbumPrefsEntity）
- Create: `data/db/AlbumPrefsDao.kt`
- Modify: `data/db/AppDatabase.kt`（version 5 + MIGRATION_4_5 + dao 出口）
- Modify: `data/db/GalleryDao.kt`（AlbumCardRow/observeAlbumCards 补 createdAt 列）
- Modify: `data/api/ApiModels.kt`（SyncGalleryDto +createdAt）
- Modify: `data/repo/RoomMirrorStore.kt`（replaceGalleries 映射 createdAt + 对账清孤儿）
- Test: `data/db/AlbumPrefsDaoTest.kt`（新建）、`data/db/MigrationTest.kt`（追加 v4→5）、`data/repo/RoomMirrorStoreTest.kt`（追加孤儿清理用例）

- [ ] **Step 1: 写失败测试**

`data/db/AlbumPrefsDaoTest.kt`（装置沿用 GalleryDaoTest：Robolectric + inMemory）：

```kotlin
package com.bluskysoftware.yandegallery.data.db

import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AlbumPrefsDaoTest {
    private lateinit var db: AppDatabase

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
    }

    @After
    fun teardown() = db.close()

    @Test
    fun `setPinned 置顶写 pinnedAt 并强制移出其他相册且清手动序`() = runTest {
        db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 1, inOther = true, manualOrder = 3))
        db.albumPrefsDao().setPinned(1, pinned = true, nowMs = 1000L)
        val row = db.albumPrefsDao().byId(1)!!
        assertTrue(row.pinned)
        assertEquals(1000L, row.pinnedAt)
        assertFalse(row.inOther)          // 互斥（spec §2.1）
        assertNull(row.manualOrder)       // 跨区迁移清手动序
    }

    @Test
    fun `setPinned 取消置顶清 pinnedAt 与手动序`() = runTest {
        db.albumPrefsDao().setPinned(2, pinned = true, nowMs = 500L)
        db.albumPrefsDao().applyManualOrder(listOf(2L))
        db.albumPrefsDao().setPinned(2, pinned = false, nowMs = 999L)
        val row = db.albumPrefsDao().byId(2)!!
        assertFalse(row.pinned)
        assertNull(row.pinnedAt)
        assertNull(row.manualOrder)
    }

    @Test
    fun `setInOther 移入强制取消置顶且清手动序_无记录行自动建`() = runTest {
        db.albumPrefsDao().setPinned(3, pinned = true, nowMs = 500L)
        db.albumPrefsDao().setInOther(3, inOther = true)
        val row = db.albumPrefsDao().byId(3)!!
        assertTrue(row.inOther)
        assertFalse(row.pinned)
        assertNull(row.pinnedAt)
        assertNull(row.manualOrder)
        db.albumPrefsDao().setInOther(99, inOther = true)   // 无记录 → upsert 新行
        assertTrue(db.albumPrefsDao().byId(99)!!.inOther)
    }

    @Test
    fun `applyManualOrder 按列表序重编号0起_未列出的行不动`() = runTest {
        db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 7, manualOrder = 42))
        db.albumPrefsDao().applyManualOrder(listOf(10L, 11L, 12L))
        assertEquals(0, db.albumPrefsDao().byId(10)!!.manualOrder)
        assertEquals(1, db.albumPrefsDao().byId(11)!!.manualOrder)
        assertEquals(2, db.albumPrefsDao().byId(12)!!.manualOrder)
        assertEquals(42, db.albumPrefsDao().byId(7)!!.manualOrder)
    }

    @Test
    fun `deleteOrphans 清掉图集已不存在的偏好行`() = runTest {
        db.galleryDao().replaceAll(listOf(GalleryEntity(1, "a", null, 0)))
        db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 1, pinned = true, pinnedAt = 1L))
        db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 2, inOther = true))
        db.albumPrefsDao().deleteOrphans()
        assertNotNull(db.albumPrefsDao().byId(1))
        assertNull(db.albumPrefsDao().byId(2))
    }
}
```

`data/db/MigrationTest.kt` 追加用例（沿用该文件既有 MigrationTestHelper 装置与库名常量）：

```kotlin
@Test
fun `v4到v5_galleries补createdAt_album_prefs表可用`() {
    helper.createDatabase(TEST_DB, 4).apply {
        execSQL("INSERT INTO galleries (id, name, coverImageId, imageCount) VALUES (1, 'g', NULL, 0)")
        close()
    }
    helper.runMigrationsAndValidate(TEST_DB, 5, true, AppDatabase.MIGRATION_4_5).apply {
        // 旧行 createdAt 为 NULL（spec §2.2）
        query("SELECT createdAt FROM galleries WHERE id = 1").use { c ->
            assertTrue(c.moveToFirst())
            assertTrue(c.isNull(0))
        }
        // 新表可写可读
        execSQL("INSERT INTO album_prefs (galleryId, pinned, pinnedAt, inOther, manualOrder) VALUES (1, 1, 123, 0, NULL)")
        query("SELECT pinned FROM album_prefs WHERE galleryId = 1").use { c ->
            assertTrue(c.moveToFirst())
            assertEquals(1, c.getInt(0))
        }
        close()
    }
}
```

`data/repo/RoomMirrorStoreTest.kt` 追加（沿用该文件既有 store/db 装置）：

```kotlin
@Test
fun `replaceGalleries 映射createdAt并清孤儿偏好`() = runTest {
    db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 1, pinned = true, pinnedAt = 1L))
    db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 2, inOther = true))
    store.replaceGalleries(listOf(
        SyncGalleryDto(id = 1, name = "keep", coverImageId = null, imageCount = 0, createdAt = "2026-01-01T00:00:00.000Z"),
    ))
    assertEquals("2026-01-01T00:00:00.000Z", db.galleryDao().byId(1)?.createdAt)
    assertNotNull(db.albumPrefsDao().byId(1))   // 图集仍在 → 偏好保留
    assertNull(db.albumPrefsDao().byId(2))      // 图集消失 → 孤儿清理（spec §2.1）
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.data.db.AlbumPrefsDaoTest --tests com.bluskysoftware.yandegallery.data.db.MigrationTest --tests com.bluskysoftware.yandegallery.data.repo.RoomMirrorStoreTest"
```
预期：编译失败（AlbumPrefsEntity 未定义）。

- [ ] **Step 3: 实现**

`data/db/Entities.kt`——GalleryEntity 替换为：

```kotlin
@Entity(tableName = "galleries")
data class GalleryEntity(
    @PrimaryKey val id: Long,
    val name: String,
    val coverImageId: Long?,
    val imageCount: Int,
    val createdAt: String? = null,   // v5：/sync/galleries 下发的 ISO 串（旧桌面缺字段为 null，spec §2.2）
)
```

（带默认值——`WriteRepository.createGallery` 等既有 4 参构造零改动。）文件末尾追加：

```kotlin
/**
 * 相册组织本机态（v0.6 spec §2.1）：置顶/「其他相册」收纳/区内手动序。
 * 独立表、不建外键——图集同步是全量 replaceAll（清表重插），FK CASCADE 会把偏好一并误清；
 * 孤儿行由 RoomMirrorStore.replaceGalleries 对账后清理。置顶与收纳互斥、跨区迁移清手动序，
 * 两条规则收敛在 AlbumPrefsDao 的事务方法里。
 */
@Entity(tableName = "album_prefs")
data class AlbumPrefsEntity(
    @PrimaryKey val galleryId: Long,
    val pinned: Boolean = false,
    val pinnedAt: Long? = null,      // epoch ms，置顶区默认序（新置顶在前）
    val inOther: Boolean = false,
    val manualOrder: Int? = null,    // 区内手动序；NULL=未定序（手动模式排区尾按名兜底）
)
```

新建 `data/db/AlbumPrefsDao.kt`：

```kotlin
package com.bluskysoftware.yandegallery.data.db

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface AlbumPrefsDao {
    @Query("SELECT * FROM album_prefs")
    fun observeAll(): Flow<List<AlbumPrefsEntity>>

    @Query("SELECT * FROM album_prefs WHERE galleryId = :galleryId")
    suspend fun byId(galleryId: Long): AlbumPrefsEntity?

    @Upsert
    suspend fun upsert(entity: AlbumPrefsEntity)

    /** 置顶/取消置顶（spec §2.1）：置顶强制移出「其他相册」（互斥）；两向都清手动序（跨区迁移）。 */
    @Transaction
    suspend fun setPinned(galleryId: Long, pinned: Boolean, nowMs: Long) {
        val old = byId(galleryId) ?: AlbumPrefsEntity(galleryId)
        upsert(
            old.copy(
                pinned = pinned,
                pinnedAt = if (pinned) nowMs else null,
                inOther = if (pinned) false else old.inOther,
                manualOrder = null,
            ),
        )
    }

    /** 移入/移出「其他相册」（spec §2.1）：移入强制取消置顶（互斥）；两向都清手动序。 */
    @Transaction
    suspend fun setInOther(galleryId: Long, inOther: Boolean) {
        val old = byId(galleryId) ?: AlbumPrefsEntity(galleryId)
        upsert(
            old.copy(
                inOther = inOther,
                pinned = if (inOther) false else old.pinned,
                pinnedAt = if (inOther) null else old.pinnedAt,
                manualOrder = null,
            ),
        )
    }

    /** 拖拽落盘（spec §4.5）：按最终视觉顺序对该分区重编号 0..n；不在列表里的行不动。 */
    @Transaction
    suspend fun applyManualOrder(orderedGalleryIds: List<Long>) {
        orderedGalleryIds.forEachIndexed { index, id ->
            val old = byId(id) ?: AlbumPrefsEntity(id)
            upsert(old.copy(manualOrder = index))
        }
    }

    /** 图集同步对账后清孤儿（spec §2.1）。 */
    @Query("DELETE FROM album_prefs WHERE galleryId NOT IN (SELECT id FROM galleries)")
    suspend fun deleteOrphans()
}
```

`data/db/AppDatabase.kt`：entities 数组加 `AlbumPrefsEntity::class`，`version = 5`，抽象方法区加 `abstract fun albumPrefsDao(): AlbumPrefsDao`；companion 加迁移（**建表语句不带 DEFAULT 子句**——实体未声明 `@ColumnInfo(defaultValue)`，带了会与 Room 期望 schema 不一致导致校验失败）：

```kotlin
        // v4→5（v0.6 功能补全）：galleries 补 createdAt（同步载荷新字段，旧行 NULL）；
        // 新建 album_prefs（置顶/其他相册/手动序本机态，spec §2.1）。
        val MIGRATION_4_5 = object : androidx.room.migration.Migration(4, 5) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `galleries` ADD COLUMN `createdAt` TEXT")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `album_prefs` (`galleryId` INTEGER NOT NULL, " +
                        "`pinned` INTEGER NOT NULL, `pinnedAt` INTEGER, " +
                        "`inOther` INTEGER NOT NULL, `manualOrder` INTEGER, " +
                        "PRIMARY KEY(`galleryId`))"
                )
            }
        }
```

`build(...)` 的 `addMigrations` 追加 `MIGRATION_4_5`。

`data/db/GalleryDao.kt`：`AlbumCardRow` 加字段 `val createdAt: String?`（放 imageCount 之后、fallbackCoverId 之前），`observeAlbumCards` 的 SELECT 改为：

```kotlin
    @Query(
        """SELECT g.id, g.name, g.coverImageId, g.imageCount, g.createdAt,
             (SELECT i.id FROM images i
                JOIN gallery_images gi ON gi.imageId = i.id
                WHERE gi.galleryId = g.id
                ORDER BY i.createdAt DESC, i.id DESC LIMIT 1) AS fallbackCoverId
           FROM galleries g ORDER BY g.name"""
    )
    fun observeAlbumCards(): Flow<List<AlbumCardRow>>
```

`data/api/ApiModels.kt`——SyncGalleryDto 加字段：

```kotlin
@Serializable
data class SyncGalleryDto(
    val id: Long,
    val name: String,
    val coverImageId: Long?,
    val imageCount: Int,
    val createdAt: String? = null,   // v0.6：旧桌面缺字段反序列化为 null（spec §2.2/§6.3）
)
```

`data/repo/RoomMirrorStore.kt`——replaceGalleries 替换为：

```kotlin
    override suspend fun replaceGalleries(items: List<SyncGalleryDto>) = db.withTransaction {
        db.galleryDao().replaceAll(
            items.map { GalleryEntity(it.id, it.name, it.coverImageId, it.imageCount, it.createdAt) },
        )
        // 对账清孤儿偏好（spec §2.1）：图集已消失的置顶/分组/手动序行一并清掉，
        // 与 replaceAll 同事务——不留「图集没了偏好还在」的中间态窗口
        db.albumPrefsDao().deleteOrphans()
    }
```

- [ ] **Step 4: 跑测试确认通过**

同 Step 2 命令，另加受 schema 影响的既有类回归：

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.data.db.AlbumPrefsDaoTest --tests com.bluskysoftware.yandegallery.data.db.MigrationTest --tests com.bluskysoftware.yandegallery.data.repo.RoomMirrorStoreTest --tests com.bluskysoftware.yandegallery.data.db.GalleryDaoTest --tests com.bluskysoftware.yandegallery.EndToEndSyncTest"
```
预期 BUILD SUCCESSFUL（GalleryDaoTest 若因 AlbumCardRow 构造参数变化编译失败，按新字段序补 `createdAt = null` 修正测试构造）。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/data/ android/app/src/test/java/com/bluskysoftware/yandegallery/data/
git commit -m "feat(android): Room v5——album_prefs 组织态表+galleries.createdAt，同步对账清孤儿偏好"
```

### Task 3: 桌面端封面能力包（PATCH coverImageId + 有效封面 + createdAt 载荷）

**Files:**
- Modify: `src/main/services/galleryService.ts`（setGalleryCover 补成员校验/接受 null）
- Modify: `src/main/api/routes/galleryWriteRoutes.ts`（PATCH body 扩展）
- Modify: `src/main/services/syncService.ts`（listSyncGalleries 有效封面 + createdAt）
- Test: `tests/main/api/routes.galleryWrite.test.ts`（追加 PATCH 用例）、`tests/main/services/syncService.test.ts`（追加载荷用例）、`tests/main/services/galleryService.setCover.test.ts`（新建）

说明：权限**零改动**——`PATCH /api/v1/galleries/:id` 已在 `permissions.ts:17` 归 `galleryWrite`。`emitGalleryGalleriesChanged` 事件保持照发（安卓 SSE system 频道 onGalleryEvent → requestSync，桌面侧改动即时推动安卓重拉）。`getGalleries`/`getGallery` 的 LEFT JOIN 一并换成有效封面表达式（`/galleries` 与 `/sync/galleries` 口径一致，spec §6.2）。

- [ ] **Step 1: 写失败测试**

`tests/main/services/galleryService.setCover.test.ts`（新建；:memory: sqlite + mock getDatabase，装置照抄 `tests/main/services/syncService.test.ts` 头部形态）：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';

const h = vi.hoisted(() => ({ db: null as unknown as import('sqlite3').Database }));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return { ...actual, getDatabase: vi.fn(async () => h.db) };
});

import { run, get } from '../../../src/main/services/database';
import { setGalleryCover } from '../../../src/main/services/galleryService';

async function setupSchema(): Promise<void> {
  await run(h.db, `CREATE TABLE images (
    id INTEGER PRIMARY KEY, filename TEXT NOT NULL, filepath TEXT NOT NULL UNIQUE,
    fileSize INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, format TEXT NOT NULL,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
  await run(h.db, `CREATE TABLE galleries (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, coverImageId INTEGER,
    imageCount INTEGER DEFAULT 0, lastScannedAt TEXT, autoScan INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
  await run(h.db, `CREATE TABLE gallery_images (
    galleryId INTEGER NOT NULL, imageId INTEGER NOT NULL, addedAt TEXT NOT NULL,
    PRIMARY KEY (galleryId, imageId))`);
}

async function seed(): Promise<void> {
  await run(h.db, `INSERT INTO galleries (id, name, createdAt, updatedAt) VALUES (1, 'g', '2026-01-01', '2026-01-01')`);
  await run(h.db, `INSERT INTO images (id, filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
    VALUES (10, 'a.jpg', 'a.jpg', 1, 1, 1, 'jpg', '2026-01-01', '2026-01-01'),
           (20, 'b.jpg', 'b.jpg', 1, 1, 1, 'jpg', '2026-01-01', '2026-01-01')`);
  await run(h.db, `INSERT INTO gallery_images (galleryId, imageId, addedAt) VALUES (1, 10, '2026-01-02')`);
}

describe('setGalleryCover（v0.6 封面能力包）', () => {
  beforeEach(async () => {
    h.db = new sqlite3.Database(':memory:');
    await setupSchema();
    await seed();
  });
  afterEach(() => { h.db.close(); });

  it('成员图 → 成功写入', async () => {
    const result = await setGalleryCover(1, 10);
    expect(result.success).toBe(true);
    const row = await get<{ coverImageId: number }>(h.db, 'SELECT coverImageId FROM galleries WHERE id = 1');
    expect(row?.coverImageId).toBe(10);
  });

  it('图片存在但非成员 → 拒绝（spec §6.1 成员校验）', async () => {
    const result = await setGalleryCover(1, 20);
    expect(result).toEqual({ success: false, error: 'Cover image not in gallery' });
  });

  it('图片不存在 → 拒绝', async () => {
    const result = await setGalleryCover(1, 999);
    expect(result).toEqual({ success: false, error: 'Cover image not found' });
  });

  it('null → 清除显式封面（回落读侧兜底）', async () => {
    await setGalleryCover(1, 10);
    const result = await setGalleryCover(1, null);
    expect(result.success).toBe(true);
    const row = await get<{ coverImageId: number | null }>(h.db, 'SELECT coverImageId FROM galleries WHERE id = 1');
    expect(row?.coverImageId).toBeNull();
  });
});
```

注意：galleryService 顶部若有 electron/事件依赖导致该测试环境报错，参照同目录 `galleryService.*.test.ts` 既有 mock（如 `appEventPublisher`/`galleryRootRegistry`）补齐 vi.mock，用例不变。

`tests/main/api/routes.galleryWrite.test.ts`：galleryService 的 `vi.mock` 工厂与 import 列表补 `setGalleryCover`，`const mockSetGalleryCover = vi.mocked(setGalleryCover);` 并追加：

```ts
  describe('PATCH /galleries/:galleryId（v0.6 扩展 coverImageId）', () => {
    it('仅 name：行为不变', async () => {
      mockGetGallery.mockResolvedValue({ success: true, data: gallery() });
      mockUpdateGallery.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: { name: ' 新名 ' } })))
        .resolves.toEqual({ updated: true });
      expect(mockUpdateGallery).toHaveBeenCalledWith(7, { name: '新名' });
      expect(mockSetGalleryCover).not.toHaveBeenCalled();
    });

    it('仅 coverImageId：委托 setGalleryCover，不调 updateGallery', async () => {
      mockGetGallery.mockResolvedValue({ success: true, data: gallery() });
      mockSetGalleryCover.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: { coverImageId: 10 } })))
        .resolves.toEqual({ updated: true });
      expect(mockSetGalleryCover).toHaveBeenCalledWith(7, 10);
      expect(mockUpdateGallery).not.toHaveBeenCalled();
    });

    it('name 与 coverImageId 同传：两者都生效', async () => {
      mockGetGallery.mockResolvedValue({ success: true, data: gallery() });
      mockUpdateGallery.mockResolvedValue({ success: true });
      mockSetGalleryCover.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: { name: 'n', coverImageId: 10 } })))
        .resolves.toEqual({ updated: true });
      expect(mockUpdateGallery).toHaveBeenCalledWith(7, { name: 'n' });
      expect(mockSetGalleryCover).toHaveBeenCalledWith(7, 10);
    });

    it('coverImageId: null → 清除封面', async () => {
      mockGetGallery.mockResolvedValue({ success: true, data: gallery() });
      mockSetGalleryCover.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: { coverImageId: null } })))
        .resolves.toEqual({ updated: true });
      expect(mockSetGalleryCover).toHaveBeenCalledWith(7, null);
    });

    it('两者都缺 → 422', async () => {
      const route = findRoute(routes, '/api/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: {} })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    });

    it('coverImageId 非法（0/负数/小数/字符串）→ 422', async () => {
      const route = findRoute(routes, '/api/v1/galleries/:galleryId', 'PATCH');
      for (const bad of [0, -1, 1.5, 'x']) {
        await expect(route.handler(context({ params: { galleryId: '7' }, body: { coverImageId: bad } })))
          .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      }
    });

    it('setGalleryCover 校验失败（非成员/不存在）→ 422', async () => {
      mockGetGallery.mockResolvedValue({ success: true, data: gallery() });
      mockSetGalleryCover.mockResolvedValue({ success: false, error: 'Cover image not in gallery' });
      const route = findRoute(routes, '/api/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: { coverImageId: 20 } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    });

    it('图集不存在 → 404（预检语义不变）', async () => {
      mockGetGallery.mockResolvedValue({ success: false, error: 'not found' });
      const route = findRoute(routes, '/api/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: { coverImageId: 10 } })))
        .rejects.toMatchObject({ statusCode: 404 });
    });
  });
```

同文件既有「PATCH 改名」用例若断言 `name is required`，按新文案 `name or coverImageId is required` 调整（仅当其 body 为空对象时命中新分支）。

`tests/main/services/syncService.test.ts` 追加（该文件 `setupSchema` 已含 galleries.createdAt 与 gallery_images.addedAt）：

```ts
  it('listSyncGalleries：有效封面兜底 + createdAt 载荷（v0.6 spec §6.2/§6.3）', async () => {
    await run(h.db, `INSERT INTO galleries (id, name, coverImageId, imageCount, createdAt, updatedAt)
      VALUES (1, 'explicit', 2, 2, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
             (2, 'fallback', NULL, 2, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
             (3, 'empty', NULL, 0, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z')`);
    // 种子 images 已有 id 1..4（本文件 seed()）；图集2 两个成员，addedAt 晚者 id=1 应当选
    await run(h.db, `INSERT INTO gallery_images (galleryId, imageId, addedAt)
      VALUES (1, 2, '2026-01-01T00:00:00.000Z'),
             (2, 3, '2026-01-01T00:00:00.000Z'),
             (2, 1, '2026-01-05T00:00:00.000Z')`);
    const rows = await listSyncGalleries();
    expect(rows).toEqual([
      { id: 1, name: 'explicit', coverImageId: 2, imageCount: 2, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, name: 'fallback', coverImageId: 1, imageCount: 2, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 3, name: 'empty', coverImageId: null, imageCount: 0, createdAt: '2026-01-03T00:00:00.000Z' },
    ]);
  });
```

若该文件已有 listSyncGalleries 旧用例断言四字段全等，按新增 createdAt 字段更新期望值。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/main/services/galleryService.setCover.test.ts tests/main/api/routes.galleryWrite.test.ts tests/main/services/syncService.test.ts
```
预期：setCover 成员校验/null 用例失败、PATCH 新用例失败、载荷用例失败。

- [ ] **Step 3: 实现**

`src/main/services/galleryService.ts`——`setGalleryCover` 整体替换：

```ts
/**
 * 设置图库封面（v0.6 扩展：接受 null 清除显式封面；补成员校验——封面必须是该图集成员，
 * 杜绝跨图集串封面；安卓 spec §6.1）。桌面 UI 既有调用只传成员图 id，行为兼容。
 */
export async function setGalleryCover(
  id: number,
  coverImageId: number | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();

    if (coverImageId !== null) {
      const image = await get<{ id: number }>(
        db,
        'SELECT id FROM images WHERE id = ?',
        [coverImageId]
      );
      if (!image) {
        return { success: false, error: 'Cover image not found' };
      }
      const member = await get<{ imageId: number }>(
        db,
        'SELECT imageId FROM gallery_images WHERE galleryId = ? AND imageId = ?',
        [id, coverImageId]
      );
      if (!member) {
        return { success: false, error: 'Cover image not in gallery' };
      }
    }

    await run(db, `
      UPDATE galleries
      SET coverImageId = ?, updatedAt = ?
      WHERE id = ?
    `, [coverImageId, new Date().toISOString(), id]);

    emitGalleryGalleriesChanged({ galleryId: id, action: 'coverChanged', affectedCount: 1 });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error setting gallery cover:', errorMessage);
    return { success: false, error: errorMessage };
  }
}
```

（改签名后 `npm run typecheck` 核对既有调用方——IPC handler / 渲染层传 number，兼容 `number | null` 无需改。）

同文件 `getGalleries` 的 query 替换（`getGallery` 按同款 ON 表达式同步改）：

```ts
    // 有效封面（v0.6 spec §6.2）：显式 coverImageId ?? 最近加入的一张（gallery_images.addedAt 倒序）。
    // 只发生在读侧，不回写 galleries.coverImageId；与 /sync/galleries 口径一致。
    const query = `
      SELECT
        g.*,
        i.id as coverImageId,
        i.filename as coverFilename,
        i.filepath as coverFilepath
      FROM galleries g
      LEFT JOIN images i ON i.id = COALESCE(
        g.coverImageId,
        (SELECT gi.imageId FROM gallery_images gi
          JOIN images im ON im.id = gi.imageId
         WHERE gi.galleryId = g.id
         ORDER BY gi.addedAt DESC, gi.imageId DESC LIMIT 1)
      )
      ORDER BY g.updatedAt DESC
    `;
```

`src/main/api/routes/galleryWriteRoutes.ts`：import 补 `setGalleryCover`；PATCH 路由 handler 整体替换：

```ts
    {
      method: 'PATCH',
      pattern: '/api/v1/galleries/:galleryId',
      handler: async (context) => {
        const galleryId = numberParam(context.params.galleryId, 'galleryId');
        const body = await jsonObject(context);
        // v0.6（安卓 spec §6.1）：body 接受 { name?, coverImageId?: number|null }，至少一项
        const hasName = body.name !== undefined;
        const hasCover = 'coverImageId' in body;
        if (!hasName && !hasCover) {
          validationError('name or coverImageId is required');
        }
        let name = '';
        if (hasName) {
          name = typeof body.name === 'string' ? body.name.trim() : '';
          if (!name) {
            validationError('name must be a non-empty string');
          }
        }
        let coverImageId: number | null = null;
        if (hasCover) {
          const value = body.coverImageId;
          if (value !== null && (!Number.isInteger(value) || (value as number) <= 0)) {
            validationError('coverImageId must be a positive integer or null');
          }
          coverImageId = value as number | null;
        }
        // updateGallery/setGalleryCover 对缺失 id 静默成功，404 语义由预检提供
        const existing = await getGallery(galleryId);
        if (!existing.success || !existing.data) {
          notFound();
        }
        if (hasName) {
          const result = await updateGallery(galleryId, { name });
          if (!result.success) {
            throw new ApiHttpError(500, 'INTERNAL_ERROR', result.error || 'Failed to rename gallery');
          }
        }
        if (hasCover) {
          const result = await setGalleryCover(galleryId, coverImageId);
          if (!result.success) {
            // 存在性/成员校验失败按 422（仓内 validationError 惯例；spec §6.1）
            if (result.error === 'Cover image not found' || result.error === 'Cover image not in gallery') {
              validationError(result.error);
            }
            throw new ApiHttpError(500, 'INTERNAL_ERROR', result.error || 'Failed to set gallery cover');
          }
        }
        return { updated: true };
      },
    },
```

`src/main/services/syncService.ts`——`listSyncGalleries` 整体替换 + 文件头注释「契约要点」补一条：

```ts
export async function listSyncGalleries(): Promise<Array<{
  id: number;
  name: string;
  coverImageId: number | null;
  imageCount: number;
  createdAt: string;
}>> {
  const db = await getDatabase();
  // 有效封面（v0.6 spec §6.2）：显式封面 ?? 最近加入的一张（gallery_images.addedAt 倒序）；
  // 只发生在读侧，不回写。createdAt 供安卓相册「创建时间」排序（spec §6.3）。
  return all(db, `
    SELECT g.id, g.name,
           COALESCE(
             g.coverImageId,
             (SELECT gi.imageId FROM gallery_images gi
               JOIN images im ON im.id = gi.imageId
              WHERE gi.galleryId = g.id
              ORDER BY gi.addedAt DESC, gi.imageId DESC LIMIT 1)
           ) AS coverImageId,
           g.imageCount, g.createdAt
      FROM galleries g ORDER BY g.id`);
}
```

头注释追加行：`*  - listSyncGalleries 下发「有效封面」（显式 ?? 最近加入）与 createdAt（v0.6 安卓排序用）；`

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/main/services/galleryService.setCover.test.ts tests/main/api/routes.galleryWrite.test.ts tests/main/services/syncService.test.ts tests/main/api/routes.sync.test.ts tests/main/api/endpointCoverage.test.ts tests/main/api/permissions.test.ts && npm run typecheck
```
预期全绿（routes.sync.test 的 galleries 用例 mock 返回值若被字段全等断言卡住，补 createdAt 字段）。

- [ ] **Step 5: Commit**

```bash
git add src/main/services/galleryService.ts src/main/services/syncService.ts src/main/api/routes/galleryWriteRoutes.ts tests/main/
git commit -m "feat(api): 图集封面能力包——PATCH 接受 coverImageId（成员校验/null 清除）、sync 载荷下发有效封面与 createdAt"
```

### Task 4: DAO 排序变体（RawQuery 化，行为保持默认序）

**Files:**
- Create: `data/db/TimelineQueries.kt`
- Modify: `data/db/ImageDao.kt`（timelinePagingSource 换 @RawQuery 签名）
- Modify: `data/db/GalleryDao.kt`（galleryImagesPagingSource 换 @RawQuery 签名）
- Modify: `ui/photos/PhotosViewModel.kt`、`ui/albums/AlbumDetailViewModel.kt`、`ui/viewer/ViewerViewModel.kt`（调用点传 `PhotoSort.DEFAULT` 查询，**本任务不接动态排序**——保持行为不变、任务独立绿）
- Test: `data/db/TimelineQueriesTest.kt`（新建）、`data/db/ImageDaoTest.kt` / `data/db/GalleryDaoTest.kt`（调用点适配 + 排序变体用例）

- [ ] **Step 1: 写失败测试**

`data/db/TimelineQueriesTest.kt`（Robolectric + inMemory，装置同 GalleryDaoTest）：

```kotlin
package com.bluskysoftware.yandegallery.data.db

import androidx.paging.PagingSource
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TimelineQueriesTest {
    private lateinit var db: AppDatabase

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
    }

    @After
    fun teardown() = db.close()

    private fun img(id: Long, createdAt: String, size: Long, name: String) = ImageEntity(
        id = id, filename = name, width = 1, height = 1, fileSize = size,
        format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    private suspend fun loadIds(source: PagingSource<Int, ImageEntity>): List<Long> {
        val page = source.load(PagingSource.LoadParams.Refresh(null, 50, false)) as PagingSource.LoadResult.Page
        return page.data.map { it.id }
    }

    private suspend fun seed() {
        db.imageDao().upsertAll(listOf(
            img(1, "2026-01-03T00:00:00.000Z", size = 300, name = "b.jpg"),
            img(2, "2026-01-01T00:00:00.000Z", size = 100, name = "c.jpg"),
            img(3, "2026-01-02T00:00:00.000Z", size = 200, name = "a.jpg"),
        ))
    }

    @Test
    fun `时间轴六种排序变体顺序正确`() = runTest {
        seed()
        val dao = db.imageDao()
        assertEquals(listOf(1L, 3L, 2L), loadIds(dao.timelinePagingSource(buildTimelineQuery(PhotoSort.TIME_DESC))))
        assertEquals(listOf(2L, 3L, 1L), loadIds(dao.timelinePagingSource(buildTimelineQuery(PhotoSort.TIME_ASC))))
        assertEquals(listOf(1L, 3L, 2L), loadIds(dao.timelinePagingSource(buildTimelineQuery(PhotoSort.SIZE_DESC))))
        assertEquals(listOf(2L, 3L, 1L), loadIds(dao.timelinePagingSource(buildTimelineQuery(PhotoSort.SIZE_ASC))))
        assertEquals(listOf(3L, 1L, 2L), loadIds(dao.timelinePagingSource(buildTimelineQuery(PhotoSort.NAME_ASC))))
        assertEquals(listOf(2L, 1L, 3L), loadIds(dao.timelinePagingSource(buildTimelineQuery(PhotoSort.NAME_DESC))))
    }

    @Test
    fun `同值时二级键 id 方向随主键（分页稳定序）`() = runTest {
        db.imageDao().upsertAll(listOf(
            img(1, "2026-01-01T00:00:00.000Z", 100, "same.jpg"),
            img(2, "2026-01-01T00:00:00.000Z", 100, "same.jpg"),
        ))
        assertEquals(listOf(2L, 1L), loadIds(db.imageDao().timelinePagingSource(buildTimelineQuery(PhotoSort.TIME_DESC))))
        assertEquals(listOf(1L, 2L), loadIds(db.imageDao().timelinePagingSource(buildTimelineQuery(PhotoSort.TIME_ASC))))
    }

    @Test
    fun `图集成员分页只含成员且按变体排序`() = runTest {
        seed()
        db.galleryDao().replaceAll(listOf(GalleryEntity(9, "g", null, 2)))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(9, 1), GalleryImageEntity(9, 2)))
        val dao = db.galleryDao()
        assertEquals(listOf(1L, 2L), loadIds(dao.galleryImagesPagingSource(buildGalleryImagesQuery(9, PhotoSort.TIME_DESC))))
        assertEquals(listOf(2L, 1L), loadIds(dao.galleryImagesPagingSource(buildGalleryImagesQuery(9, PhotoSort.SIZE_ASC))))
        assertEquals(listOf(1L, 2L), loadIds(dao.galleryImagesPagingSource(buildGalleryImagesQuery(9, PhotoSort.NAME_ASC))))  // b<c
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.data.db.TimelineQueriesTest"
```
预期：编译失败（buildTimelineQuery 未定义）。

- [ ] **Step 3: 实现**

新建 `data/db/TimelineQueries.kt`：

```kotlin
package com.bluskysoftware.yandegallery.data.db

import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteQuery
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort

/** 时间轴分页查询（spec §3.3）：ORDER BY 由 PhotoSort 白名单枚举拼接（无用户输入，无注入面）。 */
fun buildTimelineQuery(sort: PhotoSort): SupportSQLiteQuery =
    SimpleSQLiteQuery("SELECT * FROM images ORDER BY ${sort.orderBy()}")

/** 图集成员分页查询（spec §5.1）：同款排序白名单；galleryId 走绑定参数。 */
fun buildGalleryImagesQuery(galleryId: Long, sort: PhotoSort): SupportSQLiteQuery =
    SimpleSQLiteQuery(
        """SELECT i.* FROM images i
           JOIN gallery_images gi ON gi.imageId = i.id
           WHERE gi.galleryId = ?
           ORDER BY ${sort.orderBy("i.")}""",
        arrayOf<Any>(galleryId),
    )
```

`data/db/ImageDao.kt`——原 `timelinePagingSource()`（固定 @Query）替换为：

```kotlin
    // 时间轴分页（v0.6 spec §3.3）：ORDER BY 随 PhotoSort 运行时拼接，走 @RawQuery（同 search 先例）；
    // 查询由 TimelineQueries.buildTimelineQuery 构造，白名单枚举无注入面。
    @RawQuery(observedEntities = [ImageEntity::class])
    fun timelinePagingSource(query: androidx.sqlite.db.SupportSQLiteQuery): PagingSource<Int, ImageEntity>
```

`data/db/GalleryDao.kt`——原 `galleryImagesPagingSource(galleryId)`（固定 @Query）替换为：

```kotlin
    /** 图集成员分页（v0.6 spec §5.1 排序变体化）：查询由 buildGalleryImagesQuery 构造。 */
    @RawQuery(observedEntities = [ImageEntity::class, GalleryImageEntity::class])
    fun galleryImagesPagingSource(query: androidx.sqlite.db.SupportSQLiteQuery): PagingSource<Int, ImageEntity>
```

三个调用点同步适配（**本任务只传默认序**，动态排序在 Task 6/10 接线）：

- `ui/photos/PhotosViewModel.kt`：`graph.db.imageDao().timelinePagingSource()` → `graph.db.imageDao().timelinePagingSource(buildTimelineQuery(PhotoSort.DEFAULT))`，import `com.bluskysoftware.yandegallery.data.db.buildTimelineQuery` 与 `com.bluskysoftware.yandegallery.data.prefs.PhotoSort`。
- `ui/viewer/ViewerViewModel.kt`：Pager 工厂内改
  ```kotlin
  if (gid != null) graph.db.galleryDao().galleryImagesPagingSource(buildGalleryImagesQuery(gid, PhotoSort.DEFAULT))
  else graph.db.imageDao().timelinePagingSource(buildTimelineQuery(PhotoSort.DEFAULT))
  ```
- `ui/albums/AlbumDetailViewModel.kt`：`galleryImagesPagingSource(galleryId)` → `galleryImagesPagingSource(buildGalleryImagesQuery(galleryId, PhotoSort.DEFAULT))`。

`ImageDaoTest`/`GalleryDaoTest` 里既有对这两个方法的直接调用同步补查询参数（用 `PhotoSort.DEFAULT`），断言不变。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.data.db.TimelineQueriesTest --tests com.bluskysoftware.yandegallery.data.db.ImageDaoTest --tests com.bluskysoftware.yandegallery.data.db.GalleryDaoTest --tests com.bluskysoftware.yandegallery.ui.photos.PhotosViewModelTest --tests com.bluskysoftware.yandegallery.ui.viewer.ViewerViewModelTest --tests com.bluskysoftware.yandegallery.ui.albums.AlbumDetailViewModelTest"
```
预期 BUILD SUCCESSFUL（行为与原固定序完全一致，既有 VM 测试零改动过）。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/data/db/ android/app/src/main/java/com/bluskysoftware/yandegallery/ui/ android/app/src/test/java/com/bluskysoftware/yandegallery/data/db/
git commit -m "refactor(android): 时间轴与图集成员分页 RawQuery 化——PhotoSort 白名单排序变体就绪，行为保持默认序"
```

---

### Task 5: MiuiOptionsSheet 公共组件（sheet 容器 + 排序/单选/导航行）

**Files:**
- Create: `ui/common/MiuiOptionsSheet.kt`
- Test: `ui/common/MiuiOptionsSheetTest.kt`（新建，Robolectric compose；装置沿用 MiuiDialogTest）

- [ ] **Step 1: 写失败测试**

```kotlin
package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import com.bluskysoftware.yandegallery.ui.theme.YandeGalleryTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MiuiOptionsSheetTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun `排序行选中态显示方向箭头_点击回调`() {
        var clicks = 0
        rule.setContent {
            YandeGalleryTheme {
                MiuiSheetCard("排序方式") {
                    MiuiSortRow("时间", selected = true, ascending = false, tag = "sort_option_time") { clicks++ }
                    MiuiSortRow("文件大小", selected = false, ascending = false, tag = "sort_option_size") { clicks++ }
                }
            }
        }
        rule.onNodeWithTag("sort_option_time").assertIsDisplayed().performClick()
        rule.onNodeWithTag("sort_option_time_dir", useUnmergedTree = true).assertIsDisplayed()   // 选中行有箭头
        rule.onNodeWithTag("sort_option_size_dir", useUnmergedTree = true).assertDoesNotExist()  // 未选行无箭头
        assertEquals(1, clicks)
    }

    @Test
    fun `单选行选中态显示勾_导航行可点`() {
        var navClicks = 0
        rule.setContent {
            YandeGalleryTheme {
                MiuiSheetCard("网格密度") {
                    MiuiChoiceRow("标准（4 列）", selected = true, tag = "density_option_day4") {}
                    MiuiChoiceRow("紧凑（5 列）", selected = false, tag = "density_option_day5") {}
                }
                MiuiSheetCard("更多") {
                    MiuiSheetNavRow("设置", tag = "sheet_settings_row") { navClicks++ }
                }
            }
        }
        rule.onNodeWithTag("density_option_day4_check", useUnmergedTree = true).assertIsDisplayed()
        rule.onNodeWithTag("density_option_day5_check", useUnmergedTree = true).assertDoesNotExist()
        rule.onNodeWithTag("sheet_settings_row").performClick()
        assertEquals(1, navClicks)
    }
}
```

（`assertDoesNotExist` 来自 `androidx.compose.ui.test.onNodeWithTag(...).assertDoesNotExist()`，import 随 IDE 提示补。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.ui.common.MiuiOptionsSheetTest"
```
预期：编译失败。

- [ ] **Step 3: 实现**

新建 `ui/common/MiuiOptionsSheet.kt`：

```kotlin
package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/**
 * MIUI 皮选项面板（spec §3.1/§4.4/§5.1 共用）：底部弹层 + 卡片分组内容插槽。
 * 选择即生效即收面板（无确认键）——收面板由调用方在回调里做。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MiuiOptionsSheet(onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.background,
        shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
        dragHandle = null,
        modifier = Modifier.testTag("options_sheet"),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(top = 20.dp, bottom = 16.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

/** 面板内分组卡片：MiuiCardGroup 同款观感（12dp 圆角 surfaceContainer + 组外灰字标题）。 */
@Composable
fun MiuiSheetCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(
            title,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 16.dp, bottom = 6.dp),
        )
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceContainer,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(content = content)
        }
    }
}

/** 排序字段行（spec §3.1）：选中主色 + 行尾方向箭头；切字段/翻方向语义由调用方经 next() 决定。 */
@Composable
fun MiuiSortRow(label: String, selected: Boolean, ascending: Boolean, tag: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .testTag(tag),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        if (selected) {
            Icon(
                if (ascending) Icons.Filled.ArrowUpward else Icons.Filled.ArrowDownward,
                contentDescription = if (ascending) "升序" else "降序",
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp).testTag("${tag}_dir"),
            )
        }
    }
}

/** 单选档位行（密度/列数/手动排序）：选中主色 + 行尾蓝勾。 */
@Composable
fun MiuiChoiceRow(label: String, selected: Boolean, tag: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .testTag(tag),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        if (selected) {
            Icon(
                Icons.Filled.Check,
                contentDescription = "已选",
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp).testTag("${tag}_check"),
            )
        }
    }
}

/** 导航行（设置/拖拽排序入口）：行尾 chevron。 */
@Composable
fun MiuiSheetNavRow(label: String, tag: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .testTag(tag),
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        )
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

同 Step 2 命令，预期 BUILD SUCCESSFUL。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ui/common/MiuiOptionsSheet.kt android/app/src/test/java/com/bluskysoftware/yandegallery/ui/common/MiuiOptionsSheetTest.kt
git commit -m "feat(android): MiuiOptionsSheet 公共选项面板——卡片分组+排序行/单选行/导航行"
```

### Task 6: 照片页——「⋯」面板（排序+密度+设置）+ 平铺模式 + Viewer 排序贯通

**Files:**
- Modify: `ui/photos/TimelineModels.kt`（抽分组头纯函数）
- Modify: `ui/photos/PhotosViewModel.kt`（photoSort 接 ViewPrefs + pagingFlow 随排序重建 + 平铺分支）
- Modify: `ui/photos/PhotosScreen.kt`（顶栏 [搜索][⋯]、PhotosOptionsSheet、平铺门控、排序回顶）
- Modify: `ui/AppNav.kt`（AppNavForTest 适配新顶栏签名）
- Modify: `ui/viewer/ViewerViewModel.kt`（Pager 读 ViewPrefs 当前排序）
- Test: `ui/photos/TimelineModelsTest.kt`（追加）、`ui/photos/PhotosViewModelTest.kt`（追加）、`ui/photos/PhotosScreenTest.kt`（追加/适配）、`ui/AppNavTest.kt`（适配）

- [ ] **Step 1: 写失败测试**

`TimelineModelsTest.kt` 追加：

```kotlin
@Test
fun `timelineSeparatorBetween 跨日插头_同日不插_首项必插`() {
    val today = LocalDate.of(2026, 7, 9)
    val p1 = TimelineItem.Photo(imageAt("2026-07-08T10:00:00.000Z"))   // ← 用该文件既有的 ImageEntity 构造 helper，无则新建
    val p2 = TimelineItem.Photo(imageAt("2026-07-08T09:00:00.000Z"))
    val p3 = TimelineItem.Photo(imageAt("2026-07-07T09:00:00.000Z"))
    assertNotNull(timelineSeparatorBetween(null, p1, monthly = false, today))          // 首项
    assertNull(timelineSeparatorBetween(p1, p2, monthly = false, today))               // 同日
    val header = timelineSeparatorBetween(p2, p3, monthly = false, today)              // 跨日
    assertEquals("2026-07-07", header!!.dayKey)
}

@Test
fun `timelineSeparatorBetween 月粒度按月键分组`() {
    val today = LocalDate.of(2026, 7, 9)
    val jun = TimelineItem.Photo(imageAt("2026-06-30T10:00:00.000Z"))
    val jul = TimelineItem.Photo(imageAt("2026-07-01T10:00:00.000Z"))
    assertNull(timelineSeparatorBetween(jul, TimelineItem.Photo(imageAt("2026-07-02T10:00:00.000Z")).let { it }, monthly = true, today).let { if (it?.dayKey == "2026-07") null else it })
    assertEquals("2026-06", timelineSeparatorBetween(jul, jun, monthly = true, today)!!.dayKey)
}
```

`PhotosViewModelTest.kt` 追加（沿用该文件既有 graph/prefs 装置）：

```kotlin
@Test
fun `photoSort 写穿 ViewPrefs 并异步落盘`() = runTest {
    // 装置：沿用本文件既有 AppGraph 构造（in-memory db + 临时 PrefsStore override）
    vm.setPhotoSort(PhotoSort.SIZE_DESC)
    assertEquals(PhotoSort.SIZE_DESC, graph.viewPrefs.photoSort.value)   // 共享实例即时可见（spec §3.4）
    advanceUntilIdle()
    assertEquals("SIZE_DESC", graph.prefsStore.photosSortName.first())
}
```

`PhotosScreenTest.kt` 追加（沿用该文件既有真 VM + in-memory graph 装置；`rule.waitForIdle()` 驱动 sheet 弹出）：

```kotlin
@Test
fun `更多面板_切排序即生效并收面板_设置行触发回调`() {
    var settingsOpened = 0
    // 装置：本文件既有 setPhotosScreen(...) 形态，onOpenSettings = { settingsOpened++ }
    rule.onNodeWithTag("photos_more").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("options_sheet").assertIsDisplayed()
    rule.onNodeWithTag("sort_option_size").performClick()
    rule.waitForIdle()
    assertEquals(PhotoSort.SIZE_DESC, graph.viewPrefs.photoSort.value)
    rule.onNodeWithTag("options_sheet").assertDoesNotExist()   // 选择即收
    rule.onNodeWithTag("photos_more").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("sheet_settings_row").performClick()
    rule.waitForIdle()
    assertEquals(1, settingsOpened)
}

@Test
fun `更多面板_密度行走 changeTier 档位即时切换`() {
    rule.onNodeWithTag("photos_more").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("density_option_day3").performClick()
    rule.waitForIdle()
    assertEquals(DensityTier.DAY_3, vm.densityTier.value)
}
```

`AppNavTest.kt`：`PhotosPinnedTopBar` 相关用例适配新签名——搜索入口用例保留；「设置入口」路由用例改为验证 `photos_more` 存在即可（设置跳转覆盖已移至 PhotosScreenTest 的 sheet 设置行用例，本处不再穿 NavHost）。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.ui.photos.TimelineModelsTest --tests com.bluskysoftware.yandegallery.ui.photos.PhotosViewModelTest --tests com.bluskysoftware.yandegallery.ui.photos.PhotosScreenTest"
```
预期：编译失败（timelineSeparatorBetween/setPhotoSort 未定义）。

- [ ] **Step 3: 实现**

`ui/photos/TimelineModels.kt` 末尾追加（PhotosViewModel 的 insertSeparators 逻辑原样抽出）：

```kotlin
/**
 * 相邻两项之间是否插分组头（v0.6 抽出纯函数供直测；PhotosViewModel.insertSeparators 委托）。
 * 仅时间排序调用——平铺模式（非时间排序，spec §3.2)不插任何分组头。
 */
fun timelineSeparatorBetween(
    before: TimelineItem?,
    after: TimelineItem?,
    monthly: Boolean,
    today: LocalDate,
): TimelineItem.Header? {
    val afterPhoto = after as? TimelineItem.Photo ?: return null
    val afterKey = if (monthly) monthKeyOf(afterPhoto.image.createdAt) else dayKeyOf(afterPhoto.image.createdAt)
    val beforeKey = (before as? TimelineItem.Photo)?.let {
        if (monthly) monthKeyOf(it.image.createdAt) else dayKeyOf(it.image.createdAt)
    }
    return if (beforeKey != afterKey) {
        TimelineItem.Header(
            afterKey,
            if (monthly) monthHeaderDisplayOf(afterKey, today) else dayHeaderDisplayOf(afterKey, today),
        )
    } else {
        null
    }
}
```

`ui/photos/PhotosViewModel.kt`：

1. import 补 `com.bluskysoftware.yandegallery.data.db.buildTimelineQuery`（Task 4 已有）、`com.bluskysoftware.yandegallery.data.prefs.PhotoSort`、`kotlinx.coroutines.flow.combine`。
2. 密度档声明后追加：

```kotlin
    /** 照片排序（v0.6 spec §3）：共享 ViewPrefs——Viewer 同源保证网格与翻页同序（§3.4）。 */
    val photoSort: StateFlow<PhotoSort> = graph.viewPrefs.photoSort

    fun setPhotoSort(sort: PhotoSort) = graph.viewPrefs.setPhotoSort(sort)
```

3. `pagingFlow` 整体替换：

```kotlin
    /**
     * 时间轴分页流（M4-T2 重构 + v0.6 排序变体）：「月↔日分组粒度」或「排序」变化经 flatMapLatest
     * 重建（丢滚动位置——排序切换由 Screen 回顶，月日切换由 T3 锚定回原日期）；纯列数变化不重建。
     * 平铺模式（spec §3.2）：非时间排序不插分组头，网格纯照片流。
     */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val pagingFlow: Flow<PagingData<TimelineItem>> =
        combine(
            densityTier.map { it.monthGrouping }.distinctUntilChanged(),
            graph.viewPrefs.photoSort,
        ) { monthly, sort -> monthly to sort }
            .distinctUntilChanged()
            .flatMapLatest { (monthly, sort) ->
                Pager(PagingConfig(pageSize = 120, enablePlaceholders = false)) {
                    graph.db.imageDao().timelinePagingSource(buildTimelineQuery(sort))
                }.flow
                    .map { data -> data.map<ImageEntity, TimelineItem> { TimelineItem.Photo(it) } }
                    .map { data ->
                        if (!sort.isTime) return@map data   // 平铺：无日期分组语义
                        data.insertSeparators { before, after ->
                            timelineSeparatorBetween(before, after, monthly, LocalDate.now())
                        }
                    }
            }
            .cachedIn(viewModelScope)
```

`ui/photos/PhotosScreen.kt`：

1. import 补 `androidx.compose.material.icons.filled.MoreHoriz`、`com.bluskysoftware.yandegallery.data.prefs.PhotoSort`、`com.bluskysoftware.yandegallery.data.prefs.PhotoSortField`、`com.bluskysoftware.yandegallery.ui.common.MiuiOptionsSheet`、`MiuiSheetCard`、`MiuiSortRow`、`MiuiChoiceRow`、`MiuiSheetNavRow`。
2. `PhotosPinnedTopBar` 整体替换（签名 onOpenSettings → onOpenMore；设置入口迁入面板，spec §3.1）：

```kotlin
/**
 * 照片 tab 常态顶栏（v0.6 spec §3.1）：[搜索][⋯]。设置入口迁入「⋯」面板（MIUI 同款层级）。
 * internal 供 AppNavForTest 挂真件覆盖搜索路由跳转。
 */
@Composable
internal fun PhotosPinnedTopBar(
    scrolled: Boolean,
    onOpenSearch: () -> Unit,
    onOpenMore: () -> Unit,
) {
    MiuiPinnedTopBar(title = "照片", scrolled = scrolled, actions = {
        IconButton(onClick = onOpenSearch, modifier = Modifier.testTag("photos_search")) {
            Icon(Icons.Filled.Search, contentDescription = "搜索")
        }
        IconButton(onClick = onOpenMore, modifier = Modifier.testTag("photos_more")) {
            Icon(Icons.Filled.MoreHoriz, contentDescription = "更多选项")
        }
    })
}
```

（无服务器引导分支的顶栏保持现状——直挂设置图标，排序/密度对空库无意义。）

3. PhotosScreen 主体，`val tier by ...` 附近追加状态：

```kotlin
    val sort by viewModel.photoSort.collectAsStateWithLifecycle()
    var showOptions by rememberSaveable { mutableStateOf(false) }
```

非多选分支顶栏调用改为：

```kotlin
                PhotosPinnedTopBar(
                    scrolled = header.scrolled,
                    onOpenSearch = onOpenSearch,
                    onOpenMore = { showOptions = true },
                )
```

4. `changeTier` 内锚定判据补平铺门控（平铺无分组头，锚定无意义且必失败弃锚）：

```kotlin
        if (new.monthGrouping != current.monthGrouping && sort.isTime) {
```

5. 排序切换回顶（spec §3.3；跳过首帧——导航返回恢复组合时不得重置滚动位置）。放在 header 的 LaunchedEffect 之后：

```kotlin
    // 排序切换回顶：lastAppliedSort 经 rememberSaveable 抗重组/返回恢复，仅真实切换时回顶
    var lastAppliedSort by rememberSaveable { mutableStateOf(sort.name) }
    LaunchedEffect(sort) {
        if (sort.name != lastAppliedSort) {
            lastAppliedSort = sort.name
            gridState.scrollToItem(0)
        }
    }
```

6. 平铺门控（spec §3.2）：`topDateLabel` 的 derivedStateOf 改为（remember 键补 sort）：

```kotlin
                        val topDateLabel by remember(items, tier, sort) {
                            derivedStateOf {
                                if (!sort.isTime) return@derivedStateOf null   // 平铺：sticky 胶囊不显示
                                val top = gridState.firstVisibleItemIndex
                                (top downTo maxOf(0, top - 30)).firstNotNullOfOrNull { i ->
                                    if (i in 0 until items.itemCount) {
                                        timelineItemDateLabel(items.peek(i), tier.monthGrouping)
                                    } else {
                                        null
                                    }
                                }
                            }
                        }
```

`FastScrollbar` 的 `labelFor` 改为：

```kotlin
                            labelFor = { index ->
                                if (!sort.isTime) {
                                    null   // 平铺：日期气泡整体隐藏（spec §3.2）
                                } else if (index in 0 until items.itemCount) {
                                    timelineItemDateLabel(items.peek(index), tier.monthGrouping)
                                } else {
                                    null
                                }
                            },
```

（核实 `ui/common/FastScrollbar.kt`：若 label 为 null 时仍渲染空气泡壳，在气泡渲染处补 `label != null` 门并在 FastScrollbarTest 加一条用例；若本就不渲染则不动。）

7. 文件内（PhotosGuide 之前）新增面板装配：

```kotlin
/** 照片页「⋯」选项面板（spec §3.1）：排序 + 网格密度 + 设置。选择即生效即收。 */
@Composable
internal fun PhotosOptionsSheet(
    sort: PhotoSort,
    tier: DensityTier,
    onDismiss: () -> Unit,
    onSortField: (PhotoSortField) -> Unit,
    onTier: (DensityTier) -> Unit,
    onOpenSettings: () -> Unit,
) {
    MiuiOptionsSheet(onDismiss = onDismiss) {
        MiuiSheetCard("排序方式") {
            PhotoSortField.entries.forEach { field ->
                MiuiSortRow(
                    label = field.label,
                    selected = field.contains(sort),
                    ascending = sort.ascending,
                    tag = "sort_option_${field.name.lowercase()}",
                ) { onSortField(field) }
            }
        }
        MiuiSheetCard("网格密度") {
            MiuiChoiceRow("月视图（6 列）", tier == DensityTier.MONTH, "density_option_month") { onTier(DensityTier.MONTH) }
            MiuiChoiceRow("大图（3 列）", tier == DensityTier.DAY_3, "density_option_day3") { onTier(DensityTier.DAY_3) }
            MiuiChoiceRow("标准（4 列）", tier == DensityTier.DAY_4, "density_option_day4") { onTier(DensityTier.DAY_4) }
            MiuiChoiceRow("紧凑（5 列）", tier == DensityTier.DAY_5, "density_option_day5") { onTier(DensityTier.DAY_5) }
        }
        MiuiSheetCard("更多") {
            MiuiSheetNavRow("设置", tag = "sheet_settings_row", onClick = onOpenSettings)
        }
    }
}
```

PhotosScreen 主体尾部（批量删除对话框之前）挂面板：

```kotlin
    if (showOptions) {
        PhotosOptionsSheet(
            sort = sort,
            tier = tier,
            onDismiss = { showOptions = false },
            onSortField = { field -> viewModel.setPhotoSort(field.next(sort)); showOptions = false },
            onTier = { changeTier(it); showOptions = false },   // 走 changeTier 复用月↔日锚定
            onOpenSettings = { showOptions = false; onOpenSettings() },
        )
    }
```

`ui/AppNav.kt`——AppNavForTest 的 photosContent 适配：

```kotlin
            photosContent = {
                Column {
                    PhotosPinnedTopBar(
                        scrolled = false,
                        onOpenSearch = { nav.navigate(Routes.search()) },
                        onOpenMore = {},
                    )
                    Text("照片页占位")
                }
            },
```

`ui/viewer/ViewerViewModel.kt`——pagingFlow 的 Pager 工厂替换（Task 4 已传 DEFAULT，本步接真值）：

```kotlin
    val pagingFlow: Flow<PagingData<ImageEntity>> =
        Pager(PagingConfig(pageSize = 120, enablePlaceholders = false)) {
            val gid = galleryId
            // 与网格同序（v0.6 spec §3.4）：开页瞬间读共享 ViewPrefs 当前值——viewer 只能从已应用
            // 该排序的网格进入，内存态先于导航更新，无脏读窗口。搜索进入沿用时间轴上下文（既有口径）。
            if (gid != null) {
                graph.db.galleryDao().galleryImagesPagingSource(
                    buildGalleryImagesQuery(gid, graph.viewPrefs.detailSort.value),
                )
            } else {
                graph.db.imageDao().timelinePagingSource(buildTimelineQuery(graph.viewPrefs.photoSort.value))
            }
        }.flow.cachedIn(viewModelScope)
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.ui.photos.TimelineModelsTest --tests com.bluskysoftware.yandegallery.ui.photos.PhotosViewModelTest --tests com.bluskysoftware.yandegallery.ui.photos.PhotosScreenTest --tests com.bluskysoftware.yandegallery.ui.AppNavTest --tests com.bluskysoftware.yandegallery.ui.viewer.ViewerViewModelTest --tests com.bluskysoftware.yandegallery.M4DensityPrefsE2ETest"
```
预期 BUILD SUCCESSFUL。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ui/ android/app/src/test/java/com/bluskysoftware/yandegallery/ui/
git commit -m "feat(android): 照片页「⋯」面板与平铺模式——排序/密度/设置入口收敛，非时间排序去日期头，Viewer 排序同源贯通"
```

### Task 7: 相册页——三分区自适应网格 + 组织菜单 + 排序面板

**Files:**
- Create: `ui/albums/AlbumSections.kt`（分区组装纯函数）
- Create: `ui/albums/AlbumCardItem.kt`（卡片从 AlbumsScreen 抽出，菜单插槽化）
- Modify: `data/prefs/SortModels.kt`（AlbumSort 补 `ascending` 属性）
- Modify: `ui/albums/AlbumsViewModel.kt`（sections 三分区流 + setPinned/setInOther）
- Modify: `ui/albums/AlbumsScreen.kt`（自适应网格/分区头/其他相册行/「⋯」面板/菜单扩展）
- Modify: `ui/AppNav.kt`（仅 `Routes.OtherAlbums` 常量，路由注册在 Task 8）
- Test: `ui/albums/AlbumSectionsTest.kt`（新建）、`ui/albums/AlbumsViewModelTest.kt`（改写）、`ui/albums/AlbumsOrganizeTest.kt`（新建 compose 契约）、`ui/albums/AlbumsWriteTest.kt`（适配）

- [ ] **Step 1: 写失败测试**

`ui/albums/AlbumSectionsTest.kt`（纯 JVM）：

```kotlin
package com.bluskysoftware.yandegallery.ui.albums

import com.bluskysoftware.yandegallery.data.db.AlbumPrefsEntity
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.prefs.AlbumSort
import org.junit.Assert.assertEquals
import org.junit.Test

class AlbumSectionsTest {
    private fun card(id: Long, name: String, count: Int = 0, createdAt: String? = null) =
        AlbumCard(GalleryEntity(id, name, null, count, createdAt), coverImageId = null)

    private fun prefs(vararg items: AlbumPrefsEntity) = items.associateBy { it.galleryId }

    @Test
    fun `置顶与其他相册分区_置顶按pinnedAt新到旧`() {
        val sections = assembleAlbumSections(
            listOf(card(1, "a"), card(2, "b"), card(3, "c"), card(4, "d")),
            prefs(
                AlbumPrefsEntity(1, pinned = true, pinnedAt = 100L),
                AlbumPrefsEntity(3, pinned = true, pinnedAt = 200L),
                AlbumPrefsEntity(4, inOther = true),
            ),
            AlbumSort.NAME_ASC,
        )
        assertEquals(listOf(3L, 1L), sections.pinned.map { it.gallery.id })   // 新置顶在前
        assertEquals(listOf(2L), sections.normal.map { it.gallery.id })
        assertEquals(listOf(4L), sections.other.map { it.gallery.id })
    }

    @Test
    fun `名称与张数排序_同值按名兜底`() {
        val cards = listOf(card(1, "b", 5), card(2, "a", 5), card(3, "c", 9))
        assertEquals(listOf(2L, 1L, 3L), assembleAlbumSections(cards, emptyMap(), AlbumSort.NAME_ASC).normal.map { it.gallery.id })
        assertEquals(listOf(3L, 1L, 2L), assembleAlbumSections(cards, emptyMap(), AlbumSort.NAME_DESC).normal.map { it.gallery.id })
        assertEquals(listOf(3L, 2L, 1L), assembleAlbumSections(cards, emptyMap(), AlbumSort.COUNT_DESC).normal.map { it.gallery.id })
        assertEquals(listOf(2L, 1L, 3L), assembleAlbumSections(cards, emptyMap(), AlbumSort.COUNT_ASC).normal.map { it.gallery.id })
    }

    @Test
    fun `创建时间排序_NULL排尾按名兜底`() {
        val cards = listOf(
            card(1, "b", createdAt = "2026-01-02T00:00:00.000Z"),
            card(2, "a", createdAt = null),
            card(3, "c", createdAt = "2026-01-01T00:00:00.000Z"),
        )
        assertEquals(listOf(1L, 3L, 2L), assembleAlbumSections(cards, emptyMap(), AlbumSort.CREATED_DESC).normal.map { it.gallery.id })
        assertEquals(listOf(3L, 1L, 2L), assembleAlbumSections(cards, emptyMap(), AlbumSort.CREATED_ASC).normal.map { it.gallery.id })
    }

    @Test
    fun `手动排序_无序值排尾按名`() {
        val cards = listOf(card(1, "z"), card(2, "a"), card(3, "m"))
        val sections = assembleAlbumSections(
            cards,
            prefs(AlbumPrefsEntity(1, manualOrder = 0), AlbumPrefsEntity(3, manualOrder = 1)),
            AlbumSort.MANUAL,
        )
        assertEquals(listOf(1L, 3L, 2L), sections.normal.map { it.gallery.id })   // 2 无序值排尾
    }

    @Test
    fun `手动模式下置顶区也按manualOrder`() {
        val sections = assembleAlbumSections(
            listOf(card(1, "a"), card(2, "b")),
            prefs(
                AlbumPrefsEntity(1, pinned = true, pinnedAt = 999L, manualOrder = 1),
                AlbumPrefsEntity(2, pinned = true, pinnedAt = 1L, manualOrder = 0),
            ),
            AlbumSort.MANUAL,
        )
        assertEquals(listOf(2L, 1L), sections.pinned.map { it.gallery.id })
    }
}
```

`ui/albums/AlbumsViewModelTest.kt`：既有 `albums` 流用例改写到 `sections`（同装置，断言从「扁平列表」变「normal 分区」），并追加：

```kotlin
@Test
fun `setPinned与setInOther写入album_prefs并互斥`() = runTest {
    // 装置沿用本文件：in-memory db 构造 graph + vm
    db.galleryDao().replaceAll(listOf(GalleryEntity(1, "a", null, 0)))
    vm.setPinned(1, true)
    advanceUntilIdle()
    assertTrue(db.albumPrefsDao().byId(1)!!.pinned)
    vm.setInOther(1, true)
    advanceUntilIdle()
    val row = db.albumPrefsDao().byId(1)!!
    assertTrue(row.inOther)
    assertFalse(row.pinned)   // 互斥由 DAO 事务保证
}
```

`ui/albums/AlbumsOrganizeTest.kt`（新建，Robolectric compose；装置沿用 AlbumsWriteTest：真 VM + in-memory graph + rememberNavController 包 AlbumsScreen）：

```kotlin
@Test
fun `长按菜单含组织项_置顶后出现置顶分区`() = runTest {
    // 种子：图集 1
    rule.onNodeWithTag("album_card_1").performTouchInput { longClick() }
    rule.waitForIdle()
    rule.onNodeWithTag("album_menu_pin_1").assertIsDisplayed()
    rule.onNodeWithTag("album_menu_to_other_1").assertIsDisplayed()
    rule.onNodeWithTag("album_menu_pin_1").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("albums_section_pinned").assertIsDisplayed()
    // 再长按：置顶态菜单换「取消置顶」
    rule.onNodeWithTag("album_card_1").performTouchInput { longClick() }
    rule.waitForIdle()
    rule.onNodeWithTag("album_menu_unpin_1").assertIsDisplayed()
}

@Test
fun `移入其他相册后主列表折叠行出现`() = runTest {
    // 种子：图集 1、2
    rule.onNodeWithTag("album_card_1").performTouchInput { longClick() }
    rule.waitForIdle()
    rule.onNodeWithTag("album_menu_to_other_1").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("other_albums_row").assertIsDisplayed()
    rule.onNodeWithTag("album_card_1").assertDoesNotExist()   // 已收进其他相册，不在主网格
}

@Test
fun `排序面板_点张数切COUNT_DESC`() = runTest {
    rule.onNodeWithTag("albums_more").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("album_sort_option_count").performClick()
    rule.waitForIdle()
    assertEquals(AlbumSort.COUNT_DESC, graph.viewPrefs.albumsSort.value)
}
```

（menu tag 带 `_${id}` 后缀沿用仓内 `album_menu_rename_${id}` 惯例——spec §8.2 的裸名即此含义。）

- [ ] **Step 2: 跑测试确认失败**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.ui.albums.AlbumSectionsTest --tests com.bluskysoftware.yandegallery.ui.albums.AlbumsViewModelTest --tests com.bluskysoftware.yandegallery.ui.albums.AlbumsOrganizeTest"
```
预期：编译失败（assembleAlbumSections 未定义）。

- [ ] **Step 3: 实现**

`data/prefs/SortModels.kt`——AlbumSort 补属性（枚举体内）：

```kotlin
    /** 面板方向箭头用；MANUAL 无方向（恒 false，调用方不读）。 */
    val ascending: Boolean
        get() = this == NAME_ASC || this == COUNT_ASC || this == CREATED_ASC
```

新建 `ui/albums/AlbumSections.kt`：

```kotlin
package com.bluskysoftware.yandegallery.ui.albums

import com.bluskysoftware.yandegallery.data.db.AlbumPrefsEntity
import com.bluskysoftware.yandegallery.data.prefs.AlbumSort

/** 相册页三分区模型（spec §4.2）：置顶 / 全部相册 / 其他相册。 */
data class AlbumSections(
    val pinned: List<AlbumCard>,
    val normal: List<AlbumCard>,
    val other: List<AlbumCard>,
) {
    val isEmpty: Boolean get() = pinned.isEmpty() && normal.isEmpty() && other.isEmpty()
}

/**
 * 分区组装纯函数（spec §4.2）：
 * - 归属：pinned 优先（DAO 事务保证与 inOther 互斥；万一脏数据同真，置顶优先）；
 * - 置顶区：默认按 pinnedAt 新→旧，MANUAL 模式按 manualOrder；
 * - 普通/其他区：按 [sort]；MANUAL 下 manualOrder 升序、无序值排尾按名；CREATED 下 NULL 排尾按名。
 * 所有排序以名称升序作最终兜底，保证确定性。
 */
fun assembleAlbumSections(
    cards: List<AlbumCard>,
    prefs: Map<Long, AlbumPrefsEntity>,
    sort: AlbumSort,
): AlbumSections {
    fun prefOf(card: AlbumCard) = prefs[card.gallery.id]
    val (pinnedCards, rest) = cards.partition { prefOf(it)?.pinned == true }
    val (otherCards, normalCards) = rest.partition { prefOf(it)?.inOther == true }

    val nameAsc = compareBy<AlbumCard> { it.gallery.name }
    val manual = compareBy<AlbumCard> { prefOf(it)?.manualOrder ?: Int.MAX_VALUE }.then(nameAsc)

    fun sorted(list: List<AlbumCard>): List<AlbumCard> = when (sort) {
        AlbumSort.MANUAL -> list.sortedWith(manual)
        AlbumSort.NAME_ASC -> list.sortedWith(nameAsc)
        AlbumSort.NAME_DESC -> list.sortedWith(compareByDescending<AlbumCard> { it.gallery.name }.then(nameAsc))
        AlbumSort.COUNT_DESC -> list.sortedWith(compareByDescending<AlbumCard> { it.gallery.imageCount }.then(nameAsc))
        AlbumSort.COUNT_ASC -> list.sortedWith(compareBy<AlbumCard> { it.gallery.imageCount }.then(nameAsc))
        AlbumSort.CREATED_DESC -> list.sortedWith(
            // NULL 视为最小（?: ""），降序自然排尾
            compareByDescending<AlbumCard> { it.gallery.createdAt ?: "" }.then(nameAsc),
        )
        AlbumSort.CREATED_ASC -> list.sortedWith(
            compareBy<AlbumCard> { it.gallery.createdAt == null }   // false(有值) 在前 → NULL 排尾
                .then(compareBy { it.gallery.createdAt ?: "" })
                .then(nameAsc),
        )
    }

    val pinnedSorted = if (sort == AlbumSort.MANUAL) {
        pinnedCards.sortedWith(manual)
    } else {
        pinnedCards.sortedWith(compareByDescending<AlbumCard> { prefOf(it)?.pinnedAt ?: 0L }.then(nameAsc))
    }
    return AlbumSections(pinnedSorted, sorted(normalCards), sorted(otherCards))
}
```

`ui/albums/AlbumsViewModel.kt`——`albums` 流替换为 `sections`（三态哨兵语义保留），并加组织操作：

```kotlin
    /**
     * 三分区卡片流（v0.6 spec §4.2；沿用 M4-T15 三态哨兵：null=加载中/isEmpty=确无图集）。
     * 卡片 + 组织偏好 + 排序三源 combine，组装收敛在 assembleAlbumSections 纯函数。
     */
    val sections: StateFlow<AlbumSections?> =
        combine(
            graph.db.galleryDao().observeAlbumCards(),
            graph.db.albumPrefsDao().observeAll(),
            graph.viewPrefs.albumsSort,
        ) { rows, prefs, sort ->
            val cards = rows.map { row ->
                AlbumCard(
                    gallery = GalleryEntity(row.id, row.name, row.coverImageId, row.imageCount, row.createdAt),
                    coverImageId = row.coverImageId ?: row.fallbackCoverId,
                )
            }
            assembleAlbumSections(cards, prefs.associateBy { it.galleryId }, sort)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** 相册排序（v0.6 spec §4.4）。 */
    val albumsSort: StateFlow<AlbumSort> = graph.viewPrefs.albumsSort

    fun setAlbumsSort(sort: AlbumSort) = graph.viewPrefs.setAlbumsSort(sort)

    /** 置顶/取消置顶（纯本机，离线可用，spec §4.3）；互斥与清手动序在 DAO 事务内收敛。 */
    fun setPinned(galleryId: Long, pinned: Boolean) {
        viewModelScope.launch { graph.db.albumPrefsDao().setPinned(galleryId, pinned, System.currentTimeMillis()) }
    }

    /** 移入/移出「其他相册」（纯本机，离线可用）。 */
    fun setInOther(galleryId: Long, inOther: Boolean) {
        viewModelScope.launch { graph.db.albumPrefsDao().setInOther(galleryId, inOther) }
    }
```

（import 补 `AlbumSections`/`assembleAlbumSections` 同包免导、`AlbumSort`、`combine`、`launch`；原 `albums` 属性删除。）

新建 `ui/albums/AlbumCardItem.kt`——把 AlbumsScreen 里私有 `AlbumCardItem` 迁出并把菜单插槽化（封面/名称/数量渲染逻辑**原样搬运**，含 RetryableAsyncImage 与占位分支）：

```kotlin
package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import com.bluskysoftware.yandegallery.ui.theme.MiuiTokens

/**
 * 相册卡片（v0.6 从 AlbumsScreen 抽出，主页/其他相册页/重排模式共用）：
 * 1:1 圆角封面 + 名称 + 「N 张」；长按弹菜单（[menuItems] 插槽，dismiss 由卡片收敛）；
 * [enableMenu]=false 供重排模式禁用长按菜单。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun AlbumCardItem(
    card: AlbumCard,
    baseUrl: String,
    serverId: Long,
    loader: ImageLoader,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enableMenu: Boolean = true,
    menuItems: @Composable ColumnScope.(dismiss: () -> Unit) -> Unit = {},
) {
    var menuOpen by remember { mutableStateOf(false) }
    Box(modifier) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(
                    onClick = onClick,
                    onLongClick = { if (enableMenu) menuOpen = true },
                )
                .testTag("album_card_${card.gallery.id}"),
        ) {
            val coverId = card.coverImageId
            if (coverId != null) {
                RetryableAsyncImage(
                    model = thumbnailRequest(LocalContext.current, baseUrl, serverId, coverId),
                    imageLoader = loader,
                    contentDescription = card.gallery.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().aspectRatio(1f).clip(MiuiTokens.CoverShape),
                )
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(1f)
                        .clip(MiuiTokens.CoverShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
            }
            Text(
                card.gallery.name,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(top = 8.dp),
            )
            Text(
                "${card.gallery.imageCount} 张",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            menuItems { menuOpen = false }
        }
    }
}
```

`ui/albums/AlbumsScreen.kt` 改造（新建/重命名/删除对话框与 Snackbar 逻辑**全部不动**）：

1. 删除文件内旧私有 `AlbumCardItem`；import 补 `MoreHoriz`、`GridItemSpan`、`DropdownMenuItem`、`Icon`/`Row`/`Spacer` 相关、`MiuiOptionsSheet` 家族、`AlbumSort`/`AlbumSortField`、`RoundedCornerShape`、`Icons.AutoMirrored.Filled.KeyboardArrowRight`。
2. 状态区追加：`val sort by viewModel.albumsSort.collectAsStateWithLifecycle()`、`var showOptions by rememberSaveable { mutableStateOf(false) }`，`albums` 换 `val sections by viewModel.sections.collectAsStateWithLifecycle()`。
3. 顶栏 actions 在「+」之后追加：

```kotlin
                IconButton(onClick = { showOptions = true }, modifier = Modifier.testTag("albums_more")) {
                    Icon(Icons.Filled.MoreHoriz, contentDescription = "更多选项", tint = MaterialTheme.colorScheme.onSurface)
                }
```

4. 网格分支替换（自适应 + 三分区，spec §4.1/§4.2）：

```kotlin
            val current = sections
            when {
                current == null -> Box(Modifier.fillMaxSize())   // 加载中（A7 哨兵语义不变）
                current.isEmpty -> AlbumsEmpty()
                else -> LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 104.dp),
                    state = gridState,
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize().testTag("albums_grid"),
                ) {
                    if (current.pinned.isNotEmpty()) {
                        item(key = "hdr_pinned", span = { GridItemSpan(maxLineSpan) }) {
                            AlbumSectionHeader("置顶", Modifier.testTag("albums_section_pinned"))
                        }
                        items(current.pinned, key = { it.gallery.id }) { card ->
                            OrganizableAlbumCard(card, pinned = true)
                        }
                    }
                    item(key = "hdr_all", span = { GridItemSpan(maxLineSpan) }) {
                        AlbumSectionHeader("全部相册", Modifier.testTag("albums_section_all"))
                    }
                    items(current.normal, key = { it.gallery.id }) { card ->
                        OrganizableAlbumCard(card, pinned = false)
                    }
                    if (current.other.isNotEmpty()) {
                        item(key = "other_row", span = { GridItemSpan(maxLineSpan) }) {
                            OtherAlbumsRow(count = current.other.size) {
                                navController.navigate(Routes.OtherAlbums)
                            }
                        }
                    }
                }
            }
```

其中 `OrganizableAlbumCard` 是 AlbumsScreen 内的局部装配函数（在 AlbumsScreen 主体里定义为局部 `@Composable fun`，闭包捕获 viewModel/baseUrl/serverId/loader/online 与对话框状态）：

```kotlin
    @Composable
    fun OrganizableAlbumCard(card: AlbumCard, pinned: Boolean) {
        AlbumCardItem(
            card = card,
            baseUrl = baseUrl,
            serverId = serverId,
            loader = loader,
            onClick = { navController.navigate(Routes.albumDetail(card.gallery.id)) },
            menuItems = { dismiss ->
                val id = card.gallery.id
                // 组织项纯本机、离线可用（spec §4.3）；重命名/删除维持在线门控
                DropdownMenuItem(
                    text = { Text(if (pinned) "取消置顶" else "置顶") },
                    onClick = { dismiss(); viewModel.setPinned(id, !pinned) },
                    modifier = Modifier.testTag(if (pinned) "album_menu_unpin_$id" else "album_menu_pin_$id"),
                )
                DropdownMenuItem(
                    text = { Text("移入其他相册") },
                    onClick = { dismiss(); viewModel.setInOther(id, true) },
                    modifier = Modifier.testTag("album_menu_to_other_$id"),
                )
                DropdownMenuItem(
                    text = { Text("重命名") },
                    enabled = online,
                    onClick = { dismiss(); renameId = id; renameName = card.gallery.name },
                    modifier = Modifier.testTag("album_menu_rename_$id"),
                )
                DropdownMenuItem(
                    text = { Text("删除") },
                    enabled = online,
                    onClick = { dismiss(); deleteId = id; deleteName = card.gallery.name },
                    modifier = Modifier.testTag("album_menu_delete_$id"),
                )
            },
        )
    }
```

5. 文件内追加两个小组件与面板：

```kotlin
/** 分区头：span 整行的小节标题。 */
@Composable
private fun AlbumSectionHeader(title: String, modifier: Modifier = Modifier) {
    Text(
        title,
        style = MaterialTheme.typography.titleMedium,
        modifier = modifier.padding(top = 8.dp, bottom = 2.dp),
    )
}

/** 「▸ 其他相册 (N)」折叠行（spec §4.2）：span 整行，点击进二级页。 */
@Composable
private fun OtherAlbumsRow(count: Int, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .combinedClickable(onClick = onClick, onLongClick = null)
            .padding(horizontal = 4.dp, vertical = 12.dp)
            .testTag("other_albums_row"),
    ) {
        Text("其他相册", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Text("$count", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        )
    }
}

/** 相册页「⋯」面板（spec §4.4）：排序方式（手动/名称/张数/创建时间）。 */
@Composable
internal fun AlbumsOptionsSheet(
    sort: AlbumSort,
    onDismiss: () -> Unit,
    onManual: () -> Unit,
    onSortField: (AlbumSortField) -> Unit,
    extraRows: @Composable ColumnScope.() -> Unit = {},   // Task 9 挂「拖拽排序」导航行
) {
    MiuiOptionsSheet(onDismiss = onDismiss) {
        MiuiSheetCard("排序方式") {
            MiuiChoiceRow("手动", sort == AlbumSort.MANUAL, "album_sort_option_manual", onManual)
            AlbumSortField.entries.forEach { field ->
                MiuiSortRow(
                    label = field.label,
                    selected = field.contains(sort),
                    ascending = sort.ascending,
                    tag = "album_sort_option_${field.name.lowercase()}",
                ) { onSortField(field) }
            }
        }
        extraRows()
    }
}
```

主体尾部挂面板：

```kotlin
    if (showOptions) {
        AlbumsOptionsSheet(
            sort = sort,
            onDismiss = { showOptions = false },
            onManual = { viewModel.setAlbumsSort(AlbumSort.MANUAL); showOptions = false },
            onSortField = { field -> viewModel.setAlbumsSort(field.next(sort)); showOptions = false },
        )
    }
```

6. `Routes` 补常量（AppNav.kt，Task 8 注册路由，本任务先加常量保证编译）：`const val OtherAlbums = "albums_other"`（**不能**用 `albums/other`——会被 `albums/{galleryId}` 模式吞掉）。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.ui.albums.AlbumSectionsTest --tests com.bluskysoftware.yandegallery.ui.albums.AlbumsViewModelTest --tests com.bluskysoftware.yandegallery.ui.albums.AlbumsOrganizeTest --tests com.bluskysoftware.yandegallery.ui.albums.AlbumsWriteTest"
```
预期 BUILD SUCCESSFUL（AlbumsWriteTest 若引用旧 `albums` 流或旧卡片装配，按 sections/AlbumCardItem 适配，断言语义不变）。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ android/app/src/test/java/com/bluskysoftware/yandegallery/
git commit -m "feat(android): 相册页三分区自适应网格——置顶/其他相册收纳/四种排序，长按菜单扩组织项"
```

### Task 8: 其他相册二级页 + 路由注册

**Files:**
- Create: `ui/albums/OtherAlbumsScreen.kt`
- Modify: `ui/AppNav.kt`（AppScaffold 注册 `Routes.OtherAlbums` + AppNavForTest 占位）
- Modify: `MainActivity.kt`（接线）
- Test: `ui/albums/OtherAlbumsScreenTest.kt`（新建）、`ui/AppNavTest.kt`（追加路由用例）

- [ ] **Step 1: 写失败测试**

`ui/AppNavTest.kt` 追加：

```kotlin
@Test
fun `其他相册路由注册且不被图集详情模式吞掉`() {
    // AppNavForTest 的相册占位带一颗测试触发按钮（本任务加，见 Step 3），经真 NavHost 跳转
    rule.onNodeWithTag("tab_albums").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("test_open_other_albums").performClick()
    rule.waitForIdle()
    rule.onNodeWithText("其他相册占位").assertIsDisplayed()   // 命中占位而非「图集详情占位」
}
```

`ui/albums/OtherAlbumsScreenTest.kt`（装置沿用 AlbumsOrganizeTest：in-memory graph + 真 VM；宿主包 `OtherAlbumsScreen(viewModel, navController, onBack = { backCount++ })`）：

```kotlin
@Test
fun `列出其他相册_移出后清空自动返回`() = runTest {
    // 种子：图集 1 置 inOther=true
    rule.onNodeWithTag("other_albums_grid").assertIsDisplayed()
    rule.onNodeWithTag("album_card_1").performTouchInput { longClick() }
    rule.waitForIdle()
    rule.onNodeWithTag("album_menu_from_other_1").performClick()
    rule.waitForIdle()
    assertEquals(false, db.albumPrefsDao().byId(1)!!.inOther)
    assertTrue(backCount >= 1)   // 清空 → 自动返回（spec §4.6）
}

@Test
fun `进入时已空直接返回`() = runTest {
    // 种子：无任何 inOther 行
    rule.waitForIdle()
    assertTrue(backCount >= 1)
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.ui.AppNavTest --tests com.bluskysoftware.yandegallery.ui.albums.OtherAlbumsScreenTest"
```
预期：编译失败（OtherAlbumsScreen 未定义 / AppScaffold 缺参）。

- [ ] **Step 3: 实现**

新建 `ui/albums/OtherAlbumsScreen.kt`（重命名/删除对话框复用同包 internal 的 `AlbumNameDialog`/`DeleteAlbumConfirmDialog`）：

```kotlin
package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.Routes
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar
import com.bluskysoftware.yandegallery.ui.common.writeFailText
import kotlinx.coroutines.launch

/**
 * 「其他相册」二级页（spec §4.6）：收纳区查看/移出。沿用全局 albumsSort（sections.other 已排好序），
 * 无「⋯」面板、无拖拽（v1 排除项）；清空自动返回主页。菜单无置顶项——先移出再置顶（互斥语义）。
 */
@Composable
fun OtherAlbumsScreen(
    viewModel: AlbumsViewModel,
    navController: NavHostController,
    onBack: () -> Unit,
) {
    val sections by viewModel.sections.collectAsStateWithLifecycle()
    val activeServer by viewModel.activeServer.collectAsStateWithLifecycle()
    val connState by viewModel.connState.collectAsStateWithLifecycle()
    val online = connState.online
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    var renameId by rememberSaveable { mutableStateOf<Long?>(null) }
    var renameName by rememberSaveable { mutableStateOf("") }
    var deleteId by rememberSaveable { mutableStateOf<Long?>(null) }
    var deleteName by rememberSaveable { mutableStateOf("") }
    val baseUrl = activeServer?.baseUrl.orEmpty()
    val serverId = activeServer?.id ?: 0L
    val loader = viewModel.thumbnailLoader

    val other = sections?.other
    // 清空自动返回（spec §4.6）：sections 加载完成（非 null）且收纳区已空
    LaunchedEffect(other) {
        if (other != null && other.isEmpty()) onBack()
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            MiuiSubPageTopBar(title = "其他相册", onBack = onBack)
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 104.dp),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize().testTag("other_albums_grid"),
            ) {
                items(other.orEmpty(), key = { it.gallery.id }) { card ->
                    AlbumCardItem(
                        card = card,
                        baseUrl = baseUrl,
                        serverId = serverId,
                        loader = loader,
                        onClick = { navController.navigate(Routes.albumDetail(card.gallery.id)) },
                        menuItems = { dismiss ->
                            val id = card.gallery.id
                            DropdownMenuItem(
                                text = { Text("移出其他相册") },
                                onClick = { dismiss(); viewModel.setInOther(id, false) },
                                modifier = Modifier.testTag("album_menu_from_other_$id"),
                            )
                            DropdownMenuItem(
                                text = { Text("重命名") },
                                enabled = online,
                                onClick = { dismiss(); renameId = id; renameName = card.gallery.name },
                                modifier = Modifier.testTag("album_menu_rename_$id"),
                            )
                            DropdownMenuItem(
                                text = { Text("删除") },
                                enabled = online,
                                onClick = { dismiss(); deleteId = id; deleteName = card.gallery.name },
                                modifier = Modifier.testTag("album_menu_delete_$id"),
                            )
                        },
                    )
                }
            }
        }
        SnackbarHost(snackbarHostState, Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp))
    }

    renameId?.let { id ->
        AlbumNameDialog(
            title = "重命名图集",
            name = renameName,
            onNameChange = { renameName = it },
            confirmLabel = "保存",
            confirmTag = "album_rename_confirm",
            onConfirm = {
                val name = renameName.trim()
                renameId = null
                scope.launch {
                    when (val r = viewModel.renameGallery(id, name)) {
                        WriteResult.Success -> snackbarHostState.showSnackbar("已重命名为「$name」")
                        is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("重命名失败", r))
                    }
                }
            },
            onDismiss = { renameId = null },
        )
    }
    deleteId?.let { id ->
        DeleteAlbumConfirmDialog(
            albumName = deleteName,
            onConfirm = {
                val name = deleteName
                deleteId = null
                scope.launch {
                    when (val r = viewModel.deleteGallery(id)) {
                        WriteResult.Success -> snackbarHostState.showSnackbar("已删除图集「$name」")
                        is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("删除图集失败", r))
                    }
                }
            },
            onDismiss = { deleteId = null },
        )
    }
}
```

`ui/AppNav.kt`：AppScaffold 形参 `albumsContent` 之后加 `otherAlbumsContent: @Composable () -> Unit,`；NavHost 内 `composable(Routes.Albums)` 之后加：

```kotlin
            composable(Routes.OtherAlbums) { otherAlbumsContent() }
```

AppNavForTest 的 AppScaffold 调用加 `otherAlbumsContent = { Text("其他相册占位") },`，且相册占位改为带测试触发按钮（覆盖路由注册与模式优先级）：

```kotlin
            albumsContent = {
                Column {
                    Text("相册页占位")
                    Button(
                        onClick = { nav.navigate(Routes.OtherAlbums) },
                        modifier = Modifier.testTag("test_open_other_albums"),
                    ) { Text("打开其他相册") }
                }
            },
```

（import 补 `androidx.compose.material3.Button` 已有 `material3.*` 通配则免。）

`MainActivity.kt`：`albumsContent` 块之后加：

```kotlin
                    otherAlbumsContent = {
                        val albumsVm: AlbumsViewModel = viewModel(factory = AlbumsViewModel.factory(graph))
                        OtherAlbumsScreen(
                            viewModel = albumsVm,
                            navController = nav,
                            onBack = { nav.popBackStack() },
                        )
                    },
```

（import 补 `OtherAlbumsScreen`。）

- [ ] **Step 4: 跑测试确认通过**

同 Step 2 命令，预期 BUILD SUCCESSFUL。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ android/app/src/test/java/com/bluskysoftware/yandegallery/
git commit -m "feat(android): 其他相册二级页——收纳区查看/移出/清空自动返回，albums_other 独立路由"
```

---

### Task 9: 相册拖拽重排模式

**Files:**
- Create: `ui/albums/AlbumReorderState.kt`（重排状态机 + 网格拖拽控制器）
- Modify: `ui/albums/AlbumsViewModel.kt`（commitManualOrder）
- Modify: `ui/albums/AlbumsScreen.kt`（重排模式 UI + 面板入口行）
- Test: `ui/albums/AlbumReorderStateTest.kt`（新建）、`ui/albums/AlbumsReorderTest.kt`（新建 compose 契约）

**定界**：拖拽跟手手感（长按抬起/让位动画/补偿不跳）在 Robolectric 里无法可靠驱动，状态机与落盘走单测，手势链路留 Task 11 实机验证（spec §8.4 本机操作可自由实测）。旋转会丢弃进行中的重排（remember 非 saveable，进行中改动本就未落盘）——记录性取舍。

- [ ] **Step 1: 写失败测试**

`ui/albums/AlbumReorderStateTest.kt`（纯 JVM）：

```kotlin
package com.bluskysoftware.yandegallery.ui.albums

import org.junit.Assert.assertEquals
import org.junit.Test

class AlbumReorderStateTest {
    @Test
    fun `区内换位_目标位让位`() {
        val state = AlbumReorderState(pinned = listOf(1, 2), normal = listOf(10, 11, 12))
        state.move(fromId = 12, toId = 10)
        assertEquals(listOf(12L, 10L, 11L), state.normalOrder.toList())
        state.move(fromId = 1, toId = 2)
        assertEquals(listOf(2L, 1L), state.pinnedOrder.toList())
    }

    @Test
    fun `跨区与未知id忽略`() {
        val state = AlbumReorderState(pinned = listOf(1), normal = listOf(10, 11))
        state.move(fromId = 1, toId = 10)    // 跨区：忽略（spec §4.5）
        state.move(fromId = 99, toId = 10)   // 未知：忽略
        assertEquals(listOf(1L), state.pinnedOrder.toList())
        assertEquals(listOf(10L, 11L), state.normalOrder.toList())
    }

    @Test
    fun `sectionOf 判定归属`() {
        val state = AlbumReorderState(pinned = listOf(1), normal = listOf(10))
        assertEquals(ReorderSection.PINNED, state.sectionOf(1))
        assertEquals(ReorderSection.NORMAL, state.sectionOf(10))
        assertEquals(null, state.sectionOf(99))
    }
}
```

`ui/albums/AlbumsReorderTest.kt`（装置沿用 AlbumsOrganizeTest；种子图集 1/2/3 无组织态）：

```kotlin
@Test
fun `面板进重排_完成落盘手动序并切MANUAL`() = runTest {
    rule.onNodeWithTag("albums_more").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("albums_reorder_enter").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("albums_reorder_grid").assertIsDisplayed()
    rule.onNodeWithTag("reorder_done").performClick()
    rule.waitForIdle()
    // 未拖动：按当前视觉序（名称序）原样重编号
    assertEquals(0, db.albumPrefsDao().byId(1)!!.manualOrder)
    assertEquals(AlbumSort.MANUAL, graph.viewPrefs.albumsSort.value)
    rule.onNodeWithTag("albums_grid").assertIsDisplayed()   // 已退出重排
}

@Test
fun `取消不落盘_返回键同取消`() = runTest {
    rule.onNodeWithTag("albums_more").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("albums_reorder_enter").performClick()
    rule.waitForIdle()
    rule.onNodeWithTag("reorder_cancel").performClick()
    rule.waitForIdle()
    assertEquals(null, db.albumPrefsDao().byId(1))           // 未写任何行
    assertEquals(AlbumSort.NAME_ASC, graph.viewPrefs.albumsSort.value)
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.ui.albums.AlbumReorderStateTest --tests com.bluskysoftware.yandegallery.ui.albums.AlbumsReorderTest"
```
预期：编译失败。

- [ ] **Step 3: 实现**

新建 `ui/albums/AlbumReorderState.kt`：

```kotlin
package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.geometry.Offset

/** 重排分区标识（spec §4.5：不跨区拖动）。 */
enum class ReorderSection { PINNED, NORMAL }

/**
 * 拖拽重排状态机（spec §4.5，纯逻辑直测）：进入时快照两分区 id 序、区内 move；
 * 「完成」由调用方读 pinnedOrder/normalOrder 落盘；「取消」即丢弃本实例。
 */
class AlbumReorderState(pinned: List<Long>, normal: List<Long>) {
    val pinnedOrder: SnapshotStateList<Long> = mutableStateListOf<Long>().apply { addAll(pinned) }
    val normalOrder: SnapshotStateList<Long> = mutableStateListOf<Long>().apply { addAll(normal) }

    fun sectionOf(id: Long): ReorderSection? = when {
        pinnedOrder.contains(id) -> ReorderSection.PINNED
        normalOrder.contains(id) -> ReorderSection.NORMAL
        else -> null
    }

    /** 区内换位：[fromId] 插到 [toId] 当前位置；跨区/未知 id 忽略。 */
    fun move(fromId: Long, toId: Long) {
        val section = sectionOf(fromId) ?: return
        if (section != sectionOf(toId)) return
        val list = if (section == ReorderSection.PINNED) pinnedOrder else normalOrder
        val from = list.indexOf(fromId)
        val to = list.indexOf(toId)
        if (from < 0 || to < 0 || from == to) return
        list.add(to, list.removeAt(from))
    }
}

/**
 * LazyVerticalGrid 拖拽控制器（spec §4.5）：拖动中按被拖卡片中心命中同分区目标格即 move；
 * move 后被拖项基准位变为目标位，用「旧基准位 − 新基准位」反向补偿 dragOffset，视觉不跳。
 */
class GridReorderController(
    private val gridState: LazyGridState,
    private val canSwap: (fromKey: Any, toKey: Any) -> Boolean,
    private val onMove: (fromKey: Any, toKey: Any) -> Unit,
) {
    var draggingKey by mutableStateOf<Any?>(null)
        private set
    var dragOffset by mutableStateOf(Offset.Zero)
        private set

    fun onDragStart(key: Any) {
        draggingKey = key
        dragOffset = Offset.Zero
    }

    fun onDrag(delta: Offset) {
        val key = draggingKey ?: return
        dragOffset += delta
        val current = gridState.layoutInfo.visibleItemsInfo.firstOrNull { it.key == key } ?: return
        val center = Offset(
            current.offset.x + dragOffset.x + current.size.width / 2f,
            current.offset.y + dragOffset.y + current.size.height / 2f,
        )
        val target = gridState.layoutInfo.visibleItemsInfo.firstOrNull { info ->
            info.key != key && canSwap(key, info.key) &&
                center.x >= info.offset.x && center.x <= info.offset.x + info.size.width &&
                center.y >= info.offset.y && center.y <= info.offset.y + info.size.height
        } ?: return
        val fromOffset = Offset(current.offset.x.toFloat(), current.offset.y.toFloat())
        val toOffset = Offset(target.offset.x.toFloat(), target.offset.y.toFloat())
        onMove(key, target.key)
        dragOffset += fromOffset - toOffset
    }

    fun onDragEnd() {
        draggingKey = null
        dragOffset = Offset.Zero
    }
}
```

`ui/albums/AlbumsViewModel.kt` 追加：

```kotlin
    /** 拖拽落盘（spec §4.5）：两分区分别重编号 0..n（manualOrder 只在区内比较）+ 排序自动切手动。 */
    suspend fun commitManualOrder(pinned: List<Long>, normal: List<Long>) {
        graph.db.albumPrefsDao().applyManualOrder(pinned)
        graph.db.albumPrefsDao().applyManualOrder(normal)
        graph.viewPrefs.setAlbumsSort(AlbumSort.MANUAL)
    }
```

`ui/albums/AlbumsScreen.kt`：

1. import 补 `androidx.activity.compose.BackHandler`、`androidx.compose.material3.TextButton`、`androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress`、`androidx.compose.foundation.layout.height`、`androidx.compose.foundation.layout.statusBarsPadding`、`androidx.compose.ui.input.pointer.pointerInput`、`androidx.compose.ui.zIndex`、`androidx.compose.ui.graphics.graphicsLayer`。
2. 状态区追加：`var reorderState by remember { mutableStateOf<AlbumReorderState?>(null) }`，`BackHandler(enabled = reorderState != null) { reorderState = null }`。
3. 主体 Column 内容改为双分支——`reorderState != null` 时渲染重排模式（替换 常驻顶栏+大标题+网格 整段）：

```kotlin
            val reorder = reorderState
            if (reorder != null) {
                ReorderTopBar(
                    onCancel = { reorderState = null },
                    onDone = {
                        scope.launch {
                            viewModel.commitManualOrder(reorder.pinnedOrder.toList(), reorder.normalOrder.toList())
                            reorderState = null
                        }
                    },
                )
                val cardById = remember(sections) {
                    val s = sections
                    (s?.pinned.orEmpty() + s?.normal.orEmpty() + s?.other.orEmpty()).associateBy { it.gallery.id }
                }
                val reorderGridState = rememberLazyGridState()
                val controller = remember(reorder) {
                    GridReorderController(
                        gridState = reorderGridState,
                        // 分区头的 key 是字符串（"hdr_*"）——必须先类型闸再比较分区，否则强转崩溃
                        canSwap = { from, to ->
                            from is Long && to is Long &&
                                reorder.sectionOf(from) != null &&
                                reorder.sectionOf(from) == reorder.sectionOf(to)
                        },
                        onMove = { from, to -> reorder.move(from as Long, to as Long) },
                    )
                }
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 104.dp),
                    state = reorderGridState,
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize().testTag("albums_reorder_grid"),
                ) {
                    if (reorder.pinnedOrder.isNotEmpty()) {
                        item(key = "hdr_pinned", span = { GridItemSpan(maxLineSpan) }) { AlbumSectionHeader("置顶") }
                        items(reorder.pinnedOrder, key = { it }) { id ->
                            Box(Modifier.animateItem()) { ReorderCell(id, cardById, controller, baseUrl, serverId, loader) }
                        }
                    }
                    item(key = "hdr_all", span = { GridItemSpan(maxLineSpan) }) { AlbumSectionHeader("全部相册") }
                    items(reorder.normalOrder, key = { it }) { id ->
                        Box(Modifier.animateItem()) { ReorderCell(id, cardById, controller, baseUrl, serverId, loader) }
                    }
                    // 其他相册折叠行在重排模式隐藏（spec §4.5）
                }
            } else {
                // …… 既有 常驻顶栏 + MiuiLargeTitle + 三分区网格 整段保持 ……
            }
```

4. 文件内追加组件：

```kotlin
/** 重排模式顶栏（spec §4.5）：取消 / 标题 / 完成。 */
@Composable
private fun ReorderTopBar(onCancel: () -> Unit, onDone: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .height(48.dp),
    ) {
        TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.CenterStart).testTag("reorder_cancel")) {
            Text("取消", color = MaterialTheme.colorScheme.onSurface)
        }
        Text("拖动调整顺序", style = MaterialTheme.typography.titleLarge, modifier = Modifier.align(Alignment.Center))
        TextButton(onClick = onDone, modifier = Modifier.align(Alignment.CenterEnd).testTag("reorder_done")) {
            Text("完成", color = MaterialTheme.colorScheme.primary)
        }
    }
}

/** 重排格子：长按拖动换位；拖动中置顶 zIndex + graphicsLayer 平移；菜单/点击禁用。 */
@Composable
private fun ReorderCell(
    id: Long,
    cardById: Map<Long, AlbumCard>,
    controller: GridReorderController,
    baseUrl: String,
    serverId: Long,
    loader: coil3.ImageLoader,
) {
    val card = cardById[id] ?: return
    val dragging = controller.draggingKey == id
    AlbumCardItem(
        card = card,
        baseUrl = baseUrl,
        serverId = serverId,
        loader = loader,
        onClick = {},
        enableMenu = false,
        modifier = Modifier
            .zIndex(if (dragging) 1f else 0f)
            .graphicsLayer {
                if (dragging) {
                    translationX = controller.dragOffset.x
                    translationY = controller.dragOffset.y
                }
            }
            .pointerInput(id) {
                detectDragGesturesAfterLongPress(
                    onDragStart = { controller.onDragStart(id) },
                    onDrag = { change, delta ->
                        change.consume()
                        controller.onDrag(delta)
                    },
                    onDragEnd = { controller.onDragEnd() },
                    onDragCancel = { controller.onDragEnd() },
                )
            },
    )
}
```

5. `AlbumsOptionsSheet` 调用处补入口行（`extraRows` 插槽，Task 7 预留）：

```kotlin
            extraRows = {
                MiuiSheetCard("整理") {
                    MiuiSheetNavRow("拖拽排序", tag = "albums_reorder_enter") {
                        showOptions = false
                        val s = sections
                        if (s != null && !s.isEmpty) {
                            reorderState = AlbumReorderState(
                                pinned = s.pinned.map { it.gallery.id },
                                normal = s.normal.map { it.gallery.id },
                            )
                        }
                    }
                }
            },
```

- [ ] **Step 4: 跑测试确认通过**

同 Step 2 命令 + `--tests com.bluskysoftware.yandegallery.ui.albums.AlbumsOrganizeTest`（回归），预期 BUILD SUCCESSFUL。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ui/albums/ android/app/src/test/java/com/bluskysoftware/yandegallery/ui/albums/
git commit -m "feat(android): 相册拖拽重排模式——区内长按拖动换位、完成落盘手动序并自动切手动排序"
```

### Task 10: 相册详情页——排序 + 列数档（捏合）+ 设为封面

**Files:**
- Create: `ui/common/PinchStepState.kt`（PinchDensityState 泛型化迁移）
- Delete: `ui/photos/PinchDensityState.kt`（测试改名 `PinchStepStateTest`）
- Modify: `ui/photos/PhotosScreen.kt`（捏合改用 PinchStepState）
- Modify: `data/api/WriteModels.kt` + `data/api/DesktopApi.kt`（GalleryCoverDto + PATCH 方法）
- Modify: `domain/write/WriteApi.kt` / `RetrofitWriteApi.kt` / `WriteRepository.kt`（setGalleryCover）
- Modify: `data/db/GalleryDao.kt`（updateCover）
- Modify: `ui/albums/AlbumDetailViewModel.kt`（排序/列数/设封面）
- Modify: `ui/albums/AlbumDetailScreen.kt`（「⋯」面板 + 列数 + 捏合 + 设封面动作）
- Modify: `ui/common/SelectionBars.kt`（SelectionBottomBar 可选「设为封面」项）
- Test: `ui/common/PinchStepStateTest.kt`（由 PinchDensityStateTest 迁移+泛型用例）、`domain/write/WriteRepositoryTest.kt`（追加）、`data/api/WriteApiTest.kt`（追加）、`ui/common/SelectionBarsTest.kt`（追加）、`ui/albums/AlbumDetailViewModelTest.kt`（追加）

- [ ] **Step 1: 写失败测试**

`ui/common/PinchStepStateTest.kt`：把既有 `ui/photos/PinchDensityStateTest.kt` 的全部用例搬来改构造（`PinchStepState<DensityTier>(larger = { it.larger() }, smaller = { it.smaller() })`，断言不变），并追加列数档用例：

```kotlin
@Test
fun `列数档步进_放大列数减_到边界返回null不再步进`() {
    val state = PinchStepState<Int>(
        larger = { if (it > 3) it - 1 else null },
        smaller = { if (it < 5) it + 1 else null },
    )
    state.onGestureStart(4)
    assertEquals(3, state.onZoom(1.3f))       // 放大越阈值 → 4→3
    assertEquals(null, state.onZoom(1.3f))    // 已到 3 列边界
    state.onGestureStart(4)
    assertEquals(5, state.onZoom(0.7f))       // 缩小 → 4→5
}
```

`domain/write/WriteRepositoryTest.kt` 追加（该文件既有 FakeWriteApi 补 `setGalleryCover` 记录方法）：

```kotlin
@Test
fun `setGalleryCover 成功后写本地镜像并nudge同步`() = runTest {
    db.galleryDao().insertOne(GalleryEntity(1, "g", null, 1))
    val result = repo.setGalleryCover(1, 10)
    assertEquals(WriteResult.Success, result)
    assertEquals(10L, db.galleryDao().byId(1)?.coverImageId)   // 本地即时生效（spec §5.3）
    assertEquals(1, requestSyncCount)   // ← 沿用本文件既有 requestSync 计数装置
}

@Test
fun `setGalleryCover 服务端失败不动本地镜像`() = runTest {
    db.galleryDao().insertOne(GalleryEntity(1, "g", null, 1))
    fakeApi.failWith = ApiException("VALIDATION_ERROR", "Cover image not in gallery", 422)   // ← 沿用既有 fake 失败注入形态
    val result = repo.setGalleryCover(1, 10)
    assertTrue(result is WriteResult.Failed)
    assertNull(db.galleryDao().byId(1)?.coverImageId)   // 非乐观：失败零残留
}
```

`data/api/WriteApiTest.kt` 追加（MockWebServer 装置沿用该文件）：

```kotlin
@Test
fun `setGalleryCover 发 PATCH 且 body 为 coverImageId`() = runTest {
    server.enqueue(MockResponse().setBody("""{"success":true,"data":{"updated":true}}"""))
    api.setGalleryCover(7, 10)
    val recorded = server.takeRequest()
    assertEquals("PATCH", recorded.method)
    assertEquals("/api/v1/galleries/7", recorded.path)
    assertEquals("""{"coverImageId":10}""", recorded.body.readUtf8())
}
```

`ui/common/SelectionBarsTest.kt` 追加：

```kotlin
@Test
fun `设为封面项仅在传入回调时出现且随在线态置灰`() {
    rule.setContent {
        YandeGalleryTheme {
            SelectionBottomBar(
                online = false, inGallery = true,
                onDownload = {}, onShare = {}, onDelete = {}, onAddToGallery = {},
                onRemoveFromGallery = {}, onSetCover = {},
            )
        }
    }
    rule.onNodeWithTag("selection_action_set_cover").assertIsDisplayed()   // 离线也显示、但禁用（写动作门控）
}

@Test
fun `未传设为封面回调则不渲染该项`() {
    rule.setContent {
        YandeGalleryTheme {
            SelectionBottomBar(
                online = true, inGallery = true,
                onDownload = {}, onShare = {}, onDelete = {}, onAddToGallery = {}, onRemoveFromGallery = {},
            )
        }
    }
    rule.onNodeWithTag("selection_action_set_cover").assertDoesNotExist()
}
```

`ui/albums/AlbumDetailViewModelTest.kt` 追加：

```kotlin
@Test
fun `detailSort与列数写穿ViewPrefs`() = runTest {
    vm.setDetailSort(PhotoSort.SIZE_ASC)
    vm.setDetailColumns(5)
    assertEquals(PhotoSort.SIZE_ASC, graph.viewPrefs.detailSort.value)
    assertEquals(5, graph.viewPrefs.detailColumns.value)
    advanceUntilIdle()
    assertEquals("SIZE_ASC", graph.prefsStore.albumDetailSortName.first())
    assertEquals(5, graph.prefsStore.albumDetailColumns.first())
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.ui.common.PinchStepStateTest --tests com.bluskysoftware.yandegallery.domain.write.WriteRepositoryTest --tests com.bluskysoftware.yandegallery.data.api.WriteApiTest --tests com.bluskysoftware.yandegallery.ui.common.SelectionBarsTest --tests com.bluskysoftware.yandegallery.ui.albums.AlbumDetailViewModelTest"
```
预期：编译失败。

- [ ] **Step 3: 实现**

新建 `ui/common/PinchStepState.kt`（`PinchDensityState.kt` 逻辑原样泛型化搬迁，阈值/Initial-pass 遍序注释一并搬）：

```kotlin
package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.positionChanged

/**
 * 捏合步进纯状态机（v0.6 由 PinchDensityState 泛型化，照片页密度档与详情页列数档共用）：
 * 累乘 zoom，越过阈值 snap 一步并复位累计；逐帧 zoom 只进普通字段，composition 只见离散变化。
 * [larger] = 放大方向（格子变大/列数变少），[smaller] 反之；到边界返回 null 停在原档。
 */
class PinchStepState<T : Any>(
    private val larger: (T) -> T?,
    private val smaller: (T) -> T?,
) {
    private var current: T? = null
    private var accumulated = 1f

    fun onGestureStart(value: T) {
        current = value
        accumulated = 1f
    }

    /** 喂一帧 zoom 变化；越档返回新值（调用方持久化），未越档返回 null。 */
    fun onZoom(zoomChange: Float): T? {
        val base = current ?: return null
        accumulated *= zoomChange
        return when {
            accumulated >= ZOOM_IN_THRESHOLD -> {
                accumulated = 1f
                larger(base)?.also { current = it }
            }
            accumulated <= ZOOM_OUT_THRESHOLD -> {
                accumulated = 1f
                smaller(base)?.also { current = it }
            }
            else -> null
        }
    }

    companion object {
        const val ZOOM_IN_THRESHOLD = 1.25f
        const val ZOOM_OUT_THRESHOLD = 0.8f
    }
}

/**
 * 网格捏合手势协调器（原 detectPinchDensity 泛型化）：单 awaitEachGesture + PointerEventPass.Initial。
 * 遍序说明：本手势挂网格外围父层——Main pass 上子 LazyVerticalGrid 先见 move 并已驱动滚动，
 * 父层事后 consume 拦不住；Initial pass 自外向内隧道下发，多指时在 Initial 全量消费，内层网格
 * 只看到已消费事件不再滚动；单指全程零消费，滚动/点击/长按照常。
 */
suspend fun <T : Any> PointerInputScope.detectPinchStep(
    state: PinchStepState<T>,
    currentValue: () -> T,
    onChange: (T) -> Unit,
) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        var pinching = false
        while (true) {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val pressedCount = event.changes.count { it.pressed }
            if (pressedCount == 0) break
            if (pressedCount > 1) {
                if (!pinching) {
                    pinching = true
                    state.onGestureStart(currentValue())
                }
                val zoom = event.calculateZoom()
                if (zoom != 1f) {
                    state.onZoom(zoom)?.let(onChange)
                }
                event.changes.forEach { if (it.positionChanged()) it.consume() }
            }
        }
    }
}
```

删除 `ui/photos/PinchDensityState.kt` 与 `ui/photos/PinchDensityStateTest.kt`。`ui/photos/PhotosScreen.kt` 迁移：

```kotlin
    val pinchState = remember { PinchStepState<DensityTier>(larger = { it.larger() }, smaller = { it.smaller() }) }
```

`pointerInput` 内 `detectPinchDensity(state = pinchState, currentTier = ..., onTierChange = ::changeTier)` 改为：

```kotlin
                                detectPinchStep(
                                    state = pinchState,
                                    currentValue = { viewModel.densityTier.value },
                                    onChange = ::changeTier,
                                )
```

（import 换 `com.bluskysoftware.yandegallery.ui.common.PinchStepState` / `detectPinchStep`。）

`data/api/WriteModels.kt` 追加：

```kotlin
@Serializable
data class GalleryCoverDto(val coverImageId: Long)
```

`data/api/DesktopApi.kt` 追加（renameGallery 之后）：

```kotlin
    // v0.6：设图集封面（桌面 PATCH 已扩展接受 coverImageId，spec §6.1）
    @PATCH("api/v1/galleries/{galleryId}")
    suspend fun setGalleryCover(@Path("galleryId") galleryId: Long, @Body body: GalleryCoverDto): ApiEnvelope<UpdatedDto>
```

`domain/write/WriteApi.kt` 追加接口方法：`suspend fun setGalleryCover(galleryId: Long, coverImageId: Long)`；`RetrofitWriteApi.kt` 实现：

```kotlin
    override suspend fun setGalleryCover(galleryId: Long, coverImageId: Long) {
        api().setGalleryCover(galleryId, GalleryCoverDto(coverImageId)).unwrap()
    }
```

`data/db/GalleryDao.kt` 追加：

```kotlin
    /** 设封面本地回写（v0.6 spec §5.3）：PATCH 成功后即时更新镜像，下轮同步回读同值幂等。 */
    @Query("UPDATE galleries SET coverImageId = :coverImageId WHERE id = :id")
    suspend fun updateCover(id: Long, coverImageId: Long)
```

`domain/write/WriteRepository.kt` 追加（放 renameGallery 之后；**非乐观**——封面校验在服务端，先调后写，失败零残留）：

```kotlin
    /** 设为封面（v0.6 spec §5.3）：先服务端后写本地镜像（相册卡片即时换面）；失败不动本地。 */
    suspend fun setGalleryCover(galleryId: Long, imageId: Long): WriteResult {
        return try {
            writeApi.setGalleryCover(galleryId, imageId)
            db.galleryDao().updateCover(galleryId, imageId)
            monitor.reportSuccess(); requestSync(); WriteResult.Success
        } catch (e: ApiException) {
            monitor.reportFailure(e); WriteResult.Failed(e.message, e.code == "UNAUTHORIZED")
        } catch (e: CancellationException) {
            throw e   // 取消时结果未知，不上报，镜像靠下一轮同步对账收敛
        } catch (e: Exception) {
            monitor.reportFailure(e); WriteResult.Failed(e.message ?: "设为封面失败")
        }
    }
```

`ui/common/SelectionBars.kt`——SelectionBottomBar 形参补 `onSetCover: (() -> Unit)? = null,`（放 onRemoveFromGallery 之前），Row 内「加入图集」之后插：

```kotlin
                if (onSetCover != null) {
                    SelectionAction(
                        Icons.Filled.Image, "设为封面",
                        enabled = online,
                        tag = "selection_action_set_cover",
                        onClick = onSetCover,
                    )
                }
```

（import 补 `androidx.compose.material.icons.filled.Image`。）

`ui/albums/AlbumDetailViewModel.kt`：

```kotlin
    /** 详情排序/列数（v0.6 spec §5.1）：共享 ViewPrefs，全部图集共用一档。 */
    val detailSort: StateFlow<PhotoSort> = graph.viewPrefs.detailSort
    val detailColumns: StateFlow<Int> = graph.viewPrefs.detailColumns

    fun setDetailSort(sort: PhotoSort) = graph.viewPrefs.setDetailSort(sort)

    fun setDetailColumns(columns: Int) = graph.viewPrefs.setDetailColumns(columns)

    /** 设为封面（spec §5.3）：委托 WriteRepository（先服务端后本地）。 */
    suspend fun setCover(imageId: Long): WriteResult = writeRepository.setGalleryCover(galleryId, imageId)
```

`pagingFlow` 替换为随排序重建：

```kotlin
    /** 图集内图片分页（v0.6 spec §5.1）：随 detailSort 重建；无日期分组。 */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val pagingFlow: Flow<PagingData<ImageEntity>> =
        graph.viewPrefs.detailSort.flatMapLatest { sort ->
            Pager(PagingConfig(pageSize = 120, enablePlaceholders = false)) {
                graph.db.galleryDao().galleryImagesPagingSource(buildGalleryImagesQuery(galleryId, sort))
            }.flow
        }.cachedIn(viewModelScope)
```

（`writeRepository` 构造参数由 `writeRepository:` 局部改为 `private val writeRepository:` 以供 setCover 使用；import 补 `PhotoSort`、`flatMapLatest`、`buildGalleryImagesQuery`。）

`ui/albums/AlbumDetailScreen.kt`：

1. 状态区追加：

```kotlin
    val detailSort by viewModel.detailSort.collectAsStateWithLifecycle()
    val columns by viewModel.detailColumns.collectAsStateWithLifecycle()
    var showOptions by rememberSaveable { mutableStateOf(false) }
    val pinchState = remember {
        PinchStepState<Int>(
            larger = { if (it > ViewPrefs.MIN_DETAIL_COLUMNS) it - 1 else null },   // 放大 → 列数减
            smaller = { if (it < ViewPrefs.MAX_DETAIL_COLUMNS) it + 1 else null },
        )
    }
```

2. 非多选顶栏加动作（MiuiSubPageTopBar 的 actions 槽）：

```kotlin
                MiuiSubPageTopBar(
                    title = title,
                    subtitle = count?.let { "$it 张" },
                    onBack = onBack,
                    actions = {
                        IconButton(onClick = { showOptions = true }, modifier = Modifier.testTag("detail_more")) {
                            Icon(Icons.Filled.MoreHoriz, contentDescription = "更多选项")
                        }
                    },
                )
```

3. 网格外包捏合层 + 列数下传（Scaffold content 内）：

```kotlin
        Box(
            Modifier
                .padding(padding)
                .pointerInput(Unit) {
                    detectPinchStep(
                        state = pinchState,
                        currentValue = { viewModel.detailColumns.value },
                        onChange = viewModel::setDetailColumns,
                    )
                },
        ) {
            AlbumDetailGrid(
                items = items,
                columns = columns,
                imageCell = { image -> /* …… 既有 SelectableCell 内容不动 …… */ },
            )
        }
```

`AlbumDetailGrid` 加 `columns: Int` 形参：`GridCells.Fixed(4)` → `GridCells.Fixed(columns)`（默认参数不留——两个调用点都显式传）。

4. SelectionBottomBar 调用补（恰选 1 张才出现，spec §5.3）：

```kotlin
                    onSetCover = if (selected.size == 1) {
                        {
                            val imageId = selected.first()
                            scope.launch {
                                when (val r = viewModel.setCover(imageId)) {
                                    WriteResult.Success -> {
                                        snackbarHostState.showSnackbar("已设为封面")
                                        viewModel.selection.clear()
                                    }
                                    is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("设为封面失败", r))
                                }
                            }
                        }
                    } else {
                        null
                    },
```

5. 面板（文件内追加 + 主体尾部挂载）：

```kotlin
/** 详情页「⋯」面板（spec §5.1）：排序（时间/大小/文件名）+ 列数（3/4/5）。 */
@Composable
internal fun AlbumDetailOptionsSheet(
    sort: PhotoSort,
    columns: Int,
    onDismiss: () -> Unit,
    onSortField: (PhotoSortField) -> Unit,
    onColumns: (Int) -> Unit,
) {
    MiuiOptionsSheet(onDismiss = onDismiss) {
        MiuiSheetCard("排序方式") {
            PhotoSortField.entries.forEach { field ->
                MiuiSortRow(
                    label = field.label,
                    selected = field.contains(sort),
                    ascending = sort.ascending,
                    tag = "detail_sort_option_${field.name.lowercase()}",
                ) { onSortField(field) }
            }
        }
        MiuiSheetCard("列数") {
            (ViewPrefs.MIN_DETAIL_COLUMNS..ViewPrefs.MAX_DETAIL_COLUMNS).forEach { n ->
                MiuiChoiceRow("$n 列", columns == n, "detail_columns_$n") { onColumns(n) }
            }
        }
    }
}
```

```kotlin
    if (showOptions) {
        AlbumDetailOptionsSheet(
            sort = detailSort,
            columns = columns,
            onDismiss = { showOptions = false },
            onSortField = { field -> viewModel.setDetailSort(field.next(detailSort)); showOptions = false },
            onColumns = { viewModel.setDetailColumns(it); showOptions = false },
        )
    }
```

（import 补 MoreHoriz/IconButton/Icon/pointerInput/PinchStepState/detectPinchStep/ViewPrefs/PhotoSort/PhotoSortField/MiuiOptionsSheet 家族/testTag。）

- [ ] **Step 4: 跑测试确认通过**

Step 2 命令 + `--tests com.bluskysoftware.yandegallery.ui.photos.PhotosScreenTest`（捏合迁移回归），预期 BUILD SUCCESSFUL。

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/bluskysoftware/yandegallery/ android/app/src/test/java/com/bluskysoftware/yandegallery/
git commit -m "feat(android): 图集详情排序/列数捏合与设为封面——PinchStepState 泛型化共用，PATCH coverImageId 写链路贯通"
```

### Task 11: 收官——版本 / 全量回归 / 文档 / 打包实机验证（主会话执行，不派子代理）

**Files:**
- Modify: `android/app/build.gradle.kts`（versionCode 7 / versionName 0.6.0）
- Modify: `package.json`（桌面 minor 递进，先读当前值）
- Modify: `android/README.md`（新增 §9：v0.6.0 功能补全）
- Modify: `doc/superpowers/specs/2026-07-09-android-gallery-features-design.md`（状态行回填）

- [ ] **Step 1: 版本号**

`android/app/build.gradle.kts`：`versionCode = 7`、`versionName = "0.6.0"`。桌面 `package.json`：先 `Grep '"version"' package.json` 读当前值，minor +1（API 加字段/参数，按 `doc/版本发布打包规范.md`）。

- [ ] **Step 2: 双端全量回归**

```bash
npx vitest run tests/main && npm run typecheck
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest"
```
安卓全量以 test-results XML 汇总数字为准（`android/app/build/test-results/testDebugUnitTest/`）；DataStore 类 60s 协程饥饿超时按既有口径重跑至真绿（README §8）。

- [ ] **Step 3: 文档**

- `android/README.md` 追加 `## 9. v0.6.0 通用图库功能补全`：功能清单（排序/置顶/其他相册/密度入口/自适应/重排/设封面）、新偏好键与 `album_prefs` 表、「组织状态本机不跨设备」口径、验证口径。
- spec 状态行回填「✅ 已实施（v0.6.0 / versionCode 7，日期）」+ 关键偏离记录（如有）。
- 核对 `syncService.ts` 头注释与 `galleryWriteRoutes` 注释已在 Task 3 更新到位。

- [ ] **Step 4: 打包与安装（沿用既有设备流程）**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:assembleDebug"
# MuMu 未在线则先拉起：cd "/d/Program Files/Netease/MuMu Player 12/nx_main" && ./MuMuManager.exe control -v 0 launch
adb connect 127.0.0.1:16384
adb -s 127.0.0.1:16384 install -r android/app/build/outputs/apk/debug/app-debug.apk
# 小米/红魔在线则一并装（红魔序列号 FY24148102C9）
```

- [ ] **Step 5: 实机验收（对照 spec §10；安全纪律 §8.4）**

本机操作自由验：照片页「⋯」排序/密度、平铺模式（无日期头/胶囊气泡隐藏）、排序记忆（杀进程重进）、大图翻页顺序一致、相册自适应列数与三分区、长按置顶/移入其他、其他相册页与清空返回、拖拽重排跟手与落盘、详情页排序/列数/捏合。**写路径（设封面/重命名/删除）实机只看按钮呈现与置灰态，不对真实图库执行**——自动化测试为准。双主题各过一遍照片/相册页。

- [ ] **Step 6: 终审 + 提交**

派一个最终 code-reviewer 子代理对照 spec 全量复审（只读），修复其发现的问题后：

```bash
git add -A && git commit -m "chore(android): v0.6.0 收官——版本号/README §9/spec 状态回填，双端全量回归通过"
```

---

## 自审记录（writing-plans Self-Review）

1. **Spec 覆盖**：F1/F2→Task 6，F3/F4/F5/F6→Task 7+8，F7→Task 9，F8→Task 10，F9→Task 3（安卓侧 DTO/实体在 Task 2、客户端调用在 Task 10）；§2 数据层→Task 1+2；§8.2 testTag 全部出现在对应任务；§11 六项核实已全部落定并写入任务（createdAt=ISO 串、Viewer=ViewPrefs 同源、SyncEngine 每轮必拉无短路、setGalleryCover 补成员校验、设置图标无旧 tag、Room v4→5）。
2. **占位符**：无 TBD/TODO；两处「沿用既有装置」均附完整用例逻辑与断言，属装置适配而非留白；FastScrollbar null-label 行为附了核实指令与兜底改法。
3. **类型一致性**：`PhotoSort.orderBy(prefix)`（Task 1）与 `buildTimelineQuery`/`buildGalleryImagesQuery`（Task 4）、`ViewPrefs.detailColumns: StateFlow<Int>`（Task 1）与详情页 `PinchStepState<Int>`（Task 10）、`AlbumPrefsEntity`（Task 2）与 `assembleAlbumSections`（Task 7）、`AlbumReorderState.pinnedOrder/normalOrder`（Task 9）与 `commitManualOrder(pinned, normal)` 签名逐一核对一致；`AlbumCard` 在 Task 7 增 createdAt 途径为 GalleryEntity 字段透传，无新字段。

