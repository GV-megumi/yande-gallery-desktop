package com.bluskysoftware.yandegallery.ui.common

import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.api.AddMembersDto
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.api.BatchDeleteItemDto
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.DownloadEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
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

/**
 * M3-T13: SelectionActions 批量动作——:memory: Room（真 DAO）+ 真 WriteRepository + 最小 FakeWriteApi
 * （镜像 T6 测试装配）；下载入队走记录回调，不触 WorkManager。
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

        override suspend fun deleteImage(imageId: Long) {}
        override suspend fun batchDeleteImages(imageIds: List<Long>): List<BatchDeleteItemDto> {
            failBatchDelete?.let { throw it }
            return batchResults
        }
        override suspend fun addImageTags(imageId: Long, names: List<String>) {}
        override suspend fun removeImageTags(imageId: Long, names: List<String>) {}
        override suspend fun createGallery(name: String): Long = 1L
        override suspend fun renameGallery(galleryId: Long, name: String) {}
        override suspend fun deleteGallery(galleryId: Long) {}
        override suspend fun addImagesToGallery(galleryId: Long, imageIds: List<Long>): AddMembersDto =
            AddMembersDto(added = imageIds.size, missingImageIds = emptyList())
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
    ): SelectionActions {
        val monitor = ConnectionMonitor(activeServerName = flowOf<String?>("srv"), scope = backgroundScope)
        val repo = WriteRepository(api, db, monitor) { }
        return SelectionActions(db, repo, activeServerId) { serverId, img -> enqueued += serverId to img.id }
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
    fun `shareUrisFor 全部已下载——按传入顺序返回本服 uri 列表`() = runTest {
        db.downloadDao().upsert(DownloadEntity(1, 1, "content://media/1", "t"))
        db.downloadDao().upsert(DownloadEntity(1, 2, "content://media/2", "t"))
        db.downloadDao().upsert(DownloadEntity(2, 1, "content://other/1", "t"))   // 他服同号映射不得串
        val actions = build()

        val uris = actions.shareUrisFor(listOf(2, 1))

        assertEquals(listOf("content://media/2", "content://media/1"), uris)
    }

    @Test
    fun `shareUrisFor 含未下载项——返回 null 提示先下载`() = runTest {
        db.downloadDao().upsert(DownloadEntity(1, 1, "content://media/1", "t"))
        val actions = build()

        assertNull(actions.shareUrisFor(listOf(1, 2)))
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
