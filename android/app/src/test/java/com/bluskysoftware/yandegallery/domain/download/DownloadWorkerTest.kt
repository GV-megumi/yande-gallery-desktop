package com.bluskysoftware.yandegallery.domain.download

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * DownloadWorker（镜像版）：worker 只做「ensure ORIGINAL + 结果分流 + 前台通知」，
 * 落盘/校验/删 HQ/跨切服全在 ImageMirrorStore.ensure 内（ImageMirrorStoreTest 覆盖）。
 */
@RunWith(RobolectricTestRunner::class)
class DownloadWorkerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    private val noopNotifier = object : DownloadNotifier {
        override fun ensureChannel() {}
        override fun foregroundInfo(imageId: Long, filename: String, written: Long, total: Long) =
            throw IllegalStateException("测试不升前台")   // runCatching 降级路径
    }

    private fun worker(ensure: suspend (Long, Long) -> Result<File>): DownloadWorker =
        TestListenableWorkerBuilder<DownloadWorker>(context)
            .setInputData(workDataOf(
                DownloadWorker.KEY_SERVER_ID to 1L,
                DownloadWorker.KEY_IMAGE_ID to 42L,
                DownloadWorker.KEY_FILENAME to "foo.png",
            ))
            .setWorkerFactory(object : WorkerFactory() {
                override fun createWorker(c: Context, name: String, p: WorkerParameters): ListenableWorker =
                    DownloadWorker(c, p, ensureOriginal = ensure, notifier = noopNotifier)
            })
            .build() as DownloadWorker

    @Test
    fun `ensure 成功 → success（通知升级失败不影响结果）`() = runTest {
        val w = worker { _, _ -> Result.success(File("x")) }
        assertEquals(ListenableWorker.Result.success(), w.doWork())
    }

    @Test
    fun `404 → failure（原图已删，不重试；对账 nudge 由拦截器统一触发）`() = runTest {
        val w = worker { _, _ -> Result.failure(ApiException("NOT_FOUND", "x", 404)) }
        assertEquals(ListenableWorker.Result.failure(), w.doWork())
    }

    @Test
    fun `磁盘不足 → retry`() = runTest {
        val w = worker { _, _ -> Result.failure(ImageMirrorStore.DiskFullException()) }
        assertEquals(ListenableWorker.Result.retry(), w.doWork())
    }

    @Test
    fun `网络等其他错误 → retry`() = runTest {
        val w = worker { _, _ -> Result.failure(java.io.IOException("断了")) }
        assertEquals(ListenableWorker.Result.retry(), w.doWork())
    }

    @Test
    fun `无效入参（serverId 缺失）→ failure`() = runTest {
        val w = TestListenableWorkerBuilder<DownloadWorker>(context)
            .setInputData(workDataOf(DownloadWorker.KEY_IMAGE_ID to 42L))
            .setWorkerFactory(object : WorkerFactory() {
                override fun createWorker(c: Context, name: String, p: WorkerParameters): ListenableWorker =
                    DownloadWorker(c, p, ensureOriginal = { _, _ -> Result.success(File("x")) }, notifier = noopNotifier)
            })
            .build() as DownloadWorker
        assertEquals(ListenableWorker.Result.failure(), w.doWork())
    }
}
