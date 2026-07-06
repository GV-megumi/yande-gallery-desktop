package com.bluskysoftware.yandegallery.ui.photos

import android.app.PendingIntent
import android.net.Uri
import androidx.core.net.toUri
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
import com.bluskysoftware.yandegallery.data.media.DeleteOwnedResult
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnState
import com.bluskysoftware.yandegallery.domain.download.ShareCoordinator
import com.bluskysoftware.yandegallery.domain.sync.SyncPhase
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.SelectionActions
import com.bluskysoftware.yandegallery.ui.common.SelectionState
import com.bluskysoftware.yandegallery.ui.common.mimeOf
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 下拉刷新转圈判据（A8，M4-T15 从 PhotosScreen 私有函数迁入 VM 逻辑并 internal 化以便直测）：
 * 增量/对账阶段无数字进度，用转圈；首同步 FullSync 另有顶部 LinearProgressIndicator 显示 done/total，
 * 不叠加转圈避免双指示器。
 */
internal fun SyncPhase.showsRefreshSpinner(): Boolean =
    this is SyncPhase.Incremental || this is SyncPhase.Reconciling

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

    /** 首帧引导态门控（A7）：DB 首次发射前不显「还没有连接服务器」引导，避免已配对用户冷启动闪帧。 */
    val activeServerResolved: StateFlow<Boolean> =
        graph.serverRepository.observeActive().map { true }
            .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    /** 首同步/增量进度直通同步引擎（Task 7）。 */
    val syncPhase: StateFlow<SyncPhase> = graph.syncEngine.progress

    /** 下拉刷新转圈布尔（A8 隔离）：Screen 顶层只收集布尔，FullSync 每 tick 不再重组全屏。 */
    val refreshing: StateFlow<Boolean> = graph.syncEngine.progress
        .map { it.showsRefreshSpinner() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    /** 连接状态：驱动顶部横幅（offline/unauthorized）。 */
    val connState: StateFlow<ConnState> = graph.connectionMonitor.state

    /** 全量重建提示：dataVersion/serverId 变化时发一次，PhotosScreen 弹 Snackbar。 */
    val rebuildNotices: SharedFlow<Unit> = graph.syncScheduler.rebuildNotices

    /** 时间轴密度档位（D1 四档）：DataStore 持久（跨进程），Eagerly 让首帧尽快用上记忆档。 */
    val densityTier: StateFlow<DensityTier> =
        graph.prefsStore.densityTierName
            .map { DensityTier.fromName(it) }
            .stateIn(viewModelScope, SharingStarted.Eagerly, DensityTier.DEFAULT)

    /** 切档（捏合手势/未来设置入口共用）：写 DataStore，UI 经 densityTier 回环更新。 */
    fun setDensityTier(tier: DensityTier) {
        viewModelScope.launch { graph.prefsStore.setDensityTierName(tier.name) }
    }

    /**
     * 时间轴分页流（M4-T2 重构）：仅「月↔日分组粒度」翻转经 flatMapLatest 重建（丢滚动位置、
     * 由 Screen 锚定回原日期——T3）；纯列数变化（日 3/4/5）不重建本流，滚动位置天然保留（D2）。
     * cachedIn 在最外层（SearchViewModel 同款拓扑）。
     */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val pagingFlow: Flow<PagingData<TimelineItem>> =
        densityTier
            .map { it.monthGrouping }
            .distinctUntilChanged()
            .flatMapLatest { monthly ->
                Pager(PagingConfig(pageSize = 120, enablePlaceholders = false)) {
                    graph.db.imageDao().timelinePagingSource()
                }.flow
                    .map { data -> data.map<ImageEntity, TimelineItem> { TimelineItem.Photo(it) } }
                    .map { data ->
                        data.insertSeparators { before, after ->
                            val afterPhoto = after as? TimelineItem.Photo ?: return@insertSeparators null
                            val afterKey = if (monthly) monthKeyOf(afterPhoto.image.createdAt) else dayKeyOf(afterPhoto.image.createdAt)
                            val beforeKey = (before as? TimelineItem.Photo)?.let {
                                if (monthly) monthKeyOf(it.image.createdAt) else dayKeyOf(it.image.createdAt)
                            }
                            if (beforeKey != afterKey) {
                                TimelineItem.Header(afterKey, if (monthly) monthDisplayOf(afterKey) else dayDisplayOf(afterKey))
                            } else null
                        }
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
        activeServerId = { graph.serverRepository.activeServer()?.id },
        enqueueDownload = { serverId, img -> graph.downloadManager.enqueue(serverId, img.id, img.filename, mimeOf(img.format)) },
        observeDownloadState = graph.downloadManager::observeState,
        gatewayExists = { graph.mediaStoreGateway.exists(it.toUri()) },
    )

    /** 批量下载：viewModelScope 入队（离开页面不中断）；T8 唯一工作名 KEEP 去重。 */
    fun downloadSelected(ids: List<Long>) {
        viewModelScope.launch { actions.downloadAll(ids) }
    }

    /** 批量分享完整流（M4-T11/D9）：缺失项入队等终态后返回成败分拆的 ShareOutcome。 */
    suspend fun ensureShareUris(ids: List<Long>): ShareCoordinator.ShareOutcome = actions.ensureShareUris(ids)

    /** 批量删除（batch 端点 + 清确实已删 id 的本服下载映射行；本机副本级联由 Screen 侧成功后处理，spec §8）。 */
    suspend fun batchDeleteSelected(ids: List<Long>): WriteResult = actions.batchDelete(ids)

    /** 批删前快照已下载 uri（batchDelete 会清行，必须先取）；无激活服务器返回空（M4-T9）。 */
    suspend fun downloadedUrisFor(ids: List<Long>): List<String> = actions.downloadedUrisFor(ids)

    /** 选中项是否含本机已下载副本（删除确认文案分支依据，D12A）。 */
    suspend fun anyDownloaded(ids: List<Long>): Boolean = actions.anyDownloaded(ids)

    /** 30+ 批量副本级联：一次系统确认弹窗（spec §8）；<30 返回 null 走 [deleteLocalCopies]。 */
    fun buildBatchDeleteRequest(uris: List<Uri>): PendingIntent? =
        graph.mediaStoreGateway.buildDeleteRequest(uris)

    /** <30 逐条直删；API29 NeedsConsent 不逐张弹窗（批量场景逐张系统确认是敌意 UX——定界），
     *  计入保留。返回 (已删, 保留) 计数。 */
    suspend fun deleteLocalCopies(uris: List<Uri>): Pair<Int, Int> = withContext(Dispatchers.IO) {
        var deleted = 0
        var kept = 0
        for (uri in uris) {
            when (graph.mediaStoreGateway.deleteOwned(uri)) {
                DeleteOwnedResult.Deleted -> deleted++
                else -> kept++   // NeedsConsent/Failed：文件保留（行已被 batchDelete 清）
            }
        }
        deleted to kept
    }

    /** 批量加入图集。 */
    suspend fun addSelectedToGallery(galleryId: Long, ids: List<Long>): WriteResult =
        actions.addToGallery(galleryId, ids)

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { PhotosViewModel(graph) }
        }
    }
}
