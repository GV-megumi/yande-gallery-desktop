package com.bluskysoftware.yandegallery.data.db

import androidx.paging.PagingSource
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ImageDaoTest {
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

    @Test
    fun `时间轴按 createdAt 倒序 id 决胜`() = runTest {
        db.imageDao().upsertAll(listOf(
            image(1, "2026-01-01T00:00:00.000Z"),
            image(2, "2026-01-03T00:00:00.000Z"),
            image(3, "2026-01-03T00:00:00.000Z"),
        ))
        val page = db.imageDao().timelinePagingSource(buildTimelineQuery(PhotoSort.DEFAULT))
            .load(PagingSource.LoadParams.Refresh(null, 10, false)) as PagingSource.LoadResult.Page
        assertEquals(listOf(3L, 2L, 1L), page.data.map { it.id })
    }

    @Test
    fun `upsert 幂等更新`() = runTest {
        db.imageDao().upsertAll(listOf(image(1, "2026-01-01T00:00:00.000Z")))
        db.imageDao().upsertAll(listOf(image(1, "2026-02-01T00:00:00.000Z")))
        assertEquals(1L, db.imageDao().countAll())
    }

    @Test
    fun `deleteByIds 删除且 CASCADE 清关联`() = runTest {
        db.imageDao().upsertAll(listOf(image(1, "2026-01-01T00:00:00.000Z")))
        db.tagDao().replaceAll(listOf(TagEntity(9, "t", null)))
        db.imageDao().replaceTagLinks(1, listOf(9))
        db.imageDao().deleteByIds(listOf(1))
        assertEquals(0L, db.imageDao().countAll())
        assertEquals(0, db.imageDao().tagLinkCount())
    }

    @Test
    fun `replaceTagLinks 全量替换该图关联`() = runTest {
        db.imageDao().upsertAll(listOf(image(1, "2026-01-01T00:00:00.000Z")))
        db.tagDao().replaceAll(listOf(TagEntity(1, "a", null), TagEntity(2, "b", null)))
        db.imageDao().replaceTagLinks(1, listOf(1, 2))
        db.imageDao().replaceTagLinks(1, listOf(2))
        assertEquals(1, db.imageDao().tagLinkCount())
    }
}
