package com.bluskysoftware.yandegallery.domain.download

import android.content.Context
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import com.bluskysoftware.yandegallery.di.AppGraph

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
                apiProvider = { graph.api() },
                gateway = graph.mediaStoreGateway,
                downloadDao = graph.db.downloadDao(),
                // 二进制 404 对账由 graph.okHttp 错误映射拦截器统一触发，worker 不再重复 nudge（BUG-13）
                now = { java.time.Instant.now().toString() },
                activeServerId = { graph.serverRepository.activeServer()?.id },   // 落行前校验（M4-T9 切服竞态）
                notifier = AndroidDownloadNotifier(appContext),   // 前台下载通知（M4-D8）
            )
        } else {
            null
        }
}
