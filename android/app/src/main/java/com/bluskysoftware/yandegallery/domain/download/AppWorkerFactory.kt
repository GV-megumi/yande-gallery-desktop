package com.bluskysoftware.yandegallery.domain.download

import android.content.Context
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import com.bluskysoftware.yandegallery.di.AppGraph

/** 自定义 WorkerFactory：把 AppGraph 注入 worker（本任务仅占位，Task 8 填 createWorker 本体）。 */
class AppWorkerFactory(private val graph: AppGraph) : WorkerFactory() {
    override fun createWorker(
        appContext: Context,
        workerClassName: String,
        workerParameters: WorkerParameters,
    ): ListenableWorker? = null   // Task 8：识别 DownloadWorker 并构造，返回 null 让默认 factory 兜底
}
