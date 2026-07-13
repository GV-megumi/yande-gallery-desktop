package com.bluskysoftware.yandegallery.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.bluskysoftware.yandegallery.data.db.DownloadWithMeta
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch

/**
 * 缓存管理（spec §6.4 / D7；预览档下线后只剩缩略图一档，存储页改版归 Task 9）：
 * 缩略图盘缓存占用展示 + 清理（连清内存）+ 上限可调（下次启动生效）
 * + 已下载记录列表与清空（只清应用内记录，系统相册文件保留）。所有触盘操作均走 Dispatchers.IO。
 */
class CacheViewModel(private val graph: AppGraph) : ViewModel() {

    data class CacheStats(val thumbBytes: Long, val thumbMax: Long)

    private val _stats = MutableStateFlow<CacheStats?>(null)
    val stats: StateFlow<CacheStats?> = _stats

    /** 已下载记录列表（M4-T9）：按激活 serverId 过滤——切服即换域，无激活服务器为空列表。 */
    @OptIn(ExperimentalCoroutinesApi::class)
    val downloads: Flow<List<DownloadWithMeta>> =
        graph.serverRepository.observeActive().flatMapLatest { server ->
            if (server == null) flowOf(emptyList())
            else graph.db.downloadDao().observeDownloadedWithMeta(server.id)
        }
    val thumbLimitBytes: Flow<Long> = graph.prefsStore.thumbnailCacheMaxBytes

    /** DiskCache.size 为同步属性读，仍放 IO（触盘统计，D7）；进页与每次清理后调用。 */
    fun refresh() {
        viewModelScope.launch(Dispatchers.IO) {
            _stats.value = CacheStats(
                thumbBytes = graph.thumbnailLoader.diskCache?.size ?: 0L,
                thumbMax = graph.thumbnailLoader.diskCache?.maxSize ?: 0L,
            )
        }
    }

    /** 清盘缓存必须连清内存缓存，否则陈旧键继续命中旧图（cache findings §6.2）。 */
    fun clearThumbnails() {
        viewModelScope.launch(Dispatchers.IO) {
            graph.thumbnailLoader.diskCache?.clear()
            graph.thumbnailLoader.memoryCache?.clear()
            refresh()
        }
    }

    /** 只清应用内 downloads 记录；系统相册文件保留（UI 文案已明示）。 */
    fun clearDownloadRecords() {
        viewModelScope.launch(Dispatchers.IO) { graph.db.downloadDao().clearAll() }
    }

    fun setThumbLimitBytes(bytes: Long) { viewModelScope.launch { graph.prefsStore.setThumbnailCacheMaxBytes(bytes) } }

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
