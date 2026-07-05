package com.bluskysoftware.yandegallery

import android.app.PendingIntent
import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.media.MediaStoreGateway
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.download.DownloadWorker
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayOutputStream
import java.io.OutputStream

/**
 * M3 原图下载端到端：TestListenableWorkerBuilder 驱动**整条装配链**——
 * AppGraph 激活服务器行 → `graph.api()` 动态 Bearer + 错误映射拦截器 → 流式 GET /file →
 * 网关写入 → `graph.db` downloads 表落库 → observeDownloadedIds 观察流（viewer 跳原图档的数据源）。
 *
 * 与 DownloadWorkerTest（worker 内部四条路径的单测）互补：这里只走成功链路，但断言链路
 * **两端**的外部效果——请求形状（路径/Bearer）与 DownloadEntity 全字段内容，网关按计划留 fake
 * （MediaStore 真机语义 Robolectric 不可靠，见 MediaStoreGateway 注释，实机清单覆盖）。
 */
@RunWith(RobolectricTestRunner::class)
class DownloadE2ETest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    @Before
    fun setup() {
        db = AppDatabase.inMemory(context)
        // 关自动同步：下载链路成功不触发对账，requestCount 应精确为 1（激活时不许有 sync 请求混入）。
        graph = AppGraph(context, dbOverride = db, autoSyncOnActiveChange = false)
    }

    @After
    fun teardown() {
        graph.shutdownForTest()   // 先停 graph 后台协程再关库——防关库后仍触 Room 的收尾竞态
        db.close()
    }

    @Test
    fun `原图下载全链路——GET file 带 Bearer，完整字节经网关写入，downloads 表记录 uri 与时间`() = runTest {
        // 超过 64KB 拷贝缓冲 + 非对齐尾块：跨多轮读写循环，Content-Length 完整性校验真实生效
        //（MockWebServer 对 body 自动带精确 Content-Length）。
        val payload = ByteArray(96 * 1024 + 17) { (it % 251).toByte() }
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(Buffer().write(payload)))
            server.start()
            graph.serverRepository.addAndActivate("e2e-dl", server.url("/").toString(), "key-dl")

            val gateway = RecordingGateway()
            val worker = TestListenableWorkerBuilder<DownloadWorker>(
                context,
                workDataOf(
                    DownloadWorker.KEY_IMAGE_ID to 77L,
                    DownloadWorker.KEY_FILENAME to "77.jpg",
                    DownloadWorker.KEY_MIME to "image/jpeg",
                ),
            ).setWorkerFactory(object : WorkerFactory() {
                override fun createWorker(
                    appContext: Context,
                    workerClassName: String,
                    workerParameters: WorkerParameters,
                ): ListenableWorker =
                    // deps 接线与生产 AppWorkerFactory 逐项一致（apiProvider/downloadDao/onNotFound
                    // 都取自同一 graph）；仅 gateway 换 fake、now 固定以便断言 downloadedAt。
                    DownloadWorker(
                        appContext,
                        workerParameters,
                        apiProvider = { graph.api() },
                        gateway = gateway,
                        downloadDao = graph.db.downloadDao(),
                        onNotFound = { graph.onBinaryNotFound?.invoke() },
                        now = { "2026-07-05T12:00:00Z" },
                    )
            }).build()

            val result = worker.doWork()

            assertEquals(ListenableWorker.Result.success(), result)

            // ① 请求形状：恰一次 GET /api/v1/images/77/file，Bearer 来自激活服务器行（非硬编码 provider）
            assertEquals("成功链路应恰好一次请求", 1, server.requestCount)
            val req = server.takeRequest()
            assertEquals("GET", req.method)
            assertEquals("/api/v1/images/77/file", req.path)
            assertEquals("Bearer key-dl", req.getHeader("Authorization"))

            // ② 网关效果：完整字节 + finalize（挂起条目转正）+ 无 discard
            assertArrayEquals("网关应收到与响应体一致的完整字节", payload, gateway.bytes())
            assertTrue("成功应 finalize 使相册可见", gateway.finalized)
            assertEquals("成功不应 discard", 0, gateway.discardCount)

            // ③ DownloadEntity 全字段：imageId / 网关返回的 mediaStoreUri / 注入的 downloadedAt
            val row = graph.db.downloadDao().byImageId(77)
            assertNotNull("成功应落库一行", row)
            assertEquals(77L, row!!.imageId)
            assertEquals(gateway.createdUri.toString(), row.mediaStoreUri)
            assertEquals("2026-07-05T12:00:00Z", row.downloadedAt)

            // ④ 观察流：viewer「已下载直接跳原图档」的数据源立即可见本次下载
            assertEquals(listOf(77L), graph.db.downloadDao().observeDownloadedIds().first())
        }
    }

    /** 内存 fake 网关：记录创建的 uri、累积写入字节、finalize/discard 调用。 */
    private class RecordingGateway : MediaStoreGateway {
        val createdUri: Uri = Uri.parse("content://fake/media/e2e-77")
        private val sink = ByteArrayOutputStream()
        var finalized = false
        var discardCount = 0

        override fun createPending(displayName: String, mime: String): Uri = createdUri
        override fun openOutput(uri: Uri): OutputStream = sink
        override fun finalize(uri: Uri) { finalized = true }
        override fun discard(uri: Uri) { discardCount++ }
        override fun exists(uri: Uri): Boolean = true
        override fun buildDeleteRequest(uris: List<Uri>): PendingIntent? = null

        fun bytes(): ByteArray = sink.toByteArray()
    }
}
