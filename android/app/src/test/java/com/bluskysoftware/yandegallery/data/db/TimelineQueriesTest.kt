package com.bluskysoftware.yandegallery.data.db

import androidx.paging.PagingSource
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TimelineQueriesTest {
    private lateinit var db: AppDatabase

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
    }

    @After
    fun teardown() = db.close()

    private fun img(id: Long, createdAt: String, size: Long, name: String) = ImageEntity(
        id = id, filename = name, width = 1, height = 1, fileSize = size,
        format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    private suspend fun loadIds(source: PagingSource<Int, ImageEntity>): List<Long> {
        val page = source.load(PagingSource.LoadParams.Refresh(null, 50, false)) as PagingSource.LoadResult.Page
        return page.data.map { it.id }
    }

    private suspend fun seed() {
        db.imageDao().upsertAll(listOf(
            img(1, "2026-01-03T00:00:00.000Z", size = 300, name = "b.jpg"),
            img(2, "2026-01-01T00:00:00.000Z", size = 100, name = "c.jpg"),
            img(3, "2026-01-02T00:00:00.000Z", size = 200, name = "a.jpg"),
        ))
    }

    @Test
    fun `时间轴六种排序变体顺序正确`() = runTest {
        seed()
        val dao = db.imageDao()
        assertEquals(listOf(1L, 3L, 2L), loadIds(dao.timelinePagingSource(buildTimelineQuery(PhotoSort.TIME_DESC))))
        assertEquals(listOf(2L, 3L, 1L), loadIds(dao.timelinePagingSource(buildTimelineQuery(PhotoSort.TIME_ASC))))
        assertEquals(listOf(1L, 3L, 2L), loadIds(dao.timelinePagingSource(buildTimelineQuery(PhotoSort.SIZE_DESC))))
        assertEquals(listOf(2L, 3L, 1L), loadIds(dao.timelinePagingSource(buildTimelineQuery(PhotoSort.SIZE_ASC))))
        assertEquals(listOf(3L, 1L, 2L), loadIds(dao.timelinePagingSource(buildTimelineQuery(PhotoSort.NAME_ASC))))
        assertEquals(listOf(2L, 1L, 3L), loadIds(dao.timelinePagingSource(buildTimelineQuery(PhotoSort.NAME_DESC))))
    }

    @Test
    fun `同值时二级键 id 方向随主键（分页稳定序）`() = runTest {
        db.imageDao().upsertAll(listOf(
            img(1, "2026-01-01T00:00:00.000Z", 100, "same.jpg"),
            img(2, "2026-01-01T00:00:00.000Z", 100, "same.jpg"),
        ))
        assertEquals(listOf(2L, 1L), loadIds(db.imageDao().timelinePagingSource(buildTimelineQuery(PhotoSort.TIME_DESC))))
        assertEquals(listOf(1L, 2L), loadIds(db.imageDao().timelinePagingSource(buildTimelineQuery(PhotoSort.TIME_ASC))))
    }

    @Test
    fun `相册成员分页只含成员且按变体排序`() = runTest {
        seed()
        db.galleryDao().replaceAll(listOf(GalleryEntity(9, "g", null, 2)))
        db.imageDao().insertGalleryLinks(listOf(GalleryImageEntity(9, 1), GalleryImageEntity(9, 2)))
        val dao = db.galleryDao()
        assertEquals(listOf(1L, 2L), loadIds(dao.galleryImagesPagingSource(buildGalleryImagesQuery(9, PhotoSort.TIME_DESC))))
        assertEquals(listOf(2L, 1L), loadIds(dao.galleryImagesPagingSource(buildGalleryImagesQuery(9, PhotoSort.SIZE_ASC))))
        assertEquals(listOf(1L, 2L), loadIds(dao.galleryImagesPagingSource(buildGalleryImagesQuery(9, PhotoSort.NAME_ASC))))  // b<c
    }
}
