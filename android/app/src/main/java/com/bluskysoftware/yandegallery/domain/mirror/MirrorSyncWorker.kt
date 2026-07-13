package com.bluskysoftware.yandegallery.domain.mirror

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.db.ImageFileDao
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import com.bluskysoftware.yandegallery.domain.download.MirrorSyncNotifier
import com.bluskysoftware.yandegallery.domain.download.shouldUpdateNotification
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * 镜像增量同步 worker（spec §3.4）：每轮重算缺失集合（断点天然可续）→ 前 5 张串行探测
 * （HQ 模式全 404 且元数据在库 → 判桌面端过旧，中止本轮；下轮自动重试可自愈）→ 其余 3 路并发。
 * ensure 以函数注入（生产接 ImageMirrorStore::ensure）——测试不触网络/文件系统。
 * 404 跳过（对账会删该图行）；磁盘不足暂停（DISK_FULL + retry）；网络/IO 失败退避重试。
 */
class MirrorSyncWorker(
    context: Context,
    params: WorkerParameters,
    // 显式 kotlin.Result：本类继承 CoroutineWorker，裸 Result 在类作用域内解析为继承来的
    // androidx.work.ListenableWorker.Result（非泛型），必须全限定名避免歧义（对照 kotlin.Result.isSuccess 用法）
    private val ensure: suspend (serverId: Long, imageId: Long, tier: MirrorTier) -> kotlin.Result<File>,
    private val imageFileDao: ImageFileDao,
    private val saveMode: suspend () -> MirrorTier,
    private val activeServerId: suspend () -> Long?,
    private val monitor: MirrorSyncMonitor,
    private val notifier: MirrorSyncNotifier,
    private val timeMs: () -> Long = { System.currentTimeMillis() },
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val serverId = inputData.getLong(KEY_SERVER_ID, -1L)
        // 陈旧任务（切服后残留队列）直接完结，不触碰新服数据
        if (serverId <= 0 || activeServerId() != serverId) return Result.success()

        val tier = saveMode()
        val missing = imageFileDao.missingImageIds(serverId, needOriginal = tier == MirrorTier.ORIGINAL)
        if (missing.isEmpty()) { monitor.finish(); return Result.success() }
        val total = missing.size.toLong()
        monitor.start(total)
        runCatching {
            notifier.ensureChannel()
            setForeground(notifier.foregroundInfo(0, total))
        }.onFailure { if (it is CancellationException) throw it }   // 33+ 未授权降级纯后台

        val done = AtomicLong(0)
        val retryable = AtomicInteger(0)
        val diskFull = AtomicBoolean(false)
        var lastNotifyMs = 0L

        suspend fun step(imageId: Long): Result? {   // 非 null = 需要立刻中止的终态
            if (diskFull.get()) return null
            val r = ensure(serverId, imageId, tier)
            when {
                r.isSuccess -> done.incrementAndGet()
                r.isDiskFull() -> diskFull.set(true)
                r.is404() -> Unit   // 跳过：元数据对账会删行，下轮不再出现
                else -> retryable.incrementAndGet()
            }
            val d = done.get()
            monitor.progress(d, total)
            if (shouldUpdateNotification(lastNotifyMs, timeMs(), -1, if (total > 0) ((d * 100) / total).toInt() else -1)) {
                lastNotifyMs = timeMs()
                setProgress(workDataOf(KEY_DONE to d, KEY_TOTAL to total))
                runCatching { setForeground(notifier.foregroundInfo(d, total)) }
                    .onFailure { if (it is CancellationException) throw it }
            }
            return null
        }

        // 前 5 张串行探测（spec §3.4-4）：仅 HQ 模式判旧桌面——/file 旧桌面也有，原图模式不误伤
        val probe = missing.take(PROBE_COUNT)
        var probe404 = 0
        for (id in probe) {
            val r = ensure(serverId, id, tier)
            when {
                r.isSuccess -> done.incrementAndGet()
                r.isDiskFull() -> diskFull.set(true)
                r.is404() -> probe404++
                else -> retryable.incrementAndGet()
            }
            monitor.progress(done.get(), total)
            if (diskFull.get()) break
        }
        if (tier == MirrorTier.HQ && probe.size >= PROBE_COUNT && probe404 >= PROBE_COUNT) {
            monitor.finish(MirrorSyncMonitor.MirrorSyncError.SERVER_TOO_OLD)
            return Result.failure()
        }

        if (!diskFull.get()) {
            val semaphore = Semaphore(CONCURRENCY)
            coroutineScope {
                missing.drop(PROBE_COUNT).map { id ->
                    async { semaphore.withPermit { step(id) } }
                }.awaitAll()
            }
        }

        return when {
            diskFull.get() -> { monitor.finish(MirrorSyncMonitor.MirrorSyncError.DISK_FULL); Result.retry() }
            retryable.get() > 0 -> { monitor.finish(MirrorSyncMonitor.MirrorSyncError.NETWORK); Result.retry() }
            else -> { monitor.finish(); Result.success() }
        }
    }

    private fun kotlin.Result<File>.is404() = (exceptionOrNull() as? ApiException)?.httpStatus == 404
    private fun kotlin.Result<File>.isDiskFull() = exceptionOrNull() is ImageMirrorStore.DiskFullException

    companion object {
        const val KEY_SERVER_ID = "serverId"
        const val KEY_DONE = "done"
        const val KEY_TOTAL = "total"
        const val PROBE_COUNT = 5
        const val CONCURRENCY = 3
    }
}
