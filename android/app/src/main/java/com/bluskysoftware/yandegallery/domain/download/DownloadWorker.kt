package com.bluskysoftware.yandegallery.domain.download

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore
import kotlinx.coroutines.CancellationException

/**
 * 原图下载 worker（镜像版，spec §4.3）：语义从「写系统相册」改为「获取原图到本机镜像」。
 * 全部落盘细节（流式下载、Content-Length 校验、part 原子改名、同目录删 HQ、跨切服拦截、
 * image_files 升 ORIGINAL）收敛在 [ImageMirrorStore.ensure]——worker 只保留 WorkManager 外壳
 * （可靠性/退避/前台通知）与结果分流。MediaStore 链路整体退役（需求 5：原图不再进相册）。
 */
class DownloadWorker(
    context: Context,
    params: WorkerParameters,
    // 显式 kotlin.Result：本类继承 CoroutineWorker，裸 Result 在类作用域内解析为继承来的
    // androidx.work.ListenableWorker.Result（非泛型），必须全限定名避免歧义（对照 MirrorSyncWorker 用法）
    private val ensureOriginal: suspend (serverId: Long, imageId: Long) -> kotlin.Result<java.io.File>,
    private val notifier: DownloadNotifier,
    // 陈旧任务判定（对齐 MirrorSyncWorker 先例）：切服后残留的旧队列项不应对新服务器生效。
    private val activeServerId: suspend () -> Long?,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val serverId = inputData.getLong(KEY_SERVER_ID, -1L)
        val imageId = inputData.getLong(KEY_IMAGE_ID, -1L)
        val filename = inputData.getString(KEY_FILENAME) ?: "$imageId"
        if (serverId <= 0 || imageId <= 0) return Result.failure()
        // 陈旧任务（切服后残留队列）直接完结，不再对新服务器重试：否则 ensure 抛出的
        // 「服务器已切换」IllegalStateException 会走到下面的失败分支，但 WorkManager
        // 持久化跨重启，旧任务在切回原服务器前会反复入队消耗资源（Important #2）。
        if (activeServerId() != serverId) return Result.success()

        // 前台通知（大文件下载可视化）：33+ 未授权/31+ 后台 FGS 限制 runCatching 降级纯后台，
        // 唯 CancellationException 重抛（不吞取消，对齐仓内惯例）。镜像层无逐字节进度回调，
        // 通知为 indeterminate（total=-1）——逐图体感时长短，聚合进度由 MirrorSyncNotifier 承担。
        runCatching {
            notifier.ensureChannel()
            setForeground(notifier.foregroundInfo(imageId, filename, 0, -1))
        }.onFailure { if (it is CancellationException) throw it }

        val result = ensureOriginal(serverId, imageId)
        return when {
            result.isSuccess -> Result.success()
            (result.exceptionOrNull() as? ApiException)?.httpStatus == 404 -> Result.failure()
            result.exceptionOrNull() is ImageMirrorStore.DiskFullException -> Result.retry()
            // 无激活服务器 / 元数据缺失 / 落盘前中途切服（ImageMirrorStore.ensure 三处
            // IllegalStateException）均为重试无法自愈的终态：重试只会在下次切服前反复复现。
            result.exceptionOrNull() is IllegalStateException -> Result.failure()
            else -> Result.retry()
        }
    }

    companion object {
        const val KEY_SERVER_ID = "serverId"
        const val KEY_IMAGE_ID = "imageId"
        const val KEY_FILENAME = "filename"
    }
}
