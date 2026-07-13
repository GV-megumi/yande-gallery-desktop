package com.bluskysoftware.yandegallery

import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.test.core.app.ApplicationProvider
import androidx.work.ForegroundInfo
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.download.DownloadNotifier
import com.bluskysoftware.yandegallery.domain.download.DownloadWorker
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * 原图下载端到端（镜像版，M7 改写）：TestListenableWorkerBuilder 驱动**整条生产装配链**——
 * 与生产 AppWorkerFactory 逐项一致地把 ensureOriginal 接到 `graph.imageMirrorStore.ensure(..., ORIGINAL)`，
 * 断言 `graph.api()` 派生的 Bearer（激活服务器行，非硬编码 provider）、真实 GET 路径、镜像目录落盘
 * 字节与 image_files 升 ORIGINAL。
 *
 * 与 DownloadWorkerTest（worker 结果分流单测，ensureOriginal 用 fake，不触网络/AppGraph）、
 * ImageMirrorStoreTest（ensure 本体的落盘/校验/删 HQ 细节，apiProvider 固定 key 不经 AppGraph）互补：
 * 这里唯一验证「真实 AppGraph 装配下 Bearer 来自激活服务器行」这条生产接线，其余细节两处已覆盖，
 * 不重复断言（旧版 MediaStore/downloads 表全链路随 worker 改写退役，见 M7 任务）。
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
    fun `原图下载全链路——GET file 带激活服务器 Bearer，完整字节落镜像目录，image_files 升 ORIGINAL`() = runTest {
        // 超过 64KB 拷贝缓冲 + 非对齐尾块：跨多轮读写循环，Content-Length 完整性校验真实生效
        //（MockWebServer 对 body 自动带精确 Content-Length）。
        val payload = ByteArray(96 * 1024 + 17) { (it % 251).toByte() }
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(Buffer().write(payload)))
            server.start()
            val serverId = graph.serverRepository.addAndActivate("e2e-dl", server.url("/").toString(), "key-dl")
            // ensure() 落盘前先查 imageDao 取原始文件名——须先有元数据行（对齐 ImageMirrorStoreTest 惯例）
            db.imageDao().upsertAll(listOf(
                ImageEntity(
                    77, "77.jpg", 10, 10, payload.size.toLong(), "jpg",
                    "2026-07-05T00:00:00.000Z", "2026-07-05T00:00:00.000Z",
                ),
            ))

            val worker = TestListenableWorkerBuilder<DownloadWorker>(
                context,
                workDataOf(
                    DownloadWorker.KEY_SERVER_ID to serverId,
                    DownloadWorker.KEY_IMAGE_ID to 77L,
                    DownloadWorker.KEY_FILENAME to "77.jpg",
                ),
            ).setWorkerFactory(object : WorkerFactory() {
                override fun createWorker(
                    appContext: Context,
                    workerClassName: String,
                    workerParameters: WorkerParameters,
                ): ListenableWorker =
                    // deps 接线与生产 AppWorkerFactory 逐项一致：ensureOriginal 直接接 graph.imageMirrorStore.ensure；
                    // 唯 notifier 换 fake（TestListenableWorkerBuilder 自带 ForegroundUpdater 接住，链路语义零改动）。
                    DownloadWorker(
                        appContext,
                        workerParameters,
                        ensureOriginal = { sid, iid -> graph.imageMirrorStore.ensure(sid, iid, MirrorTier.ORIGINAL) },
                        notifier = object : DownloadNotifier {
                            override fun ensureChannel() {}
                            override fun foregroundInfo(imageId: Long, filename: String, written: Long, total: Long) =
                                ForegroundInfo(
                                    1,
                                    NotificationCompat.Builder(context, "test")
                                        .setSmallIcon(android.R.drawable.stat_sys_download).build(),
                                )
                        },
                    )
            }).build()

            val result = worker.doWork()

            assertEquals(ListenableWorker.Result.success(), result)

            // ① 请求形状：恰一次 GET /api/app/v1/images/77/file，Bearer 来自激活服务器行（非硬编码 provider）
            assertEquals("成功链路应恰好一次请求", 1, server.requestCount)
            val req = server.takeRequest()
            assertEquals("GET", req.method)
            assertEquals("/api/app/v1/images/77/file", req.path)
            assertEquals("Bearer key-dl", req.getHeader("Authorization"))

            // ② 镜像落盘效果：完整字节写入镜像目录（ensure 内 Content-Length 校验已生效，非本测重点）
            val localFile = graph.imageMirrorStore.localFile(serverId, 77)?.file
            assertNotNull("成功应落入镜像目录", localFile)
            assertArrayEquals("镜像文件应与响应体一致的完整字节", payload, localFile!!.readBytes())

            // ③ image_files 全字段：serverId / imageId / tier 升 ORIGINAL
            val row = graph.db.imageFileDao().byImageId(serverId, 77)
            assertNotNull("成功应登记 image_files 行", row)
            assertEquals(serverId, row!!.serverId)
            assertEquals(77L, row.imageId)
            assertEquals("ORIGINAL", row.tier)
        }
    }
}
