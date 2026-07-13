package com.bluskysoftware.yandegallery.domain.mirror

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import com.bluskysoftware.yandegallery.domain.download.MirrorSyncNotifier
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class MirrorSyncWorkerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AppDatabase
    private val monitor = MirrorSyncMonitor()

    /** no-op 通知 fake：worker 通知路径 runCatching 包裹，测试不触真通知服务。 */
    private val noopNotifier = object : MirrorSyncNotifier {
        override fun ensureChannel() {}
        override fun foregroundInfo(done: Long, total: Long) = throw IllegalStateException("测试不升前台")
    }

    @Before
    fun setup() = runTest {
        db = AppDatabase.inMemory(context)
        db.imageDao().upsertAll((1L..8L).map {
            ImageEntity(it, "a$it.jpg", 1, 1, 100, "jpg", "2026-07-01T00:00:0$it.000Z", "")
        })
    }

    @After
    fun teardown() = db.close()

    private fun worker(
        ensure: suspend (Long, Long, MirrorTier) -> Result<File>,
        mode: MirrorTier = MirrorTier.HQ,
        activeId: Long? = 1L,
    ): MirrorSyncWorker =
        TestListenableWorkerBuilder<MirrorSyncWorker>(context)
            .setInputData(workDataOf(MirrorSyncWorker.KEY_SERVER_ID to 1L))
            .setWorkerFactory(object : WorkerFactory() {
                override fun createWorker(c: Context, name: String, p: WorkerParameters): ListenableWorker =
                    MirrorSyncWorker(
                        c, p,
                        ensure = ensure,
                        imageFileDao = db.imageFileDao(),
                        saveMode = { mode },
                        activeServerId = { activeId },
                        monitor = monitor,
                        notifier = noopNotifier,
                    )
            })
            .build() as MirrorSyncWorker

    @Test
    fun `全部成功 → success，monitor 走到 done==total`() = runTest {
        val w = worker(ensure = { _, _, _ -> Result.success(File("x")) })
        assertEquals(ListenableWorker.Result.success(), w.doWork())
        assertEquals(8L, monitor.state.value.done)
        assertEquals(false, monitor.state.value.running)
    }

    @Test
    fun `HQ 模式前 5 张全 404 → 中止置 SERVER_TOO_OLD（spec §3_4-4）`() = runTest {
        val w = worker(ensure = { _, _, _ ->
            Result.failure(ApiException("NOT_FOUND", "x", 404))
        })
        assertEquals(ListenableWorker.Result.failure(), w.doWork())
        assertEquals(MirrorSyncMonitor.MirrorSyncError.SERVER_TOO_OLD, monitor.state.value.error)
    }

    @Test
    fun `ORIGINAL 模式全 404 → 只按单图跳过，success 不误判旧桌面`() = runTest {
        val w = worker(
            ensure = { _, _, _ -> Result.failure(ApiException("NOT_FOUND", "x", 404)) },
            mode = MirrorTier.ORIGINAL,
        )
        assertEquals(ListenableWorker.Result.success(), w.doWork())
        assertEquals(null, monitor.state.value.error)
    }

    @Test
    fun `网络错误 → retry（退避重试）`() = runTest {
        var calls = 0
        val w = worker(ensure = { _, _, _ ->
            calls++
            if (calls <= 2) Result.failure(java.io.IOException("网络中断")) else Result.success(File("x"))
        })
        assertEquals(ListenableWorker.Result.retry(), w.doWork())
    }

    @Test
    fun `磁盘不足 → retry 且置 DISK_FULL`() = runTest {
        val w = worker(ensure = { _, _, _ -> Result.failure(ImageMirrorStore.DiskFullException()) })
        assertEquals(ListenableWorker.Result.retry(), w.doWork())
        assertEquals(MirrorSyncMonitor.MirrorSyncError.DISK_FULL, monitor.state.value.error)
    }

    @Test
    fun `陈旧任务（serverId 非激活）→ 直接 success 不跑`() = runTest {
        var called = false
        val w = worker(ensure = { _, _, _ -> called = true; Result.success(File("x")) }, activeId = 2L)
        assertEquals(ListenableWorker.Result.success(), w.doWork())
        assertEquals(false, called)
    }

    @Test
    fun `缺失集合为空 → 立即 success`() = runTest {
        db.imageFileDao().let { dao ->
            (1L..8L).forEach {
                dao.upsert(com.bluskysoftware.yandegallery.data.db.ImageFileEntity(1, it, "HQ", "s1/i$it/a.jpg", 1, 0))
            }
        }
        var called = false
        val w = worker(ensure = { _, _, _ -> called = true; Result.success(File("x")) })
        assertEquals(ListenableWorker.Result.success(), w.doWork())
        assertEquals(false, called)
    }
}
