package com.bluskysoftware.yandegallery.data.db

import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * M3-T4: ImageDao 单行 CRUD 扩展（详情页/多选移出图集消费）。
 */
@RunWith(RobolectricTestRunner::class)
class ImageDaoWriteTest {
    private lateinit var db: AppDatabase

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
    }

    @After
    fun teardown() = db.close()

    private fun image(id: Long, createdAt: String = "2026-01-01T00:00:00.000Z") = ImageEntity(
        id = id, filename = "$id.jpg", width = 100, height = 100,
        fileSize = 1, format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    private fun gallery(id: Long, name: String) = GalleryEntity(
        id = id, name = name, coverImageId = null, imageCount = 0,
    )

    @Test
    fun `byId 命中返回该行`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        assertEquals(1L, db.imageDao().byId(1)?.id)
    }

    @Test
    fun `byId 未命中返回 null`() = runTest {
        assertNull(db.imageDao().byId(999))
    }

    @Test
    fun `replaceTagLinks 后 tagNamesOf 返回按名排序的名列表`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.tagDao().replaceAll(listOf(TagEntity(1, "banana", null), TagEntity(2, "apple", null)))
        db.imageDao().replaceTagLinks(1, listOf(1, 2))
        assertEquals(listOf("apple", "banana"), db.imageDao().tagNamesOf(1))
    }

    @Test
    fun `galleryIdsOf 返回该图所在的全部图集 id`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.galleryDao().replaceAll(listOf(gallery(1, "g1"), gallery(2, "g2")))
        db.imageDao().replaceGalleryLinks(1, listOf(1, 2))
        assertEquals(listOf(1L, 2L), db.imageDao().galleryIdsOf(1).sorted())
    }

    @Test
    fun `deleteTagLinks 只删指定 tagId 保留其余`() = runTest {
        db.imageDao().upsertAll(listOf(image(1)))
        db.tagDao().replaceAll(listOf(TagEntity(1, "a", null), TagEntity(2, "b", null), TagEntity(3, "c", null)))
        db.imageDao().replaceTagLinks(1, listOf(1, 2, 3))
        db.imageDao().deleteTagLinks(1, listOf(1, 2))
        assertEquals(listOf("c"), db.imageDao().tagNamesOf(1))
    }

    @Test
    fun `deleteTagLinks 只影响指定 imageId 不误删其他图的同名 tag 关联`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        db.tagDao().replaceAll(listOf(TagEntity(1, "a", null)))
        db.imageDao().replaceTagLinks(1, listOf(1))
        db.imageDao().replaceTagLinks(2, listOf(1))
        db.imageDao().deleteTagLinks(1, listOf(1))
        assertEquals(emptyList<String>(), db.imageDao().tagNamesOf(1))
        assertEquals(listOf("a"), db.imageDao().tagNamesOf(2))
    }

    @Test
    fun `deleteGalleryLinks 只删该图集该批 imageId 且不影响其他图集关联`() = runTest {
        db.imageDao().upsertAll(listOf(image(1), image(2)))
        db.galleryDao().replaceAll(listOf(gallery(1, "g1"), gallery(2, "g2")))
        // 注意 GalleryImageEntity 构造顺序是 (galleryId, imageId)——replaceGalleryLinks 内部已按此顺序正确构造。
        db.imageDao().replaceGalleryLinks(1, listOf(1, 2)) // image1 属于图集 1、2
        db.imageDao().replaceGalleryLinks(2, listOf(1))    // image2 只属于图集 1
        db.imageDao().deleteGalleryLinks(1, listOf(1, 2))  // 从图集 1 移出 image1、image2
        assertEquals(listOf(2L), db.imageDao().galleryIdsOf(1)) // image1 仍属于图集2
        assertEquals(emptyList<Long>(), db.imageDao().galleryIdsOf(2)) // image2 完全移出
    }
}
