package com.bluskysoftware.yandegallery.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.bluskysoftware.yandegallery.data.db.DownloadWithMeta
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * 缓存管理（spec §6.4 / D7）：两档盘缓存占用展示 + 分别清理（连清内存）+ 上限可调（下次启动生效）
 * + 已下载记录列表与清空（只清应用内记录，系统相册文件保留）。所有触盘操作均走 Dispatchers.IO。
 */
class CacheViewModel(private val graph: AppGraph) : ViewModel() {

    data class CacheStats(val thumbBytes: Long, val thumbMax: Long, val previewBytes: Long, val previewMax: Long)

    private val _stats = MutableStateFlow<CacheStats?>(null)
    val stats: StateFlow<CacheStats?> = _stats

    val downloads: Flow<List<DownloadWithMeta>> = graph.db.downloadDao().observeDownloadedWithMeta()
    val thumbLimitBytes: Flow<Long> = graph.prefsStore.thumbnailCacheMaxBytes
    val previewLimitBytes: Flow<Long> = graph.prefsStore.previewCacheMaxBytes

    /** DiskCache.size 为同步属性读，仍放 IO（触盘统计，D7）；进页与每次清理后调用。 */
    fun refresh() {
        viewModelScope.launch(Dispatchers.IO) {
            _stats.value = CacheStats(
                thumbBytes = graph.thumbnailLoader.diskCache?.size ?: 0L,
                thumbMax = graph.thumbnailLoader.diskCache?.maxSize ?: 0L,
                previewBytes = graph.previewLoader.diskCache?.size ?: 0L,
                previewMax = graph.previewLoader.diskCache?.maxSize ?: 0L,
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

    fun clearPreviews() {
        viewModelScope.launch(Dispatchers.IO) {
            graph.previewLoader.diskCache?.clear()
            graph.previewLoader.memoryCache?.clear()
            refresh()
        }
    }

    /** 只清应用内 downloads 记录；系统相册文件保留（UI 文案已明示）。 */
    fun clearDownloadRecords() {
        viewModelScope.launch(Dispatchers.IO) { graph.db.downloadDao().clearAll() }
    }

    fun setThumbLimitBytes(bytes: Long) { viewModelScope.launch { graph.prefsStore.setThumbnailCacheMaxBytes(bytes) } }
    fun setPreviewLimitBytes(bytes: Long) { viewModelScope.launch { graph.prefsStore.setPreviewCacheMaxBytes(bytes) } }

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
