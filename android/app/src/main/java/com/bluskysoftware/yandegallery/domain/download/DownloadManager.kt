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
 * 唯一工作名 `download-$imageId` + KEEP 策略：重复点下载不会叠加多个 worker（进行中的复用）。
 * 「下载中」状态来自 WorkManager 的 WorkInfo（downloads 表无状态列，只在成功后落一行 uri）。
 */
class DownloadManager(private val context: Context) {

    fun enqueue(imageId: Long, filename: String, mime: String) {
        val req = OneTimeWorkRequestBuilder<DownloadWorker>()
            .setInputData(
                workDataOf(
                    DownloadWorker.KEY_IMAGE_ID to imageId,
                    DownloadWorker.KEY_FILENAME to filename,
                    DownloadWorker.KEY_MIME to mime,
                ),
            )
            .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork("download-$imageId", ExistingWorkPolicy.KEEP, req)
    }

    fun observeState(imageId: Long): Flow<WorkInfo.State?> =
        WorkManager.getInstance(context)
            .getWorkInfosForUniqueWorkFlow("download-$imageId")
            .map { it.firstOrNull()?.state }
}
