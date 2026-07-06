package com.bluskysoftware.yandegallery.ui.common

import androidx.test.core.app.ApplicationProvider
import androidx.work.WorkInfo
import com.bluskysoftware.yandegallery.data.api.AddMembersDto
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.api.BatchDeleteItemDto
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.DownloadEntity
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.domain.ConnectionMonitor
import com.bluskysoftware.yandegallery.domain.write.WriteApi
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
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

/**
 * M3-T13: SelectionActions 批量动作——:memory: Room（真 DAO）+ 真 WriteRepository + 最小 FakeWriteApi
 * （镜像 T6 测试装配）；下载入队走记录回调，不触 WorkManager（M4-T11：终态观察同为注入 fake 流）。
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
    }

    private fun image(id: Long, createdAt: String = "2026-01-01T00:00:00.000Z") = ImageEntity(
        id = id, filename = "$id.jpg", width = 100, height = 100,
        fileSize = 1, format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    private fun TestScope.build(
        api: FakeWriteApi = FakeWriteApi(),
        enqueued: MutableList<Pair<Long, Long>> = mutableListOf(),
        activeServerId: suspend () -> Long? = { 1L },
        observeDownloadState: (Long, Long) -> Flow<WorkInfo.State?> = { _, _ -> MutableStateFlow(null) },
        gatewayExists: (String) -> Boolean = { true },
        onEnqueue: (Long, ImageEntity) -> Unit = { _, _ -> },
    ): SelectionActions {
        val monitor = ConnectionMonitor(activeServerName = flowOf<String?>("srv"), scope = backgroundScope)
        val repo = WriteRepository(api, db, monitor) { }
        return SelectionActions(
            db = db,
            writeRepository = repo,
            activeServerId = activeServerId,
            enqueueDownload = { serverId, img ->
                enqueued += serverId to img.id
                onEnqueue(serverId, img)
            },
            observeDownloadState = observeDownloadState,
            gatewayExists = gatewayExists,
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
    fun `ensureShareUris 全部已下载——按传入顺序返回本服 uri 且不入队`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        db.downloadDao().upsert(DownloadEntity(1, 1, "content://media/1", "t"))
        db.downloadDao().upsert(DownloadEntity(1, 2, "content://media/2", "t"))
        db.downloadDao().upsert(DownloadEntity(2, 1, "content://other/1", "t"))   // 他服同号映射不得串
        val enqueued = mutableListOf<Pair<Long, Long>>()
        val actions = build(enqueued = enqueued)

        val outcome = actions.ensureShareUris(listOf(2, 1))

        assertEquals(listOf("content://media/2", "content://media/1"), outcome.uris)
        assertTrue(outcome.failedIds.isEmpty())
        assertEquals(emptyList<Pair<Long, Long>>(), enqueued)
    }

    @Test
    fun `ensureShareUris 缺失项以激活 serverId 入队等终态成功后返回全量 uri`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        db.downloadDao().upsert(DownloadEntity(1, 1, "content://media/1", "t"))
        val state = MutableStateFlow<WorkInfo.State?>(null)
        val enqueued = mutableListOf<Pair<Long, Long>>()
        val actions = build(
            enqueued = enqueued,
            observeDownloadState = { _, _ -> state },
            onEnqueue = { serverId, img ->
                // 模拟 worker 成功：落 downloads 行 + 置终态（真实链路 DownloadWorker 成功后 upsert）
                runBlocking { db.downloadDao().upsert(DownloadEntity(serverId, img.id, "content://dl-${img.id}", "t")) }
                state.value = WorkInfo.State.SUCCEEDED
            },
        )

        val outcome = actions.ensureShareUris(listOf(1, 2))

        assertEquals(listOf(1L to 2L), enqueued)   // 已下载的 1 不重复入队
        assertEquals(listOf("content://media/1", "content://dl-2"), outcome.uris)
        assertTrue(outcome.failedIds.isEmpty())
    }

    @Test
    fun `ensureShareUris 下载失败项计入 failedIds 保留成功子集`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        db.downloadDao().upsert(DownloadEntity(1, 1, "content://media/1", "t"))
        val actions = build(observeDownloadState = { _, _ -> MutableStateFlow(WorkInfo.State.FAILED) })

        val outcome = actions.ensureShareUris(listOf(1, 2))

        assertEquals(listOf("content://media/1"), outcome.uris)
        assertEquals(listOf(2L), outcome.failedIds)
    }

    @Test
    fun `ensureShareUris 失效映射先清行再重下——不分享亡失 uri`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.downloadDao().upsert(DownloadEntity(1, 1, "content://stale", "t"))   // 行在文件亡
        val state = MutableStateFlow<WorkInfo.State?>(null)
        val actions = build(
            gatewayExists = { it != "content://stale" },
            observeDownloadState = { _, _ -> state },
            onEnqueue = { serverId, img ->
                runBlocking { db.downloadDao().upsert(DownloadEntity(serverId, img.id, "content://fresh", "t")) }
                state.value = WorkInfo.State.SUCCEEDED
            },
        )

        val outcome = actions.ensureShareUris(listOf(1))

        assertEquals(listOf("content://fresh"), outcome.uris)
        assertEquals("content://fresh", db.downloadDao().byImageId(1, 1)?.mediaStoreUri)
    }

    @Test
    fun `ensureShareUris 镜像已删 id 计入失败——其余照常分享`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.downloadDao().upsert(DownloadEntity(1, 1, "content://media/1", "t"))

        val outcome = build().ensureShareUris(listOf(1, 99))   // 99 已被同步删除

        assertEquals(listOf("content://media/1"), outcome.uris)
        assertEquals(listOf(99L), outcome.failedIds)
    }

    @Test
    fun `ensureShareUris 无激活服务器——全部计失败`() = runTest {
        val outcome = build(activeServerId = { null }).ensureShareUris(listOf(1, 2))

        assertTrue(outcome.uris.isEmpty())
        assertEquals(listOf(1L, 2L), outcome.failedIds)
    }

    @Test
    fun `downloadedUrisFor 只取本服快照，无激活服务器返回空`() = runTest {
        db.downloadDao().upsert(DownloadEntity(1, 1, "content://media/1", "t"))
        db.downloadDao().upsert(DownloadEntity(2, 1, "content://other/1", "t"))   // 他服同号映射
        db.downloadDao().upsert(DownloadEntity(1, 3, "content://media/3", "t"))

        assertEquals(
            listOf("content://media/1", "content://media/3"),
            build().downloadedUrisFor(listOf(1, 2, 3)),         // 2 未下载 → 只回已下载的本服行
        )
        assertEquals(
            emptyList<String>(),
            build(activeServerId = { null }).downloadedUrisFor(listOf(1, 3)),
        )
    }

    @Test
    fun `anyDownloaded 本服任一有副本即真，全无或无激活服务器为假`() = runTest {
        db.imageDao().upsertAll(listOf(image(2), image(5)))   // 已下载图必有镜像行（M4-T14 filterExisting 前置）
        db.downloadDao().upsert(DownloadEntity(1, 2, "content://media/2", "t"))
        db.downloadDao().upsert(DownloadEntity(2, 5, "content://other/5", "t"))   // 他服行不算本服

        assertTrue("选中含本服已下载的 2 → 真", build().anyDownloaded(listOf(1, 2, 3)))
        assertEquals("全未下载 → 假", false, build().anyDownloaded(listOf(1, 3)))
        assertEquals("他服同号不算 → 假", false, build().anyDownloaded(listOf(5)))
        assertEquals("无激活服务器 → 假", false, build(activeServerId = { null }).anyDownloaded(listOf(2)))
    }

    @Test
    fun `batchDelete 全部成功——镜像行删除且本服下载映射行清理`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        db.downloadDao().upsert(DownloadEntity(1, 1, "content://media/1", "t"))
        db.downloadDao().upsert(DownloadEntity(1, 2, "content://media/2", "t"))
        db.downloadDao().upsert(DownloadEntity(2, 1, "content://other/1", "t"))   // 他服行不受波及
        val actions = build()   // batchResults 为空 → 无失败项 → Success

        val result = actions.batchDelete(listOf(1, 2))

        assertEquals(WriteResult.Success, result)
        assertNull(db.imageDao().byId(1))
        assertNull(db.downloadDao().byImageId(1, 1))
        assertNull(db.downloadDao().byImageId(1, 2))
        assertNotNull("他服同号映射保留", db.downloadDao().byImageId(2, 1))
    }

    @Test
    fun `batchDelete 部分失败——回滚 id 的镜像与下载行保留，已删 id 的清理`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        db.downloadDao().upsert(DownloadEntity(1, 1, "content://media/1", "t"))
        db.downloadDao().upsert(DownloadEntity(1, 2, "content://media/2", "t"))
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
        assertNull(db.downloadDao().byImageId(1, 1))           // 成功项：下载行清理
        assertNotNull(db.imageDao().byId(2))                   // 失败项：镜像回滚
        assertNotNull(db.downloadDao().byImageId(1, 2))        // 失败项：下载行保留
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
    fun `batchDelete 整体异常——全部回滚且不清任何下载行`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.downloadDao().upsert(DownloadEntity(1, 1, "content://media/1", "t"))
        val api = FakeWriteApi().apply {
            failBatchDelete = ApiException("INTERNAL_ERROR", "boom", 500)
        }
        val actions = build(api = api)

        val result = actions.batchDelete(listOf(1))

        assertTrue(result is WriteResult.Failed)
        assertNotNull(db.imageDao().byId(1))
        assertNotNull(db.downloadDao().byImageId(1, 1))
    }
}
