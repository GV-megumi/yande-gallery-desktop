package com.bluskysoftware.yandegallery.ui.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageFileEntity
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okio.buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * CacheScreen 破坏性操作 Compose 回归（复审补测——原 review finding：`storage_sync_now`/
 * `storage_clear_mirror`（含二次确认 `storage_clear_mirror_dialog`）/`cache_clear_thumb` 三处
 * 只有人工走查验证过 `confirmClear` 状态门控与 onDismiss 不清/onConfirm 才清的弹窗接线，一次
 * 接线回归（例如误把 vm.clearMirror() 挪进 onDismiss，或漏挡 confirmClear 直接清）不会被任何
 * 测试捕获）。手法同 `SettingsScreenTest`：real AppGraph + in-memory Room + 临时文件 PrefsStore +
 * `requestMirrorSyncOverride` fake（Robolectric 下真 WorkManager 未初始化，直接调用会抛异常，
 * 同 `CacheViewModelTest` 先例）。
 *
 * 覆盖：
 * 1. 清空图片镜像点击→确认框弹出→取消（`miui_dialog_dismiss`）→镜像行不清、不重新入队；
 * 2. 确认（`miui_dialog_confirm`）→镜像行清空 + 以 replace=true 重新入队——`CacheViewModel.clearMirror()`
 *    KDoc 明文顺序固定「行→文件→重新入队」不可调换：同一协程内 `clearAll()`/`clearAllFiles()` 两个
 *    真 suspend 调用严格先于（非 suspend 的）`requestMirrorSync(replace=true)` 起新协程，协程 launch
 *    的 JMM happens-before 语义保证前两步的落盘对新协程可见——故等到 `resyncRequests` 记录落定后，
 *    直接断言 DB 行数即可，无需再轮询 DB（同 `CacheViewModelTest` 用 `awaitValue` 双路径验证的精神一致，
 *    这里凭顺序保证简化为单一等待点）；
 * 3. 立即同步点击→以 replace=false 入队（不打断在途同步任务）；
 * 4. 清理缩略图点击→真实 Coil DiskCache（`graph.thumbnailLoader.diskCache`）经公开 `openEditor`/`commit`
 *    API 写一枚真实条目验证非零占用，点击后经 VM 的 `thumbBytes` 状态观察到归零——直接用 Coil 公开
 *    DiskCache API 造数据、不碰内部文件布局；`RealDiskCache.size` 直转 `DiskLruCache.size()`，
 *    `commit()` 内 `completeEdit` 同步更新计数，无需等异步裁剪，比单纯断言"点了没崩"更诚实。
 *
 * qualifiers 拉高窗口：同 `SettingsScreenTest`/`DetailPanelTest` 先例——Robolectric 默认 320x470dp
 * 视口装不下三张卡片（图片镜像两按钮+缩略图缓存+同步状态），末尾「同步状态」行会被裁剪到可见区外，
 * 点击/断言随机失败。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w480dp-h1000dp")
class CacheScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph
    private lateinit var vm: CacheViewModel
    private var serverId: Long = -1
    private val resyncRequests = mutableListOf<Triple<Long, Boolean, Boolean>>()

    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("cache-screen-prefs", ".preferences_pb").also { it.delete() }

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(
            ApplicationProvider.getApplicationContext(),
            dbOverride = db,
            autoSyncOnActiveChange = false,
            prefsStoreOverride = PrefsStore(PreferenceDataStoreFactory.create(scope = prefsScope) { prefsTmp }),
            requestMirrorSyncOverride = { sid, cellular, replace -> resyncRequests.add(Triple(sid, cellular, replace)) },
        )
        vm = CacheViewModel(graph)
        // requestMirrorSync() 内部 activeServer() 取不到就静默 return@launch（AppGraph 既定行为）——
        // 不激活服务器则 override 永远不会被调用，同 SettingsScreenTest/CacheViewModelTest 先例。
        serverId = runBlocking { graph.serverRepository.addAndActivate("t9cachescreen", "http://127.0.0.1:1", "k") }
    }

    @After
    fun teardown() {
        graph.shutdownForTest()
        db.close()
        prefsScope.cancel()
        prefsTmp.delete()
        // 真实 Coil 磁盘缓存目录，清掉避免跨测试残留条目污染下一轮 size 断言。
        ApplicationProvider.getApplicationContext<android.content.Context>().cacheDir.resolve("thumbnails").deleteRecursively()
        Dispatchers.resetMain()
    }

    @Test
    fun `清空图片镜像点击弹二次确认，取消不清行不入队`() {
        runBlocking {
            db.imageFileDao().upsert(ImageFileEntity(serverId, 1, "HQ", "s$serverId/i1/a.jpg", 100, 0))
        }
        compose.setContent {
            CacheScreen(vm = vm, onBack = {})
        }
        compose.onNodeWithTag("storage_clear_mirror").performClick()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("storage_clear_mirror_dialog").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("storage_clear_mirror_dialog").assertIsDisplayed()
        compose.onNodeWithTag("miui_dialog_dismiss").performClick()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("storage_clear_mirror_dialog").fetchSemanticsNodes().isEmpty()
        }
        assertEquals(1L, runBlocking { db.imageFileDao().countFor(serverId) })
        assertTrue("取消不应触发任何重新入队", resyncRequests.isEmpty())
    }

    @Test
    fun `确认清空图片镜像后清行并以 replace=true 重新入队`() {
        runBlocking {
            db.imageFileDao().upsert(ImageFileEntity(serverId, 1, "HQ", "s$serverId/i1/a.jpg", 100, 0))
        }
        compose.setContent {
            CacheScreen(vm = vm, onBack = {})
        }
        compose.onNodeWithTag("storage_clear_mirror").performClick()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("storage_clear_mirror_dialog").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("miui_dialog_confirm").performClick()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("storage_clear_mirror_dialog").fetchSemanticsNodes().isEmpty()
        }
        compose.waitUntil(timeoutMillis = 5_000) { resyncRequests.any { it.third } }
        assertTrue("清空后应以 replace=true 重新入队同步", resyncRequests.any { it.third })
        // clearAll()/clearAllFiles() 严格先于 requestMirrorSync 起的新协程（见类头 KDoc 顺序保证），
        // resyncRequests 落定即代表二者已完成，此处直接断言、无需再轮询 DB。
        assertEquals(0L, runBlocking { db.imageFileDao().countFor(serverId) })
    }

    @Test
    fun `立即同步点击后以 replace=false 入队不打断在途任务`() {
        compose.setContent {
            CacheScreen(vm = vm, onBack = {})
        }
        compose.onNodeWithTag("storage_sync_now").performClick()
        compose.waitUntil(timeoutMillis = 5_000) { resyncRequests.isNotEmpty() }
        assertTrue("立即同步应以 replace=false 入队", resyncRequests.any { !it.third })
    }

    @Test
    fun `清理缩略图点击后真实清空磁盘缓存占用归零`() {
        // 直接用 Coil 公开 DiskCache API（openEditor/commit）造一枚真实条目，而非只断言"点了没崩"——
        // RealDiskCache.size 直转 DiskLruCache.size()，commit() 内 completeEdit 同步更新计数。
        val diskCache = requireNotNull(graph.thumbnailLoader.diskCache)
        val editor = requireNotNull(diskCache.openEditor("thumb_probe"))
        diskCache.fileSystem.sink(editor.data).buffer().use { it.writeUtf8("thumbnail-bytes-probe") }
        editor.commit()
        assertTrue("造数据后磁盘缓存应有非零占用", diskCache.size > 0)

        compose.setContent {
            CacheScreen(vm = vm, onBack = {})
        }
        compose.waitUntil(timeoutMillis = 5_000) { vm.thumbBytes.value != null }
        assertTrue("清理前 VM 应观察到非零占用", (vm.thumbBytes.value ?: 0L) > 0L)

        compose.onNodeWithTag("cache_clear_thumb").performClick()
        compose.waitUntil(timeoutMillis = 5_000) { vm.thumbBytes.value == 0L }
        assertEquals(0L, vm.thumbBytes.value)
        assertEquals(0L, diskCache.size)
    }
}
