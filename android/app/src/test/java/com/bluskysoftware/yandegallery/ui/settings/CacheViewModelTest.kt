package com.bluskysoftware.yandegallery.ui.settings

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.DownloadEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * CacheViewModel 单元测试——Robolectric + :memory: Room + 临时文件 PrefsStore（隔离进程级 DataStore 单例）。
 * 覆盖：refresh() 占用统计（默认上限 2G/1G）、上限调整持久回读、已下载记录列表（LEFT JOIN 取 filename）与清空、
 * formatBytes 换算。清理/refresh 走真 Dispatchers.IO，故断言前用 first{} 挂起等落定（不叠 withTimeout——
 * 其虚拟时钟会在 runTest 里瞬时推进跳过真 IO；由 runTest 的 dispatchTimeout 兜底）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class CacheViewModelTest {
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("cache-vm-prefs", ".preferences_pb").also { it.delete() }

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(
            ApplicationProvider.getApplicationContext(),
            dbOverride = db,
            autoSyncOnActiveChange = false,
            prefsStoreOverride = PrefsStore(PreferenceDataStoreFactory.create(scope = prefsScope) { prefsTmp }),
        )
    }

    @After
    fun teardown() {
        graph.shutdownForTest()
        db.close()
        prefsScope.cancel()
        prefsTmp.delete()
        Dispatchers.resetMain()
    }

    @Test
    fun `refresh 后 stats 非 null 且上限为默认 2G 1G`() = runTest {
        val vm = CacheViewModel(graph)
        vm.refresh()
        val stats = vm.stats.first { it != null }!!
        assertNotNull(stats)
        assertEquals(2L * 1024 * 1024 * 1024, stats.thumbMax)
        assertEquals(1L * 1024 * 1024 * 1024, stats.previewMax)
    }

    @Test
    fun `setThumbLimitBytes 后 thumbLimitBytes 回读为新值`() = runTest {
        val vm = CacheViewModel(graph)
        vm.setThumbLimitBytes(4L * 1024 * 1024 * 1024)
        val v = vm.thumbLimitBytes.first { it == 4L * 1024 * 1024 * 1024 }
        assertEquals(4L * 1024 * 1024 * 1024, v)
    }

    @Test
    fun `种一行 downloads——列表按激活 serverId 过滤发射且 filename 为 LEFT JOIN 值，清空后为空`() = runTest {
        // T9 后列表按激活 serverId 过滤：须先激活服务器（autoSyncOnActiveChange=false，无副作用）
        val serverId = graph.serverRepository.addAndActivate("t9", "http://x:1", "k")
        db.imageDao().upsertAll(
            listOf(
                ImageEntity(
                    id = 7, filename = "neko.jpg", width = 1, height = 1,
                    fileSize = 1, format = "jpg",
                    createdAt = "2026-07-01T00:00:00.000Z", updatedAt = "2026-07-01T00:00:00.000Z",
                ),
            ),
        )
        db.downloadDao().upsert(
            DownloadEntity(serverId = serverId, imageId = 7, mediaStoreUri = "content://media/7", downloadedAt = "2026-07-01T00:00:00.000Z"),
        )
        // 他服同号记录不得混入激活服务器的列表
        db.downloadDao().upsert(
            DownloadEntity(serverId = serverId + 1, imageId = 7, mediaStoreUri = "content://other/7", downloadedAt = "2026-07-01T00:00:00.000Z"),
        )
        val vm = CacheViewModel(graph)

        val list = vm.downloads.first { it.isNotEmpty() }
        assertEquals(1, list.size)
        assertEquals(7L, list[0].imageId)
        assertEquals("content://media/7", list[0].mediaStoreUri)
        assertEquals("neko.jpg", list[0].filename)

        vm.clearDownloadRecords()
        val empty = vm.downloads.first { it.isEmpty() }
        assertEquals(0, empty.size)
    }

    @Test
    fun `formatBytes——1536MB 记为 1_50 GB`() {
        assertEquals("1.50 GB", formatBytes(1536L * 1024 * 1024))
    }
}
