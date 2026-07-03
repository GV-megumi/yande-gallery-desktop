package com.bluskysoftware.yandegallery.data.db

import androidx.paging.PagingSource
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class GalleryDaoTest {
    private lateinit var db: AppDatabase

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
    }

    @After
    fun teardown() = db.close()

    private fun image(id: Long, createdAt: String) = ImageEntity(
        id = id, filename = "$id.jpg", width = 100, height = 100,
        fileSize = 1, format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    private fun gallery(id: Long, name: String) = GalleryEntity(
        id = id, name = name, coverImageId = null, imageCount = 0,
    )

    @Test
    fun `observeAll 按 name 升序发射`() = runTest {
        db.galleryDao().replaceAll(listOf(gallery(1, "b"), gallery(2, "a")))
        db.galleryDao().observeAll().test {
            assertEquals(listOf("a", "b"), awaitItem().map { it.name })
        }
    }

    @Test
    fun `replaceAll 清表重插覆盖旧数据`() = runTest {
        db.galleryDao().replaceAll(listOf(gallery(1, "old")))
        db.galleryDao().replaceAll(listOf(gallery(2, "new")))
        assertNull(db.galleryDao().byId(1))
        assertEquals("new", db.galleryDao().byId(2)?.name)
    }

    @Test
    fun `coverFallback 取图集内最新一张`() = runTest {
        db.galleryDao().replaceAll(listOf(gallery(1, "g")))
        db.imageDao().upsertAll(listOf(
            image(1, "2026-01-01T00:00:00.000Z"),
            image(2, "2026-01-03T00:00:00.000Z"),
        ))
        db.imageDao().replaceGalleryLinks(1, listOf(1))
        db.imageDao().replaceGalleryLinks(2, listOf(1))
        assertEquals(2L, db.galleryDao().coverFallback(1)?.id)
    }

    @Test
    fun `galleryImagesPagingSource 按 createdAt 倒序`() = runTest {
        db.galleryDao().replaceAll(listOf(gallery(1, "g")))
        db.imageDao().upsertAll(listOf(
            image(1, "2026-01-01T00:00:00.000Z"),
            image(2, "2026-01-03T00:00:00.000Z"),
            image(3, "2026-01-02T00:00:00.000Z"),
        ))
        db.imageDao().replaceGalleryLinks(1, listOf(1))
        db.imageDao().replaceGalleryLinks(2, listOf(1))
        db.imageDao().replaceGalleryLinks(3, listOf(1))
        val page = db.galleryDao().galleryImagesPagingSource(1)
            .load(PagingSource.LoadParams.Refresh(null, 10, false)) as PagingSource.LoadResult.Page
        assertEquals(listOf(2L, 3L, 1L), page.data.map { it.id })
    }
}
