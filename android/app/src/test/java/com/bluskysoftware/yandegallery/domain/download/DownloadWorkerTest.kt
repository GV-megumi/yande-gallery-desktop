package com.bluskysoftware.yandegallery.domain.download

import android.app.PendingIntent
import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.work.Data
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.api.ApiClientFactory
import com.bluskysoftware.yandegallery.data.api.DesktopApi
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.DownloadDao
import com.bluskysoftware.yandegallery.data.media.MediaStoreGateway
import kotlinx.coroutines.test.runTest
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

    private fun buildWorker(
        api: DesktopApi?,
        gateway: MediaStoreGateway,
        onNotFound: () -> Unit = {},
        now: () -> String = { "2026-07-05T00:00:00Z" },
        inputData: Data = workDataOf(
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
            val row = dao.byImageId(imageId)
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
            assertNull("尺寸不符不应落库", dao.byImageId(imageId))
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
            assertNull("404 不应落库", dao.byImageId(imageId))
        }
    }

    @Test
    fun `系统相册写入失败——直接失败不重试且不落库`() = runTest {
        val payload = ByteArray(512) { it.toByte() }
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(Buffer().write(payload)))
            server.start()
            val gateway = FakeMediaStoreGateway(createReturnsNull = true)

            val result = buildWorker(api = realApi(server), gateway = gateway).doWork()

            assertEquals("MediaStore 写失败应 failure（非 retry）", ListenableWorker.Result.failure(), result)
            assertEquals("createPending 返回 null，无 uri 可 discard", 0, gateway.discardCount)
            assertNull("写失败不应落库", dao.byImageId(imageId))
        }
    }

    /** 内存 fake：ByteArrayOutputStream 累积字节，记录 finalize/discard 调用。 */
    private class FakeMediaStoreGateway(
        private val createReturnsNull: Boolean = false,
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

        override fun openOutput(uri: Uri): OutputStream? = streams[uri]

        override fun finalize(uri: Uri) {
            finalizeCalled = true
        }

        override fun discard(uri: Uri) {
            discardCount++
            streams.remove(uri)
        }

        override fun exists(uri: Uri): Boolean = streams.containsKey(uri)

        override fun buildDeleteRequest(uris: List<Uri>): PendingIntent? = null

        /** 唯一一次下载写入的字节。 */
        fun bytes(): ByteArray = streams.values.firstOrNull()?.toByteArray() ?: ByteArray(0)
    }
}
