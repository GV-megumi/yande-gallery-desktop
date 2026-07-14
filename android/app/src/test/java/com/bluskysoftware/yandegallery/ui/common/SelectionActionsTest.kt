package com.bluskysoftware.yandegallery.ui.common

import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.api.AddMembersDto
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.api.BatchDeleteItemDto
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ImageFileEntity
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import com.bluskysoftware.yandegallery.domain.ConnectionMonitor
import com.bluskysoftware.yandegallery.domain.write.WriteApi
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * M3-T13 → 镜像层 Task 8: SelectionActions 批量动作——:memory: Room（真 DAO）+ 真 WriteRepository +
 * 最小 FakeWriteApi（镜像 T6 测试装配）；分享走镜像四级规则（localFile/ensureTier/saveMode/online
 * 全部注入 fake），下载入队走记录回调，不触 WorkManager/网络栈。
 */
@RunWith(RobolectricTestRunner::class)
class SelectionActionsTest {
    private lateinit var db: AppDatabase

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
    }

    @After
    fun teardown() = db.close()

    /** 最小 fake：仅本任务用到的 batch 删除/加入/移出可配置，其余方法空实现。 */
    private class FakeWriteApi : WriteApi {
        var batchResults: List<BatchDeleteItemDto> = emptyList()
        var failBatchDelete: ApiException? = null
        var failRemoveFromGallery: ApiException? = null
        // 记录发往服务端的入参，供「死 id 已滤除」断言（M4-T14）
        val batchDeleteInputs = mutableListOf<List<Long>>()
        val addToGalleryInputs = mutableListOf<List<Long>>()

        override suspend fun deleteImage(imageId: Long) {}
        override suspend fun batchDeleteImages(imageIds: List<Long>): List<BatchDeleteItemDto> {
            batchDeleteInputs += imageIds
            failBatchDelete?.let { throw it }
            return batchResults
        }
        override suspend fun addImageTags(imageId: Long, names: List<String>) {}
        override suspend fun removeImageTags(imageId: Long, names: List<String>) {}
        override suspend fun createGallery(name: String): Long = 1L
        override suspend fun renameGallery(galleryId: Long, name: String) {}
        override suspend fun deleteGallery(galleryId: Long) {}
        override suspend fun addImagesToGallery(galleryId: Long, imageIds: List<Long>): AddMembersDto {
            addToGalleryInputs += imageIds
            return AddMembersDto(added = imageIds.size, missingImageIds = emptyList())
        }
        override suspend fun removeImagesFromGallery(galleryId: Long, imageIds: List<Long>): Int {
            failRemoveFromGallery?.let { throw it }
            return imageIds.size
        }
        override suspend fun setGalleryCover(galleryId: Long, coverImageId: Long) {}
    }

    private fun image(id: Long, createdAt: String = "2026-01-01T00:00:00.000Z") = ImageEntity(
        id = id, filename = "$id.jpg", width = 100, height = 100,
        fileSize = 1, format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    private fun fileRow(serverId: Long, imageId: Long, tier: MirrorTier) = ImageFileEntity(
        serverId = serverId, imageId = imageId, tier = tier.name,
        relPath = "s$serverId/i$imageId/$imageId.jpg", bytes = 1, createdAt = 0,
    )

    private fun TestScope.build(
        api: FakeWriteApi = FakeWriteApi(),
        enqueued: MutableList<Pair<Long, Long>> = mutableListOf(),
        activeServerId: suspend () -> Long? = { 1L },
        localFile: suspend (Long) -> File? = { null },
        ensureTier: suspend (Long, MirrorTier) -> Result<File> = { _, _ ->
            Result.failure(IllegalStateException("测试未配置 ensure"))
        },
        saveMode: suspend () -> MirrorTier = { MirrorTier.HQ },
        online: () -> Boolean = { true },
    ): SelectionActions {
        val monitor = ConnectionMonitor(activeServerName = flowOf<String?>("srv"), scope = backgroundScope)
        val repo = WriteRepository(api, db, monitor) { }
        return SelectionActions(
            db = db,
            writeRepository = repo,
            activeServerId = activeServerId,
            localFile = localFile,
            ensureTier = ensureTier,
            saveMode = saveMode,
            online = online,
            enqueueOriginal = { serverId, img -> enqueued += serverId to img.id },
        )
    }

    @Test
    fun `downloadAll 以激活 serverId 逐个入队且跳过镜像已删的 id`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        val enqueued = mutableListOf<Pair<Long, Long>>()
        val actions = build(enqueued = enqueued)

        actions.downloadAll(listOf(1, 2, 3))   // 3 已被同步删除

        assertEquals(listOf(1L to 1L, 1L to 2L), enqueued)
    }

    @Test
    fun `downloadAll 无激活服务器——不入队任何项`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        val enqueued = mutableListOf<Pair<Long, Long>>()
        val actions = build(enqueued = enqueued, activeServerId = { null })

        actions.downloadAll(listOf(1))

        assertEquals(emptyList<Pair<Long, Long>>(), enqueued)
    }

    @Test
    fun `ensureShareFiles 全部本地——按传入顺序返回文件且不触 ensure`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        var ensured = 0
        val actions = build(
            localFile = { File("local-$it.jpg") },
            ensureTier = { _, _ -> ensured++; Result.failure(IllegalStateException("不该调")) },
        )

        val outcome = actions.ensureShareFiles(listOf(2, 1))

        assertEquals(listOf("local-2.jpg", "local-1.jpg"), outcome.files.map { it.name })
        assertTrue(outcome.failedIds.isEmpty())
        assertEquals(0, ensured)
    }

    @Test
    fun `ensureShareFiles 缺失项在线按保存方式 ensure 后返回全量`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        val ensuredTiers = mutableListOf<Pair<Long, MirrorTier>>()
        val actions = build(
            localFile = { id -> if (id == 1L) File("local-1.jpg") else null },
            ensureTier = { id, tier ->
                ensuredTiers += id to tier
                Result.success(File("pulled-$id.jpg"))
            },
            saveMode = { MirrorTier.ORIGINAL },
        )

        val outcome = actions.ensureShareFiles(listOf(1, 2))

        assertEquals(listOf(2L to MirrorTier.ORIGINAL), ensuredTiers)   // 本地已有的 1 不重复拉
        assertEquals(listOf("local-1.jpg", "pulled-2.jpg"), outcome.files.map { it.name })
        assertTrue(outcome.failedIds.isEmpty())
    }

    @Test
    fun `ensureShareFiles 拉取失败项计入 failedIds 保留成功子集`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        val actions = build(
            localFile = { id -> if (id == 1L) File("local-1.jpg") else null },
            ensureTier = { _, _ -> Result.failure(java.io.IOException("断了")) },
        )

        val outcome = actions.ensureShareFiles(listOf(1, 2))

        assertEquals(listOf("local-1.jpg"), outcome.files.map { it.name })
        assertEquals(listOf(2L), outcome.failedIds)
    }

    @Test
    fun `ensureShareFiles 离线且缺本地——计失败不 ensure`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        var ensured = 0
        val actions = build(
            localFile = { id -> if (id == 1L) File("local-1.jpg") else null },
            ensureTier = { _, _ -> ensured++; Result.success(File("x")) },
            online = { false },
        )

        val outcome = actions.ensureShareFiles(listOf(1, 2))

        assertEquals(listOf("local-1.jpg"), outcome.files.map { it.name })
        assertEquals(listOf(2L), outcome.failedIds)
        assertEquals(0, ensured)
    }

    @Test
    fun `ensureShareFiles 镜像已删 id 计入失败——其余照常分享`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        val actions = build(localFile = { File("local-$it.jpg") })

        val outcome = actions.ensureShareFiles(listOf(1, 99))   // 99 已被同步删除

        assertEquals(listOf("local-1.jpg"), outcome.files.map { it.name })
        assertEquals(listOf(99L), outcome.failedIds)
    }

    @Test
    fun `anyDownloaded 本服有原图行即真，仅 HQ、他服或无激活服务器为假`() = runTest {
        db.imageDao().upsertAll(listOf(image(2), image(5), image(6)))
        db.imageFileDao().upsert(fileRow(1, 2, MirrorTier.ORIGINAL))
        db.imageFileDao().upsert(fileRow(1, 6, MirrorTier.HQ))              // HQ 行不算「有原图」
        db.imageFileDao().upsert(fileRow(2, 5, MirrorTier.ORIGINAL))        // 他服行不算本服

        assertTrue("选中含本服原图行的 2 → 真", build().anyDownloaded(listOf(1, 2, 3)))
        assertEquals("仅 HQ 行 → 假", false, build().anyDownloaded(listOf(6)))
        assertEquals("他服同号不算 → 假", false, build().anyDownloaded(listOf(5)))
        assertEquals("无激活服务器 → 假", false, build(activeServerId = { null }).anyDownloaded(listOf(2)))
    }

    @Test
    fun `batchDelete 全部成功——镜像行删除`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        val actions = build()   // batchResults 为空 → 无失败项 → Success

        val result = actions.batchDelete(listOf(1, 2))

        assertEquals(WriteResult.Success, result)
        assertNull(db.imageDao().byId(1))
        assertNull(db.imageDao().byId(2))
    }

    @Test
    fun `batchDelete 部分失败——回滚 id 的镜像行保留`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        val api = FakeWriteApi().apply {
            batchResults = listOf(
                BatchDeleteItemDto(imageId = 1, success = true),
                BatchDeleteItemDto(imageId = 2, success = false, error = "INTERNAL_ERROR"),
            )
        }
        val actions = build(api = api)

        val result = actions.batchDelete(listOf(1, 2))

        assertTrue(result is WriteResult.Failed)
        assertNull(db.imageDao().byId(1))                      // 成功项：镜像已删
        assertNotNull(db.imageDao().byId(2))                   // 失败项：镜像回滚
    }

    @Test
    fun `batchDelete 前过滤死 id——不发出无镜像行的 id`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))   // 2 已被同步对账删除，无镜像行
        val api = FakeWriteApi()
        val actions = build(api = api)

        actions.batchDelete(listOf(1, 2))

        assertEquals(listOf(listOf(1L)), api.batchDeleteInputs)   // 死 id 2 未进 batch 端点
    }

    @Test
    fun `addToGallery 前过滤死 id——不发出无镜像行的 id`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))   // 2 已被同步对账删除，无镜像行
        db.galleryDao().insertOne(GalleryEntity(5, "g", null, 0))
        val api = FakeWriteApi()
        val actions = build(api = api)

        actions.addToGallery(5, listOf(1, 2))

        assertEquals(listOf(listOf(1L)), api.addToGalleryInputs)   // 死 id 2 未发出
    }

    @Test
    fun `batchDelete 整体异常——全部回滚`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        val api = FakeWriteApi().apply {
            failBatchDelete = ApiException("INTERNAL_ERROR", "boom", 500)
        }
        val actions = build(api = api)

        val result = actions.batchDelete(listOf(1))

        assertTrue(result is WriteResult.Failed)
        assertNotNull(db.imageDao().byId(1))
    }
}
