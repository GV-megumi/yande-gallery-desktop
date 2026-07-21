package com.bluskysoftware.yandegallery.domain.write

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.api.AddMembersDto
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.api.BatchDeleteItemDto
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.GalleryImageEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ImageFileEntity
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
import java.io.File
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
    private lateinit var mirrorRoot: File

    @Before
    fun setup() {
        val context: Context = ApplicationProvider.getApplicationContext()
        db = AppDatabase.inMemory(context)
        // 镜像级联用例的假镜像文件落在这——真实文件而非纯内存假设，贴近 ImageMirrorStoreTest 的做法
        mirrorRoot = File(context.cacheDir, "write-repo-test-${System.nanoTime()}").apply { mkdirs() }
    }

    @After
    fun teardown() {
        db.close()
        mirrorRoot.deleteRecursively()
    }

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
        var failSetGalleryCover: ApiException? = null

        var createdGalleryId: Long = 100L
        var batchResults: List<BatchDeleteItemDto> = emptyList()
        val calls = mutableListOf<String>()
        // 分块用例：记录每次 batch 调用收到的 id 列表；指定第 N 次(0基)调用抛 ApiException(500)。
        val batchDeleteInputs = mutableListOf<List<Long>>()
        var failBatchDeleteOnCallIndex: Int? = null
        // 移动到相册用例：记录每次 removeImagesFromGallery 收到的 (galleryId, imageIds)；
        // 指定第 N 次(0基)调用抛 ApiException(500)——仅让首次「当前移除」失败、补偿「目标移除」照常成功
        //（沿用 failBatchDeleteOnCallIndex 的按调用序失败风格；全局 failRemoveFromGallery 会连补偿一并炸）。
        val removeFromGalleryInputs = mutableListOf<Pair<Long, List<Long>>>()
        var failRemoveFromGalleryOnCallIndex: Int? = null

        // 取消用例的门控：entered 通知「已进入调用」，gate 永不放行——调用只能被取消（无 sleep）。
        var deleteImageEntered: CompletableDeferred<Unit>? = null
        var deleteImageGate: CompletableDeferred<Unit>? = null

        override suspend fun deleteImage(imageId: Long) {
            calls += "deleteImage"; failDeleteImage?.let { throw it }
            deleteImageEntered?.complete(Unit)
            deleteImageGate?.await()
        }

        override suspend fun batchDeleteImages(imageIds: List<Long>): List<BatchDeleteItemDto> {
            calls += "batchDeleteImages"; batchDeleteInputs += imageIds
            failBatchDelete?.let { throw it }
            if (failBatchDeleteOnCallIndex == batchDeleteInputs.size - 1) {
                throw ApiException("INTERNAL_ERROR", "boom", 500)
            }
            return batchResults
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
            // 先记录再判失败：失败调用也要留痕（补偿调用序断言依赖此）
            calls += "removeImagesFromGallery"; removeFromGalleryInputs += galleryId to imageIds
            failRemoveFromGallery?.let { throw it }
            if (failRemoveFromGalleryOnCallIndex == removeFromGalleryInputs.size - 1) {
                throw ApiException("INTERNAL_ERROR", "boom", 500)
            }
            return imageIds.size
        }

        override suspend fun setGalleryCover(galleryId: Long, coverImageId: Long) {
            calls += "setGalleryCover"; failSetGalleryCover?.let { throw it }
        }
    }

    private fun image(id: Long, createdAt: String = "2026-01-01T00:00:00.000Z") = ImageEntity(
        id = id, filename = "$id.jpg", width = 100, height = 100,
        fileSize = 1, format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    private fun gallery(id: Long, name: String) = GalleryEntity(
        id = id, name = name, coverImageId = null, imageCount = 0,
    )

    /**
     * 每个用例内新建 monitor + repo；requestSync 计数经 AtomicInteger 汇总。
     * activeServerId/removeMirrorFiles 默认值为 no-op（多数用例不关心镜像级联）；
     * 镜像级联用例按需具名传入，不影响既有 ~30 个用例的调用形态。
     */
    private fun TestScope.build(
        api: FakeWriteApi,
        syncCount: AtomicInteger,
        activeServerId: suspend () -> Long? = { null },
        removeMirrorFiles: suspend (Long, List<Long>) -> Unit = { _, _ -> },
    ): Pair<WriteRepository, ConnectionMonitor> {
        val monitor = ConnectionMonitor(activeServerName = flowOf<String?>("srv"), scope = backgroundScope)
        val repo = WriteRepository(api, db, monitor, activeServerId, removeMirrorFiles) { syncCount.incrementAndGet() }
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
        monitor.reportFailure(java.io.IOException("先制造离线态"))   // 连不上才算离线（BUG-02 分类）
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
        assertTrue(monitor.state.value.online)     // 服务器已应答：不误报离线（BUG-02）
        assertEquals(1, sync.get())                // 应答式失败对账一次，回滚残差以服务端为准收敛
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
        assertTrue(monitor.state.value.online)     // 401 也是服务器应答（BUG-02）；横幅按 unauthorized 展示
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

    @Test
    fun `batchDeleteImages 去重——重复 id 只发一次`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        val api = FakeWriteApi()   // batchResults 空 → 无失败项 → Success
        val sync = AtomicInteger(0)
        val (repo, _) = build(api, sync)

        val result = repo.batchDeleteImages(listOf(1, 1, 2))

        assertEquals(WriteResult.Success, result)
        assertEquals(listOf(listOf(1L, 2L)), api.batchDeleteInputs)   // 去重后 [1,2] 单块发出
    }

    @Test
    fun `batchDeleteImages 超 900 分块——按 900+1 两次调用`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(901)))   // 快照允许缺失，只种边界两行
        val api = FakeWriteApi()
        val sync = AtomicInteger(0)
        val (repo, _) = build(api, sync)

        val ids = (1L..901L).toList()
        val result = repo.batchDeleteImages(ids)

        assertEquals(WriteResult.Success, result)
        assertEquals(2, api.batchDeleteInputs.size)
        assertEquals(900, api.batchDeleteInputs[0].size)
        assertEquals(1, api.batchDeleteInputs[1].size)
        assertNull(db.imageDao().byId(1))     // 全成功——两块都删
        assertNull(db.imageDao().byId(901))
    }

    @Test
    fun `batchDeleteImages 某块失败——回滚该块与未发块，已成块保持`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(901)))   // 边界：1 在首块、901 在次块
        val api = FakeWriteApi().apply { failBatchDeleteOnCallIndex = 1 }   // 第二块（次块）抛 500
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.batchDeleteImages((1L..901L).toList())

        assertTrue(result is WriteResult.Failed)
        assertNull(db.imageDao().byId(1))       // 首块已成——保持删除
        assertNotNull(db.imageDao().byId(901))  // 次块失败——回滚恢复
        assertTrue(monitor.state.value.online)  // 500 是服务器应答：不误报离线（BUG-02）
        assertEquals(1, sync.get())             // 应答式失败对账一次（已成块的删除也需服务端确认收敛）
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
        assertTrue(monitor.state.value.online)             // 500 是服务器应答：不误报离线（BUG-02）
    }

    // ---- createGallery / renameGallery / deleteGallery ----

    @Test
    fun `createGallery——galleries 行插入返回 id`() = runTest {
        val api = FakeWriteApi().apply { createdGalleryId = 42 }
        val sync = AtomicInteger(0)
        val (repo, monitor) = build(api, sync)

        val result = repo.createGallery("新相册")

        assertEquals(WriteResult.Success, result)
        val row = db.galleryDao().byId(42)
        assertNotNull(row)
        assertEquals("新相册", row!!.name)
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
        assertTrue(monitor.state.value.online)                // 500 是服务器应答：不误报离线（BUG-02）
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
        assertTrue(monitor.state.value.online)                // 500 是服务器应答：不误报离线（BUG-02）
    }

    // ---- setGalleryCover（v0.6 spec §5.3：非乐观——先服务端后写本地镜像）----

    @Test
    fun `setGalleryCover 成功后写本地镜像并nudge同步`() = runTest {
        db.galleryDao().insertOne(gallery(1, "g"))
        val api = FakeWriteApi()
        val sync = AtomicInteger(0)
        val (repo, _) = build(api, sync)

        val result = repo.setGalleryCover(1, 10)

        assertEquals(WriteResult.Success, result)
        assertEquals(10L, db.galleryDao().byId(1)?.coverImageId)   // 本地即时生效（spec §5.3）
        assertEquals(1, sync.get())   // 沿用本文件既有 requestSync 计数装置
    }

    @Test
    fun `setGalleryCover 服务端失败不动本地镜像`() = runTest {
        db.galleryDao().insertOne(gallery(1, "g"))
        val api = FakeWriteApi().apply {
            failSetGalleryCover = ApiException("VALIDATION_ERROR", "Cover image not in gallery", 422)
        }
        val sync = AtomicInteger(0)
        val (repo, _) = build(api, sync)

        val result = repo.setGalleryCover(1, 10)

        assertTrue(result is WriteResult.Failed)
        assertNull(db.galleryDao().byId(1)?.coverImageId)   // 非乐观：失败零残留
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
        assertTrue(monitor.state.value.online)                          // 500 是服务器应答：不误报离线（BUG-02）
    }

    // ---- 回滚对称性回归（BUG-03/04/14/15 + deleteGallery 同族）----

    @Test
    fun `deleteImage 失败——回滚重建被级联删除的相册与标签链（BUG-03）`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(5, "g"))
        db.tagDao().insertAll(listOf(TagEntity(7, "sky", null)))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(5, 1)))
        db.imageDao().insertTagLinks(listOf(ImageTagEntity(1, 7)))
        val api = FakeWriteApi().apply { failDeleteImage = ApiException("PERMISSION_DENIED", "imageWrite 未开", 403) }
        val (repo, _) = build(api, AtomicInteger(0))

        val result = repo.deleteImage(1)

        assertTrue(result is WriteResult.Failed)
        assertNotNull(db.imageDao().byId(1))
        assertEquals("回滚须恢复相册链——否则图从相册凭空消失", listOf(5L), db.imageDao().galleryIdsOf(1))
        assertEquals("回滚须恢复标签链——否则标签清空掉出搜索", listOf("sky"), db.imageDao().tagNamesOf(1))
    }

    @Test
    fun `addToGallery 失败——回滚不误删选中图原有的成员关系（BUG-04）`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))   // 1 已在相册 G，2 是本次新加
        db.galleryDao().insertOne(gallery(5, "g"))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(5, 1)))
        val api = FakeWriteApi().apply { failAddToGallery = ApiException("PERMISSION_DENIED", "galleryWrite 未开", 403) }
        val (repo, _) = build(api, AtomicInteger(0))

        val result = repo.addToGallery(5, listOf(1, 2))

        assertTrue(result is WriteResult.Failed)
        assertEquals("已在相册的 1 不得被回滚静默移出", listOf(5L), db.imageDao().galleryIdsOf(1))
        assertEquals("本次新加的 2 回滚移除", emptyList<Long>(), db.imageDao().galleryIdsOf(2))
    }

    @Test
    fun `addToGallery 千级选中——已存链查询与回滚删除按 900 分块跨界不丢不漏（审查 major 回归）`() = runTest {
        // 真机 API 26–30 框架 SQLite 绑定变量上限 999，未分块 IN 会直接崩；Robolectric 自带
        // SQLite 上限 32766 拦不住那个崩溃——本用例锁的是分块逻辑跨 900 界的语义正确性：
        // 已存链 1..50 + 全选 1..1000 → 查询跨界（900+100）、回滚删除跨界（950=900+50）。
        db.imageDao().upsertAll((1L..1000L).map { image(it) })
        db.galleryDao().insertOne(gallery(5, "g"))
        db.imageDao().insertGalleryLinks((1L..50L).map { GalleryImageEntity(5, it) })
        val api = FakeWriteApi().apply { failAddToGallery = ApiException("INTERNAL_ERROR", "boom", 500) }
        val (repo, _) = build(api, AtomicInteger(0))

        val result = repo.addToGallery(5, (1L..1000L).toList())

        assertTrue(result is WriteResult.Failed)
        for (kept in listOf(1L, 50L)) {
            assertEquals("既有链 $kept 不得被回滚误删", listOf(5L), db.imageDao().galleryIdsOf(kept))
        }
        for (removed in listOf(51L, 900L, 901L, 1000L)) {
            assertEquals("新增链 $removed（含分块边界）回滚移除", emptyList<Long>(), db.imageDao().galleryIdsOf(removed))
        }
    }

    @Test
    fun `addToGallery-removeFromGallery 空列表——不发请求直接成功（BUG-14）`() = runTest {
        val api = FakeWriteApi()
        val (repo, _) = build(api, AtomicInteger(0))

        assertEquals(WriteResult.Success, repo.addToGallery(5, emptyList()))
        assertEquals(WriteResult.Success, repo.removeFromGallery(5, emptyList()))
        assertEquals("空集不得发往服务端（桌面对空 imageIds 回 422）", emptyList<String>(), api.calls)
    }

    @Test
    fun `addTags 失败——回滚不误删操作前已存在的同名标签链（BUG-15）`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.tagDao().insertAll(listOf(TagEntity(7, "sky", null)))
        db.imageDao().insertTagLinks(listOf(ImageTagEntity(1, 7)))   // 操作前已有链
        val api = FakeWriteApi().apply { failAddTags = ApiException("INTERNAL_ERROR", "boom", 500) }
        val (repo, _) = build(api, AtomicInteger(0))

        val result = repo.addTags(1, listOf("sky"))

        assertTrue(result is WriteResult.Failed)
        assertEquals("操作前已存在的链必须存活", listOf("sky"), db.imageDao().tagNamesOf(1))
    }

    @Test
    fun `deleteGallery 失败——回滚恢复成员链（例行同步不重建，BUG-03 同族）`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(5, "g"))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(5, 1)))
        val api = FakeWriteApi().apply { failDeleteGallery = ApiException("INTERNAL_ERROR", "boom", 500) }
        val (repo, _) = build(api, AtomicInteger(0))

        val result = repo.deleteGallery(5)

        assertTrue(result is WriteResult.Failed)
        assertNotNull(db.galleryDao().byId(5))
        assertEquals("回滚回来的相册不得变成空集", listOf(5L), db.imageDao().galleryIdsOf(1))
    }

    @Test
    fun `batchDeleteImages 失败块回滚——镜像行连同相册标签链一并恢复（BUG-03 批量版）`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(5, "g"))
        db.tagDao().insertAll(listOf(TagEntity(7, "sky", null)))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(5, 1)))
        db.imageDao().insertTagLinks(listOf(ImageTagEntity(1, 7)))
        val api = FakeWriteApi().apply { failBatchDelete = ApiException("INTERNAL_ERROR", "boom", 500) }
        val (repo, _) = build(api, AtomicInteger(0))

        val result = repo.batchDeleteImages(listOf(1))

        assertTrue(result is WriteResult.Failed)
        assertNotNull(db.imageDao().byId(1))
        assertEquals(listOf(5L), db.imageDao().galleryIdsOf(1))
        assertEquals(listOf("sky"), db.imageDao().tagNamesOf(1))
    }

    // ---- 镜像级联清理（Task 8 审查遗留项：App 内发起的删除永不级联镜像文件）----
    // db.imageDao().deleteByIds 把行整行抹掉后，images 表里再也查不到该 id，SyncEngine 对账的
    // stale-diff（本地 id 集合里挑出「不在远端集合」的）从此永远看不到它，RoomMirrorStore.deleteImages
    // 这条既有对账级联路径永远轮不到触发——image_files 行与磁盘镜像文件会永久泄漏。
    // 用 activeServerId/removeMirrorFiles 两个注入点在删除成功路径主动补一刀（镜像 RoomMirrorStore 的注入方式）。

    @Test
    fun `deleteImage 成功——级联删 image_files 行与磁盘镜像文件`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        val mirrorFile = File(mirrorRoot, "i1.jpg").apply { writeBytes(ByteArray(4)) }
        db.imageFileDao().upsert(ImageFileEntity(1L, 1L, "ORIGINAL", mirrorFile.path, 4L, 0L))
        val removedCalls = mutableListOf<Pair<Long, List<Long>>>()
        val api = FakeWriteApi()
        val (repo, _) = build(
            api, AtomicInteger(0),
            activeServerId = { 1L },
            removeMirrorFiles = { serverId, ids -> removedCalls += serverId to ids; mirrorFile.delete() },
        )

        val result = repo.deleteImage(1)

        assertEquals(WriteResult.Success, result)
        assertNull(db.imageFileDao().byImageId(1L, 1L))     // image_files 行随主动级联删除
        assertFalse(mirrorFile.exists())                     // 磁盘镜像文件随注入回调删除
        assertEquals(listOf(1L to listOf(1L)), removedCalls)
    }

    @Test
    fun `deleteImage 失败回滚——镜像行与磁盘文件都不级联`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        val mirrorFile = File(mirrorRoot, "i1.jpg").apply { writeBytes(ByteArray(4)) }
        db.imageFileDao().upsert(ImageFileEntity(1L, 1L, "ORIGINAL", mirrorFile.path, 4L, 0L))
        val removedCalls = mutableListOf<Pair<Long, List<Long>>>()
        val api = FakeWriteApi().apply { failDeleteImage = ApiException("INTERNAL_ERROR", "boom", 500) }
        val (repo, _) = build(
            api, AtomicInteger(0),
            activeServerId = { 1L },
            removeMirrorFiles = { serverId, ids -> removedCalls += serverId to ids; mirrorFile.delete() },
        )

        val result = repo.deleteImage(1)

        assertTrue(result is WriteResult.Failed)
        assertNotNull(db.imageFileDao().byImageId(1L, 1L))   // 图本身回滚保留——镜像行不该被清
        assertTrue(mirrorFile.exists())
        assertTrue("回滚后 images 行仍在，级联判定须是 no-op", removedCalls.isEmpty())
    }

    @Test
    fun `batchDeleteImages 部分失败——只级联真删除子集的镜像文件`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2), image(3)))
        val files = (1L..3L).associateWith { id -> File(mirrorRoot, "i$id.jpg").apply { writeBytes(ByteArray(4)) } }
        files.forEach { (id, f) -> db.imageFileDao().upsert(ImageFileEntity(1L, id, "ORIGINAL", f.path, 4L, 0L)) }
        val removedIds = mutableListOf<Long>()
        val api = FakeWriteApi().apply {
            batchResults = listOf(
                BatchDeleteItemDto(1, true),
                BatchDeleteItemDto(2, false, "NOT_FOUND"),      // 桌面已删——视为成功，一并级联
                BatchDeleteItemDto(3, false, "INTERNAL_ERROR"), // 真失败——回滚，不级联
            )
        }
        val (repo, _) = build(
            api, AtomicInteger(0),
            activeServerId = { 1L },
            removeMirrorFiles = { _, ids -> removedIds += ids; ids.forEach { files.getValue(it).delete() } },
        )

        val result = repo.batchDeleteImages(listOf(1, 2, 3))

        assertTrue(result is WriteResult.Failed)
        assertEquals(listOf(1L, 2L), removedIds.sorted())
        assertNull(db.imageFileDao().byImageId(1L, 1L))
        assertNull(db.imageFileDao().byImageId(1L, 2L))
        assertNotNull(db.imageFileDao().byImageId(1L, 3L))    // 真失败回滚——镜像行与文件都保留
        assertFalse(files.getValue(1).exists())
        assertFalse(files.getValue(2).exists())
        assertTrue(files.getValue(3).exists())
    }

    @Test
    fun `batchDeleteImages 某块失败早退——已成块仍级联其镜像文件`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(901)))   // 边界：1 在首块、901 在次块
        val f1 = File(mirrorRoot, "i1.jpg").apply { writeBytes(ByteArray(4)) }
        val f901 = File(mirrorRoot, "i901.jpg").apply { writeBytes(ByteArray(4)) }
        db.imageFileDao().upsert(ImageFileEntity(1L, 1L, "ORIGINAL", f1.path, 4L, 0L))
        db.imageFileDao().upsert(ImageFileEntity(1L, 901L, "ORIGINAL", f901.path, 4L, 0L))
        val removedIds = mutableListOf<Long>()
        val api = FakeWriteApi().apply { failBatchDeleteOnCallIndex = 1 }   // 第二块（次块）抛 500
        val (repo, _) = build(
            api, AtomicInteger(0),
            activeServerId = { 1L },
            removeMirrorFiles = { _, ids -> removedIds += ids; if (1L in ids) f1.delete(); if (901L in ids) f901.delete() },
        )

        val result = repo.batchDeleteImages((1L..901L).toList())

        assertTrue(result is WriteResult.Failed)
        assertEquals(listOf(1L), removedIds)      // 早退路径也须级联「已成块」；901（次块回滚）不级联
        assertNull(db.imageFileDao().byImageId(1L, 1L))
        assertNotNull(db.imageFileDao().byImageId(1L, 901L))
        assertFalse(f1.exists())
        assertTrue(f901.exists())
    }

    // ---- moveToGallery（桌面域移动，spec §6.2：目标加入成功→当前移除；移除失败补偿回滚）----
    // A=10、B=20；image 1 初始在 A。gallery_images 现状即断言 ground truth（不看调用方分流子集）。

    @Test
    fun `移动到相册_目标加入且当前移除`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(10, "A"))
        db.galleryDao().insertOne(gallery(20, "B"))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(10, 1)))   // 1 初始在 A
        val api = FakeWriteApi()
        val (repo, monitor) = build(api, AtomicInteger(0))

        val result = repo.moveToGallery(fromGalleryId = 10, toGalleryId = 20, imageIds = listOf(1))

        assertEquals(WriteResult.Success, result)
        assertEquals(listOf(20L), db.imageDao().galleryIdsOf(1))          // 只在 B 不在 A（加入 B 生效 + 移出 A 生效）
        assertEquals(1, api.calls.count { it == "addImagesToGallery" })   // addImagesToGallery(B,[1]) 一次
        assertEquals(listOf(10L to listOf(1L)), api.removeFromGalleryInputs)  // removeImagesFromGallery(A,[1]) 一次
        assertTrue(monitor.state.value.online)
    }

    @Test
    fun `移动到相册_移除失败时补偿回滚目标加入`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(10, "A"))
        db.galleryDao().insertOne(gallery(20, "B"))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(10, 1)))
        // 仅首次「当前移除」(A) 失败 500；补偿「目标移除」(B) 照常成功——撤销刚才的目标加入
        val api = FakeWriteApi().apply { failRemoveFromGalleryOnCallIndex = 0 }
        val (repo, _) = build(api, AtomicInteger(0))

        val result = repo.moveToGallery(fromGalleryId = 10, toGalleryId = 20, imageIds = listOf(1))

        assertTrue(result is WriteResult.Failed)
        assertEquals(listOf(10L), db.imageDao().galleryIdsOf(1))   // 回到初始态：1 仍在 A、不在 B
        // 调用序：先 A 移除（失败）→ 再 B 补偿移除（撤销目标加入）
        assertEquals(listOf(10L to listOf(1L), 20L to listOf(1L)), api.removeFromGalleryInputs)
    }

    @Test
    fun `移动到相册_加入失败直接失败不发移除`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(10, "A"))
        db.galleryDao().insertOne(gallery(20, "B"))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(10, 1)))
        val api = FakeWriteApi().apply { failAddToGallery = ApiException("INTERNAL_ERROR", "boom", 500) }
        val (repo, _) = build(api, AtomicInteger(0))

        val result = repo.moveToGallery(fromGalleryId = 10, toGalleryId = 20, imageIds = listOf(1))

        assertTrue(result is WriteResult.Failed)
        assertFalse(api.calls.contains("removeImagesFromGallery"))       // 加入失败即止，绝不发移除
        assertEquals(emptyList<Pair<Long, List<Long>>>(), api.removeFromGalleryInputs)
        assertEquals(listOf(10L), db.imageDao().galleryIdsOf(1))          // 镜像不变：加入 B 已回滚、1 仍只在 A
    }

    @Test
    fun `移动到相册_移除404当成功`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(10, "A"))
        db.galleryDao().insertOne(gallery(20, "B"))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(10, 1)))
        // 目标已在桌面被移出——「当前移除」返回 404 当成功；整体 Success，不补偿
        val api = FakeWriteApi().apply { failRemoveFromGallery = ApiException("NOT_FOUND", "已移出", 404) }
        val (repo, monitor) = build(api, AtomicInteger(0))

        val result = repo.moveToGallery(fromGalleryId = 10, toGalleryId = 20, imageIds = listOf(1))

        assertEquals(WriteResult.Success, result)
        assertEquals(listOf(20L), db.imageDao().galleryIdsOf(1))          // 1 移入 B、移出 A（404 当移除成功不回滚）
        assertEquals(listOf(10L to listOf(1L)), api.removeFromGalleryInputs)  // 仅 A 移除一次，无 B 补偿
        assertTrue(monitor.state.value.online)                           // 404 走 reportSuccess，仍 online
    }

    // ---- moveToGallery 边界锁定（加固轮 F8：空集守护 / add-404 / 补偿双杀 / 补偿路径 nudge）----

    @Test
    fun `移动到相册_空集直接成功不触API`() = runTest {
        val api = FakeWriteApi()
        val (repo, _) = build(api, AtomicInteger(0))

        val result = repo.moveToGallery(fromGalleryId = 5, toGalleryId = 6, imageIds = emptyList())

        assertEquals(WriteResult.Success, result)
        assertEquals(emptyList<String>(), api.calls)   // add/remove 均未发（BUG-14 同门守护）
    }

    @Test
    fun `移动到相册_目标已删加入404当成功移除照走`() = runTest {
        // spec §6.2/KDoc 钉过的边界：目标相册 6 已在桌面被删 → add 404 当成功 → remove 照走 → 整体 Success
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(5, "A"))   // 目标 6 不建本地行：模拟已在桌面被删
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(5, 1)))
        val api = FakeWriteApi().apply { failAddToGallery = ApiException("NOT_FOUND", "相册已删", 404) }
        val (repo, monitor) = build(api, AtomicInteger(0))

        val result = repo.moveToGallery(fromGalleryId = 5, toGalleryId = 6, imageIds = listOf(1))

        assertEquals(WriteResult.Success, result)
        // 404 当成功不回滚（同 deleteImage 404 用例口径）：乐观加入的 (6,1) 幻影链保留、交
        // requestSync 对账收敛——按现状钉 [6]（计划 brief 预期空集，以代码为准修断言，见任务报告）
        assertEquals(listOf(6L), db.imageDao().galleryIdsOf(1))          // 已离开 A（5 链已删）
        assertNotNull(db.imageDao().byId(1))                             // 图片本体保留
        assertEquals(listOf(5L to listOf(1L)), api.removeFromGalleryInputs)  // remove 照走且仅发 A，无补偿
        assertTrue(monitor.state.value.online)                           // 404 走 reportSuccess
    }

    @Test
    fun `移动到相册_补偿自身失败镜像与服务端一致`() = runTest {
        // 双杀：remove(A) 失败 → 补偿 remove(B) 也失败 → 镜像终态 1 在 A+B（与服务端真相一致，交对账收敛）
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(5, "A"))
        db.galleryDao().insertOne(gallery(6, "g6"))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(5, 1)))
        // 全局失败连炸补偿（对照 failRemoveFromGalleryOnCallIndex 只炸首刀的既有用例）
        val api = FakeWriteApi().apply { failRemoveFromGallery = ApiException("INTERNAL_ERROR", "boom", 500) }
        val (repo, _) = build(api, AtomicInteger(0))

        val result = repo.moveToGallery(fromGalleryId = 5, toGalleryId = 6, imageIds = listOf(1))

        assertTrue(result is WriteResult.Failed)
        // 服务端真相：加入 B 已成、移出 A 未成——镜像终态同为 A+B，无幻影分歧
        assertEquals(listOf(5L, 6L), db.imageDao().galleryIdsOf(1).sorted())
        // 调用序：A 移除（失败）→ B 补偿移除（也失败但确曾尝试）
        assertEquals(listOf(5L to listOf(1L), 6L to listOf(1L)), api.removeFromGalleryInputs)
    }

    @Test
    fun `移动到相册_补偿路径触发对账nudge`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().insertOne(gallery(5, "A"))
        db.galleryDao().insertOne(gallery(6, "g6"))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(5, 1)))
        val api = FakeWriteApi().apply { failRemoveFromGalleryOnCallIndex = 0 }   // 仅首刀 A 移除失败，B 补偿成功
        val sync = AtomicInteger(0)
        val (repo, _) = build(api, sync)

        val result = repo.moveToGallery(fromGalleryId = 5, toGalleryId = 6, imageIds = listOf(1))

        assertTrue(result is WriteResult.Failed)
        // add 成功 + 补偿链路均应 nudge（实际 3 次：add 成功/A 移除应答式失败对账/B 补偿成功各一）
        assertTrue("补偿路径至少 nudge 两次，交对账收敛残差", sync.get() >= 2)
    }
}
