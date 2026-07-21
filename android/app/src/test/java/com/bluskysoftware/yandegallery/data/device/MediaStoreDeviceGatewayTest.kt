package com.bluskysoftware.yandegallery.data.device

import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

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
}
