package com.bluskysoftware.yandegallery.domain.sync

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

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
    fun `url 暂缺时短退避重试——url 就绪后建立订阅`() {
        MockWebServer().use { server ->
            server.enqueue(eventStream("event: gallery:images-changed\ndata: {}\n\n"))
            server.start()

            val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
            // start() 时 url 仍为 null（切服窄窗）；随后置为真实地址，验证 50ms 短退避能触达订阅
            val activeUrl = AtomicReference<String?>(null)
            val sse = SseClient(
                client = OkHttpClient(),
                urlProvider = { activeUrl.get() },
                onGalleryEvent = {},
                scope = scope,
                debounceMs = 50,
                reconnectDelayMs = 30_000,   // 大值：证明重试走的是 nullUrlRetryMs 而非常规退避
                nullUrlRetryMs = 50,
            )

            sse.start()
            activeUrl.set(server.url("/api/v1/events/system").toString())
            // 50ms 短退避重试应在 url 就绪后建立订阅请求（takeRequest 超时等待）
            assertNotNull("url 就绪后短退避应建立订阅", server.takeRequest(2, TimeUnit.SECONDS))

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

    @Test
    fun `切换服务器 restart 清 403 降级并连新 baseUrl`() {
        MockWebServer().use { serverA ->
            MockWebServer().use { serverB ->
                // A：eventsSubscribe 未开 → 403 降级；B：已开，重连后应收到事件
                serverA.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":{"code":"FORBIDDEN"}}"""))
                serverB.enqueue(eventStream("event: gallery:images-changed\ndata: {}\n\n"))
                serverA.start()
                serverB.start()

                val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
                val activeUrl = AtomicReference(serverA.url("/api/v1/events/system").toString())
                val count = AtomicInteger(0)
                val latch = CountDownLatch(1)
                val sse = SseClient(
                    client = OkHttpClient(),
                    urlProvider = { activeUrl.get() },
                    onGalleryEvent = { count.incrementAndGet(); latch.countDown() },
                    scope = scope,
                    debounceMs = 50,
                    // 大退避：B 的单帧事件流发完后会 onClosed→退避重连，用大值把它挡在观察窗外，
                    // 只验证「切服即连 B」本身；A 的 403 路径本就不安排重连。
                    reconnectDelayMs = 30_000,
                )

                sse.start()
                Thread.sleep(300)
                assertEquals("A 收到 403 后应停连、不重连", 1, serverA.requestCount)

                // 切换到 B：restart 清 A 的 403 降级并按新 URL 重连
                activeUrl.set(serverB.url("/api/v1/events/system").toString())
                sse.restart()
                assertTrue("切服后应连 B 并收到事件", latch.await(3, TimeUnit.SECONDS))
                Thread.sleep(200)
                assertEquals(1, count.get())
                assertEquals("B 应被连接（403 降级已按服务器隔离，不再全局永久）", 1, serverB.requestCount)
                assertEquals("A 不应因 restart 被重连", 1, serverA.requestCount)

                sse.stop()
                scope.cancel()
            }
        }
    }

    @Test
    fun `restart 后旧连接迟到的取消回调不清新连接不再重连（BUG-05 孤儿守卫）`() {
        MockWebServer().use { serverA ->
            MockWebServer().use { serverB ->
                // A：连接受理但不应答（挂住）——cancel 时产生异步 onFailure(canceled) 迟到回调
                serverA.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
                // B：事件帧 + 长节流尾巴保持流打开（不触发 onClosed 的合法重连，隔离观察目标）
                serverB.dispatcher = object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse = MockResponse()
                        .addHeader("Content-Type", "text/event-stream")
                        .setBody("event: gallery:images-changed\ndata: {}\n\n" + ": pad\n".repeat(400))
                        .throttleBody(64, 60, TimeUnit.SECONDS)
                }
                serverA.start()
                serverB.start()

                val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
                val activeUrl = AtomicReference(serverA.url("/api/v1/events/system").toString())
                val latch = CountDownLatch(1)
                val sse = SseClient(
                    client = OkHttpClient(),
                    urlProvider = { activeUrl.get() },
                    onGalleryEvent = { latch.countDown() },
                    scope = scope,
                    debounceMs = 50,
                    // 短重连间隔：修复前旧连接的 canceled 回调会清掉新引用并再排一次重连，
                    // 500ms 观察窗内 B 必然多出第二条连接（孤儿制造机）；修复后守卫直接忽略
                    reconnectDelayMs = 100,
                )

                sse.start()
                assertNotNull("A 应收到订阅请求", serverA.takeRequest(2, TimeUnit.SECONDS))

                activeUrl.set(serverB.url("/api/v1/events/system").toString())
                sse.restart()   // cancel A（其失败回调异步迟到）→ 立即连 B
                assertTrue("B 应收到事件", latch.await(3, TimeUnit.SECONDS))
                Thread.sleep(500)
                assertEquals("旧连接的取消回调不得再触发重连——B 只被连一次", 1, serverB.requestCount)

                sse.stop()
                scope.cancel()
            }
        }
    }
}
