package com.bluskysoftware.yandegallery.data.db

import androidx.paging.PagingSource
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SearchQueryTest {
    private lateinit var db: AppDatabase

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
    }

    @After
    fun teardown() = db.close()

    private fun image(id: Long, filename: String) = ImageEntity(
        id = id, filename = filename, width = 1, height = 1,
        fileSize = 1, format = "jpg",
        createdAt = "2026-01-0${id}T00:00:00.000Z",
        updatedAt = "2026-01-0${id}T00:00:00.000Z",
    )

    /** 种子：3 图各带标签——image1 landscape+orange、image3 landscape+person、image2 person。 */
    private suspend fun seed() {
        db.imageDao().upsertAll(listOf(
            image(1, "sunset.jpg"),
            image(2, "portrait.png"),
            image(3, "beach_sunset.jpg"),
        ))
        db.tagDao().replaceAll(listOf(
            TagEntity(10, "landscape", null),
            TagEntity(11, "orange", null),
            TagEntity(12, "person", null),
        ))
        db.imageDao().replaceTagLinks(1, listOf(10, 11))
        db.imageDao().replaceTagLinks(3, listOf(10, 12))
        db.imageDao().replaceTagLinks(2, listOf(12))
    }

    private suspend fun search(vararg kw: String): List<Long> {
        val src = db.imageDao().searchPagingSource(buildSearchQuery(kw.toList()))
        val page = src.load(PagingSource.LoadParams.Refresh(null, 50, false))
            as PagingSource.LoadResult.Page
        return page.data.map { it.id }
    }

    @Test
    fun `单关键词匹配文件名`() = runTest {
        seed()
        // "portrait" 无同名标签，仅经文件名 LIKE 命中 image2
        assertEquals(listOf(2L), search("portrait"))
    }

    @Test
    fun `单关键词匹配标签前缀`() = runTest {
        seed()
        // "land" 不在任何文件名内，仅经 landscape 标签前缀命中 image1、image3
        assertEquals(setOf(1L, 3L), search("land").toSet())
    }

    @Test
    fun `多关键词取交集`() = runTest {
        seed()
        // 仅 image3 同时命中 landscape 与 person 两词
        assertEquals(listOf(3L), search("landscape", "person"))
    }

    @Test
    fun `无匹配返回空页`() = runTest {
        seed()
        assertEquals(emptyList<Long>(), search("zzz"))
    }

    @Test
    fun `空关键词退化为全表倒序`() = runTest {
        seed()
        assertEquals(listOf(3L, 2L, 1L), search())
    }
}
