package com.bluskysoftware.yandegallery.data.device

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** OEM 定制 MediaProvider 替身（v0.8.1 D2）：任何查询直接抛——模拟真机 ROM 对 Files 联合 uri 过滤查询的拒绝。 */
class ThrowingMediaProvider : ContentProvider() {
    override fun onCreate(): Boolean = true
    override fun query(
        uri: Uri,
        projection: Array<String>?,
        selection: String?,
        selectionArgs: Array<String>?,
        sortOrder: String?,
    ): Cursor = throw IllegalArgumentException("OEM MediaProvider 拒绝查询")
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = 0
}

@RunWith(RobolectricTestRunner::class)
class MediaStoreDeviceGatewayTest {
    private fun row(id: Long, bucket: Long, name: String, path: String, taken: Long, video: Boolean = false) = AlbumRow(
        media = DeviceMedia(
            mediaId = id, uri = Uri.parse("content://media/external/images/media/$id"),
            isVideo = video, displayName = "f$id.jpg", relativePath = path,
            width = 100, height = 100, sizeBytes = 1000, takenAtMs = taken,
            durationMs = if (video) 5_000 else null,
        ),
        bucketId = bucket, bucketName = name,
    )

    @Test
    fun `aggregateAlbums_按bucket分组_计数_封面取最新`() {
        val rows = listOf(
            row(1, 10, "Camera", "DCIM/Camera/", taken = 100),
            row(2, 10, "Camera", "DCIM/Camera/", taken = 300),
            row(3, 20, "WeChat", "Pictures/WeChat/", taken = 200),
        )
        val albums = aggregateAlbums(rows)
        assertEquals(2, albums.size)
        val camera = albums.first { it.relativePath == "DCIM/Camera/" }
        assertEquals("Camera", camera.name)
        assertEquals(2, camera.count)
        assertEquals(rows[1].media.uri, camera.coverUri)   // 组内 takenAtMs 最大
        assertEquals(BucketKey.Bucket(10), camera.key)
    }

    @Test
    fun `aggregateAlbums_空表`() {
        assertEquals(emptyList<DeviceAlbum>(), aggregateAlbums(emptyList()))
    }

    @Test
    @Config(sdk = [33])
    fun `findCopy_查询异常降级为查无副本null`() = runTest {
        // v0.8.1 D2 防御：OEM ROM 定制 MediaProvider 对 RELATIVE_PATH 过滤查询抛
        // IllegalArgumentException——runCatching 降级 null（= 查无副本放行 insert），
        // 不向上炸掉导出 worker 整批。authority "media" 挂抛异常 provider 替身直达真实 query 路径。
        Robolectric.buildContentProvider(ThrowingMediaProvider::class.java).create("media")
        val gateway = MediaStoreDeviceGateway(ApplicationProvider.getApplicationContext())
        assertNull(
            "查询异常应降级为查无副本（放行 insert），而非抛出",
            gateway.findCopy("Pictures/Yande/", "img-1.jpg"),
        )
    }
}
