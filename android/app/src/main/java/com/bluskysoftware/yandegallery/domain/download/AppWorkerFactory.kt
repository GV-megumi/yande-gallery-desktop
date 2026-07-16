package com.bluskysoftware.yandegallery.domain.download

import android.content.Context
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import com.bluskysoftware.yandegallery.data.mirror.mirrorTierOf
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.export.AndroidDeviceExportNotifier
import com.bluskysoftware.yandegallery.domain.export.DeviceExportWorker
import com.bluskysoftware.yandegallery.domain.mirror.MirrorSyncWorker
import kotlinx.coroutines.flow.first

/**
 * 自定义 WorkerFactory：把 AppGraph 注入 worker（默认初始化器已在 T1 移除，本工厂是生产环境
 * 构造 DownloadWorker 的唯一途径）。识别不了的 worker 返回 null 让默认 factory 兜底。
 */
class AppWorkerFactory(private val graph: AppGraph) : WorkerFactory() {
    override fun createWorker(
        appContext: Context,
        workerClassName: String,
        workerParameters: WorkerParameters,
    ): ListenableWorker? =
        if (workerClassName == DownloadWorker::class.java.name) {
            DownloadWorker(
                appContext,
                workerParameters,
                ensureOriginal = { serverId, imageId ->
                    graph.imageMirrorStore.ensure(serverId, imageId, MirrorTier.ORIGINAL)
                },
                notifier = AndroidDownloadNotifier(appContext),   // 前台下载通知（M4-D8）
                activeServerId = { graph.serverRepository.activeServer()?.id },
            )
        } else if (workerClassName == MirrorSyncWorker::class.java.name) {
            MirrorSyncWorker(
                appContext,
                workerParameters,
                ensure = { serverId, imageId, tier -> graph.imageMirrorStore.ensure(serverId, imageId, tier) },
                imageFileDao = graph.db.imageFileDao(),
                saveMode = { mirrorTierOf(graph.prefsStore.imageSaveModeName.first()) },
                activeServerId = { graph.serverRepository.activeServer()?.id },
                monitor = graph.mirrorSyncMonitor,
                notifier = AndroidMirrorSyncNotifier(appContext),
            )
        } else if (workerClassName == DeviceExportWorker::class.java.name) {
            DeviceExportWorker(
                appContext,
                workerParameters,
                // ORIGINAL 档位在此柯里化烘焙（spec §6.1 导出即升原图档），worker 不感知 tier
                ensureOriginal = { serverId, imageId ->
                    graph.imageMirrorStore.ensure(serverId, imageId, MirrorTier.ORIGINAL)
                },
                insertCopy = graph.deviceMediaGateway::insertCopy,
                findCopy = graph.deviceMediaGateway::findCopy,
                activeServerId = { graph.serverRepository.activeServer()?.id },
                notifier = AndroidDeviceExportNotifier(appContext),
            )
        } else {
            null
        }
}
