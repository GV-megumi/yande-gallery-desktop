package com.bluskysoftware.yandegallery.domain.sync

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * SSE 客户端行为：一帧 gallery:* 事件防抖后回调一次；403（订阅权限未开）→ 永久降级不重连。
 * 防抖用注入短延时 + 门闩，确定性弱化处：断言「至少触发、且不重复」，不依赖精确 2s 计时。
 */
class SseClientTest {

    private fun eventStream(body: String) = MockResponse()
        .addHeader("Content-Type", "text/event-stream")
        .setBody(body)

    @Test
    fun `一帧 gallery 事件防抖后回调一次`() {
        MockWebServer().use { server ->
            server.enqueue(eventStream("event: gallery:images-changed\ndata: {}\n\n"))
            server.start()

            val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
            val count = AtomicInteger(0)
            val latch = CountDownLatch(1)
            val sse = SseClient(
                client = OkHttpClient(),
                urlProvider = { server.url("/api/v1/events/system").toString() },
                onGalleryEvent = { count.incrementAndGet(); latch.countDown() },
                scope = scope,
                debounceMs = 50,
                reconnectDelayMs = 30_000,
            )

            sse.start()
            assertTrue("onGalleryEvent 应在防抖后触发", latch.await(3, TimeUnit.SECONDS))
            Thread.sleep(200)          // 观察窗口：确认不会二次触发
            assertEquals(1, count.get())

            sse.stop()
            scope.cancel()
        }
    }

    @Test
    fun `服务器 403 时永久降级不重连`() {
        MockWebServer().use { server ->
            // 首个响应 403；再备一帧——若错误地重连就会消费它并使 requestCount 变 2
            server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":{"code":"FORBIDDEN"}}"""))
            server.enqueue(eventStream("event: gallery:images-changed\ndata: {}\n\n"))
            server.start()

            val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
            val sse = SseClient(
                client = OkHttpClient(),
                urlProvider = { server.url("/api/v1/events/system").toString() },
                onGalleryEvent = {},
                scope = scope,
                debounceMs = 50,
                reconnectDelayMs = 100,   // 短重连间隔：若会重连，500ms 内必发生
            )

            sse.start()
            Thread.sleep(500)            // > reconnectDelayMs，给「错误重连」充分机会
            assertEquals(1, server.requestCount)

            sse.stop()
            scope.cancel()
        }
    }
}
