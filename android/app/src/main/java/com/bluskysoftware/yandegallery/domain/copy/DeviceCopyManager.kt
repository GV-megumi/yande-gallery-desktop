package com.bluskysoftware.yandegallery.domain.copy

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.device.EXPORT_BATCH
import java.util.concurrent.TimeUnit

/**
 * 手机→手机批量复制入队（本机相册 spec §5.3，v0.8.1 B 类）。
 *
 * 唯一工作名 `device-copy` + APPEND_OR_REPLACE：多次复制按提交顺序排队串行（不互踩、不合并——每批
 * 的 mediaIds/targetPath 独立成 work）；前序失败链不阻塞新批（APPEND_OR_REPLACE 对失败终态链自动
 * 重开新链）。复制是纯本机 IO——**无网络约束**（对照导出侧 CONNECTED：导出可能要下原图，复制不需要）；
 * 指数退避 10s 起（对照 DeviceExportManager/DownloadManager）。>EXPORT_BATCH 自动分块多批（KEY_MEDIA_IDS
 * 走 WorkManager Data 有 10KB 硬上限）。
 *
 * [open]：仅为让 DeviceAlbumDetailViewModel 的单测（DeviceActionsTest）注入记录型替身直断
 * enqueue 入参——VM 注入具体 manager（非 graph），WorkInfo 又不暴露 inputData，无法像 PhotosViewModelTest
 * 那样经真 WorkManager 验 id/path，故留一处可覆写缝（生产实例正常构造，不受影响）。
 */
open class DeviceCopyManager(private val context: Context) {

    /**
     * 入队一批复制，返回是否成功（v0.8.1 D1 同款防御）：>EXPORT_BATCH 自动分块，逐批 runCatching
     * 收敛——WorkManager 未初始化（getInstance 抛 IllegalStateException）、Data 超 10KB 上限
     * （workDataOf→build 即抛）等入队异常收敛为该批 false；`all { }` 短路，任一批失败即整体 false
     * （调用方据此分流「复制启动失败」，不再向上炸掉调用协程或静默谎报成功）。空选中 → 无批次 → true。
     */
    open fun enqueue(mediaIds: List<Long>, targetPath: String): Boolean =
        mediaIds.chunked(EXPORT_BATCH).all { batch -> enqueueBatch(batch, targetPath) }

    private fun enqueueBatch(batch: List<Long>, targetPath: String): Boolean = runCatching {
        val req = OneTimeWorkRequestBuilder<DeviceCopyWorker>()
            .setInputData(
                workDataOf(
                    DeviceCopyWorker.KEY_MEDIA_IDS to batch.toLongArray(),
                    DeviceCopyWorker.KEY_TARGET_PATH to targetPath,
                ),
            )
            // 无 setConstraints：纯本机 IO 不依赖网络
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(UNIQUE_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, req)
    }.isSuccess

    companion object {
        private const val UNIQUE_NAME = "device-copy"
    }
}
