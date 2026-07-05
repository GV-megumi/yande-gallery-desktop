package com.bluskysoftware.yandegallery.domain.download

import android.app.PendingIntent
import android.content.Context
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.test.core.app.ApplicationProvider
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.api.ApiClientFactory
import com.bluskysoftware.yandegallery.data.api.DesktopApi
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.DownloadDao
import com.bluskysoftware.yandegallery.data.media.DeleteOwnedResult
import com.bluskysoftware.yandegallery.data.media.MediaStoreGateway
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import okhttp3.Call
import okhttp3.Connection
import okhttp3.EventListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicInteger

/**
 * DownloadWorker 单元测试（TDD）——对 fake gateway / in-memory Room DownloadDao / 真实 okHttp 客户端
 * （含错误映射拦截器）驱动 MockWebServer 验证四条路径：成功、尺寸不符、原图 404、系统相册写失败。
 *
 * 关键：404 用例必须用**真实 ApiClientFactory 客户端**——错误拦截器对非 2xx 先抛 ApiException，
 * downloadOriginal() 永远拿不到 code()==404 的 Response；若用绕过拦截器的 fake DesktopApi 返回 404 Response，
 * 测的是永不发生的死代码路径（plan critic 抓到的陷阱）。
 */
@RunWith(RobolectricTestRunner::class)
class DownloadWorkerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AppDatabase
    private lateinit var dao: DownloadDao

    private val imageId = 42L

    @Before
    fun setup() {
        db = AppDatabase.inMemory(context)
        dao = db.downloadDao()
    }

    @After
    fun teardown() = db.close()

    /** 真实客户端（含错误拦截器）指向 MockWebServer，Bearer key 无关紧要给 null。 */
    private fun realApi(server: MockWebServer): DesktopApi =
        ApiClientFactory.desktopApi(server.url("/").toString(), ApiClientFactory.okHttp({ null }))

    /**
     * fake notifier：返回真实最小 ForegroundInfo——每条 doWork 路径拿到 body 后都会 setForeground 一次，
     * TestListenableWorkerBuilder 自带 ForegroundUpdater 接住（不起真 service），四条 IO 路径断言零语义改动。
     */
    private val fakeNotifier = object : DownloadNotifier {
        override fun ensureChannel() {}
        override fun foregroundInfo(imageId: Long, filename: String, written: Long, total: Long) =
            ForegroundInfo(
                1,
                NotificationCompat.Builder(context, "test")
                    .setSmallIcon(android.R.drawable.stat_sys_download).build(),
            )
    }

    private fun buildWorker(
        api: DesktopApi?,
        gateway: MediaStoreGateway,
        onNotFound: () -> Unit = {},
        now: () -> String = { "2026-07-05T00:00:00Z" },
        activeServerId: suspend () -> Long? = { 1L },
        inputData: Data = workDataOf(
            DownloadWorker.KEY_SERVER_ID to 1L,
            DownloadWorker.KEY_IMAGE_ID to imageId,
            DownloadWorker.KEY_FILENAME to "$imageId.jpg",
            DownloadWorker.KEY_MIME to "image/jpeg",
        ),
    ): DownloadWorker =
        TestListenableWorkerBuilder<DownloadWorker>(context, inputData)
            .setWorkerFactory(object : WorkerFactory() {
                override fun createWorker(
                    appContext: Context,
                    workerClassName: String,
                    workerParameters: WorkerParameters,
                ): ListenableWorker =
                    DownloadWorker(
                        appContext,
                        workerParameters,
                        apiProvider = { api },
                        gateway = gateway,
                        downloadDao = dao,
                        onNotFound = onNotFound,
                        now = now,
                        activeServerId = activeServerId,
                        notifier = fakeNotifier,
                        timeMs = { 0L },   // 固定时钟：节流不受墙钟影响，测试确定性
                    )
            })
            .build()

    @Test
    fun `成功——完整字节写入网关并落库`() = runTest {
        val payload = ByteArray(4096) { (it % 251).toByte() }
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(Buffer().write(payload)))
            server.start()
            val gateway = FakeMediaStoreGateway()

            val result = buildWorker(api = realApi(server), gateway = gateway).doWork()

            assertEquals(ListenableWorker.Result.success(), result)
            assertArrayEquals("网关应收到与响应体一致的完整字节", payload, gateway.bytes())
            assertTrue("成功应 finalize", gateway.finalizeCalled)
            assertEquals("成功不应 discard", 0, gateway.discardCount)
            val row = dao.byImageId(1L, imageId)
            assertNotNull("成功应落库一行", row)
            assertEquals("2026-07-05T00:00:00Z", row!!.downloadedAt)
        }
    }

    @Test
    fun `尺寸不符——丢弃并重试且不落库`() = runTest {
        val payload = ByteArray(2048) { it.toByte() }
        MockWebServer().use { server ->
            // 声明 Content-Length 比实际多 1 字节 + 响应末尾断开 → 读流截断抛异常 → 丢弃重试。
            server.enqueue(
                MockResponse()
                    .setBody(Buffer().write(payload))
                    .setHeader("Content-Length", (payload.size + 1).toString())
                    .setSocketPolicy(SocketPolicy.DISCONNECT_AT_END),
            )
            server.start()
            val gateway = FakeMediaStoreGateway()

            val result = buildWorker(api = realApi(server), gateway = gateway).doWork()

            assertEquals(ListenableWorker.Result.retry(), result)
            assertTrue("尺寸不符应 discard 半成品", gateway.discardCount >= 1)
            assertNull("尺寸不符不应落库", dao.byImageId(1L, imageId))
        }
    }

    @Test
    fun `原图 404——真实拦截器抛 ApiException 触发 onNotFound 并失败`() = runTest {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setResponseCode(404).setBody(
                    """{"success":false,"error":{"code":"NOT_FOUND","message":"Resource not found"}}""",
                ),
            )
            server.start()
            var notFound = 0
            val gateway = FakeMediaStoreGateway()

            val result = buildWorker(
                api = realApi(server),
                gateway = gateway,
                onNotFound = { notFound++ },
            ).doWork()

            assertEquals(ListenableWorker.Result.failure(), result)
            assertEquals("原图 404 应触发一次对账钩子", 1, notFound)
            assertEquals("404 未创建条目，无需 discard", 0, gateway.discardCount)
            assertNull("404 不应落库", dao.byImageId(1L, imageId))
        }
    }

    @Test
    fun `系统相册写入失败——直接失败不重试且不落库，流式 body 连接归还不泄漏`() = runTest {
        val payload = ByteArray(512) { it.toByte() }
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(Buffer().write(payload)))
            server.start()
            val gateway = FakeMediaStoreGateway(createReturnsNull = true)

            // 连接泄漏观测：@Streaming body 不 close 则 OkHttp 连接不归还（connectionReleased 不触发）。
            // body.close() 同步触发 connectionReleased，故 doWork 返回后计数确定可断言，无需等待。
            val released = AtomicInteger(0)
            val client = ApiClientFactory.okHttp({ null }).newBuilder()
                .eventListener(object : EventListener() {
                    override fun connectionReleased(call: Call, connection: Connection) {
                        released.incrementAndGet()
                    }
                })
                .build()
            val api = ApiClientFactory.desktopApi(server.url("/").toString(), client)

            val result = buildWorker(api = api, gateway = gateway).doWork()

            assertEquals("MediaStore 写失败应 failure（非 retry）", ListenableWorker.Result.failure(), result)
            assertEquals("createPending 返回 null，无 uri 可 discard", 0, gateway.discardCount)
            assertNull("写失败不应落库", dao.byImageId(1L, imageId))
            assertEquals("早退路径必须 close 流式 body 归还连接（不泄漏）", 1, released.get())
        }
    }

    @Test
    fun `切服竞态——落行前校验发现激活服务器已变，丢弃产物且不落任何行`() = runTest {
        val payload = ByteArray(1024) { (it % 251).toByte() }
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(Buffer().write(payload)))
            server.start()
            val gateway = FakeMediaStoreGateway()

            // inputData serverId=1，下载期间用户切服 → activeServerId() 已是 2
            val result = buildWorker(
                api = realApi(server),
                gateway = gateway,
                activeServerId = { 2L },
            ).doWork()

            assertEquals("切服竞态应 failure（产物属旧服务器域）", ListenableWorker.Result.failure(), result)
            assertEquals("须 discard 丢弃产物", 1, gateway.discardCount)
            assertTrue("校验在 finalize 之前——半成品不得转正", !gateway.finalizeCalled)
            assertNull("旧服域不落行", dao.byImageId(1L, imageId))
            assertNull("新服域更不落行", dao.byImageId(2L, imageId))
        }
    }

    @Test
    fun `成功路径落行带 serverId——byImageId(1,id) 命中且 serverId 列为 1`() = runTest {
        val payload = ByteArray(256) { it.toByte() }
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(Buffer().write(payload)))
            server.start()
            val gateway = FakeMediaStoreGateway()

            val result = buildWorker(api = realApi(server), gateway = gateway).doWork()

            assertEquals(ListenableWorker.Result.success(), result)
            val row = dao.byImageId(1L, imageId)
            assertNotNull("成功应在 serverId=1 域落行", row)
            assertEquals(1L, row!!.serverId)
            assertEquals(imageId, row.imageId)
        }
    }

    @Test
    fun `取消——CancellationException 不吞成 retry，discard 清理半成品且不落库`() = runTest {
        val payload = ByteArray(512) { it.toByte() }
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(Buffer().write(payload)))
            server.start()
            // 生产中取消于拷贝循环内的挂起点（setProgress）浮出为 CancellationException；
            // TestListenableWorkerBuilder 直调 doWork()，真实挂起点无 gate 可挂、无法确定性注入取消，
            // 故经 fake 网关写入缝直接抛 CancellationException——覆盖同一 catch 排序逻辑
            // （CancellationException 必须先于 Exception 被捕获：discard 清理后重抛，绝不吞成 retry）。
            val gateway = FakeMediaStoreGateway(throwOnWrite = { CancellationException("下载被取消") })

            val thrown = runCatching {
                buildWorker(api = realApi(server), gateway = gateway).doWork()
            }.exceptionOrNull()

            assertTrue("取消必须向上重抛，不能吞成 Result.retry", thrown is CancellationException)
            assertEquals("取消须 discard 清理半成品条目", 1, gateway.discardCount)
            assertNull("取消不应落库", dao.byImageId(1L, imageId))
        }
    }

    /** 内存 fake：ByteArrayOutputStream 累积字节，记录 finalize/discard 调用。 */
    private class FakeMediaStoreGateway(
        private val createReturnsNull: Boolean = false,
        private val throwOnWrite: (() -> Throwable)? = null,   // 写入时抛指定异常（模拟取消/IO 故障）
    ) : MediaStoreGateway {
        private val streams = LinkedHashMap<Uri, ByteArrayOutputStream>()
        var finalizeCalled = false
        var discardCount = 0
        private var counter = 0

        override fun createPending(displayName: String, mime: String): Uri? {
            if (createReturnsNull) return null
            val uri = Uri.parse("content://fake/media/${counter++}")
            streams[uri] = ByteArrayOutputStream()
            return uri
        }

        override fun openOutput(uri: Uri): OutputStream? {
            val target = streams[uri] ?: return null
            val thrower = throwOnWrite ?: return target
            return object : OutputStream() {
                override fun write(b: Int): Unit = throw thrower()
                override fun write(b: ByteArray, off: Int, len: Int): Unit = throw thrower()
            }
        }

        override fun finalize(uri: Uri) {
            finalizeCalled = true
        }

        override fun discard(uri: Uri) {
            discardCount++
            streams.remove(uri)
        }

        override fun exists(uri: Uri): Boolean = streams.containsKey(uri)

        override fun buildDeleteRequest(uris: List<Uri>): PendingIntent? = null

        override fun deleteOwned(uri: Uri): DeleteOwnedResult = DeleteOwnedResult.Deleted

        /** 唯一一次下载写入的字节。 */
        fun bytes(): ByteArray = streams.values.firstOrNull()?.toByteArray() ?: ByteArray(0)
    }
}
