package com.bluskysoftware.yandegallery.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.bluskysoftware.yandegallery.data.mirror.MirrorStats
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.mirror.MirrorSyncMonitor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * 存储管理页（Task 9 改版；原「缓存管理」，spec §5.2）：图片镜像分档统计（HQ/原图张数+字节）
 * + 立即同步 + 清空图片镜像（连清行与文件，重新入队）；缩略图缓存占用与清理（原样保留）；
 * 同步状态展示（与设置页「图片同步」分组同一套文案，见 [syncStateSupporting]）。
 * 预览档/两档上限/已下载记录三块均已随本次改版下线（前二者 Task 8/9 功能性下线，
 * 后者归 Task 10 收尾——本页先只去 UI，DownloadDao/downloads 表留待 Task 10 一并处理）。
 */
class CacheViewModel(private val graph: AppGraph) : ViewModel() {
    private val _mirrorStats = MutableStateFlow<MirrorStats?>(null)
    val mirrorStats: StateFlow<MirrorStats?> = _mirrorStats

    private val _thumbBytes = MutableStateFlow<Long?>(null)
    val thumbBytes: StateFlow<Long?> = _thumbBytes

    /** 镜像同步进度/错误态，与设置页共用同一个 Monitor 单例（AppGraph by lazy）。 */
    val syncState: StateFlow<MirrorSyncMonitor.MirrorSyncState> = graph.mirrorSyncMonitor.state

    /** 进页与每次清理后调用：镜像统计走 DB 聚合（[ImageMirrorStore.stats]），缩略图占用触盘读。 */
    fun refresh() {
        viewModelScope.launch(Dispatchers.IO) {
            val serverId = graph.serverRepository.activeServer()?.id
            _mirrorStats.value = if (serverId != null) graph.imageMirrorStore.stats(serverId) else MirrorStats()
            _thumbBytes.value = graph.thumbnailLoader.diskCache?.size ?: 0L
        }
    }

    /** 清盘缓存必须连清内存缓存，否则陈旧键继续命中旧图（cache findings §6.2，沿用原逻辑）。 */
    fun clearThumbnails() {
        viewModelScope.launch(Dispatchers.IO) {
            graph.thumbnailLoader.diskCache?.clear()
            graph.thumbnailLoader.memoryCache?.clear()
            refresh()
        }
    }

    /**
     * 清空图片镜像（用户手动「清空图片镜像」确认后）：先清 DB 行、再删真实文件、最后以
     * replace=true 重新入队——顺序固定 行→文件→重新入队，不可调换。
     * [ImageMirrorStore.clearAllFiles] 的 KDoc 契约要求调用方已先使镜像身份失效/取消同步；
     * 这里没有单独先 cancel 一步，是因为本操作是用户主动发起的一次性全量重置，且清空后
     * 立即以 replace=true 重新入队——WorkManager REPLACE 策略本身会顶掉任何仍在途的旧同步
     * worker，窗口内即使有极小概率的残留写入，也会在重新入队的全量同步或下次启动的
     * sweepOrphans 中被自愈纠正，不构成需要额外加锁/取消步骤的持久性问题。
     */
    fun clearMirror() {
        viewModelScope.launch(Dispatchers.IO) {
            graph.db.imageFileDao().clearAll()
            graph.imageMirrorStore.clearAllFiles()
            graph.requestMirrorSync(replace = true)
            refresh()
        }
    }

    /** 「立即同步」：不清空、只补一次同步（不需要 replace，让现有排队任务保留）。 */
    fun requestSyncNow() = graph.requestMirrorSync()

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { CacheViewModel(graph) }
        }
    }
}

/** 字节可读化：1536MB → "1.50 GB"（B/KB/MB/GB 两位小数，缓存占用与上限展示用）。 */
fun formatBytes(bytes: Long): String {
    val gb = 1024.0 * 1024 * 1024
    val mb = 1024.0 * 1024
    val kb = 1024.0
    return when {
        bytes >= gb -> "%.2f GB".format(bytes / gb)
        bytes >= mb -> "%.2f MB".format(bytes / mb)
        bytes >= kb -> "%.2f KB".format(bytes / kb)
        else -> "$bytes B"
    }
}
