package com.bluskysoftware.yandegallery.ui.photos

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import androidx.paging.insertSeparators
import androidx.paging.map
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnState
import com.bluskysoftware.yandegallery.domain.sync.SyncPhase
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

class PhotosViewModel(private val graph: AppGraph) : ViewModel() {

    /** 缩略图专用 loader（Task 9），照片格子直接消费。 */
    val thumbnailLoader: ImageLoader get() = graph.thumbnailLoader

    /** 当前激活服务器：null → 引导态；非 null 提供 baseUrl 拼缩略图 URL。 */
    val activeServer: StateFlow<ServerEntity?> =
        graph.serverRepository.observeActive()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** 首同步/增量进度直通同步引擎（Task 7）。 */
    val syncPhase: StateFlow<SyncPhase> = graph.syncEngine.progress

    /** 连接状态：驱动顶部横幅（offline/unauthorized）。 */
    val connState: StateFlow<ConnState> = graph.connectionMonitor.state

    /** 全量重建提示：dataVersion/serverId 变化时发一次，PhotosScreen 弹 Snackbar。 */
    val rebuildNotices: SharedFlow<Unit> = graph.syncScheduler.rebuildNotices

    /**
     * 时间轴分页流：Pager → map 成 Photo → 按本地时区日界 insertSeparators 插 Header → cachedIn。
     * insertSeparators 仅在相邻两张照片跨日（含列表首张，before==null）时插入分组头。
     */
    val pagingFlow: Flow<PagingData<TimelineItem>> =
        Pager(PagingConfig(pageSize = 120, enablePlaceholders = false)) {
            graph.db.imageDao().timelinePagingSource()
        }.flow
            .map { data -> data.map<ImageEntity, TimelineItem> { TimelineItem.Photo(it) } }
            .map { data ->
                data.insertSeparators { before, after ->
                    val afterPhoto = after as? TimelineItem.Photo ?: return@insertSeparators null
                    val afterKey = dayKeyOf(afterPhoto.image.createdAt)
                    val beforeKey = (before as? TimelineItem.Photo)?.let { dayKeyOf(it.image.createdAt) }
                    if (beforeKey != afterKey) TimelineItem.Header(afterKey, dayDisplayOf(afterKey)) else null
                }
            }
            .cachedIn(viewModelScope)

    /** 手动下拉刷新：走调度器合并请求（与前台/SSE/二进制404 互斥，失败静默上报横幅）。 */
    fun refresh() {
        graph.syncScheduler.requestSync("pull-refresh")
    }

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { PhotosViewModel(graph) }
        }
    }
}
