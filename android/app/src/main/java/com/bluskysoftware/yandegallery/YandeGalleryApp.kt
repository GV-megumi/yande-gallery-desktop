package com.bluskysoftware.yandegallery

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Configuration
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.download.AppWorkerFactory

class YandeGalleryApp : Application(), Configuration.Provider {
    lateinit var graph: AppGraph
        private set

    // WorkManager 用自定义 WorkerFactory 把 AppGraph 注入 worker（factory 本体 Task 8 填充）。
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(AppWorkerFactory(graph))
            .build()

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)

        // 进程级前后台：回前台触发一次同步并订阅事件；退后台停订阅（spec §6/§8）。
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                graph.syncScheduler.requestSync("foreground")
                graph.sseClient.start()
                graph.networkMonitor.start()
            }

            override fun onStop(owner: LifecycleOwner) {
                graph.sseClient.stop()
                graph.networkMonitor.stop()
            }
        })
    }
}
