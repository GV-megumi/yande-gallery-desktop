package com.bluskysoftware.yandegallery.ui.albums

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
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.data.db.buildGalleryImagesQuery
import com.bluskysoftware.yandegallery.data.media.DeleteOwnedResult
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnState
import com.bluskysoftware.yandegallery.domain.download.ShareCoordinator
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.SelectionActions
import com.bluskysoftware.yandegallery.ui.common.SelectionState
import com.bluskysoftware.yandegallery.ui.common.mimeOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 图集详情（M2 只读；T13 加多选批量动作）。
 */
class AlbumDetailViewModel(
    private val graph: AppGraph,
    private val galleryId: Long,
    writeRepository: WriteRepository = graph.writeRepository,  // 测试注入缝（镜像 ViewerViewModel gateway 模式）
) : ViewModel() {

    /** 缩略图专用 loader（Task 9），图片格子直接消费。 */
    val thumbnailLoader: ImageLoader get() = graph.thumbnailLoader

    /** 当前激活服务器：非 null 时提供 baseUrl 拼缩略图 URL。 */
    val activeServer: StateFlow<ServerEntity?> =
        graph.serverRepository.observeActive()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** 图集标题：随 galleries 表变化更新，不额外加 DAO 方法，复用 observeAll。 */
    val title: Flow<String> =
        graph.db.galleryDao().observeAll().map { galleries ->
            galleries.firstOrNull { it.id == galleryId }?.name.orEmpty()
        }

    /** 图集内图片分页：galleryImagesPagingSource 已按 createdAt DESC 排序，此处无日期分组。 */
    val pagingFlow: Flow<PagingData<ImageEntity>> =
        Pager(PagingConfig(pageSize = 120, enablePlaceholders = false)) {
            graph.db.galleryDao().galleryImagesPagingSource(buildGalleryImagesQuery(galleryId, PhotoSort.DEFAULT))
        }.flow.cachedIn(viewModelScope)

    // ---- Task 13 多选：VM 持有选择状态 + 批量动作（Screen 不直接触 graph） ----

    /** 本图集 id（GalleryPickerDialog 排除自身——图集详情不应把选中项「加入当前所在图集」，D12A）。 */
    val currentGalleryId: Long get() = galleryId

    /** 连接状态：多选底部栏写动作离线置灰。 */
    val connState: StateFlow<ConnState> = graph.connectionMonitor.state

    /** 多选状态：Screen 订阅 selectedFlow 驱动角标/选择栏。 */
    val selection = SelectionState()

    /** 图集列表（「加入图集」picker——图集内也可把选中项加进其它图集），按名升序。 */
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
    suspend fun addSelectedToGallery(targetGalleryId: Long, ids: List<Long>): WriteResult =
        actions.addToGallery(targetGalleryId, ids)

    /** 批量移出当前图集：成功即清空选择（brief 裁定）；失败保留选择供用户重试。 */
    suspend fun removeSelectedFromGallery(ids: List<Long>): WriteResult {
        val result = actions.removeFromGallery(galleryId, ids)
        if (result == WriteResult.Success) selection.clear()
        return result
    }

    companion object {
        fun factory(graph: AppGraph, galleryId: Long): ViewModelProvider.Factory = viewModelFactory {
            initializer { AlbumDetailViewModel(graph, galleryId) }
        }
    }
}
