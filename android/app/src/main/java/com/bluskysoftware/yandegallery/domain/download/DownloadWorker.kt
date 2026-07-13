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
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val serverId = inputData.getLong(KEY_SERVER_ID, -1L)
        val imageId = inputData.getLong(KEY_IMAGE_ID, -1L)
        val filename = inputData.getString(KEY_FILENAME) ?: "$imageId"
        if (serverId <= 0 || imageId <= 0) return Result.failure()

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
            else -> Result.retry()
        }
    }

    companion object {
        const val KEY_SERVER_ID = "serverId"
        const val KEY_IMAGE_ID = "imageId"
        const val KEY_FILENAME = "filename"
    }
}
