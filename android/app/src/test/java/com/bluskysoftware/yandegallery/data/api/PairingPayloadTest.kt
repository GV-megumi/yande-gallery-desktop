package com.bluskysoftware.yandegallery.data.api

import org.junit.Assert.*
import org.junit.Test

class PairingPayloadTest {
    @Test
    fun `合法载荷解析成功`() {
        val payload = parsePairingPayload(
            """{"v":1,"name":"DESKTOP-1","baseUrl":"http://192.168.1.10:38947","apiKey":"abc"}"""
        )
        assertEquals(PairingPayload(1, "DESKTOP-1", "http://192.168.1.10:38947", "abc"), payload)
    }

    @Test
    fun `版本不为 1 拒绝`() {
        assertNull(parsePairingPayload("""{"v":2,"name":"x","baseUrl":"http://a:1","apiKey":"k"}"""))
    }

    @Test
    fun `baseUrl 非 http 拒绝`() {
        assertNull(parsePairingPayload("""{"v":1,"name":"x","baseUrl":"ftp://a:1","apiKey":"k"}"""))
    }

    @Test
    fun `apiKey 为空拒绝`() {
        assertNull(parsePairingPayload("""{"v":1,"name":"x","baseUrl":"http://a:1","apiKey":""}"""))
    }

    @Test
    fun `非 JSON 或缺字段返回 null 不抛`() {
        assertNull(parsePairingPayload("hello"))
        assertNull(parsePairingPayload("""{"v":1}"""))
    }
}
