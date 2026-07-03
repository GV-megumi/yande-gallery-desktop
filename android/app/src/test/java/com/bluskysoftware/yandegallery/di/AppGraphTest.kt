package com.bluskysoftware.yandegallery.di

import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.api.unwrap
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * 回归测试：AppGraph.api() 的缓存键必须与 Bearer 快照（activeSnapshot）解耦。
 *
 * 历史 bug：api() 用 init collector 持续刷新的 activeSnapshot 做缓存命中判断——
 * 切换激活服务器后 collector 一追平（Room InvalidationTracker 后台线程，常规时序
 * 必然发生），命中判断恒真，api() 永远返回绑在旧 baseUrl 上的 cachedApi 且不自愈
 * （Retrofit baseUrl 构建时烧死）。修复后缓存键只在 api() 内写入，本测试不依赖
 * collector 时序必然通过；修复前它在 collector 追平后必挂。
 */
@RunWith(RobolectricTestRunner::class)
class AppGraphTest {
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db)
    }

    @After
    fun teardown() = db.close()

    private fun metaResponse(serverId: String) = MockResponse()
        .setBody("""{"success":true,"data":{"serverId":"$serverId","dataVersion":1,"imageCount":0,"latestCursor":null}}""")
        .addHeader("Content-Type", "application/json")

    @Test
    fun `切换激活服务器后 api() 重建客户端并指向新 baseUrl`() = runTest {
        MockWebServer().use { serverA ->
            MockWebServer().use { serverB ->
                serverA.enqueue(metaResponse("a"))
                // 诱饵响应：若 bug 复现（第二次请求仍落 A），用例以内容断言快速失败而非读超时挂起
                serverA.enqueue(metaResponse("a-stale"))
                serverB.enqueue(metaResponse("b"))
                serverA.start()
                serverB.start()

                graph.serverRepository.addAndActivate("a", serverA.url("/").toString(), "key-a")
                val metaA = graph.api()!!.syncMeta().unwrap()
                assertEquals("a", metaA.serverId)
                assertEquals("/api/v1/sync/meta", serverA.takeRequest().path)

                graph.serverRepository.addAndActivate("b", serverB.url("/").toString(), "key-b")
                // 让 init 预热 collector（Dispatchers.IO，真实时间）追平到服务器 B——
                // 这正是历史 bug 的触发前提；修复后无论 collector 是否追平都必须通过
                Thread.sleep(300)

                val metaB = graph.api()!!.syncMeta().unwrap()
                assertEquals("b", metaB.serverId)
                assertEquals("/api/v1/sync/meta", serverB.takeRequest().path)
                // A 不得收到第二个请求，B 恰好收到一个
                assertEquals(1, serverA.requestCount)
                assertEquals(1, serverB.requestCount)
            }
        }
    }

    @Test
    fun `无激活服务器时 api() 返回 null，激活后恢复`() = runTest {
        assertNull(graph.api())

        MockWebServer().use { server ->
            server.enqueue(metaResponse("s"))
            server.start()

            val id = graph.serverRepository.addAndActivate("s", server.url("/").toString(), "key")
            val meta = graph.api()!!.syncMeta().unwrap()
            assertEquals("s", meta.serverId)

            graph.serverRepository.delete(id)
            assertNull(graph.api())
        }
    }
}
