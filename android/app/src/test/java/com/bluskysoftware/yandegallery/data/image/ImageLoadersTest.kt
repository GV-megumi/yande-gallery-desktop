package com.bluskysoftware.yandegallery.data.image

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * 纯 JVM 可测部分：thumbnailUrl 拼接 + thumbnailCacheKey 稳定键。
 * ImageLoader/DiskCache 需要 Android Context，留给 instrumented/手动验证（无 Robolectric）。
 */
class ImageLoadersTest {

    @Test
    fun `thumbnailUrl 拼接——baseUrl 不带尾斜杠`() {
        assertEquals(
            "http://192.168.1.10:8080/api/app/v1/images/7/thumbnail",
            thumbnailUrl("http://192.168.1.10:8080", 7L),
        )
    }

    @Test
    fun `thumbnailUrl 拼接——baseUrl 带尾斜杠`() {
        assertEquals(
            "http://192.168.1.10:8080/api/app/v1/images/7/thumbnail",
            thumbnailUrl("http://192.168.1.10:8080/", 7L),
        )
    }

    @Test
    fun `thumbnailCacheKey 按 serverId 命名空间——不同 serverId 得不同 key`() {
        assertEquals("s1:t7", thumbnailCacheKey(1L, 7L))
        // 同 imageId、不同服务器 → 键必须不同，避免跨服务器缓存串图
        assertNotEquals(thumbnailCacheKey(1L, 7L), thumbnailCacheKey(2L, 7L))
    }

    @Test
    fun `fileUrl 拼接`() {
        assertEquals("http://h:1/api/app/v1/images/7/file", fileUrl("http://h:1/", 7L))
    }
}
