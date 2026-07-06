package com.bluskysoftware.yandegallery.data.image

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * 构建 ImageLoader/DiskCache 需 Android Context，故走 Robolectric（既有 ImageLoadersTest 为纯 JVM，不动）。
 * M4-T8：两档 builder 收拢为参数化单源后，验证上限参数经 DiskCache.maxSize 生效、目录名落到独立子目录。
 */
@RunWith(RobolectricTestRunner::class)
class ImageLoadersRobolectricTest {
    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val okHttp = OkHttpClient()

    @Test fun `loader 上限参数生效`() {
        assertEquals(512L * 1024 * 1024,
            buildThumbnailImageLoader(ctx, okHttp, 512L * 1024 * 1024).diskCache?.maxSize)
        assertEquals(256L * 1024 * 1024,
            buildPreviewImageLoader(ctx, okHttp, 256L * 1024 * 1024).diskCache?.maxSize)
    }

    @Test fun `参数化 builder 目录与上限`() {
        val loader = buildTierImageLoader(ctx, okHttp, "tier-test", 128L * 1024 * 1024)
        assertEquals(128L * 1024 * 1024, loader.diskCache?.maxSize)
        assertEquals(true, loader.diskCache?.directory.toString().endsWith("tier-test"))
    }
}
