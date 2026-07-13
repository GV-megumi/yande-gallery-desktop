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
 * M3-T4: GalleryDao 写操作扩展（重命名/删除相册消费），以及 TagDao.byName 查询。后者未各自建
 * DAO 专属测试文件（brief 只列出本文件与 ImageDaoWriteTest.kt 两个测试文件），故与 GalleryDao
 * 写操作一并放在这里。（Task 10：DownloadDao 随 MediaStore 下载链路退役，其反应式 Flow
 * 测试用例随之删除。）
 */
@RunWith(RobolectricTestRunner::class)
class GalleryDaoWriteTest {
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
    fun `insertOne 后 byId 可查到该行`() = runTest {
        db.galleryDao().insertOne(gallery(1, "g"))
        assertEquals("g", db.galleryDao().byId(1)?.name)
    }

    @Test
    fun `updateName 改名`() = runTest {
        db.galleryDao().insertOne(gallery(1, "old"))
        db.galleryDao().updateName(1, "new")
        assertEquals("new", db.galleryDao().byId(1)?.name)
    }

    @Test
    fun `deleteById 无级联 gallery_images 残留 clearMembership 后才清空`() = runTest {
        db.galleryDao().insertOne(gallery(1, "g"))
        db.imageDao().upsertAll(listOf(image(1)))
        db.imageDao().replaceGalleryLinks(1, listOf(1))
        db.galleryDao().deleteById(1)
        // galleries 行已删
        assertNull(db.galleryDao().byId(1))
        // 但 galleries 无 FK 级联到 gallery_images：成员行仍残留
        assertEquals(listOf(1L), db.imageDao().galleryIdsOf(1))
        db.galleryDao().clearMembership(1)
        assertEquals(emptyList<Long>(), db.imageDao().galleryIdsOf(1))
    }

    @Test
    fun `TagDao byName 按 LOWER 匹配大小写不敏感`() = runTest {
        db.tagDao().replaceAll(listOf(TagEntity(1, "Cat", "general")))
        assertEquals(1L, db.tagDao().byName("cat")?.id)
        assertEquals(1L, db.tagDao().byName("CAT")?.id)
        assertNull(db.tagDao().byName("dog"))
    }
}
