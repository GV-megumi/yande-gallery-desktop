package com.bluskysoftware.yandegallery.di

import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.api.unwrap
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.TimeUnit

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
        // 这两个用例逐一断言 FIFO 响应与请求计数——关掉激活变化的自动同步，避免 collector 抢响应。
        graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db, autoSyncOnActiveChange = false)
    }

    @After
    fun teardown() {
        graph.shutdownForTest()   // 先停 graph 后台协程再关库——防关库后仍触 Room 的收尾竞态
        db.close()
    }

    private fun metaResponse(serverId: String) = MockResponse()
        .setBody("""{"success":true,"data":{"serverId":"$serverId","dataVersion":1,"imageCount":0,"latestCursor":null}}""")
        .addHeader("Content-Type", "application/json")

    /** 按 path 幂等应答完整同步链路（meta/images/image-ids/galleries/tags），供自动同步用例跑到收尾不阻塞。 */
    private fun syncDispatcher(serverId: String) = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
            val path = request.path ?: ""
            val json = when {
                path.startsWith("/api/app/v1/sync/meta") ->
                    """{"success":true,"data":{"serverId":"$serverId","dataVersion":1,"imageCount":0,"latestCursor":null}}"""
                path.startsWith("/api/app/v1/sync/images") ->
                    """{"success":true,"data":{"items":[],"nextCursor":null,"hasMore":false}}"""
                path.startsWith("/api/app/v1/sync/image-ids") -> """{"success":true,"data":{"ids":[]}}"""
                path.startsWith("/api/app/v1/sync/galleries") -> """{"success":true,"data":{"items":[]}}"""
                path.startsWith("/api/app/v1/sync/tags") -> """{"success":true,"data":{"items":[]}}"""
                else -> return MockResponse().setResponseCode(404)
            }
            return MockResponse().setBody(json).addHeader("Content-Type", "application/json")
        }
    }

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
                assertEquals("/api/app/v1/sync/meta", serverA.takeRequest().path)

                graph.serverRepository.addAndActivate("b", serverB.url("/").toString(), "key-b")
                // 让 init 预热 collector（Dispatchers.IO，真实时间）追平到服务器 B——
                // 这正是历史 bug 的触发前提；修复后无论 collector 是否追平都必须通过
                Thread.sleep(300)

                val metaB = graph.api()!!.syncMeta().unwrap()
                assertEquals("b", metaB.serverId)
                assertEquals("/api/app/v1/sync/meta", serverB.takeRequest().path)
                // A 不得收到第二个请求，B 恰好收到一个
                assertEquals(1, serverA.requestCount)
                assertEquals(1, serverB.requestCount)
            }
        }
    }

    @Test
    fun `新增激活服务器后自动触发同步（server-changed）`() = runTest {
        MockWebServer().use { server ->
            server.dispatcher = syncDispatcher("auto")
            server.start()

            // 默认 autoSyncOnActiveChange=true 的 graph：激活服务器变化即由 collector 自动发起同步。
            val autoGraph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db)
            try {
                autoGraph.serverRepository.addAndActivate("auto", server.url("/").toString(), "key")

                // collector 在 Dispatchers.IO 真实时间追平 Room 发射后自动 requestSync → syncEngine.sync()。
                // 首个自动请求必是 meta；未修复（不自动触发）时 takeRequest 超时返回 null。
                val req = server.takeRequest(5, TimeUnit.SECONDS)
                assertNotNull("激活服务器后应自动发起同步（应收到 meta 请求）", req)
                assertEquals("/api/app/v1/sync/meta", req!!.path)
            } finally {
                autoGraph.shutdownForTest()   // 方法内建的第二个 graph 同样要先停协程，防泄漏到关库后
            }
        }
    }

    @Test
    fun `编辑激活服务器 baseUrl 后自动向新端点发起同步（BUG-10 server-edited 收敛）`() = runTest {
        MockWebServer().use { serverA ->
            MockWebServer().use { serverB ->
                serverA.dispatcher = syncDispatcher("a")
                serverB.dispatcher = syncDispatcher("b")
                serverA.start()
                serverB.start()

                val autoGraph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db)
                try {
                    val id = autoGraph.serverRepository.addAndActivate("s", serverA.url("/").toString(), "key")
                    assertNotNull("激活应自动同步到 A", serverA.takeRequest(5, TimeUnit.SECONDS))

                    // 编辑激活行 baseUrl（id 不变）：收集器按端点变化触发 server-edited，且 activeSnapshot
                    // 已先行更新——同步/SSE 必须指向 B（历史 bug：VM 手动 nudge 读陈旧快照连回旧 URL）。
                    // 注意 RetrofitSyncApi 按请求解析 api()：编辑若落在 A 同步中途，B 收到的首个同步
                    // 请求未必是 meta（可能是同一轮的 images/tags 尾巴）——断言只锁定「同步请求到达 B」。
                    autoGraph.serverRepository.updateServer(id, "s", serverB.url("/").toString(), "key")
                    var req = serverB.takeRequest(5, TimeUnit.SECONDS)
                    // 跳过可能先到的 SSE 订阅请求，找首个同步请求
                    while (req != null && req.path?.startsWith("/api/app/v1/sync/") != true) {
                        req = serverB.takeRequest(5, TimeUnit.SECONDS)
                    }
                    assertNotNull("编辑 baseUrl 后同步请求应到达新端点 B", req)
                } finally {
                    autoGraph.shutdownForTest()
                }
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

    /** 跳过可能先到的 SSE 订阅请求，返回首个 /sync/ 请求；用于确认"collector 确实处理到了这一轮事件"。 */
    private fun MockWebServer.takeNextSyncRequest(): RecordedRequest? {
        var req = takeRequest(5, TimeUnit.SECONDS)
        while (req != null && req.path?.startsWith("/api/app/v1/sync/") != true) {
            req = takeRequest(5, TimeUnit.SECONDS)
        }
        return req
    }

    /**
     * 回归测试（审查发现）：AppGraph init 收集器里 `previousId` 必须在 `lastActive` 被覆盖前捕获，
     * 且只有「真实 id 变化」才取消旧服镜像同步工作——「编辑激活行端点」（id 不变）不得误取消。
     * 这个顺序此前是 BUG-10 同一个收集器里出过的问题类型，但一直没有测试盯着它。
     *
     * 用三台独立 MockWebServer（各自只承接一轮事件的请求）避免"请求队列里有上一轮遗留请求"的
     * 误判风险——每次 takeNextSyncRequest() 返回非 null，才能确定 collector 已经跑到了
     * cancel 判断之后的 requestSync 那一行（两者在同一段同步代码里，cancel 判断严格先执行）。
     */
    @Test
    fun `切服才取消旧服镜像同步，previousId 在 lastActive 覆盖前捕获，端点编辑不误触发`() = runTest {
        MockWebServer().use { serverA ->
            MockWebServer().use { serverB ->
                MockWebServer().use { serverC ->
                    serverA.dispatcher = syncDispatcher("a")
                    serverB.dispatcher = syncDispatcher("b")
                    serverC.dispatcher = syncDispatcher("c")
                    serverA.start()
                    serverB.start()
                    serverC.start()

                    val cancelledIds = mutableListOf<Long>()
                    val autoGraph = AppGraph(
                        ApplicationProvider.getApplicationContext(),
                        dbOverride = db,
                        cancelMirrorSyncOverride = { cancelledIds.add(it) },
                    )
                    try {
                        // 首次激活：previousId 为 null（尚未同步过任何服务器），不应触发取消
                        val idA = autoGraph.serverRepository.addAndActivate("a", serverA.url("/").toString(), "key-a")
                        assertNotNull("激活 A 应自动发起同步", serverA.takeNextSyncRequest())
                        assertTrue("首次激活不应触发取消（previousId 为 null）", cancelledIds.isEmpty())

                        // 编辑激活行 baseUrl（id 不变，A 行改指向 B）：只是端点编辑，不应触发取消
                        autoGraph.serverRepository.updateServer(idA, "a", serverB.url("/").toString(), "key-a2")
                        assertNotNull("端点编辑后应仍自动同步到新地址", serverB.takeNextSyncRequest())
                        assertTrue("端点编辑（id 不变）不应触发取消", cancelledIds.isEmpty())

                        // 切服（真正 id 变化 A→C）：previousId 必须是旧 id A，而不是被提前覆盖后的新 id
                        val idC = autoGraph.serverRepository.addAndActivate("c", serverC.url("/").toString(), "key-c")
                        assertNotNull("切服后应自动同步到新服务器", serverC.takeNextSyncRequest())
                        assertEquals("id 变化应且只应取消旧服（A）的镜像同步工作", listOf(idA), cancelledIds)
                        assertNotEquals("绝不能拿新 id 去取消自己", idC, cancelledIds.firstOrNull())
                    } finally {
                        autoGraph.shutdownForTest()
                    }
                }
            }
        }
    }
}
