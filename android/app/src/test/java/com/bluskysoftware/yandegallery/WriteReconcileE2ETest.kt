package com.bluskysoftware.yandegallery

import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.TagEntity
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.TimeUnit

/**
 * M3 写操作端到端：AppGraph（Task 5 注入缝，in-memory Room）+ MockWebServer 真实 envelope，
 * 走 `graph.writeRepository` 的**完整装配链路**（乐观镜像 → RetrofitWriteApi → okHttp 拦截器
 * Bearer/错误映射 → 成功后 requestSync 对账 nudge），与 WriteRepositoryTest 的 fake-API 单测互补。
 *
 * 三类断言（全是链路外部可观察效果，不打内部 seam）：
 *   ① 请求形状：方法/路径/Bearer/body——锁定与 M1 galleryWriteRoutes 的契约；
 *   ② 镜像库效果：行删除 / image_tags 建链（乐观应用立即可见）；
 *   ③ 对账链路：写成功后 `/api/v1/sync/meta` 请求真实发出（scheduler 接线是活的）。
 */
@RunWith(RobolectricTestRunner::class)
class WriteReconcileE2ETest {
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        // 关掉激活变化的自动同步（同 EndToEndSyncTest）：本用例断言 FIFO 首个请求必须是写请求本身；
        // 写成功后的对账 nudge 是异步到达的后续请求，在用例 ③ 单独断言。
        graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db, autoSyncOnActiveChange = false)
    }

    @After
    fun teardown() {
        graph.shutdownForTest()   // 先停 graph 后台协程再关库——防关库后仍触 Room 的收尾竞态
        db.close()
    }

    private fun ok(json: String) =
        MockResponse().setBody(json).addHeader("Content-Type", "application/json")

    /** 种子镜像一张图（字段形状与同步落库一致）。 */
    private suspend fun seedImage(id: Long) = db.imageDao().upsertAll(
        listOf(
            ImageEntity(id, "$id.jpg", 800, 600, 12345, "jpg", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
        ),
    )

    @Test
    fun `删除图片成功——镜像行删除，DELETE 带 Bearer，且触发一次对账同步`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(ok("""{"success":true,"data":{"removed":true}}"""))
            server.start()
            graph.serverRepository.addAndActivate("e2e-write", server.url("/").toString(), "key-write")
            seedImage(7)

            val result = graph.writeRepository.deleteImage(7)

            assertEquals(WriteResult.Success, result)
            assertNull("镜像行应已删除", db.imageDao().byId(7))
            assertEquals(0L, db.imageDao().countAll())

            // ① 请求形状：DELETE /api/v1/images/7 + Bearer（写请求先完成、对账才启动，FIFO 首个必为它）
            val req = server.takeRequest()
            assertEquals("DELETE", req.method)
            assertEquals("/api/v1/images/7", req.path)
            assertEquals("Bearer key-write", req.getHeader("Authorization"))

            // ③ 写成功 → requestSync("write") 冗余对账：sync/meta 请求须真实发出。
            //    不给它回应——本用例只证明对账链路被触发；挂起的连接随 server.close() 收尾，
            //    后台 scheduler 把失败静默上报横幅，不影响断言。
            val reconcile = server.takeRequest(5, TimeUnit.SECONDS)
            assertNotNull("写成功后应发出一次对账同步请求", reconcile)
            assertEquals("/api/v1/sync/meta", reconcile!!.path)
        }
    }

    @Test
    fun `删除图片遇 404——目标已在桌面被删，视为成功且不回滚`() = runTest {
        MockWebServer().use { server ->
            // 真实错误 envelope + 真实拦截器：非 2xx 被映射为 ApiException(httpStatus=404)，
            // WriteRepository 按 spec §8 视为成功——镜像行保持删除，不回滚。
            server.enqueue(
                MockResponse().setResponseCode(404).setBody(
                    """{"success":false,"error":{"code":"NOT_FOUND","message":"Resource not found"}}""",
                ),
            )
            server.start()
            graph.serverRepository.addAndActivate("e2e-write", server.url("/").toString(), "key-write")
            seedImage(8)

            val result = graph.writeRepository.deleteImage(8)

            assertEquals("404 应视为成功（spec §8）", WriteResult.Success, result)
            assertNull("不回滚：镜像行保持删除", db.imageDao().byId(8))
            assertEquals(0L, db.imageDao().countAll())
            val req = server.takeRequest()
            assertEquals("DELETE", req.method)
            assertEquals("/api/v1/images/8", req.path)
        }
    }

    @Test
    fun `标签编辑——已知标签乐观建链立即可见，POST body 带 names`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(ok("""{"success":true,"data":{"updated":true}}"""))
            server.start()
            graph.serverRepository.addAndActivate("e2e-write", server.url("/").toString(), "key-write")
            seedImage(9)
            // 本地已知 tag（有 id）才乐观建链；新 tag 无本地 id，靠写后对账同步补链（T6 取舍）。
            db.tagDao().insertAll(listOf(TagEntity(10, "风景", "general")))

            val result = graph.writeRepository.addTags(9, listOf("风景"))

            assertEquals(WriteResult.Success, result)
            // ② 乐观建链立即可见：image_tags 关联行已出现（详情面板即时刷新的数据源）
            assertEquals(listOf("风景"), db.imageDao().tagNamesOf(9))

            // ① 请求形状：POST /api/v1/images/9/tags，body 为 {"names":[...]}（契约字段名 names）
            val req = server.takeRequest()
            assertEquals("POST", req.method)
            assertEquals("/api/v1/images/9/tags", req.path)
            assertEquals("Bearer key-write", req.getHeader("Authorization"))
            assertTrue(req.body.readUtf8().contains(""""names":["风景"]"""))
        }
    }
}
