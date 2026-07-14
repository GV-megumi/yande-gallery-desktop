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
import com.bluskysoftware.yandegallery.data.db.buildTimelineQuery
import com.bluskysoftware.yandegallery.data.mirror.mirrorTierOf
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnState
import com.bluskysoftware.yandegallery.domain.download.ShareCoordinator
import com.bluskysoftware.yandegallery.domain.sync.SyncPhase
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.SelectionActions
import com.bluskysoftware.yandegallery.ui.common.SelectionState
import java.time.LocalDate
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

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

    /**
     * 时间轴密度档位（D1 四档）：内存态为准、DataStore 只作持久化介质（BUG-18）——原实现读写都
     * 走 DataStore 回环，setDensityTier 后 `.value` 数十 ms 内仍是旧档：快速连续两次独立捏合，
     * 第二次 onGestureStart 用旧档播种会丢档；换列也恒落后手势一截。现在写入同步更新内存态
     * （手势/网格立即见效），异步落盘；冷启动回填一次记忆档（compareAndSet 防手快用户被回冲）。
     */
    private val _densityTier = MutableStateFlow(DensityTier.DEFAULT)
    val densityTier: StateFlow<DensityTier> = _densityTier.asStateFlow()

    init {
        viewModelScope.launch {
            val persisted = DensityTier.fromName(graph.prefsStore.densityTierName.first())
            // 回填仅在用户尚未切档时生效；已抢先捏合则以用户操作为准
            _densityTier.compareAndSet(DensityTier.DEFAULT, persisted)
        }
    }

    /** 切档（捏合手势/未来设置入口共用）：内存态即时生效，DataStore 异步持久化（跨进程记忆）。 */
    fun setDensityTier(tier: DensityTier) {
        _densityTier.value = tier
        viewModelScope.launch { graph.prefsStore.setDensityTierName(tier.name) }
    }

    /** 照片排序（v0.6 spec §3）：共享 ViewPrefs——Viewer 同源保证网格与翻页同序（§3.4）。 */
    val photoSort: StateFlow<PhotoSort> = graph.viewPrefs.photoSort

    fun setPhotoSort(sort: PhotoSort) = graph.viewPrefs.setPhotoSort(sort)

    /**
     * 时间轴分页流（M4-T2 重构 + v0.6 排序变体）：「时间排序下的月↔日分组粒度」或「排序」变化经
     * flatMapLatest 重建（丢滚动位置——排序切换由 Screen 回顶，月日切换由 T3 锚定回原日期）；
     * 纯列数变化不重建。平铺模式（spec §3.2）：非时间排序不插分组头，网格纯照片流——分组键折算
     * 恒 false（monthly && isTime），MONTH 档退化为纯 6 列，月↔日切档等同纯列数变化：不重建
     * Pager、滚动位置天然保留（D2 不变式）；切回时间排序时 sort 变化本身携带正确分组粒度重建。
     */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val pagingFlow: Flow<PagingData<TimelineItem>> =
        combine(
            densityTier.map { it.monthGrouping }.distinctUntilChanged(),
            graph.viewPrefs.photoSort,
        ) { monthly, sort -> (monthly && sort.isTime) to sort }
            .distinctUntilChanged()
            .flatMapLatest { (monthly, sort) ->
                Pager(PagingConfig(pageSize = 120, enablePlaceholders = false)) {
                    graph.db.imageDao().timelinePagingSource(buildTimelineQuery(sort))
                }.flow
                    .map { data -> data.map<ImageEntity, TimelineItem> { TimelineItem.Photo(it) } }
                    .map { data ->
                        if (!sort.isTime) return@map data   // 平铺：无日期分组语义
                        data.insertSeparators { before, after ->
                            timelineSeparatorBetween(before, after, monthly, LocalDate.now())
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

    /** 相册列表（「加入相册」picker），按名升序。 */
    val galleries: Flow<List<GalleryEntity>> = graph.db.galleryDao().observeAll()

    private val actions = SelectionActions(
        db = graph.db,
        writeRepository = writeRepository,
        activeServerId = { graph.serverRepository.activeServer()?.id },
        localFile = { id ->
            graph.serverRepository.activeServer()?.id
                ?.let { sid -> graph.imageMirrorStore.localFile(sid, id)?.file }
        },
        ensureTier = { id, tier ->
            graph.serverRepository.activeServer()?.id
                ?.let { sid -> graph.imageMirrorStore.ensure(sid, id, tier) }
                ?: Result.failure(IllegalStateException("无激活服务器"))
        },
        saveMode = { mirrorTierOf(graph.prefsStore.imageSaveModeName.first()) },
        online = { graph.connectionMonitor.state.value.online },
        enqueueOriginal = { serverId, img -> graph.downloadManager.enqueue(serverId, img.id, img.filename) },
    )

    /** 批量下载：viewModelScope 入队（离开页面不中断）；T8 唯一工作名 KEEP 去重。 */
    fun downloadSelected(ids: List<Long>) {
        viewModelScope.launch { actions.downloadAll(ids) }
    }

    /** 批量分享（spec §4.4）：镜像四级规则，返回成败分拆的 ShareOutcome（files 为镜像文件）。 */
    suspend fun ensureShareFiles(ids: List<Long>): ShareCoordinator.ShareOutcome = actions.ensureShareFiles(ids)

    /** 批量删除（batch 端点）；镜像文件级联由对账链路收口（RoomMirrorStore.deleteImages）。 */
    suspend fun batchDeleteSelected(ids: List<Long>): WriteResult = actions.batchDelete(ids)

    /** 选中项是否含本机原图（删除确认文案分支依据，D12A；镜像层改查 image_files）。 */
    suspend fun anyDownloaded(ids: List<Long>): Boolean = actions.anyDownloaded(ids)

    /** 批量加入相册。 */
    suspend fun addSelectedToGallery(galleryId: Long, ids: List<Long>): WriteResult =
        actions.addToGallery(galleryId, ids)

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { PhotosViewModel(graph) }
        }
    }
}
