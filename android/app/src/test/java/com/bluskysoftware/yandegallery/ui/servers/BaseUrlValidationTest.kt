package com.bluskysoftware.yandegallery.ui.servers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * normalizeBaseUrl（M4-T14）校验矩阵：补 scheme / 去尾斜杠 / IPv6 括号主机 / 非法 scheme / 空。
 * 纯 JVM——normalizeBaseUrl 无 Android 依赖。
 */
class BaseUrlValidationTest {
    @Test
    fun `缺 scheme 自动补 http`() {
        assertEquals("http://192.168.1.5:3000", normalizeBaseUrl("192.168.1.5:3000"))
    }

    @Test
    fun `去尾斜杠`() {
        assertEquals("http://h:3000", normalizeBaseUrl("http://h:3000/"))
    }

    @Test
    fun `https 主机名合法`() {
        assertEquals("https://h", normalizeBaseUrl("https://h"))
    }

    @Test
    fun `IPv6 括号字面量主机`() {
        assertEquals("http://[::1]:3000", normalizeBaseUrl("http://[::1]:3000"))
    }

    @Test
    fun `前后空白 trim 后合法`() {
        assertEquals("http://host:8080", normalizeBaseUrl("  http://host:8080  "))
    }

    @Test
    fun `非 http scheme 返回 null`() {
        assertNull(normalizeBaseUrl("ftp://h"))
    }

    @Test
    fun `仅 scheme 无主机返回 null`() {
        assertNull(normalizeBaseUrl("http://"))
    }

    @Test
    fun `纯空白返回 null`() {
        assertNull(normalizeBaseUrl("   "))
    }
}
