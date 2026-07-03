package com.bluskysoftware.yandegallery

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.bluskysoftware.yandegallery.di.AppGraph

class YandeGalleryApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)

        // 进程级前后台：回前台触发一次同步并订阅事件；退后台停订阅（spec §6/§8）。
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                graph.syncScheduler.requestSync("foreground")
                graph.sseClient.start()
            }

            override fun onStop(owner: LifecycleOwner) {
                graph.sseClient.stop()
            }
        })
    }
}
