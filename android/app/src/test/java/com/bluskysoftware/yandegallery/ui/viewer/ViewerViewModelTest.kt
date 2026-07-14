package com.bluskysoftware.yandegallery.ui.viewer

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import coil3.request.ImageRequest
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ImageFileEntity
import com.bluskysoftware.yandegallery.data.db.TagEntity
import com.bluskysoftware.yandegallery.data.image.ThumbnailSpec
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * ViewerViewModel 单元测试（TDD；镜像层 Task 8 改造）——Robolectric + :memory: Room。
 *
 * modelFor 在 composition 里同步读 localImages.value，故被它读取的 StateFlow 用 Eagerly 收集；
 * 测试用 turbine 订阅 localImages 等种子行进入 map 后再调 modelFor，确定性覆盖本地直出/占位/
 * 行在文件亡三态。镜像夹具 = image_files 行 + 真实临时镜像文件（graph.imageMirrorStore 同根目录）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class ViewerViewModelTest {
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph
    private var serverId: Long = 0L   // 镜像流按激活 serverId 过滤，用例须有激活服务器

    @Before
    fun setup() {
        // viewModelScope 的 stateIn 收集器跑在 Dispatchers.Main 上；runTest 不驱动 Robolectric 主 looper，
        // 故把 Main 换成 UnconfinedTestDispatcher，让 Eagerly 收集器随 Room 发射即时追平（否则 turbine 超时）。
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        // autoSyncOnActiveChange=false：种激活服务器只为给镜像流提供 serverId 域，
        // 不许触发自动同步/SSE（无真实服务器，Task 9 适配）。
        graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db, autoSyncOnActiveChange = false)
        serverId = runBlocking { graph.serverRepository.addAndActivate("t9", "http://x:1", "k") }
    }

    @After
    fun teardown() {
        graph.shutdownForTest()   // 先停 graph 后台协程再关库——防关库后仍触 Room 的收尾竞态
        db.close()
        mirrorRoot().deleteRecursively()   // 清镜像临时文件（Robolectric 各用例独立 context，防御性清理）
        Dispatchers.resetMain()
    }

    private fun image(id: Long, createdAt: String = "2026-01-01T00:00:00.000Z") = ImageEntity(
        id = id, filename = "$id.jpg", width = 100, height = 100,
        fileSize = 1, format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    private fun vm(imageId: Long, galleryId: Long? = null) = ViewerViewModel(graph, imageId, galleryId)

    /** 与 AppGraph.imageMirrorStore 同一根目录（getExternalFilesDir 回退 filesDir + "mirror"）。 */
    private fun mirrorRoot(): File {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        return File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "mirror")
    }

    /** 镜像夹具：image_files 行 + 真实落盘文件（fileOf 存在性校验需要非空文件）。 */
    private fun seedMirror(imageId: Long, tier: MirrorTier, withFile: Boolean = true): File {
        val rel = "s$serverId/i$imageId/$imageId.jpg"
        val file = File(mirrorRoot(), rel)
        if (withFile) {
            file.parentFile!!.mkdirs()
            file.writeBytes(ByteArray(4))
        }
        runBlocking { db.imageFileDao().upsert(ImageFileEntity(serverId, imageId, tier.name, rel, 4, 0)) }
        return file
    }

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
    fun `本机原图行进入 downloadedIds 集合`() = runTest {
        db.imageDao().upsertAll(listOf(image(7)))
        seedMirror(7, MirrorTier.ORIGINAL)

        vm(7).downloadedIds.test {
            var ids = awaitItem()
            while (7L !in ids) ids = awaitItem()
            assertTrue(7L in ids)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `HQ 行进 localImages 但不进 downloadedIds（查看原图按钮仍可用）`() = runTest {
        db.imageDao().upsertAll(listOf(image(7)))
        seedMirror(7, MirrorTier.HQ)
        val viewModel = vm(7)

        viewModel.localImages.test {
            var m = awaitItem()
            while (!m.containsKey(7L)) m = awaitItem()
            assertEquals(MirrorTier.HQ, m[7L]!!.tier)
            cancelAndIgnoreRemainingEvents()
        }
        assertTrue("HQ 档不算已有原图", 7L !in viewModel.downloadedIds.value)
    }

    @Test
    fun `modelFor 本地镜像命中——返回 File 直出`() = runTest {
        db.imageDao().upsertAll(listOf(image(7)))
        val seeded = seedMirror(7, MirrorTier.ORIGINAL)
        val viewModel = vm(7)

        viewModel.localImages.test {
            var m = awaitItem()
            while (!m.containsKey(7L)) m = awaitItem()

            val model = viewModel.modelFor(image(7), "http://base")

            assertTrue("本地镜像命中应返回 File 直出", model is File)
            assertEquals(seeded.absolutePath, (model as File).absolutePath)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `modelFor 未镜像——返回缩略图请求占位（ThumbnailSpec 同键）`() = runTest {
        db.imageDao().upsertAll(listOf(image(8)))
        val viewModel = vm(8)

        // activeServer 为 Eagerly stateIn，Room 首发射异步——等追平再断言 ThumbnailSpec 分支
        viewModel.activeServer.test {
            var server = awaitItem()
            while (server == null) server = awaitItem()

            val model = viewModel.modelFor(image(8), "http://base")

            assertTrue("未镜像应返回缩略图占位 ImageRequest", model is ImageRequest)
            val spec = (model as ImageRequest).data as ThumbnailSpec
            assertEquals(serverId, spec.serverId)
            assertEquals(8L, spec.imageId)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `行在文件亡——不进 localImages 映射，modelFor 退回缩略图占位`() = runTest {
        db.imageDao().upsertAll(listOf(image(7), image(9)))
        seedMirror(7, MirrorTier.ORIGINAL)
        seedMirror(9, MirrorTier.ORIGINAL, withFile = false)   // 行在文件亡（用户手清/损坏）
        val viewModel = vm(7)

        viewModel.localImages.test {
            var m = awaitItem()
            while (!m.containsKey(7L)) m = awaitItem()
            // 稳定态映射只含文件真实存在的 7，绝不含行在文件亡的 9（下轮 sweepOrphans 清行自愈）
            assertTrue("文件存在的 7 应在映射", m.containsKey(7L))
            assertTrue("行在文件亡的 9 不得进入映射", !m.containsKey(9L))
            cancelAndIgnoreRemainingEvents()
        }
        // 未命中映射 → modelFor 退回缩略图占位（等价于「未同步」）
        assertTrue(viewModel.modelFor(image(9), "http://base") is ImageRequest)
    }
}
