package com.bluskysoftware.yandegallery.data.image

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Path.Companion.toOkioPath
import okio.buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * 构建 ImageLoader/DiskCache 需 Android Context，故走 Robolectric（既有 ImageLoadersTest 为纯 JVM，不动）。
 * 任务 6（spec §4.1/D9/D11）：缩略图侧改镜像优先——thumbnailRequest 的 data 换成 ThumbnailSpec、
 * MirrorFirstFetcher 本地命中/回退网络两分支、buildThumbnailImageLoader 不再接受数值上限（不设限）。
 * 镜像层 Task 8：1600px 预览档下线，preview/tier builder 相关用例随符号一并删除。
 */
@RunWith(RobolectricTestRunner::class)
class ImageLoadersRobolectricTest {
    private val ctx = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun `thumbnailRequest data 为 ThumbnailSpec——缓存键不变`() {
        val req = thumbnailRequest(ctx, "http://h:1/", 3, 7)
        val spec = req.data as ThumbnailSpec
        assertEquals(3L, spec.serverId)
        assertEquals(7L, spec.imageId)
        assertEquals("http://h:1/api/app/v1/images/7/thumbnail", spec.url)
        assertEquals("s3:t7", req.diskCacheKey)
    }

    @Test
    fun `MirrorFirstFetcher 本地命中——返回文件 Source 零网络`() = runTest {
        val file = File.createTempFile("mirror", ".jpg").apply { writeBytes(ByteArray(8)) }
        val factory = MirrorFirstFetcherFactory(localFile = { _, _ -> file }, okHttp = OkHttpClient())
        val fetcher = factory.create(
            ThumbnailSpec(1, 42, "http://127.0.0.1:9/api/app/v1/images/42/thumbnail"),   // 不可达端口：走网络必炸
            coil3.request.Options(ctx),
            coil3.ImageLoader(ctx),
        )
        val result = fetcher.fetch() as coil3.fetch.SourceFetchResult
        assertNotNull(result.source)   // 未抛 = 未走网络
    }

    @Test
    fun `MirrorFirstFetcher 本地缺失——回退网络路径`() = runTest {
        val server = MockWebServer().apply {
            enqueue(MockResponse().setHeader("Content-Type", "image/jpeg").setBody(okio.Buffer().write(ByteArray(8))))
            start()
        }
        try {
            val factory = MirrorFirstFetcherFactory(localFile = { _, _ -> null }, okHttp = OkHttpClient())
            val fetcher = factory.create(
                ThumbnailSpec(1, 42, server.url("/api/app/v1/images/42/thumbnail").toString()),
                coil3.request.Options(ctx),
                coil3.ImageLoader(ctx),
            )
            val result = fetcher.fetch() as coil3.fetch.SourceFetchResult
            assertNotNull(result.source)
            assertEquals(1, server.requestCount)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `MirrorFirstFetcher 远程 404——显式抛错而非当作图片数据`() = runTest {
        val server = MockWebServer().apply {
            enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"not found"}"""))
            start()
        }
        try {
            val factory = MirrorFirstFetcherFactory(localFile = { _, _ -> null }, okHttp = OkHttpClient())
            val fetcher = factory.create(
                ThumbnailSpec(1, 42, server.url("/api/app/v1/images/42/thumbnail").toString()),
                coil3.request.Options(ctx),
                coil3.ImageLoader(ctx),
            )
            assertThrows(java.io.IOException::class.java) {
                runBlocking { fetcher.fetch() }
            }
            assertEquals(1, server.requestCount)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `buildThumbnailImageLoader 不设限——maxSize 为 1 TiB 形式上限`() {
        val loader = buildThumbnailImageLoader(ctx, OkHttpClient(), localFile = { _, _ -> null })
        assertEquals(1L shl 40, loader.diskCache?.maxSize)
    }

    @Test
    fun `MirrorFirstFetcher 网络命中写穿磁盘缓存——服务器下线后第二次请求仍从盘命中`() = runTest {
        val cacheDir = File(ctx.cacheDir, "mirror-fetcher-cache-test-network").apply { mkdirs() }
        val loader = coil3.ImageLoader.Builder(ctx)
            .diskCache(coil3.disk.DiskCache.Builder().directory(cacheDir.toOkioPath()).build())
            .build()
        val payload = ByteArray(8) { it.toByte() }
        val server = MockWebServer().apply {
            enqueue(MockResponse().setHeader("Content-Type", "image/jpeg").setBody(okio.Buffer().write(payload)))
            start()
        }
        val url = server.url("/api/app/v1/images/42/thumbnail").toString()
        val options = coil3.request.Options(ctx, diskCacheKey = "s1:t42")
        val factory = MirrorFirstFetcherFactory(localFile = { _, _ -> null }, okHttp = OkHttpClient())

        // 第一次：本地未镜像 → 回退网络，命中后写穿磁盘缓存
        val first = factory.create(ThumbnailSpec(1, 42, url), options, loader).fetch() as coil3.fetch.SourceFetchResult
        assertEquals(coil3.decode.DataSource.NETWORK, first.dataSource)
        assertEquals(1, server.requestCount)
        server.shutdown()   // 关服：第二次若误走网络分支会直接连接失败，而非静默重试

        // 第二次：同 key 磁盘缓存应命中，零网络即可拿到与第一次网络响应一致的字节
        val second = factory.create(ThumbnailSpec(1, 42, url), options, loader).fetch() as coil3.fetch.SourceFetchResult
        assertEquals(coil3.decode.DataSource.DISK, second.dataSource)
        assertEquals(payload.toList(), second.source.source().readByteArray().toList())
    }

    @Test
    fun `MirrorFirstFetcher 本地镜像命中——即使同 key 磁盘缓存已有旧档也直接读镜像文件，不摸磁盘缓存`() = runTest {
        val cacheDir = File(ctx.cacheDir, "mirror-fetcher-cache-test-mirror").apply { mkdirs() }
        val diskCache = coil3.disk.DiskCache.Builder().directory(cacheDir.toOkioPath()).build()
        val loader = coil3.ImageLoader.Builder(ctx).diskCache(diskCache).build()
        val cacheKey = "s1:t42"
        // 磁盘缓存里预置一份「旧」内容——若 Fetcher 误走磁盘缓存分支，读到的会是这份陈旧数据而非镜像文件
        diskCache.openEditor(cacheKey)!!.let { editor ->
            diskCache.fileSystem.sink(editor.data).buffer().use { it.write(ByteArray(4) { 9 }) }
            editor.commit()
        }
        val mirrorFile = File.createTempFile("mirror", ".jpg").apply { writeBytes(ByteArray(8) { 1 }) }
        val factory = MirrorFirstFetcherFactory(localFile = { _, _ -> mirrorFile }, okHttp = OkHttpClient())

        val result = factory.create(
            ThumbnailSpec(1, 42, "http://127.0.0.1:9/api/app/v1/images/42/thumbnail"),   // 不可达端口：走网络必炸
            coil3.request.Options(ctx, diskCacheKey = cacheKey),
            loader,
        ).fetch() as coil3.fetch.SourceFetchResult

        assertEquals(coil3.decode.DataSource.DISK, result.dataSource)
        assertEquals(mirrorFile.toOkioPath(), result.source.file())
    }
}
