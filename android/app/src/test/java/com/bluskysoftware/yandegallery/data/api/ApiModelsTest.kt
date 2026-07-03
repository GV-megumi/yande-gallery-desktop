package com.bluskysoftware.yandegallery.data.api

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class ApiModelsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `meta envelope 反序列化`() {
        val raw = """{"success":true,"data":{"serverId":"srv-1","dataVersion":3,"imageCount":42,"latestCursor":"abc"}}"""
        val env = json.decodeFromString<ApiEnvelope<SyncMetaDto>>(raw)
        assertEquals(SyncMetaDto("srv-1", 3, 42, "abc"), env.unwrap())
    }

    @Test
    fun `latestCursor 为 null 可解析`() {
        val raw = """{"success":true,"data":{"serverId":"s","dataVersion":1,"imageCount":0,"latestCursor":null}}"""
        assertNull(json.decodeFromString<ApiEnvelope<SyncMetaDto>>(raw).unwrap().latestCursor)
    }

    @Test
    fun `images page 反序列化含 tagIds galleryIds`() {
        val raw = """{"success":true,"data":{"items":[{"id":7,"filename":"a.jpg","width":100,"height":200,
            "fileSize":333,"format":"jpg","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-02T00:00:00.000Z",
            "tagIds":[1,2],"galleryIds":[5]}],"nextCursor":"c2","hasMore":true}}"""
        val page = json.decodeFromString<ApiEnvelope<SyncImagesPageDto>>(raw).unwrap()
        assertEquals(1, page.items.size)
        assertEquals(listOf(1L, 2L), page.items[0].tagIds)
        assertTrue(page.hasMore)
    }

    @Test
    fun `失败 envelope unwrap 抛 ApiException 带错误码`() {
        val raw = """{"success":false,"error":{"code":"PERMISSION_DENIED","message":"Permission denied"}}"""
        val env = json.decodeFromString<ApiEnvelope<SyncMetaDto>>(raw)
        val ex = assertThrows(ApiException::class.java) { env.unwrap() }
        assertEquals("PERMISSION_DENIED", ex.code)
    }

    @Test
    fun `未知字段被忽略（服务端演进兼容）`() {
        val raw = """{"success":true,"data":{"serverId":"s","dataVersion":1,"imageCount":0,"latestCursor":null,"extra":1}}"""
        json.decodeFromString<ApiEnvelope<SyncMetaDto>>(raw).unwrap()
    }
}
