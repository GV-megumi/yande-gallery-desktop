package com.bluskysoftware.yandegallery.data.db

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** image_files 登记表（镜像 spec §3.2）：档位互斥单行、缺失集合查询、统计、serverId 域隔离。 */
@RunWith(RobolectricTestRunner::class)
class ImageFileDaoTest {
    private lateinit var db: AppDatabase
    private lateinit var dao: ImageFileDao

    private fun img(id: Long, size: Long = 1000L) = ImageEntity(
        id = id, filename = "a$id.jpg", width = 10, height = 10,
        fileSize = size, format = "jpg",
        createdAt = "2026-07-0${(id % 9) + 1}T00:00:00.000Z", updatedAt = "2026-07-01T00:00:00.000Z",
    )

    private fun row(serverId: Long, imageId: Long, tier: String, bytes: Long = 100L) =
        ImageFileEntity(serverId, imageId, tier, "s$serverId/i$imageId/a$imageId.jpg", bytes, 1720000000000L)

    @Before
    fun setup() {
        val context: Context = ApplicationProvider.getApplicationContext()
        db = AppDatabase.inMemory(context)
        dao = db.imageFileDao()
    }

    @After
    fun teardown() = db.close()

    @Test
    fun `upsert 同键覆盖——HQ 升 ORIGINAL 为同行 UPDATE`() = runTest {
        dao.upsert(row(1, 1, "HQ"))
        dao.upsert(row(1, 1, "ORIGINAL", bytes = 999L))
        val got = dao.byImageId(1, 1)
        assertEquals("ORIGINAL", got?.tier)
        assertEquals(999L, got?.bytes)
        assertEquals(1L, dao.countFor(1))
    }

    @Test
    fun `missingImageIds needOriginal=false 只报无行的图`() = runTest {
        db.imageDao().upsertAll(listOf(img(1), img(2), img(3)))
        dao.upsert(row(1, 1, "HQ"))
        dao.upsert(row(1, 2, "ORIGINAL"))
        assertEquals(listOf(3L), dao.missingImageIds(1, needOriginal = false))
    }

    @Test
    fun `missingImageIds needOriginal=true 报无行与 HQ 行的图`() = runTest {
        db.imageDao().upsertAll(listOf(img(1), img(2), img(3)))
        dao.upsert(row(1, 1, "HQ"))
        dao.upsert(row(1, 2, "ORIGINAL"))
        assertEquals(listOf(1L, 3L), dao.missingImageIds(1, needOriginal = true).sorted())
    }

    @Test
    fun `missingImageIds 按 createdAt 降序——新图优先`() = runTest {
        db.imageDao().upsertAll(listOf(img(1), img(5)))   // img(5) createdAt 更晚
        assertEquals(listOf(5L, 1L), dao.missingImageIds(1, needOriginal = false))
    }

    @Test
    fun `missingImageIds 跨服隔离——他服行不掩盖本服缺失`() = runTest {
        db.imageDao().upsertAll(listOf(img(1), img(2)))
        dao.upsert(row(2, 1, "ORIGINAL"))   // 服务器 2 已登记 image 1，但 JOIN 按 serverId=1 域，不应满足本服查询
        assertEquals(listOf(1L, 2L), dao.missingImageIds(1, needOriginal = false).sorted())
    }

    @Test
    fun `statsFor 按档位分组统计张数与字节`() = runTest {
        dao.upsert(row(1, 1, "HQ", 100))
        dao.upsert(row(1, 2, "HQ", 200))
        dao.upsert(row(1, 3, "ORIGINAL", 5000))
        val stats = dao.statsFor(1).associateBy { it.tier }
        assertEquals(2L, stats["HQ"]?.count)
        assertEquals(300L, stats["HQ"]?.bytes)
        assertEquals(5000L, stats["ORIGINAL"]?.bytes)
    }

    @Test
    fun `missingOriginalBytes 汇总缺原图的 images fileSize`() = runTest {
        db.imageDao().upsertAll(listOf(img(1, 1000), img(2, 2000), img(3, 4000)))
        dao.upsert(row(1, 2, "ORIGINAL"))   // 2 已有原图；1 无行、3 无行 → 1000+4000
        assertEquals(5000L, dao.missingOriginalBytes(1))
    }

    @Test
    fun `missingOriginalBytes 跨服隔离——他服行不算已覆盖，全覆盖后 SUM 为 NULL`() = runTest {
        db.imageDao().upsertAll(listOf(img(1, 1000), img(2, 2000)))
        dao.upsert(row(2, 1, "ORIGINAL"))   // 服务器 2 已有原图，但本服（1）JOIN 查不到匹配行，两张仍算缺失
        assertEquals(3000L, dao.missingOriginalBytes(1))

        dao.upsert(row(1, 1, "ORIGINAL"))
        dao.upsert(row(1, 2, "ORIGINAL"))
        assertNull(dao.missingOriginalBytes(1))   // 本服全覆盖——WHERE 命中空集，SUM 为 NULL
    }

    @Test
    fun `serverId 域隔离——他服行不可见不受删`() = runTest {
        dao.upsert(row(1, 7, "HQ"))
        dao.upsert(row(2, 7, "ORIGINAL"))
        dao.deleteByImageIds(1, listOf(7))
        assertNull(dao.byImageId(1, 7))
        assertEquals("ORIGINAL", dao.byImageId(2, 7)?.tier)
    }
}
