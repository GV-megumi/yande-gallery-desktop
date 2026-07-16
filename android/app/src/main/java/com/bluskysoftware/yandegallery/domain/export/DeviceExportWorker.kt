package com.bluskysoftware.yandegallery.domain.export

import android.content.Context
import android.net.Uri
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.device.DeviceSource
import com.bluskysoftware.yandegallery.data.device.mimeOf
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore
import com.bluskysoftware.yandegallery.domain.download.shouldUpdateNotification
import kotlinx.coroutines.CancellationException
import java.io.File

/**
 * 桌面→手机导出 worker（本机相册 spec §6.1）：逐张（串行）`ensureOriginal` 把原图收进镜像
 * （同 D7 语义：导出即升原图档，镜像层落盘/校验/删 HQ 全在 ImageMirrorStore.ensure 内）→
 * `insertCopy(LocalFile)` 复制落 MediaStore 目标相册。分流：
 * - 单张 ensure 404（原图已在桌面删除）或 insertCopy 失败 → 该张计入失败继续下一张；
 * - 磁盘不足 → 整批 [Result.retry]（指数退避，等清理出空间后续跑）；
 * - 陈旧任务（activeServerId != 入参 serverId，切服后残留队列）→ [Result.success] 直接丢弃，
 *   每张开工前复查——已落地的照片是用户手机相册的真实文件，保留不回滚；
 * - 正常结束 → outputData [KEY_FAILED_COUNT] 报失败张数（Task 11 UI 据此提示）。
 */
class DeviceExportWorker(
    context: Context,
    params: WorkerParameters,
    // 显式 kotlin.Result：本类继承 CoroutineWorker，裸 Result 在类作用域内解析为继承来的
    // androidx.work.ListenableWorker.Result（非泛型），必须全限定名避免歧义（对照 DownloadWorker 用法）。
    // ORIGINAL 档位在 AppWorkerFactory 柯里化时烘焙，worker 不感知 tier。
    private val ensureOriginal: suspend (serverId: Long, imageId: Long) -> kotlin.Result<File>,
    // 生产接 graph.deviceMediaGateway::insertCopy（方法引用），测试注 fake 记录入参
    private val insertCopy: suspend (source: DeviceSource, targetRelativePath: String) -> kotlin.Result<Uri>,
    // 陈旧任务判定（对齐 DownloadWorker/MirrorSyncWorker 先例）：切服后残留的旧队列项不应再动手
    private val activeServerId: suspend () -> Long?,
    private val notifier: DeviceExportNotifier,
    private val timeMs: () -> Long = { System.currentTimeMillis() },
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val serverId = inputData.getLong(KEY_SERVER_ID, -1L)
        val imageIds = inputData.getLongArray(KEY_IMAGE_IDS)
        val targetPath = inputData.getString(KEY_TARGET_PATH)
        if (serverId <= 0 || imageIds == null || targetPath.isNullOrBlank()) return Result.failure()
        if (activeServerId() != serverId) return Result.success()

        val total = imageIds.size
        // 前台通知：33+ 未授权/31+ 后台 FGS 限制 runCatching 降级纯后台，唯 CancellationException
        // 重抛（不吞取消，仓内惯例）；确定进度 0/total 起步
        runCatching {
            notifier.ensureChannel()
            setForeground(notifier.foregroundInfo(0, total, targetPath))
        }.onFailure { if (it is CancellationException) throw it }

        var done = 0          // 已处理张数（含失败）——进度展示口径
        var failed = 0
        var lastNotifyMs = 0L
        var lastPct = -1
        for (imageId in imageIds) {
            // 每张开工前复查切服：长批次中途切服即丢弃剩余（已插入的照片保留），
            // 不留给 ensure 内部 IllegalStateException 去逐张膨胀失败计数
            if (activeServerId() != serverId) return Result.success()

            val ensured = ensureOriginal(serverId, imageId)
            when {
                ensured.isSuccess -> {
                    val file = ensured.getOrThrow()
                    // mimeOf 按实际文件扩展名（镜像原图档保留源扩展名，不做转码改名）
                    val source = DeviceSource.LocalFile(file, file.name, mimeOf(file.extension))
                    if (insertCopy(source, targetPath).isFailure) failed++
                }
                ensured.exceptionOrNull() is ImageMirrorStore.DiskFullException ->
                    // 磁盘满是整批性障碍：立即退避重试（已入镜像的张重试时 ensure 直接命中缓存）
                    return Result.retry()
                // 404（原图已删）/网络中断/元数据缺失等：该张计失败继续——批量导出不因个别
                // 图失败而整批中止；末尾以 KEY_FAILED_COUNT 汇总（Task 11 UI 提示"N 张失败"）
                else -> failed++
            }
            done++
            val pct = if (total > 0) (done * 100) / total else -1
            // 节流复用下载域 shouldUpdateNotification（≥1s 或进度跳 ≥5%）；setForeground 可能抛
            // 非取消异常（33+ 未授权通知），runCatching 降级避免异常中断剩余批次
            if (shouldUpdateNotification(lastNotifyMs, timeMs(), lastPct, pct)) {
                lastNotifyMs = timeMs()
                lastPct = pct
                runCatching { setForeground(notifier.foregroundInfo(done, total, targetPath)) }
                    .onFailure { if (it is CancellationException) throw it }
            }
        }
        return Result.success(workDataOf(KEY_FAILED_COUNT to failed))
    }

    companion object {
        const val KEY_SERVER_ID = "serverId"
        const val KEY_IMAGE_IDS = "imageIds"
        const val KEY_TARGET_PATH = "targetPath"
        const val KEY_FAILED_COUNT = "failedCount"
    }
}
