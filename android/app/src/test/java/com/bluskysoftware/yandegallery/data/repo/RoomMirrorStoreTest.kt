package com.bluskysoftware.yandegallery.data.repo

import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.api.SyncGalleryDto
import com.bluskysoftware.yandegallery.data.api.SyncImageItemDto
import com.bluskysoftware.yandegallery.data.api.SyncTagDto
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.DownloadEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.data.media.DeleteOwnedResult
import com.bluskysoftware.yandegallery.data.media.MediaStoreGateway
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
        store.writeSyncState(SyncState("srv", "cursor", 1, "2026-01-01T00:00:00.000Z"))

        store.clearMirror()

        assertEquals(0L, rowCount("images"))
        assertEquals(0L, rowCount("galleries"))
        assertEquals(0L, rowCount("gallery_images"))
        assertEquals(0L, rowCount("tags"))
        assertEquals(0L, rowCount("image_tags"))
        assertNull(store.readSyncState())

        // servers 不是镜像表，clearMirror 不应触碰它
        assertEquals(1L, rowCount("servers"))
        assertEquals(serverId, db.serverDao().active()?.id)
    }

    @Test
    fun `clearMirror 一并清空 downloads 表（镜像身份失效则映射作废，D10 裁定保留全清）`() = runTest {
        // v3 后 downloads 虽有 serverId 命名空间，clearMirror 仍表示「镜像身份失效」——
        // 全清是最小正确实现（D10 裁定保留）；系统相册文件本身不动。
        store.applyImagePage(listOf(imageItem(1, listOf(1), listOf(1))))
        db.downloadDao().upsert(
            DownloadEntity(serverId = 1, imageId = 1, mediaStoreUri = "content://old/1", downloadedAt = "2026-01-01T00:00:00.000Z")
        )
        assertEquals(1L, rowCount("downloads"))

        store.clearMirror()

        assertEquals(0L, rowCount("downloads"))
        // 与既有行为一致：镜像表同样被清空
        assertEquals(0L, rowCount("images"))
    }

    @Test
    fun `对账删除级联：删本服映射与副本、清缓存键、他服映射保留`() = runTest {
        val discarded = mutableListOf<String>()
        val removedKeys = mutableListOf<Pair<Long, Long>>()
        val fakeGateway = object : MediaStoreGateway {
            override fun createPending(displayName: String, mime: String): android.net.Uri? = null
            override fun openOutput(uri: android.net.Uri): java.io.OutputStream? = null
            override fun finalize(uri: android.net.Uri) {}
            override fun discard(uri: android.net.Uri) { discarded += uri.toString() }
            override fun exists(uri: android.net.Uri) = true
            override fun buildDeleteRequest(uris: List<android.net.Uri>): android.app.PendingIntent? = null
            override fun deleteOwned(uri: android.net.Uri): DeleteOwnedResult = DeleteOwnedResult.Deleted
        }
        val cascadeStore = RoomMirrorStore(
            db, gateway = fakeGateway,
            activeServerId = { 1L },
            removeCachedImage = { serverId, imageId -> removedKeys += serverId to imageId },
        )
        db.imageDao().upsertAll(listOf(ImageEntity(7, "a.jpg", 1, 1, 1L, "jpg", "2026", "2026")))
        db.downloadDao().upsert(DownloadEntity(1L, 7L, "content://own", "2026"))   // 本服映射
        db.downloadDao().upsert(DownloadEntity(2L, 7L, "content://other", "2026")) // 他服同号映射

        cascadeStore.deleteImages(listOf(7L))

        assertNull(db.downloadDao().byImageId(1L, 7L))                       // 本服行清
        assertEquals("content://other", db.downloadDao().byImageId(2L, 7L)?.mediaStoreUri)  // 他服行保留
        assertEquals(listOf("content://own"), discarded)                     // 副本直删（后台定界，见实现注释）
        assertEquals(listOf(1L to 7L), removedKeys)                          // 两级缓存键清除回调
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
}
