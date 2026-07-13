package com.bluskysoftware.yandegallery.data.mirror

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.api.ApiClientFactory
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.api.DesktopApi
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class ImageMirrorStoreTest {
    private lateinit var db: AppDatabase
    private lateinit var server: MockWebServer
    private lateinit var api: DesktopApi
    private lateinit var root: File
    private var activeId: Long = 1L
    private var free: Long = Long.MAX_VALUE

    private fun store() = ImageMirrorStore(
        rootDir = root,
        imageFileDao = db.imageFileDao(),
        imageDao = db.imageDao(),
        apiProvider = { api },
        activeServerId = { activeId },
        nowMs = { 1720000000000L },
        freeBytes = { free },
    )

    @Before
    fun setup() = runTest {
        val context: Context = ApplicationProvider.getApplicationContext()
        db = AppDatabase.inMemory(context)
        db.imageDao().upsertAll(listOf(
            ImageEntity(42, "foo.png", 10, 10, 1000, "png", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"),
        ))
        server = MockWebServer().apply { start() }
        api = ApiClientFactory.desktopApi(server.url("/").toString(), ApiClientFactory.okHttp({ "k" }))
        root = File(context.cacheDir, "mirror-test-${System.nanoTime()}").apply { mkdirs() }
        activeId = 1L
        free = Long.MAX_VALUE
    }

    @After
    fun teardown() {
        db.close(); server.shutdown(); root.deleteRecursively()
    }

    private fun okBody(bytes: ByteArray, type: String) = MockResponse()
        .setHeader("Content-Type", type)
        .setBody(okio.Buffer().write(bytes))

    @Test
    fun `ensure HQ 成功——png 源 jpeg 产物落 foo_jpg 并登记 HQ 行`() = runTest {
        val payload = ByteArray(64) { it.toByte() }
        server.enqueue(okBody(payload, "image/jpeg"))
        val result = store().ensure(1, 42, MirrorTier.HQ)
        val file = result.getOrThrow()
        assertEquals("foo.jpg", file.name)
        assertTrue(file.readBytes().contentEquals(payload))
        val row = db.imageFileDao().byImageId(1, 42)!!
        assertEquals("HQ", row.tier)
        assertEquals("s1/i42/foo.jpg", row.relPath)
        assertEquals(64L, row.bytes)
        assertEquals("/api/app/v1/images/42/hq", server.takeRequest().path)
    }

    @Test
    fun `ensure ORIGINAL 覆盖 HQ——旧 HQ 文件删除 行升 ORIGINAL`() = runTest {
        server.enqueue(okBody(ByteArray(8), "image/jpeg"))
        store().ensure(1, 42, MirrorTier.HQ)
        server.enqueue(okBody(ByteArray(16), "image/png"))
        val file = store().ensure(1, 42, MirrorTier.ORIGINAL).getOrThrow()
        assertEquals("foo.png", file.name)
        assertFalse(File(file.parentFile, "foo.jpg").exists())   // 同目录旧 HQ 已清
        assertEquals("ORIGINAL", db.imageFileDao().byImageId(1, 42)?.tier)
        assertEquals(2, server.requestCount)
        assertEquals("/api/app/v1/images/42/hq", server.takeRequest().path)
        assertEquals("/api/app/v1/images/42/file", server.takeRequest().path)
    }

    @Test
    fun `已有 ORIGINAL 请求 HQ——零网络直接返回原图（D7）`() = runTest {
        server.enqueue(okBody(ByteArray(16), "image/png"))
        store().ensure(1, 42, MirrorTier.ORIGINAL)
        val file = store().ensure(1, 42, MirrorTier.HQ).getOrThrow()
        assertEquals("foo.png", file.name)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `Content-Length 不符——失败且无 part 残留无行`() = runTest {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "image/jpeg")
                .setBody(okio.Buffer().write(ByteArray(8)))
                .setHeader("Content-Length", "999")
                .setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_AT_END),
        )
        val result = store().ensure(1, 42, MirrorTier.HQ)
        assertTrue(result.isFailure)
        assertNull(db.imageFileDao().byImageId(1, 42))
        assertTrue(File(root, "s1/i42").listFiles().orEmpty().isEmpty())
    }

    @Test
    fun `404——失败携带 ApiException httpStatus 404（同步 worker 计数依据）`() = runTest {
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"success":false}"""))
        val result = store().ensure(1, 42, MirrorTier.HQ)
        assertEquals(404, (result.exceptionOrNull() as? ApiException)?.httpStatus)
        assertNull(db.imageFileDao().byImageId(1, 42))
    }

    @Test
    fun `跨切服拦截——落行前 activeServerId 变化即丢弃产物`() = runTest {
        server.enqueue(okBody(ByteArray(8), "image/jpeg"))
        activeId = 2L   // 下载完成时已切服
        val result = store().ensure(1, 42, MirrorTier.HQ)
        assertTrue(result.isFailure)
        assertNull(db.imageFileDao().byImageId(1, 42))
        assertTrue(File(root, "s1/i42").listFiles().orEmpty().isEmpty())
    }

    @Test
    fun `磁盘不足——DiskFullException 不发网络请求`() = runTest {
        free = 0L
        val result = store().ensure(1, 42, MirrorTier.HQ)
        assertTrue(result.exceptionOrNull() is ImageMirrorStore.DiskFullException)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `并发同图 ensure——Mutex 收敛为单次下载`() = runTest {
        server.enqueue(okBody(ByteArray(8), "image/jpeg"))
        val s = store()
        coroutineScope {
            val a = async { s.ensure(1, 42, MirrorTier.HQ) }
            val b = async { s.ensure(1, 42, MirrorTier.HQ) }
            assertTrue(a.await().isSuccess)
            assertTrue(b.await().isSuccess)
        }
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `localFile 行在文件亡返回 null；stats 分档聚合；sweepOrphans 双向清理`() = runTest {
        server.enqueue(okBody(ByteArray(8), "image/jpeg"))
        val s = store()
        s.ensure(1, 42, MirrorTier.HQ)
        assertEquals(MirrorTier.HQ, s.localFile(1, 42)?.tier)
        val stats = s.stats(1)
        assertEquals(1L, stats.hqCount)
        assertEquals(8L, stats.hqBytes)
        // 孤儿目录（无行）+ 行在文件亡
        File(root, "s1/i999").apply { mkdirs(); File(this, "x.jpg").writeBytes(ByteArray(1)) }
        File(root, "s1/i42/foo.jpg").delete()
        s.sweepOrphans(1)
        assertFalse(File(root, "s1/i999").exists())
        assertNull(db.imageFileDao().byImageId(1, 42))
        assertNull(s.localFile(1, 42))
    }

    @Test
    fun `崩溃重试——target 已存在无行时 ensure 覆盖旧产物并登记新行`() = runTest {
        // 模拟崩溃场景：上一轮 renameTo 已成功但进程在 upsert 前终止，target 残留、行缺失
        val dir = File(root, "s1/i42").apply { mkdirs() }
        File(dir, "foo.png").writeBytes(ByteArray(4) { 9 })
        val payload = ByteArray(16) { it.toByte() }
        server.enqueue(okBody(payload, "image/png"))
        val file = store().ensure(1, 42, MirrorTier.ORIGINAL).getOrThrow()
        assertEquals("foo.png", file.name)
        assertTrue(file.readBytes().contentEquals(payload))   // 旧残留产物已被本次下载覆盖
        val row = db.imageFileDao().byImageId(1, 42)!!
        assertEquals("ORIGINAL", row.tier)
        assertEquals(16L, row.bytes)
    }

    @Test
    fun `sweepOrphans 正向守卫——行与文件都存在的目录不被误删`() = runTest {
        server.enqueue(okBody(ByteArray(8), "image/jpeg"))
        val s = store()
        s.ensure(1, 42, MirrorTier.HQ)
        s.sweepOrphans(1)
        assertTrue(File(root, "s1/i42/foo.jpg").exists())
        assertEquals("HQ", db.imageFileDao().byImageId(1, 42)?.tier)
    }

    @Test
    fun `全新安装镜像根目录不存在——ensure 前置建根目录，不再误判磁盘不足`() = runTest {
        // 复现首次安装场景：mirror 根目录从未被创建过（不同于 setup() 里已 mkdirs 的 root）。
        // 故意不注入 freeBytes，走构造函数默认值 rootDir.usableSpace——已用 jshell 核实
        // JDK 17 + Windows 下该 API 对不存在的路径返回 0（非"未知"而是"0 可用"，statvfs 语义），
        // 若 ensureLocked 在建目录前查可用空间，会对全新安装永久误判磁盘不足（DownloadWorker
        // 无限重试、sync 恒报 DISK_FULL，无自愈路径）。
        val context: Context = ApplicationProvider.getApplicationContext()
        val freshRoot = File(context.cacheDir, "mirror-fresh-${System.nanoTime()}")
        assertFalse(freshRoot.exists())
        val freshStore = ImageMirrorStore(
            rootDir = freshRoot,
            imageFileDao = db.imageFileDao(),
            imageDao = db.imageDao(),
            apiProvider = { api },
            activeServerId = { activeId },
            nowMs = { 1720000000000L },
            // freeBytes 故意不传，用默认 lambda——本用例专测该默认路径
        )
        val payload = ByteArray(8) { it.toByte() }
        server.enqueue(okBody(payload, "image/jpeg"))
        val file = freshStore.ensure(1, 42, MirrorTier.HQ).getOrThrow()
        assertTrue(file.isFile)
        assertTrue(file.readBytes().contentEquals(payload))
        freshRoot.deleteRecursively()
    }
}
