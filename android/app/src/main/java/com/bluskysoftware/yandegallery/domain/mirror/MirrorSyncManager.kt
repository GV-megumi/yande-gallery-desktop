package com.bluskysoftware.yandegallery.domain.mirror

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/**
 * 镜像同步入队（spec §3.4）：唯一工作名 `mirror-sync-{serverId}` KEEP 合并（设置切换 REPLACE）；
 * 约束默认仅 WiFi（UNMETERED），「允许移动网络同步」开启降为 CONNECTED；指数退避 30s 起。
 */
class MirrorSyncManager(private val context: Context) {

    fun requestSync(serverId: Long, allowCellular: Boolean, replace: Boolean = false) {
        val req = OneTimeWorkRequestBuilder<MirrorSyncWorker>()
            .setInputData(workDataOf(MirrorSyncWorker.KEY_SERVER_ID to serverId))
            .setConstraints(
                Constraints(requiredNetworkType = if (allowCellular) NetworkType.CONNECTED else NetworkType.UNMETERED),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "mirror-sync-$serverId",
            if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
            req,
        )
    }

    /** 切服时取消旧服工作（spec §6 跨切服拦截的调度侧）。 */
    fun cancel(serverId: Long) {
        WorkManager.getInstance(context).cancelUniqueWork("mirror-sync-$serverId")
    }
}
