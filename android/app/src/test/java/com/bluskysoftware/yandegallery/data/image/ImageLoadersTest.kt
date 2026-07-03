package com.bluskysoftware.yandegallery.data.image

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 纯 JVM 可测部分：thumbnailUrl 拼接 + thumbnailCacheKey 稳定键。
 * ImageLoader/DiskCache 需要 Android Context，留给 instrumented/手动验证（无 Robolectric）。
 */
class ImageLoadersTest {

    @Test
    fun `thumbnailUrl 拼接——baseUrl 不带尾斜杠`() {
        assertEquals(
            "http://192.168.1.10:8080/api/v1/images/7/thumbnail",
            thumbnailUrl("http://192.168.1.10:8080", 7L),
        )
    }

    @Test
    fun `thumbnailUrl 拼接——baseUrl 带尾斜杠`() {
        assertEquals(
            "http://192.168.1.10:8080/api/v1/images/7/thumbnail",
            thumbnailUrl("http://192.168.1.10:8080/", 7L),
        )
    }

    @Test
    fun `thumbnailCacheKey 是稳定 key，与 baseUrl 无关`() {
        assertEquals("thumb:7", thumbnailCacheKey(7L))
    }
}
