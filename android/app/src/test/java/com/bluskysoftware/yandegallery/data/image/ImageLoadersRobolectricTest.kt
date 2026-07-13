package com.bluskysoftware.yandegallery.data.image

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * 构建 ImageLoader/DiskCache 需 Android Context，故走 Robolectric（既有 ImageLoadersTest 为纯 JVM，不动）。
 * M4-T8：两档 builder 收拢为参数化单源后，验证上限参数经 DiskCache.maxSize 生效、目录名落到独立子目录。
 * 任务 6（spec §4.1/D9/D11）：缩略图侧改镜像优先——thumbnailRequest 的 data 换成 ThumbnailSpec、
 * MirrorFirstFetcher 本地命中/回退网络两分支、buildThumbnailImageLoader 不再接受数值上限（不设限）。
 */
@RunWith(RobolectricTestRunner::class)
class ImageLoadersRobolectricTest {
    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val okHttp = OkHttpClient()

    // 缩略图半支随任务 6 迁到下面「buildThumbnailImageLoader 不设限」——不再接受数值 maxSizeBytes 参数。
    @Test fun `预览 loader 上限参数生效`() {
        assertEquals(256L * 1024 * 1024,
            buildPreviewImageLoader(ctx, okHttp, 256L * 1024 * 1024).diskCache?.maxSize)
    }

    @Test fun `参数化 builder 目录与上限`() {
        val loader = buildTierImageLoader(ctx, okHttp, "tier-test", 128L * 1024 * 1024)
        assertEquals(128L * 1024 * 1024, loader.diskCache?.maxSize)
        assertEquals(true, loader.diskCache?.directory.toString().endsWith("tier-test"))
    }

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
    fun `buildThumbnailImageLoader 不设限——maxSize 为 1 TiB 形式上限`() {
        val loader = buildThumbnailImageLoader(ctx, OkHttpClient(), localFile = { _, _ -> null })
        assertEquals(1L shl 40, loader.diskCache?.maxSize)
    }
}
