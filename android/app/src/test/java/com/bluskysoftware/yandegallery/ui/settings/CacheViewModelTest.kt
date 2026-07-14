package com.bluskysoftware.yandegallery.ui.settings

import com.bluskysoftware.yandegallery.awaitValue
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
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * CacheViewModel 单元测试（存储页改版，Task 9）——Robolectric + :memory: Room + 临时文件 PrefsStore
 * （隔离进程级 DataStore 单例）。覆盖：refresh() 镜像分档统计（高质量/原图张数字节，Task 3 statsFor）
 * + 缩略图占用；clearMirror() 清行 + 删镜像文件（独立复算 AppGraph 内部 mirror/ 路径公式落一枚真实
 * 标记文件验证是否真被删除）+ REPLACE 重新入队（requestMirrorSyncOverride fake 回调观察——Robolectric
 * 环境下 WorkManager 未初始化，真调用会抛 IllegalStateException，同 cancelMirrorSyncOverride 先例）；
 * formatBytes 换算。清理/refresh 走真 Dispatchers.IO，断言前用 awaitValue 轮询等落定（TestAwait 机理
 * 注释：advanceUntilIdle 的虚拟时钟不追踪 AppGraph 自身 scope 上的真实 IO 协程，会 flake）。
 * 两档上限（thumbLimitBytes/setThumbLimitBytes）与已下载记录（downloads/clearDownloadRecords）随
 * 预览档/downloads 表退役一并下线，随本次改版从测试中移除。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class CacheViewModelTest {
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph
    private lateinit var mirrorRoot: File
    private val resyncRequests = mutableListOf<Triple<Long, Boolean, Boolean>>()

    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("cache-vm-prefs", ".preferences_pb").also { it.delete() }

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()
        // 与 AppGraph.imageMirrorStore 的 rootDir 公式保持一致（外部私有目录优先，回退内部 filesDir）
        mirrorRoot = File(appContext.getExternalFilesDir(null) ?: appContext.filesDir, "mirror")
        graph = AppGraph(
            appContext,
            dbOverride = db,
            autoSyncOnActiveChange = false,
            prefsStoreOverride = PrefsStore(PreferenceDataStoreFactory.create(scope = prefsScope) { prefsTmp }),
            requestMirrorSyncOverride = { serverId, cellular, replace -> resyncRequests.add(Triple(serverId, cellular, replace)) },
        )
    }

    @After
    fun teardown() {
        graph.shutdownForTest()
        db.close()
        prefsScope.cancel()
        prefsTmp.delete()
        mirrorRoot.deleteRecursively()
        Dispatchers.resetMain()
    }

    @Test
    fun `refresh 统计镜像分档与缩略图占用`() = runTest {
        val serverId = graph.serverRepository.addAndActivate("t9", "http://127.0.0.1:1", "k")
        db.imageFileDao().upsert(ImageFileEntity(serverId, 1, "HQ", "s$serverId/i1/a.jpg", 100, 0))
        db.imageFileDao().upsert(ImageFileEntity(serverId, 2, "ORIGINAL", "s$serverId/i2/b.jpg", 5000, 0))
        val vm = CacheViewModel(graph)

        vm.refresh()

        val stats = awaitValue({ vm.mirrorStats.value }) { it != null }
        assertEquals(100L, stats?.hqBytes)
        assertEquals(1L, stats?.hqCount)
        assertEquals(5000L, stats?.originalBytes)
        assertEquals(1L, stats?.originalCount)
        val thumb = awaitValue({ vm.thumbBytes.value }) { it != null }
        assertEquals(0L, thumb)   // 新建空缓存
    }

    @Test
    fun `clearMirror 清行清文件并重新入队同步`() = runTest {
        val serverId = graph.serverRepository.addAndActivate("t9b", "http://127.0.0.1:1", "k")
        db.imageFileDao().upsert(ImageFileEntity(serverId, 1, "HQ", "s$serverId/i1/a.jpg", 100, 0))
        // 真实标记文件：独立复算与 AppGraph.imageMirrorStore 相同的相对路径公式，验证 clearAllFiles() 真删除
        val marker = File(mirrorRoot, "s$serverId/i1/a.jpg")
        marker.parentFile?.mkdirs()
        marker.writeText("x")
        assertTrue(marker.exists())

        val vm = CacheViewModel(graph)
        vm.clearMirror()

        awaitValue({ db.imageFileDao().countFor(serverId) }) { it == 0L }
        assertEquals(0L, db.imageFileDao().countFor(serverId))
        awaitValue({ marker.exists() }) { !it }
        assertFalse("clearAllFiles 应删除镜像目录下的真实文件", marker.exists())
        awaitValue({ resyncRequests.toList() }) { it.any { r -> r.third } }
        assertTrue("清空后应以 replace=true 重新入队同步", resyncRequests.any { it.third })
    }

    @Test
    fun `formatBytes——1536MB 记为 1_50 GB`() {
        assertEquals("1.50 GB", formatBytes(1536L * 1024 * 1024))
    }
}
