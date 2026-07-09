package com.bluskysoftware.yandegallery.data.db

import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AlbumPrefsDaoTest {
    private lateinit var db: AppDatabase

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
    }

    @After
    fun teardown() = db.close()

    @Test
    fun `setPinned 置顶写 pinnedAt 并强制移出其他相册且清手动序`() = runTest {
        db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 1, inOther = true, manualOrder = 3))
        db.albumPrefsDao().setPinned(1, pinned = true, nowMs = 1000L)
        val row = db.albumPrefsDao().byId(1)!!
        assertTrue(row.pinned)
        assertEquals(1000L, row.pinnedAt)
        assertFalse(row.inOther)          // 互斥（spec §2.1）
        assertNull(row.manualOrder)       // 跨区迁移清手动序
    }

    @Test
    fun `setPinned 取消置顶清 pinnedAt 与手动序`() = runTest {
        db.albumPrefsDao().setPinned(2, pinned = true, nowMs = 500L)
        db.albumPrefsDao().applyManualOrder(listOf(2L))
        db.albumPrefsDao().setPinned(2, pinned = false, nowMs = 999L)
        val row = db.albumPrefsDao().byId(2)!!
        assertFalse(row.pinned)
        assertNull(row.pinnedAt)
        assertNull(row.manualOrder)
    }

    @Test
    fun `setInOther 移入强制取消置顶且清手动序_无记录行自动建`() = runTest {
        db.albumPrefsDao().setPinned(3, pinned = true, nowMs = 500L)
        db.albumPrefsDao().setInOther(3, inOther = true)
        val row = db.albumPrefsDao().byId(3)!!
        assertTrue(row.inOther)
        assertFalse(row.pinned)
        assertNull(row.pinnedAt)
        assertNull(row.manualOrder)
        db.albumPrefsDao().setInOther(99, inOther = true)   // 无记录 → upsert 新行
        assertTrue(db.albumPrefsDao().byId(99)!!.inOther)
    }

    @Test
    fun `applyManualOrder 按列表序重编号0起_未列出的行不动`() = runTest {
        db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 7, manualOrder = 42))
        db.albumPrefsDao().applyManualOrder(listOf(10L, 11L, 12L))
        assertEquals(0, db.albumPrefsDao().byId(10)!!.manualOrder)
        assertEquals(1, db.albumPrefsDao().byId(11)!!.manualOrder)
        assertEquals(2, db.albumPrefsDao().byId(12)!!.manualOrder)
        assertEquals(42, db.albumPrefsDao().byId(7)!!.manualOrder)
    }

    @Test
    fun `deleteOrphans 清掉图集已不存在的偏好行`() = runTest {
        db.galleryDao().replaceAll(listOf(GalleryEntity(1, "a", null, 0)))
        db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 1, pinned = true, pinnedAt = 1L))
        db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 2, inOther = true))
        db.albumPrefsDao().deleteOrphans()
        assertNotNull(db.albumPrefsDao().byId(1))
        assertNull(db.albumPrefsDao().byId(2))
    }
}
