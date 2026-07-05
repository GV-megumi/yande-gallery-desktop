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
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnState
import com.bluskysoftware.yandegallery.domain.sync.SyncPhase
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.SelectionActions
import com.bluskysoftware.yandegallery.ui.common.SelectionState
import com.bluskysoftware.yandegallery.ui.viewer.mimeOf
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class PhotosViewModel(
    private val graph: AppGraph,
    writeRepository: WriteRepository = graph.writeRepository,  // 测试注入缝（镜像 ViewerViewModel gateway 模式）
) : ViewModel() {

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

    // ---- Task 13 多选：VM 持有选择状态 + 批量动作（Screen 不直接触 graph） ----

    /** 多选状态：Screen 订阅 selectedFlow 驱动角标/选择栏；长按/点击经 toggle 收敛到这里。 */
    val selection = SelectionState()

    init {
        // 切服清空选择：本 VM 随照片 tab 长活，切服后镜像全量重建，旧选中 id 可能撞上新服务器
        // 同号图片造成误删/误加；按激活服务器 id 去抖（drop(1) 跳过首个当前值，冷启动不清）。
        // AlbumDetail 的 VM 随返回出栈销毁，无此问题。
        viewModelScope.launch {
            graph.serverRepository.observeActive()
                .map { it?.id }
                .distinctUntilChanged()
                .drop(1)
                .collect { selection.clear() }
        }
    }

    /** 图集列表（「加入图集」picker），按名升序。 */
    val galleries: Flow<List<GalleryEntity>> = graph.db.galleryDao().observeAll()

    private val actions = SelectionActions(
        db = graph.db,
        writeRepository = writeRepository,
        enqueueDownload = { img -> graph.downloadManager.enqueue(img.id, img.filename, mimeOf(img.format)) },
    )

    /** 批量下载：viewModelScope 入队（离开页面不中断）；T8 唯一工作名 KEEP 去重。 */
    fun downloadSelected(ids: List<Long>) {
        viewModelScope.launch { actions.downloadAll(ids) }
    }

    /** 批量分享 URI：全部已下载 → uri 列表；含未下载 → null（Screen 提示先下载，brief 简化）。 */
    suspend fun shareUrisFor(ids: List<Long>): List<String>? = actions.shareUrisFor(ids)

    /** 批量删除（batch 端点 + 清确实已删 id 的下载映射行；本地系统相册副本不级联，controller 裁定）。 */
    suspend fun batchDeleteSelected(ids: List<Long>): WriteResult = actions.batchDelete(ids)

    /** 批量加入图集。 */
    suspend fun addSelectedToGallery(galleryId: Long, ids: List<Long>): WriteResult =
        actions.addToGallery(galleryId, ids)

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { PhotosViewModel(graph) }
        }
    }
}
