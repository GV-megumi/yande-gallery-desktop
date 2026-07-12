package com.bluskysoftware.yandegallery.data.api

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class ApiClientTest {
    @Test
    fun `请求带 Bearer 头且路径正确`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(
                """{"success":true,"data":{"serverId":"s","dataVersion":1,"imageCount":0,"latestCursor":null}}"""
            ).addHeader("Content-Type", "application/json"))
            server.start()

            val api = ApiClientFactory.desktopApi(
                baseUrl = server.url("/").toString(),
                okHttp = ApiClientFactory.okHttp({ "test-key" }),
            )
            val meta = api.syncMeta().unwrap()

            assertEquals("s", meta.serverId)
            val recorded = server.takeRequest()
            assertEquals("/api/app/v1/sync/meta", recorded.path)
            assertEquals("Bearer test-key", recorded.getHeader("Authorization"))
        }
    }

    @Test
    fun `cursor 与 limit 以查询参数传递`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(
                """{"success":true,"data":{"items":[],"nextCursor":null,"hasMore":false}}"""
            ))
            server.start()
            val api = ApiClientFactory.desktopApi(server.url("/").toString(), ApiClientFactory.okHttp({ "k" }))
            api.syncImages(cursor = "abc", limit = 500)
            assertEquals("/api/app/v1/sync/images?cursor=abc&limit=500", server.takeRequest().path)
        }
    }

    @Test
    fun `非 2xx 错误 envelope 映射为 ApiException（401 密钥失效可识别）`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(401).setBody(
                """{"success":false,"error":{"code":"UNAUTHORIZED","message":"Unauthorized"}}"""
            ))
            server.start()
            val api = ApiClientFactory.desktopApi(server.url("/").toString(), ApiClientFactory.okHttp({ null }))
            val ex = runCatching { api.syncMeta() }.exceptionOrNull()
            assertTrue(ex is ApiException)
            assertEquals("UNAUTHORIZED", (ex as ApiException).code)
            assertEquals(401, ex.httpStatus)
            // key 为 null 时请求不带 Authorization 头
            assertNull(server.takeRequest().getHeader("Authorization"))
        }
    }

    @Test
    fun `二进制路径空体 200 映射为 ApiException（不当成功、不被 Coil 缓存投毒）`() = runTest {
        MockWebServer().use { server ->
            // 旧桌面/生成中断会对缩略图发 Content-Length:0 的 200——须当失败抛出，
            // 否则 Coil 缓存成「成功但空」条目并永久命中，重试也只命中空缓存无法自愈。
            server.enqueue(MockResponse().setResponseCode(200).addHeader("Content-Type", "image/webp").setBody(""))
            server.start()
            val client = ApiClientFactory.okHttp({ "k" })
            val ex = runCatching {
                client.newCall(okhttp3.Request.Builder().url(server.url("/api/app/v1/images/11/thumbnail")).build()).execute()
            }.exceptionOrNull()
            assertTrue(ex is ApiException)
            assertEquals("EMPTY_BINARY", (ex as ApiException).code)
        }
    }

    @Test
    fun `二进制路径非空 200 正常放行，不误伤`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(200).addHeader("Content-Type", "image/webp").setBody("abcd"))
            server.start()
            val client = ApiClientFactory.okHttp({ "k" })
            val resp = client.newCall(okhttp3.Request.Builder().url(server.url("/api/app/v1/images/11/thumbnail")).build()).execute()
            assertTrue(resp.isSuccessful)
            assertEquals(4L, resp.body.contentLength())
            resp.close()
        }
    }

    @Test
    fun `非二进制路径空体 200 不拦截（空体检查仅限图片路径）`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(200).setBody(""))
            server.start()
            val client = ApiClientFactory.okHttp({ "k" })
            val resp = client.newCall(okhttp3.Request.Builder().url(server.url("/api/app/v1/sync/meta")).build()).execute()
            assertTrue(resp.isSuccessful)
            resp.close()
        }
    }

    @Test
    fun `二进制路径 404 触发对账钩子，其它路径 404 不触发`() = runTest {
        MockWebServer().use { server ->
            repeat(2) {
                server.enqueue(MockResponse().setResponseCode(404).setBody(
                    """{"success":false,"error":{"code":"NOT_FOUND","message":"Resource not found"}}"""
                ))
            }
            server.start()
            var hooked = 0
            val client = ApiClientFactory.okHttp({ "k" }, onBinaryNotFound = { hooked++ })
            val call = { path: String ->
                runCatching {
                    client.newCall(okhttp3.Request.Builder().url(server.url(path)).build()).execute()
                }
            }
            call("/api/app/v1/images/7/thumbnail")
            assertEquals(1, hooked)
            call("/api/app/v1/sync/meta")
            assertEquals(1, hooked)
        }
    }
}
