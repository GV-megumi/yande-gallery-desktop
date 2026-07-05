package com.bluskysoftware.yandegallery.ui.albums

import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.api.AddMembersDto
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.api.BatchDeleteItemDto
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnectionMonitor
import com.bluskysoftware.yandegallery.domain.write.WriteApi
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.TestScope
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

/**
 * M3-T13: AlbumDetailViewModel 多选批量动作——重点验「移出当前图集」成功清空选择/失败保留
 * （批量动作本体已由 SelectionActionsTest 覆盖）。Robolectric + :memory: Room，
 * writeRepository 经构造缝注入（镜像 ViewerViewModel gateway 模式）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class AlbumDetailViewModelTest {
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db)
    }

    @After
    fun teardown() {
        db.close()
        Dispatchers.resetMain()
    }

    /** 最小 fake：仅移出图集可配置失败，其余空实现。 */
    private class FakeWriteApi : WriteApi {
        var failRemoveFromGallery: ApiException? = null

        override suspend fun deleteImage(imageId: Long) {}
        override suspend fun batchDeleteImages(imageIds: List<Long>): List<BatchDeleteItemDto> = emptyList()
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

    private suspend fun seedGallery(galleryId: Long, imageIds: List<Long>) {
        db.imageDao().upsertAll(imageIds.map { image(it) })
        db.galleryDao().insertOne(GalleryEntity(galleryId, "g$galleryId", null, imageIds.size))
        imageIds.forEach { db.imageDao().replaceGalleryLinks(it, listOf(galleryId)) }
    }

    private fun TestScope.vm(galleryId: Long, api: FakeWriteApi): AlbumDetailViewModel {
        val monitor = ConnectionMonitor(activeServerName = flowOf<String?>("srv"), scope = backgroundScope)
        val repo = WriteRepository(api, db, monitor) { }
        return AlbumDetailViewModel(graph, galleryId, writeRepository = repo)
    }

    @Test
    fun `移出当前图集成功——成员链删除且选择清空`() = runTest {
        seedGallery(5, listOf(1, 2))
        val viewModel = vm(5, FakeWriteApi())
        viewModel.selection.selectAll(listOf(1, 2))

        val result = viewModel.removeSelectedFromGallery(listOf(1, 2))

        assertEquals(WriteResult.Success, result)
        assertEquals(emptyList<Long>(), db.imageDao().galleryIdsOf(1))
        assertEquals(emptyList<Long>(), db.imageDao().galleryIdsOf(2))
        assertEquals(emptySet<Long>(), viewModel.selection.selected)   // brief 裁定：成功后清空
    }

    @Test
    fun `移出当前图集失败——成员链回滚且选择保留供重试`() = runTest {
        seedGallery(5, listOf(1))
        val api = FakeWriteApi().apply {
            failRemoveFromGallery = ApiException("INTERNAL_ERROR", "boom", 500)
        }
        val viewModel = vm(5, api)
        viewModel.selection.selectAll(listOf(1))

        val result = viewModel.removeSelectedFromGallery(listOf(1))

        assertTrue(result is WriteResult.Failed)
        assertEquals(listOf(5L), db.imageDao().galleryIdsOf(1))        // T6 回滚
        assertEquals(setOf(1L), viewModel.selection.selected)          // 保留选择
    }
}
