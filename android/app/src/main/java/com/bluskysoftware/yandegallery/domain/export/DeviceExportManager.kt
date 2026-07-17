package com.bluskysoftware.yandegallery.domain.export

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.util.concurrent.TimeUnit

/**
 * 桌面→手机导出入队 + 状态观察（本机相册 spec §6.1）。
 *
 * 唯一工作名 `device-export-$serverId` + APPEND_OR_REPLACE：同服多次导出按提交顺序排队串行
 * （不互踩、不合并——每批的 imageIds/targetPath 独立成 work）；前序失败链不阻塞新批
 * （APPEND_OR_REPLACE 对失败终态链自动重开新链，这正是与 APPEND 的差别）。serverId 入名
 * 对照 DownloadManager 先例：切服后新批不受旧服队列牵连。
 * Constraints CONNECTED（ensure 可能要下原图）；指数退避 10s 起（对照 DownloadManager）。
 */
class DeviceExportManager(private val context: Context) {

    fun enqueue(serverId: Long, imageIds: List<Long>, targetPath: String) {
        val req = OneTimeWorkRequestBuilder<DeviceExportWorker>()
            .setInputData(
                workDataOf(
                    DeviceExportWorker.KEY_SERVER_ID to serverId,
                    DeviceExportWorker.KEY_IMAGE_IDS to imageIds.toLongArray(),
                    DeviceExportWorker.KEY_TARGET_PATH to targetPath,
                ),
            )
            .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(uniqueName(serverId), ExistingWorkPolicy.APPEND_OR_REPLACE, req)
    }

    /**
     * 队首（最早入队仍未终态）work 的状态；空链 null。
     * 预留观察接口，当前无 UI 消费者（终审 N1 裁定保留）——后续 picker 流程可据此显示「导出中」。
     */
    fun observeState(serverId: Long): Flow<WorkInfo.State?> =
        WorkManager.getInstance(context)
            .getWorkInfosForUniqueWorkFlow(uniqueName(serverId))
            .map { infos -> infos.firstOrNull { !it.state.isFinished }?.state ?: infos.lastOrNull()?.state }

    private fun uniqueName(serverId: Long) = "device-export-$serverId"
}
