package com.bluskysoftware.yandegallery.ui.viewer

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
import androidx.work.WorkInfo
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.data.image.previewRequest
import com.bluskysoftware.yandegallery.data.media.MediaStoreGateway
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * 大图页 ViewModel（Task 10 消费）：分页来源二选一 + 三档图片模型选择 + 详情组装 + 下载/连接状态。
 *
 * gateway 走构造入参（默认取自 graph，测试可替换 fake——AppGraph 不支持替换 mediaStoreGateway）。
 *
 * 关键：[modelFor] 在 composition 中**同步**调用，直接读三个 StateFlow 的 `.value`
 * （downloadedUris / activeServer）。为保证无订阅者时 `.value` 仍新鲜，这几个流用
 * `SharingStarted.Eagerly`——不能依赖 Task 10 一定订阅它们才生效（否则永远读到初始空值）。
 *
 * @param imageId  被点开的图片 id（首屏定位用，见 [initialImageId]）
 * @param galleryId 非 null → 来源为该图集分页；null → 来源为时间轴全量分页（与被点网格同序）
 */
class ViewerViewModel(
    private val graph: AppGraph,
    imageId: Long,
    private val galleryId: Long?,
    private val gateway: MediaStoreGateway = graph.mediaStoreGateway,
) : ViewModel() {

    /** 1600px 预览档专用 loader（Task 2），Task 10 的 AsyncImage 直接消费。 */
    val previewLoader: ImageLoader get() = graph.previewLoader

    /**
     * 首屏定位契约：仅暴露被点图片 id，由 Task 10 在 LazyPagingItems 快照里按 id 匹配定位初始页。
     *
     * 不预算「绝对下标」作为 Pager 初始页：分页 enablePlaceholders=false 时 itemCount 随滚动增长，
     * 预算的绝对下标在首帧多半越界不可用；按 id 在已加载快照里匹配才稳健（详见任务报告的设计决策）。
     */
    val initialImageId: Long = imageId

    /** 当前激活服务器：提供 baseUrl，其 id 供 [modelFor] 拼 preview 缓存键命名空间。 */
    val activeServer: StateFlow<ServerEntity?> =
        graph.serverRepository.observeActive()
            .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /**
     * 分页流：galleryId != null → 图集分页（GalleryDao，按 createdAt DESC 与网格同序）；
     * 否则 → 时间轴分页（ImageDao）。此处只出 ImageEntity（不插日期分组头，那是网格的视觉层）。
     */
    val pagingFlow: Flow<PagingData<ImageEntity>> =
        Pager(PagingConfig(pageSize = 120, enablePlaceholders = false)) {
            val gid = galleryId
            if (gid != null) graph.db.galleryDao().galleryImagesPagingSource(gid)
            else graph.db.imageDao().timelinePagingSource()
        }.flow.cachedIn(viewModelScope)

    /** 已下载 id 集合：某图已下载 → viewer 跳 1600 档直读 MediaStore（见 [modelFor]）。 */
    val downloadedIds: StateFlow<Set<Long>> =
        graph.db.downloadDao().observeDownloadedIds()
            .map { it.toSet() }
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())

    /**
     * 已下载 id→mediaStoreUri 映射：前置收集成 map，因 [modelFor] 在 composition 同步调用，
     * 不能走 suspend 版 byImageId。Eagerly 收集保证无订阅者时 `.value` 也已追平 DB。
     */
    val downloadedUris: StateFlow<Map<Long, String>> =
        graph.db.downloadDao().observeDownloaded()
            .map { rows -> rows.associate { it.imageId to it.mediaStoreUri } }
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptyMap())

    /** 连接状态：写按钮/下载按钮按需置灰（Task 11）。 */
    val connState: StateFlow<ConnState> = graph.connectionMonitor.state

    /** 某图下载中/成功/失败状态（WorkManager WorkInfo；downloads 表无状态列，只成功后落一行）。 */
    fun downloadState(imageId: Long): Flow<WorkInfo.State?> = graph.downloadManager.observeState(imageId)

    /**
     * 三档图片模型（**同步**，composition 里调用）：
     * - 命中 downloadedUris 且 `gateway.exists(uri)` → 返回解析后的 [Uri]（跳 1600 档直读 MediaStore）；
     * - 命中但 exists=false（用户已在系统相册手删）→ 异步清 downloads 行，本次回退 1600 档 preview；
     * - 未命中 → 1600 档 [previewRequest]。
     *
     * gateway.exists 为同步 IO 调用，按 spec §6.4 允许留在 composition 路径；清行只在
     * viewModelScope.launch 里做，modelFor 本体只读 map 保持非挂起。serverId 取自
     * activeServer.value.id 做 preview 缓存键命名空间（多服务器同 imageId 不同图，避免串图）。
     */
    fun modelFor(image: ImageEntity, baseUrl: String): Any {
        val uriString = downloadedUris.value[image.id]
        if (uriString != null) {
            val uri = uriString.toUri()
            if (gateway.exists(uri)) return uri
            // 映射失效：清行（异步），本次回退 preview。
            viewModelScope.launch { graph.db.downloadDao().delete(image.id) }
        }
        val serverId = activeServer.value?.id ?: 0L
        return previewRequest(graph.appContext, baseUrl, serverId, image.id)
    }

    /** 详情面板数据：byId + tagNamesOf + galleryIdsOf 组装（entity 必须存在——viewer 只对可见图调用）。 */
    suspend fun detailOf(imageId: Long): ImageDetail {
        val dao = graph.db.imageDao()
        val entity = requireNotNull(dao.byId(imageId)) { "图片不存在: $imageId" }
        return ImageDetail(
            entity = entity,
            tagNames = dao.tagNamesOf(imageId),
            galleryIds = dao.galleryIdsOf(imageId),
        )
    }

    companion object {
        fun factory(graph: AppGraph, imageId: Long, galleryId: Long?): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ViewerViewModel(graph, imageId, galleryId) }
            }
    }
}

/** 详情面板模型：图片实体 + 标签名（按名升序）+ 所属图集 id。 */
data class ImageDetail(
    val entity: ImageEntity,
    val tagNames: List<String>,
    val galleryIds: List<Long>,
)
