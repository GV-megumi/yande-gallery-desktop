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
import com.bluskysoftware.yandegallery.data.media.MediaStoreGateway
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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

    @Before
    fun setup() {
        // viewModelScope 的 stateIn 收集器跑在 Dispatchers.Main 上；runTest 不驱动 Robolectric 主 looper，
        // 故把 Main 换成 UnconfinedTestDispatcher，让 Eagerly 收集器随 Room 发射即时追平（否则 turbine 超时）。
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db)
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
        db.downloadDao().upsert(DownloadEntity(imageId = 7, mediaStoreUri = "content://media/7", downloadedAt = "t"))

        vm(7).downloadedIds.test {
            var ids = awaitItem()
            while (7L !in ids) ids = awaitItem()
            assertTrue(7L in ids)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `modelFor 对已下载且系统相册仍在返回 Uri（跳 1600 档直读 MediaStore）`() = runTest {
        db.imageDao().upsertAll(listOf(image(7)))
        db.downloadDao().upsert(DownloadEntity(imageId = 7, mediaStoreUri = "content://media/7", downloadedAt = "t"))
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
    fun `modelFor 映射失效（系统相册已删）回退 preview 并异步清行`() = runTest {
        db.imageDao().upsertAll(listOf(image(9)))
        db.downloadDao().upsert(DownloadEntity(imageId = 9, mediaStoreUri = "content://media/9", downloadedAt = "t"))
        // existing 为空 → exists 恒 false，模拟用户已在系统相册手删该条目。
        val gateway = FakeGateway(existing = emptySet())
        val viewModel = vm(9, gateway = gateway)

        viewModel.downloadedUris.test {
            var uris = awaitItem()
            while (!uris.containsKey(9L)) uris = awaitItem()

            val model = viewModel.modelFor(image(9), "http://base")
            assertTrue("映射失效应回退 preview", model is ImageRequest)

            // 清行后 observeDownloaded 再发射一版不含 9 的 map
            var after = awaitItem()
            while (after.containsKey(9L)) after = awaitItem()
            assertTrue(!after.containsKey(9L))
            cancelAndIgnoreRemainingEvents()
        }

        assertNull("失效映射行应被删除", db.downloadDao().byImageId(9))
    }

    /** 内存 fake：existing 集合内的 uri 字符串视为系统相册仍在；其余不存在。 */
    private class FakeGateway(private val existing: Set<String> = emptySet()) : MediaStoreGateway {
        override fun createPending(displayName: String, mime: String): Uri? = null
        override fun openOutput(uri: Uri): OutputStream? = null
        override fun finalize(uri: Uri) {}
        override fun discard(uri: Uri) {}
        override fun exists(uri: Uri): Boolean = uri.toString() in existing
        override fun buildDeleteRequest(uris: List<Uri>): PendingIntent? = null
    }
}
