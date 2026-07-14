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
import org.junit.Assert.assertFalse
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

    private fun worker(activeId: Long? = 1L, ensure: suspend (Long, Long) -> Result<File>): DownloadWorker =
        TestListenableWorkerBuilder<DownloadWorker>(context)
            .setInputData(workDataOf(
                DownloadWorker.KEY_SERVER_ID to 1L,
                DownloadWorker.KEY_IMAGE_ID to 42L,
                DownloadWorker.KEY_FILENAME to "foo.png",
            ))
            .setWorkerFactory(object : WorkerFactory() {
                override fun createWorker(c: Context, name: String, p: WorkerParameters): ListenableWorker =
                    DownloadWorker(
                        c, p,
                        ensureOriginal = ensure,
                        notifier = noopNotifier,
                        activeServerId = { activeId },
                    )
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
                    DownloadWorker(
                        c, p,
                        ensureOriginal = { _, _ -> Result.success(File("x")) },
                        notifier = noopNotifier,
                        activeServerId = { 1L },
                    )
            })
            .build() as DownloadWorker
        assertEquals(ListenableWorker.Result.failure(), w.doWork())
    }

    @Test
    fun `陈旧任务（activeServerId 与入参 serverId 不符）→ success 直接完结，不调用 ensure`() = runTest {
        var ensureCalled = false
        val w = worker(activeId = 999L) { _, _ ->
            ensureCalled = true
            Result.success(File("x"))
        }
        assertEquals(ListenableWorker.Result.success(), w.doWork())
        assertFalse("陈旧任务（已切服）不应触发 ensure", ensureCalled)
    }

    @Test
    fun `IllegalStateException（元数据缺失或中途切服）→ failure 不重试`() = runTest {
        // ImageMirrorStore.ensure 的三处 IllegalStateException 均为重试无法自愈的终态
        // （下次触发条件不变，会一直失败到下次切服），必须映射为终态 failure 而非 retry。
        val w = worker { _, _ -> Result.failure(IllegalStateException("服务器已切换，中止落盘")) }
        assertEquals(ListenableWorker.Result.failure(), w.doWork())
    }
}
