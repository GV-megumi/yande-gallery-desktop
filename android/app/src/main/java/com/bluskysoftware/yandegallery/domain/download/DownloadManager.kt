package com.bluskysoftware.yandegallery.domain.download

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
 * 原图下载入队 + 状态观察。
 *
 * 唯一工作名 `download-$serverId-$imageId` + KEEP 策略：重复点下载不会叠加多个 worker（进行中
 * 的复用）；serverId 入名（M4-T9）——切服后同号 imageId 不再被旧服的进行中任务 KEEP 抑制。
 * 「下载中」状态来自 WorkManager 的 WorkInfo（downloads 表无状态列，只在成功后落一行 uri）。
 */
class DownloadManager(private val context: Context) {

    fun enqueue(serverId: Long, imageId: Long, filename: String) {
        val req = OneTimeWorkRequestBuilder<DownloadWorker>()
            .setInputData(
                workDataOf(
                    DownloadWorker.KEY_SERVER_ID to serverId,
                    DownloadWorker.KEY_IMAGE_ID to imageId,
                    DownloadWorker.KEY_FILENAME to filename,
                ),
            )
            .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork("download-$serverId-$imageId", ExistingWorkPolicy.KEEP, req)
    }

    fun observeState(serverId: Long, imageId: Long): Flow<WorkInfo.State?> =
        WorkManager.getInstance(context)
            .getWorkInfosForUniqueWorkFlow("download-$serverId-$imageId")
            .map { it.firstOrNull()?.state }
}
