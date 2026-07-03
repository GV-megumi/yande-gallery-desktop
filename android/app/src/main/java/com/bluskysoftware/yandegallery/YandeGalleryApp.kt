package com.bluskysoftware.yandegallery

import android.app.Application
import com.bluskysoftware.yandegallery.di.AppGraph

class YandeGalleryApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
    }
}
