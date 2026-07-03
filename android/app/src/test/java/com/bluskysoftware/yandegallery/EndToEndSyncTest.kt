package com.bluskysoftware.yandegallery

import androidx.paging.PagingSource
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * M2 端到端冒烟：MockWebServer 脚本化 **六个响应**（真实 envelope JSON，形状对齐
 * ApiClientTest/ApiModelsTest/SyncEngineTest），经 AppGraph（Task 5 注入缝，in-memory Room）
 * 走完整 SyncEngine.sync() 链路，断言 T3-T7 装配正确性：
 *
 *   引擎调用顺序（见 SyncEngine.kt）：meta → images 第 1 页 → images 第 2 页
 *   → image-ids → galleries → tags。MockWebServer 按 FIFO 出队，enqueue 顺序须与此一一对应。
 *
 * 五类断言：SyncOutcome 成功语义 / imageDao.countAll() 图片总数 / 时间轴 PagingSource
 * 首页 createdAt DESC 顺序 / galleryDao 卡片数据 / image-tag 关联落库。
 */
@RunWith(RobolectricTestRunner::class)
class EndToEndSyncTest {
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db)
    }

    @After
    fun teardown() = db.close()

    private fun body(json: String) =
        MockResponse().setBody(json).addHeader("Content-Type", "application/json")

    @Test
    fun `脚本化六响应全量同步：图片落库、时间轴倒序、相册卡片、标签关联`() = runTest {
        MockWebServer().use { server ->
            // 1) sync/meta —— 首次同步（本地无 sync_state）→ 全量重建
            server.enqueue(body("""{"success":true,"data":{"serverId":"srv-e2e","dataVersion":7,"imageCount":3,"latestCursor":"cursor-2"}}"""))
            // 2) sync/images 第 1 页（hasMore=true）—— image 1（tags 10,20 / gallery 100）+ image 2（gallery 100）
            server.enqueue(body("""{"success":true,"data":{"items":[
                {"id":1,"filename":"1.jpg","width":800,"height":600,"fileSize":12345,"format":"jpg","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","tagIds":[10,20],"galleryIds":[100]},
                {"id":2,"filename":"2.png","width":1024,"height":768,"fileSize":22222,"format":"png","createdAt":"2026-03-01T00:00:00.000Z","updatedAt":"2026-03-01T00:00:00.000Z","tagIds":[],"galleryIds":[100]}
            ],"nextCursor":"cursor-1","hasMore":true}}"""))
            // 3) sync/images 第 2 页（hasMore=false）—— image 3（tag 10）
            server.enqueue(body("""{"success":true,"data":{"items":[
                {"id":3,"filename":"3.jpg","width":640,"height":480,"fileSize":33333,"format":"jpg","createdAt":"2026-02-01T00:00:00.000Z","updatedAt":"2026-02-01T00:00:00.000Z","tagIds":[10],"galleryIds":[]}
            ],"nextCursor":"cursor-2","hasMore":false}}"""))
            // 4) sync/image-ids —— 远端全量 id，无对账删除
            server.enqueue(body("""{"success":true,"data":{"ids":[1,2,3]}}"""))
            // 5) sync/galleries —— 单相册，coverImageId + imageCount
            server.enqueue(body("""{"success":true,"data":{"items":[{"id":100,"name":"夏日相册","coverImageId":1,"imageCount":2}]}}"""))
            // 6) sync/tags —— category 可空
            server.enqueue(body("""{"success":true,"data":{"items":[{"id":10,"name":"风景","category":"general"},{"id":20,"name":"海","category":null}]}}"""))
            server.start()

            // 种子 server 行指向 MockWebServer 并激活（原子 insert+activate）。
            // 不等待 init 预热 collector：api() 内部同步读 activeServer()，sync() 无需等 Bearer 快照追平。
            graph.serverRepository.addAndActivate("e2e", server.url("/").toString(), "key-e2e")

            val outcome = graph.syncEngine.sync()

            // 断言 1：SyncOutcome 成功语义——全量重建、落库 3 张、无对账删除
            assertTrue("首次同步应为全量重建", outcome.fullRebuild)
            assertEquals(3L, outcome.upserted)
            assertEquals(0, outcome.deleted)

            // 断言 2：imageDao.countAll() == 两页图片总数
            assertEquals(3L, graph.db.imageDao().countAll())

            // 断言 3：时间轴 PagingSource 首页按 createdAt DESC 排序（2>3>1，非插入序/非 id 序）
            @Suppress("UNCHECKED_CAST")
            val page = graph.db.imageDao().timelinePagingSource()
                .load(PagingSource.LoadParams.Refresh<Int>(null, 10, false))
                    as PagingSource.LoadResult.Page<Int, ImageEntity>
            assertEquals(listOf(2L, 3L, 1L), page.data.map { it.id })

            // 断言 4：galleryDao 卡片数据——name / coverImageId / imageCount 逐字段
            val cards = graph.db.galleryDao().observeAll().first()
            assertEquals(1, cards.size)
            val card = cards.single()
            assertEquals(100L, card.id)
            assertEquals("夏日相册", card.name)
            assertEquals(1L, card.coverImageId)
            assertEquals(2, card.imageCount)

            // 断言 5：image-tag 关联落库——总关联数 3（image1→10,20；image3→10），
            // 且 image 1 精确关联 [10,20]（原始 SQL 直查，验证具体某图关联正确而非仅计数）
            assertEquals(3, graph.db.imageDao().tagLinkCount())
            val tagsOfImage1 = graph.db
                .query("SELECT tagId FROM image_tags WHERE imageId = 1 ORDER BY tagId", null)
                .use { c -> buildList { while (c.moveToNext()) add(c.getLong(0)) } }
            assertEquals(listOf(10L, 20L), tagsOfImage1)

            // 六个响应恰好按引擎调用顺序被消费
            val metaReq = server.takeRequest()
            assertEquals("/api/v1/sync/meta", metaReq.path)
            // 堵 auth 盲区：请求须携带 Bearer 头（okHttp 拦截器把激活 key 注入 Authorization）
            assertEquals("Bearer key-e2e", metaReq.getHeader("Authorization"))
            assertEquals("/api/v1/sync/images?limit=2000", server.takeRequest().path)
            assertEquals("/api/v1/sync/images?cursor=cursor-1&limit=2000", server.takeRequest().path)
            assertEquals("/api/v1/sync/image-ids", server.takeRequest().path)
            assertEquals("/api/v1/sync/galleries", server.takeRequest().path)
            assertEquals("/api/v1/sync/tags", server.takeRequest().path)
        }
    }
}
