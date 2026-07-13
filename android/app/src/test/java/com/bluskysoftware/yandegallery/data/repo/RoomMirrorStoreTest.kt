package com.bluskysoftware.yandegallery.data.repo

import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.api.SyncGalleryDto
import com.bluskysoftware.yandegallery.data.api.SyncImageItemDto
import com.bluskysoftware.yandegallery.data.api.SyncTagDto
import com.bluskysoftware.yandegallery.data.db.AlbumPrefsEntity
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ImageFileEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.domain.sync.SyncState
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class RoomMirrorStoreTest {
    private lateinit var db: AppDatabase
    private lateinit var store: RoomMirrorStore

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        store = RoomMirrorStore(db)
    }

    @After
    fun teardown() = db.close()

    private fun rowCount(table: String): Long =
        db.query(SimpleSQLiteQuery("SELECT COUNT(*) FROM $table"), null).use { c ->
            c.moveToFirst()
            c.getLong(0)
        }

    private fun imageItem(id: Long, tagIds: List<Long>, galleryIds: List<Long>) = SyncImageItemDto(
        id = id,
        filename = "$id.jpg",
        width = 100,
        height = 100,
        fileSize = 1,
        format = "jpg",
        createdAt = "2026-01-01T00:00:00.000Z",
        updatedAt = "2026-01-01T00:00:00.000Z",
        tagIds = tagIds,
        galleryIds = galleryIds,
    )

    @Test
    fun `applyImagePage 写入行与关联`() = runTest {
        store.applyImagePage(listOf(imageItem(1, listOf(1, 2), listOf(1))))

        assertEquals(1L, db.imageDao().countAll())
        assertEquals(2, db.imageDao().tagLinkCount())
        assertEquals(1L, rowCount("gallery_images"))
    }

    @Test
    fun `applyImagePage 同 id 不同 tagIds 再 apply 关联全量替换`() = runTest {
        store.applyImagePage(listOf(imageItem(1, listOf(1, 2), listOf(1, 2))))
        store.applyImagePage(listOf(imageItem(1, listOf(3), emptyList())))

        assertEquals(1L, db.imageDao().countAll())
        assertEquals(1, db.imageDao().tagLinkCount())
        assertEquals(0L, rowCount("gallery_images"))
    }

    @Test
    fun `deleteImages 超 900 条分批不炸`() = runTest {
        val items = (1..1000L).map { imageItem(it, listOf(it), listOf(it)) }
        store.applyImagePage(items)
        assertEquals(1000L, db.imageDao().countAll())

        store.deleteImages((1..1000L).toList())

        assertEquals(0L, db.imageDao().countAll())
        assertEquals(0, db.imageDao().tagLinkCount())
        assertEquals(0L, rowCount("gallery_images"))
    }

    @Test
    fun `clearMirror 清五张镜像表与 sync_state 且不影响 servers`() = runTest {
        val serverId = db.serverDao().insertAndActivate(
            ServerEntity(name = "desktop", baseUrl = "http://x:1", apiKey = "key-1")
        )
        store.applyImagePage(listOf(imageItem(1, listOf(1), listOf(1))))
        store.replaceGalleries(listOf(SyncGalleryDto(1, "g", null, 1)))
        store.replaceTags(listOf(SyncTagDto(1, "t", null)))
        db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 1, pinned = true, pinnedAt = 1L))
        store.writeSyncState(SyncState("srv", "cursor", 1, "2026-01-01T00:00:00.000Z"))

        store.clearMirror()

        assertEquals(0L, rowCount("images"))
        assertEquals(0L, rowCount("galleries"))
        assertEquals(0L, rowCount("gallery_images"))
        assertEquals(0L, rowCount("tags"))
        assertEquals(0L, rowCount("image_tags"))
        // album_prefs 按 galleryId 键——跨服同号 id 撞号会附身，随镜像身份失效一并清（对齐 D10）
        assertEquals(0L, rowCount("album_prefs"))
        assertNull(store.readSyncState())

        // servers 不是镜像表，clearMirror 不应触碰它
        assertEquals(1L, rowCount("servers"))
        assertEquals(serverId, db.serverDao().active()?.id)
    }

    @Test
    fun `replaceGalleries 映射createdAt并清孤儿偏好`() = runTest {
        db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 1, pinned = true, pinnedAt = 1L))
        db.albumPrefsDao().upsert(AlbumPrefsEntity(galleryId = 2, inOther = true))
        store.replaceGalleries(listOf(
            SyncGalleryDto(id = 1, name = "keep", coverImageId = null, imageCount = 0, createdAt = "2026-01-01T00:00:00.000Z"),
        ))
        assertEquals("2026-01-01T00:00:00.000Z", db.galleryDao().byId(1)?.createdAt)
        assertNotNull(db.albumPrefsDao().byId(1))   // 相册仍在 → 偏好保留
        assertNull(db.albumPrefsDao().byId(2))      // 相册消失 → 孤儿清理（spec §2.1）
    }

    @Test
    fun `readSyncState writeSyncState 往返`() = runTest {
        assertNull(store.readSyncState())

        val state = SyncState(
            remoteServerId = "srv-1",
            cursor = "cursor-1",
            dataVersion = 3L,
            lastSyncAt = "2026-01-01T00:00:00.000Z",
        )
        store.writeSyncState(state)

        assertEquals(state, store.readSyncState())

        val updated = state.copy(cursor = "cursor-2", dataVersion = 4L)
        store.writeSyncState(updated)

        assertEquals(updated, store.readSyncState())
    }

    @Test
    fun `clearMirror 清空 image_files 并回调 clearMirrorFiles`() = runTest {
        var cleared = false
        val cascadeStore = RoomMirrorStore(db, clearMirrorFiles = { cleared = true })
        db.imageFileDao().upsert(ImageFileEntity(1, 1, "HQ", "s1/i1/a.jpg", 1, 0))
        cascadeStore.clearMirror()
        assertEquals(0L, db.imageFileDao().countFor(1))
        assertTrue(cleared)
    }

    @Test
    fun `deleteImages 级联清 image_files 行并回调 removeMirrorFiles`() = runTest {
        val removed = mutableListOf<Long>()
        val cascadeStore = RoomMirrorStore(
            db,
            activeServerId = { 1L },
            removeMirrorFiles = { _, ids -> removed += ids },
        )
        db.imageDao().upsertAll(listOf(
            ImageEntity(1, "1.jpg", 1, 1, 1L, "jpg", "2026", "2026"),
            ImageEntity(2, "2.jpg", 1, 1, 1L, "jpg", "2026", "2026"),
        ))
        db.imageFileDao().upsert(ImageFileEntity(1, 1, "HQ", "s1/i1/a.jpg", 1, 0))
        db.imageFileDao().upsert(ImageFileEntity(1, 2, "ORIGINAL", "s1/i2/b.jpg", 1, 0))
        cascadeStore.deleteImages(listOf(1L, 2L))
        assertEquals(0L, db.imageFileDao().countFor(1))
        assertEquals(listOf(1L, 2L), removed.sorted())
    }
}
