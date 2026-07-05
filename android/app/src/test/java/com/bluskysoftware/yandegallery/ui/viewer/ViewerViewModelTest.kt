package com.bluskysoftware.yandegallery.ui.viewer

import android.app.PendingIntent
import android.net.Uri
import androidx.core.net.toUri
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import coil3.request.ImageRequest
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.DownloadEntity
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.TagEntity
import com.bluskysoftware.yandegallery.data.media.DeleteOwnedResult
import com.bluskysoftware.yandegallery.data.media.MediaStoreGateway
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.OutputStream

/**
 * ViewerViewModel 单元测试（TDD）——Robolectric + :memory: Room，镜像既有 VM 测试装配。
 *
 * modelFor 在 composition 里同步读 downloadedUris.value，故三个被它读取的 StateFlow 用 Eagerly 收集；
 * 测试用 turbine 订阅 downloadedUris 等种子行进入 map 后再调 modelFor，确定性覆盖三档选择与失效清行。
 * gateway 走构造入参（AppGraph 不支持替换 mediaStoreGateway），以 fake 控制 exists 分支。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class ViewerViewModelTest {
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph
    private var serverId: Long = 0L   // T9 后 downloads 流按激活 serverId 过滤，用例须有激活服务器

    @Before
    fun setup() {
        // viewModelScope 的 stateIn 收集器跑在 Dispatchers.Main 上；runTest 不驱动 Robolectric 主 looper，
        // 故把 Main 换成 UnconfinedTestDispatcher，让 Eagerly 收集器随 Room 发射即时追平（否则 turbine 超时）。
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        // autoSyncOnActiveChange=false：种激活服务器只为给 downloads 流提供 serverId 域，
        // 不许触发自动同步/SSE（无真实服务器，Task 9 适配）。
        graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db, autoSyncOnActiveChange = false)
        serverId = runBlocking { graph.serverRepository.addAndActivate("t9", "http://x:1", "k") }
    }

    @After
    fun teardown() {
        graph.shutdownForTest()   // 先停 graph 后台协程再关库——防关库后仍触 Room 的收尾竞态
        db.close()
        Dispatchers.resetMain()
    }

    private fun image(id: Long, createdAt: String = "2026-01-01T00:00:00.000Z") = ImageEntity(
        id = id, filename = "$id.jpg", width = 100, height = 100,
        fileSize = 1, format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    private fun vm(imageId: Long, galleryId: Long? = null, gateway: MediaStoreGateway = FakeGateway()) =
        ViewerViewModel(graph, imageId, galleryId, gateway)

    @Test
    fun `detailOf 组装 tagNames 与 galleryIds`() = runTest {
        db.imageDao().upsertAll(listOf(image(5)))
        db.tagDao().insertAll(
            listOf(
                TagEntity(id = 1, name = "zebra", category = null),
                TagEntity(id = 2, name = "apple", category = "general"),
            ),
        )
        db.imageDao().replaceTagLinks(5, listOf(1, 2))
        db.galleryDao().insertOne(GalleryEntity(id = 7, name = "g", coverImageId = null, imageCount = 1))
        db.imageDao().replaceGalleryLinks(5, listOf(7))

        val detail = vm(5).detailOf(5)

        assertEquals(5L, detail.entity.id)
        // tagNamesOf 按 name 升序：apple 在 zebra 前
        assertEquals(listOf("apple", "zebra"), detail.tagNames)
        assertEquals(listOf(7L), detail.galleryIds)
    }

    @Test
    fun `已下载 id 进入 downloadedIds 集合`() = runTest {
        db.imageDao().upsertAll(listOf(image(7)))
        db.downloadDao().upsert(DownloadEntity(serverId = serverId, imageId = 7, mediaStoreUri = "content://media/7", downloadedAt = "t"))
        // M4-T15：downloadedIds 由 downloadedUris 派生（只含收集期预校验 exists=true 的行），故须让 7 存在。
        val gateway = FakeGateway(existing = setOf("content://media/7"))

        vm(7, gateway = gateway).downloadedIds.test {
            var ids = awaitItem()
            while (7L !in ids) ids = awaitItem()
            assertTrue(7L in ids)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `modelFor 对已下载且系统相册仍在返回 Uri（跳 1600 档直读 MediaStore）`() = runTest {
        db.imageDao().upsertAll(listOf(image(7)))
        db.downloadDao().upsert(DownloadEntity(serverId = serverId, imageId = 7, mediaStoreUri = "content://media/7", downloadedAt = "t"))
        val gateway = FakeGateway(existing = setOf("content://media/7"))
        val viewModel = vm(7, gateway = gateway)

        viewModel.downloadedUris.test {
            var uris = awaitItem()
            while (!uris.containsKey(7L)) uris = awaitItem()

            val model = viewModel.modelFor(image(7), "http://base")

            assertTrue("已下载且系统相册仍在应返回 Uri", model is Uri)
            assertEquals("content://media/7", model.toString())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `modelFor 对未下载返回 previewRequest`() = runTest {
        db.imageDao().upsertAll(listOf(image(8)))

        val model = vm(8).modelFor(image(8), "http://base")

        assertTrue("未下载应返回 1600 档 ImageRequest", model is ImageRequest)
    }

    @Test
    fun `downloadedUris 收集期预校验——exists=false 的行不进映射且被清库`() = runTest {
        db.imageDao().upsertAll(listOf(image(7), image(9)))
        db.downloadDao().upsert(DownloadEntity(serverId = serverId, imageId = 7, mediaStoreUri = "content://media/7", downloadedAt = "t"))
        db.downloadDao().upsert(DownloadEntity(serverId = serverId, imageId = 9, mediaStoreUri = "content://media/9", downloadedAt = "t"))
        // 只有 7 的系统相册副本仍在；9 已被用户手删 → 收集链路应剔除并清库（spec §6.4，M4-T15 把清行从 modelFor 前移到收集期）。
        val gateway = FakeGateway(existing = setOf("content://media/7"))
        val viewModel = vm(7, gateway = gateway)

        viewModel.downloadedUris.test {
            var uris = awaitItem()
            while (!uris.containsKey(7L)) uris = awaitItem()
            // 稳定态映射只含存在的 7，绝不含失效的 9
            assertTrue("exists=true 的 7 应在映射", uris.containsKey(7L))
            assertTrue("exists=false 的 9 不得进入映射", !uris.containsKey(9L))
            cancelAndIgnoreRemainingEvents()
        }
        // 失效行被收集链路顺手清（不再等 modelFor 触发）
        assertNull("exists=false 的失效映射行应被清库", db.downloadDao().byImageId(serverId, 9))
        // 未命中映射 → modelFor 退回 1600 档 preview（等价于「未下载」）
        assertTrue(viewModel.modelFor(image(9), "http://base") is ImageRequest)
    }

    @Test
    fun `modelFor 零 IPC——exists 只发生在收集链路而不在 modelFor`() = runTest {
        db.imageDao().upsertAll(listOf(image(7)))
        db.downloadDao().upsert(DownloadEntity(serverId = serverId, imageId = 7, mediaStoreUri = "content://media/7", downloadedAt = "t"))
        val gateway = FakeGateway(existing = setOf("content://media/7"))
        val viewModel = vm(7, gateway = gateway)

        viewModel.downloadedUris.test {
            var uris = awaitItem()
            while (!uris.containsKey(7L)) uris = awaitItem()

            val callsAfterCollect = gateway.existsCalls
            // 命中与未命中各调若干次，均不得再触 gateway（modelFor 纯读 map，零 binder IPC）
            repeat(3) { viewModel.modelFor(image(7), "http://base") }
            repeat(3) { viewModel.modelFor(image(8), "http://base") }
            assertEquals("modelFor 不得触 gateway.exists（零 IPC，A3 根治）", callsAfterCollect, gateway.existsCalls)
            cancelAndIgnoreRemainingEvents()
        }
    }

    /** 内存 fake：existing 集合内的 uri 字符串视为系统相册仍在；其余不存在。exists 计数用于零 IPC 断言（跨 IO 线程，用 Atomic）。 */
    private class FakeGateway(private val existing: Set<String> = emptySet()) : MediaStoreGateway {
        private val existsCounter = java.util.concurrent.atomic.AtomicInteger(0)
        val existsCalls: Int get() = existsCounter.get()
        override fun createPending(displayName: String, mime: String): Uri? = null
        override fun openOutput(uri: Uri): OutputStream? = null
        override fun finalize(uri: Uri) {}
        override fun discard(uri: Uri) {}
        override fun exists(uri: Uri): Boolean {
            existsCounter.incrementAndGet()
            return uri.toString() in existing
        }
        override fun buildDeleteRequest(uris: List<Uri>): PendingIntent? = null
        override fun deleteOwned(uri: Uri): DeleteOwnedResult = DeleteOwnedResult.Deleted
    }
}
