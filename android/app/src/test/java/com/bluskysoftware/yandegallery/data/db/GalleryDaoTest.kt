package com.bluskysoftware.yandegallery.data.db

import androidx.paging.PagingSource
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
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
    fun `observeAlbumCards 单查询带回图集与兜底封面 id`() = runTest {
        db.galleryDao().replaceAll(listOf(
            GalleryEntity(id = 1, name = "a-has-cover", coverImageId = 10, imageCount = 1),
            GalleryEntity(id = 2, name = "b-null-cover", coverImageId = null, imageCount = 2),
            GalleryEntity(id = 3, name = "c-empty", coverImageId = null, imageCount = 0),
        ))
        db.imageDao().upsertAll(listOf(
            image(10, "2026-01-01T00:00:00.000Z"),
            image(20, "2026-01-01T00:00:00.000Z"),
            image(21, "2026-01-03T00:00:00.000Z"),
        ))
        db.imageDao().replaceGalleryLinks(10, listOf(1))
        db.imageDao().replaceGalleryLinks(20, listOf(2))
        db.imageDao().replaceGalleryLinks(21, listOf(2))

        db.galleryDao().observeAlbumCards().test {
            val rows = awaitItem()
            assertEquals(listOf(1L, 2L, 3L), rows.map { it.id }) // 按 name 升序
            // 有封面：coverImageId 保留，兜底子查询照常算出但 ViewModel 用不到
            assertEquals(10L, rows.first { it.id == 1L }.coverImageId)
            // null 封面：兜底取图集内 createdAt 最新（21）
            val nullCover = rows.first { it.id == 2L }
            assertNull(nullCover.coverImageId)
            assertEquals(21L, nullCover.fallbackCoverId)
            // 空图集：coverImageId 与兜底均为 null
            val empty = rows.first { it.id == 3L }
            assertNull(empty.coverImageId)
            assertNull(empty.fallbackCoverId)
        }
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
        val page = db.galleryDao().galleryImagesPagingSource(buildGalleryImagesQuery(1, PhotoSort.DEFAULT))
            .load(PagingSource.LoadParams.Refresh(null, 10, false)) as PagingSource.LoadResult.Page
        assertEquals(listOf(2L, 3L, 1L), page.data.map { it.id })
    }
}
