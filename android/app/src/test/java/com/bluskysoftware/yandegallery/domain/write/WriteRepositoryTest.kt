package com.bluskysoftware.yandegallery.domain.write

import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.api.AddMembersDto
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.api.BatchDeleteItemDto
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.GalleryImageEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ImageTagEntity
import com.bluskysoftware.yandegallery.data.db.TagEntity
import com.bluskysoftware.yandegallery.domain.ConnectionMonitor
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.atomic.AtomicInteger

/**
 * M3-T6: WriteRepository——乐观镜像 + 回滚 + 404 当成功 + 写失败/401 汇入横幅。
 *
 * :memory: Room（真 DAO）+ FakeWriteApi（可注入抛 ApiException）+ 真 ConnectionMonitor
 * （断言 online/unauthorized StateFlow 翻转）+ 计数 requestSync。
 */
@RunWith(RobolectricTestRunner::class)
class WriteRepositoryTest {
    private lateinit var db: AppDatabase

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
    }

    @After
    fun teardown() = db.close()

    /** 可注入每方法抛 ApiException 的 fake；记录调用便于断言 batch 端点被选用。 */
    private class FakeWriteApi : WriteApi {
        var failDeleteImage: ApiException? = null
        var failBatchDelete: ApiException? = null
        var failAddTags: ApiException? = null
        var failRemoveTags: ApiException? = null
        var failCreateGallery: ApiException? = null
        var failRenameGallery: ApiException? = null
        var failDeleteGallery: ApiException? = null
        var failAddToGallery: ApiException? = null
        var failRemoveFromGallery: ApiException? = null

        var createdGalleryId: Long = 100L
        var batchResults: List<BatchDeleteItemDto> = emptyList()
        val calls = mutableListOf<String>()

        // 取消用例的门控：entered 通知「已进入调用」，gate 永不放行——调用只能被取消（无 sleep）。
        var deleteImageEntered: CompletableDeferred<Unit>? = null
        var deleteImageGate: CompletableDeferred<Unit>? = null

        override suspend fun deleteImage(imageId: Long) {
            calls += "deleteImage"; failDeleteImage?.let { throw it }
            deleteImageEntered?.complete(Unit)
            deleteImageGate?.await()
        }

        override suspend fun batchDeleteImages(imageIds: List<Long>): List<BatchDeleteItemDto> {
            calls += "batchDeleteImages"; failBatchDelete?.let { throw it }; return batchResults
        }

        override suspend fun addImageTags(imageId: Long, names: List<String>) {
            calls += "addImageTags"; failAddTags?.let { throw it }
        }

        override suspend fun removeImageTags(imageId: Long, names: List<String>) {
            calls += "removeImageTags"; failRemoveTags?.let { throw it }
        }

        override suspend fun createGallery(name: String): Long {
            calls += "createGallery"; failCreateGallery?.let { throw it }; return createdGalleryId
        }

        override suspend fun renameGallery(galleryId: Long, name: String) {
            calls += "renameGallery"; failRenameGallery?.let { throw it }
        }

        override suspend fun deleteGallery(galleryId: Long) {
            calls += "deleteGallery"; failDeleteGallery?.let { throw it }
        }

        override suspend fun addImagesToGallery(galleryId: Long, imageIds: List<Long>): AddMembersDto {
            calls += "addImagesToGallery"; failAddToGallery?.let { throw it }
            return AddMembersDto(added = imageIds.size, missingImageIds = emptyList())
        }

        override suspend fun removeImagesFromGallery(galleryId: Long, imageIds: List<Long>): Int {
            calls += "removeImagesFromGallery"; failRemoveFromGallery?.let { throw it }
            return imageIds.size
        }
    }

    private fun image(id: Long, createdAt: String = "2026-01-01T00:00:00.000Z") = ImageEntity(
        id = id, filename = "$id.jpg", width = 100, height = 100,
        fileSize = 1, format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    private fun gallery(id: Long, name: String) = GalleryEntity(
        id = id, name = name, coverImageId = null, imageCount = 0,
    )

    /** 每个用例内新建 monitor + repo；requestSync 计数经 AtomicInteger 汇总。 */
    private fun TestScope.build(
        api: FakeWriteApi,
        syncCount: AtomicInteger,
    ): Pair<WriteRepository, ConnectionMonitor> {
        val monitor = ConnectionMonitor(activeServerName = flowOf<String?>("srv"), scope = backgroundScope)
        val repo = WriteRepository(api, db, monitor) { syncCount.incrementAndGet() }
        return repo to monitor
    }

    // ---- deleteImage ----

    @Test
    fun `deleteImage 成功——镜像行删除+online+requestSync`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        val api = FakeWriteApi()
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.deleteImage(1)

        assertEquals(WriteResult.Success, result)
        assertNull(db.imageDao().byId(1))          // 镜像行删除
        assertTrue(monitor.state.value.online)     // 上报成功
        assertEquals(1, sync.get())                // 冗余 nudge
    }

    @Test
    fun `deleteImage 404——视为成功不回滚不置离线`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        val api = FakeWriteApi().apply { failDeleteImage = ApiException("NOT_FOUND", "已删", 404) }
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)
        monitor.reportFailure(ApiException("INTERNAL_ERROR", "先制造离线态"))
        assertFalse(monitor.state.value.online)

        val result = repo.deleteImage(1)

        assertEquals(WriteResult.Success, result)
        assertNull(db.imageDao().byId(1))          // 目标已在桌面被删——镜像不回滚
        assertTrue(monitor.state.value.online)     // 404 走 reportSuccess，翻回 online
        assertEquals(1, sync.get())
    }

    @Test
    fun `deleteImage 500——镜像行回滚恢复+离线`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        val api = FakeWriteApi().apply { failDeleteImage = ApiException("INTERNAL_ERROR", "boom", 500) }
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.deleteImage(1)

        assertTrue(result is WriteResult.Failed)
        assertFalse((result as WriteResult.Failed).unauthorized)
        assertNotNull(db.imageDao().byId(1))       // 回滚恢复
        assertFalse(monitor.state.value.online)    // 上报失败
        assertEquals(0, sync.get())                // 失败不 nudge
    }

    @Test
    fun `deleteImage 401——回滚+unauthorized`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        val api = FakeWriteApi().apply { failDeleteImage = ApiException("UNAUTHORIZED", "密钥失效", 401) }
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.deleteImage(1)

        assertTrue(result is WriteResult.Failed)
        assertTrue((result as WriteResult.Failed).unauthorized)
        assertNotNull(db.imageDao().byId(1))       // 回滚恢复
        assertTrue(monitor.state.value.unauthorized)
        assertFalse(monitor.state.value.online)
    }

    @Test
    fun `deleteImage 取消——CancellationException 重抛且不误报离线横幅`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        val entered = CompletableDeferred<Unit>()
        val api = FakeWriteApi().apply {
            deleteImageEntered = entered
            deleteImageGate = CompletableDeferred()   // 永不放行——调用只能被取消
        }
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)
        monitor.reportSuccess()                       // 预置 online；若吞取消误报 reportFailure 会翻 false
        assertTrue(monitor.state.value.online)

        val job = launch { repo.deleteImage(1) }
        entered.await()                               // 确定性等到 fake 挂在 gate 上
        job.cancel()
        job.join()

        assertTrue(job.isCancelled)                   // (a) 取消向上传播，不被吞成 Failed
        assertTrue(monitor.state.value.online)        // (b) 未误报离线（无 spurious reportFailure）
        assertNull(db.imageDao().byId(1))             // 取消时结果未知，不回滚，镜像靠下一轮同步对账收敛
        assertEquals(0, sync.get())                   // 取消不 nudge
    }

    // ---- batchDeleteImages（走 batch 端点，controller 裁定 3）----

    @Test
    fun `batchDeleteImages 全成功——走 batch 端点+全删+Success`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        val api = FakeWriteApi().apply {
            batchResults = listOf(BatchDeleteItemDto(1, true), BatchDeleteItemDto(2, true))
        }
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.batchDeleteImages(listOf(1, 2))

        assertEquals(WriteResult.Success, result)
        assertTrue(api.calls.contains("batchDeleteImages"))   // 用批量端点而非逐个 deleteImage
        assertFalse(api.calls.contains("deleteImage"))
        assertNull(db.imageDao().byId(1))
        assertNull(db.imageDao().byId(2))
        assertTrue(monitor.state.value.online)
        assertEquals(1, sync.get())
    }

    @Test
    fun `batchDeleteImages 部分失败——NOT_FOUND当成功真失败回滚+Failed`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2), image(3)))
        val api = FakeWriteApi().apply {
            batchResults = listOf(
                BatchDeleteItemDto(1, true),
                BatchDeleteItemDto(2, false, "NOT_FOUND"),   // 桌面已删——视为成功
                BatchDeleteItemDto(3, false, "INTERNAL_ERROR"), // 真失败——回滚其镜像行
            )
        }
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.batchDeleteImages(listOf(1, 2, 3))

        assertTrue(result is WriteResult.Failed)
        assertEquals("部分删除失败", (result as WriteResult.Failed).message)
        assertNull(db.imageDao().byId(1))          // 成功删
        assertNull(db.imageDao().byId(2))          // NOT_FOUND 当已删
        assertNotNull(db.imageDao().byId(3))       // 真失败——回滚恢复
        assertTrue(monitor.state.value.online)     // 端点整体返回，reportSuccess
        assertEquals(1, sync.get())
    }

    // ---- addTags / removeTags ----

    @Test
    fun `addTags 已知 tag name——image_tags 链新增`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.tagDao().insertAll(listOf(TagEntity(7, "sky", null)))
        val api = FakeWriteApi()
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.addTags(1, listOf("sky"))

        assertEquals(WriteResult.Success, result)
        assertEquals(listOf("sky"), db.imageDao().tagNamesOf(1))   // 本地建链
        assertTrue(monitor.state.value.online)
        assertEquals(1, sync.get())
    }

    @Test
    fun `addTags 未知 tag name——不新增本地链且不崩`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        // tags 表内无 "novel"——tagDao.byName 未命中
        val api = FakeWriteApi()
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.addTags(1, listOf("novel"))

        assertEquals(WriteResult.Success, result)          // 不崩，等 SSE resync 补 id
        assertEquals(0, db.imageDao().tagLinkCount())      // 未知 tag 不本地建行
        assertTrue(monitor.state.value.online)
    }

    @Test
    fun `removeTags 已知 tag name——image_tags 链删除`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.tagDao().insertAll(listOf(TagEntity(7, "sky", null)))
        db.imageDao().insertTagLinks(listOf(ImageTagEntity(1, 7)))
        val api = FakeWriteApi()
        val sync = AtomicInteger(0)
        val (repo, _) = build(api, sync)

        val result = repo.removeTags(1, listOf("sky"))

        assertEquals(WriteResult.Success, result)
        assertEquals(emptyList<String>(), db.imageDao().tagNamesOf(1))
    }

    @Test
    fun `addTags 失败——回滚已建链`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.tagDao().insertAll(listOf(TagEntity(7, "sky", null)))
        val api = FakeWriteApi().apply { failAddTags = ApiException("INTERNAL_ERROR", "boom", 500) }
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.addTags(1, listOf("sky"))

        assertTrue(result is WriteResult.Failed)
        assertEquals(0, db.imageDao().tagLinkCount())      // 乐观链被回滚删除
        assertFalse(monitor.state.value.online)
    }

    // ---- createGallery / renameGallery / deleteGallery ----

    @Test
    fun `createGallery——galleries 行插入返回 id`() = runTest {
        val api = FakeWriteApi().apply { createdGalleryId = 42 }
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.createGallery("新图集")

        assertEquals(WriteResult.Success, result)
        val row = db.galleryDao().byId(42)
        assertNotNull(row)
        assertEquals("新图集", row!!.name)
        assertNull(row.coverImageId)
        assertEquals(0, row.imageCount)
        assertTrue(monitor.state.value.online)
        assertEquals(1, sync.get())
    }

    @Test
    fun `renameGallery 失败——回滚旧名`() = runTest {
        db.galleryDao().insertOne(gallery(1, "旧名"))
        val api = FakeWriteApi().apply { failRenameGallery = ApiException("INTERNAL_ERROR", "boom", 500) }
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.renameGallery(1, "新名")

        assertTrue(result is WriteResult.Failed)
        assertEquals("旧名", db.galleryDao().byId(1)?.name)   // 回滚旧名
        assertFalse(monitor.state.value.online)
    }

    @Test
    fun `deleteGallery 成功——galleries 行与成员行都删`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(5, "g"))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(5, 1)))
        val api = FakeWriteApi()
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.deleteGallery(5)

        assertEquals(WriteResult.Success, result)
        assertNull(db.galleryDao().byId(5))                   // galleries 行删
        assertEquals(emptyList<Long>(), db.imageDao().galleryIdsOf(1))  // 成员行删
        assertTrue(monitor.state.value.online)
        assertEquals(1, sync.get())
    }

    @Test
    fun `deleteGallery 失败——回滚 galleries 行`() = runTest {
        db.galleryDao().insertOne(gallery(5, "g"))
        val api = FakeWriteApi().apply { failDeleteGallery = ApiException("INTERNAL_ERROR", "boom", 500) }
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.deleteGallery(5)

        assertTrue(result is WriteResult.Failed)
        assertNotNull(db.galleryDao().byId(5))                // galleries 行回滚恢复
        assertFalse(monitor.state.value.online)
    }

    // ---- addToGallery / removeFromGallery ----

    @Test
    fun `addToGallery——链新增且 galleryId 列顺序正确`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(5, "g"))
        val api = FakeWriteApi()
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.addToGallery(galleryId = 5, imageIds = listOf(1))

        assertEquals(WriteResult.Success, result)
        // galleryIdsOf 按 imageId 过滤、返回 galleryId 列——== 传入的 galleryId 证明列顺序正确。
        assertEquals(listOf(5L), db.imageDao().galleryIdsOf(1))
        assertTrue(monitor.state.value.online)
        assertEquals(1, sync.get())
    }

    @Test
    fun `removeFromGallery——链删除`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(5, "g"))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(5, 1)))
        val api = FakeWriteApi()
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.removeFromGallery(galleryId = 5, imageIds = listOf(1))

        assertEquals(WriteResult.Success, result)
        assertEquals(emptyList<Long>(), db.imageDao().galleryIdsOf(1))
        assertTrue(monitor.state.value.online)
    }

    @Test
    fun `addToGallery 失败——回滚新增链`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(5, "g"))
        val api = FakeWriteApi().apply { failAddToGallery = ApiException("INTERNAL_ERROR", "boom", 500) }
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.addToGallery(galleryId = 5, imageIds = listOf(1))

        assertTrue(result is WriteResult.Failed)
        assertEquals(emptyList<Long>(), db.imageDao().galleryIdsOf(1))  // 乐观链回滚
        assertFalse(monitor.state.value.online)
    }
}
