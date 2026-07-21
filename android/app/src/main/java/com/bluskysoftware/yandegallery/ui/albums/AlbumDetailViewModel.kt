package com.bluskysoftware.yandegallery.ui.albums

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.cachedIn
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.data.db.buildGalleryImagesQuery
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.mirror.mirrorTierOf
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnState
import com.bluskysoftware.yandegallery.domain.download.ShareCoordinator
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.DeviceCopyTargets
import com.bluskysoftware.yandegallery.ui.common.SelectionActions
import com.bluskysoftware.yandegallery.ui.common.SelectionState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * 相册详情（M2 只读；T13 加多选批量动作）。
 */
class AlbumDetailViewModel(
    private val graph: AppGraph,
    private val galleryId: Long,
    private val writeRepository: WriteRepository = graph.writeRepository,  // 测试注入缝（镜像 ViewerViewModel gateway 模式）
) : ViewModel() {

    /** 缩略图专用 loader（Task 9），图片格子直接消费。 */
    val thumbnailLoader: ImageLoader get() = graph.thumbnailLoader

    /** 当前激活服务器：非 null 时提供 baseUrl 拼缩略图 URL。 */
    val activeServer: StateFlow<ServerEntity?> =
        graph.serverRepository.observeActive()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** 相册标题：随 galleries 表变化更新，不额外加 DAO 方法，复用 observeAll。 */
    val title: Flow<String> =
        graph.db.galleryDao().observeAll().map { galleries ->
            galleries.firstOrNull { it.id == galleryId }?.name.orEmpty()
        }

    /** 详情排序/列数（v0.6 spec §5.1）：共享 ViewPrefs，全部相册共用一档。 */
    val detailSort: StateFlow<PhotoSort> = graph.viewPrefs.detailSort
    val detailColumns: StateFlow<Int> = graph.viewPrefs.detailColumns

    fun setDetailSort(sort: PhotoSort) = graph.viewPrefs.setDetailSort(sort)

    fun setDetailColumns(columns: Int) = graph.viewPrefs.setDetailColumns(columns)

    /** 设为封面（spec §5.3）：委托 WriteRepository（先服务端后本地）。 */
    suspend fun setCover(imageId: Long): WriteResult = writeRepository.setGalleryCover(galleryId, imageId)

    /** 相册内图片分页（v0.6 spec §5.1）：随 detailSort 重建；无日期分组。 */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val pagingFlow: Flow<PagingData<ImageEntity>> =
        graph.viewPrefs.detailSort.flatMapLatest { sort ->
            Pager(PagingConfig(pageSize = 120, enablePlaceholders = false)) {
                graph.db.galleryDao().galleryImagesPagingSource(buildGalleryImagesQuery(galleryId, sort))
            }.flow
        }.cachedIn(viewModelScope)

    // ---- Task 13 多选：VM 持有选择状态 + 批量动作（Screen 不直接触 graph） ----

    /** 本相册 id（CopyTargetPicker excludeIds 排除自身——相册详情不应把选中项「复制/移动进当前所在相册」，D12A）。 */
    val currentGalleryId: Long get() = galleryId

    /** 连接状态：多选底部栏写动作离线置灰。 */
    val connState: StateFlow<ConnState> = graph.connectionMonitor.state

    /** 多选状态：Screen 订阅 selectedFlow 驱动角标/选择栏。 */
    val selection = SelectionState()

    /** 相册列表（「加入相册」picker——相册内也可把选中项加进其它相册），按名升序。 */
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
    suspend fun addSelectedToGallery(targetGalleryId: Long, ids: List<Long>): WriteResult =
        actions.addToGallery(targetGalleryId, ids)

    /** 批量移出当前相册：成功即清空选择（brief 裁定）；失败保留选择供用户重试。 */
    suspend fun removeSelectedFromGallery(ids: List<Long>): WriteResult {
        val result = actions.removeFromGallery(galleryId, ids)
        if (result == WriteResult.Success) selection.clear()
        return result
    }

    /** 批量移动到目标相册（spec §6.2）：目标加入 + 当前移除，移除失败补偿回滚（T9 语义）。 */
    suspend fun moveTo(targetGalleryId: Long, ids: List<Long>): WriteResult =
        actions.moveToGallery(galleryId, targetGalleryId, ids)

    // ---- Task 11「复制到」手机相册节：数据源/内联新建/导出入队 ----

    private val deviceTargets = DeviceCopyTargets(graph.deviceMediaGateway, graph.prefsStore, viewModelScope)

    /** 手机相册节候选（CopyTargetPicker Copy 模式，spec §6.1）：真实相册 + 待落地占位。 */
    suspend fun deviceAlbumTargets(): List<DeviceAlbum> = deviceTargets.targets()

    /** picker 内联新建手机相册（spec §5.5）：错误文案就地显示；null=成功（写入待落地占位）。 */
    fun createDeviceAlbum(name: String): String? = deviceTargets.create(name)

    /**
     * 桌面→手机导出入队（spec §6.1）：>500 张分批防 Data 10KB 上限，唯一工作名顺序排队。
     * 返回是否全部批次成功入队（v0.8.1 D1 防御）：无激活服务器 false（不触 WorkManager）、
     * 任一批 enqueue 失败即 false（短路停投后续批）——Screen 据此分流成败提示，失败不清选择可重试。
     */
    suspend fun exportSelectedToDevice(ids: List<Long>, targetPath: String): Boolean {
        val serverId = graph.serverRepository.activeServer()?.id ?: return false
        return ids.chunked(DeviceCopyTargets.EXPORT_BATCH).all { batch ->
            graph.deviceExportManager.enqueue(serverId, batch, targetPath)
        }
    }

    companion object {
        fun factory(graph: AppGraph, galleryId: Long): ViewModelProvider.Factory = viewModelFactory {
            initializer { AlbumDetailViewModel(graph, galleryId) }
        }
    }
}
