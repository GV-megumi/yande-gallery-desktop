package com.bluskysoftware.yandegallery.ui.viewer

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
import androidx.work.WorkInfo
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.data.image.previewRequest
import com.bluskysoftware.yandegallery.data.media.DeleteOwnedResult
import com.bluskysoftware.yandegallery.data.media.MediaStoreGateway
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnState
import com.bluskysoftware.yandegallery.domain.download.ShareCoordinator
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.mimeOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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
     *
     * 消费时序契约（ViewerScreen 已按此实现）：首帧快照可能尚未包含该 id——消费方须随分页 append
     * （itemCount / loadState 变化）持续按 id 重查快照直到命中；id 位于深处时快照不会自己长大，
     * 须主动驱动 append（访问已加载区间的最后一项 `items[itemCount-1]` 触发下一页加载）循环推进，
     * 直到命中、endOfPaginationReached（id 已被同步删除，兜底留在首部）或 append 出错为止。
     */
    val initialImageId: Long = imageId

    /** 大图页所处图集上下文：非 null → 从图集进入（「移出当前图集」可用）；null → 时间轴进入（该项置灰）。 */
    val contextGalleryId: Long? = galleryId

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

    /**
     * 已下载 id 集合：某图已下载 → viewer 跳 1600 档直读 MediaStore（见 [modelFor]）。
     * M4-T9：按激活 serverId 过滤（flatMapLatest 挂在 [activeServer] 上，切服即换域；
     * 无激活服务器发空集）——跨服同号 imageId 不再串本地原图。Eagerly 语义不变。
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    val downloadedIds: StateFlow<Set<Long>> =
        activeServer
            .flatMapLatest { server ->
                if (server == null) flowOf(emptyList())
                else graph.db.downloadDao().observeDownloadedIds(server.id)
            }
            .map { it.toSet() }
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())

    /**
     * 已下载 id→mediaStoreUri 映射：前置收集成 map，因 [modelFor] 在 composition 同步调用，
     * 不能走 suspend 版 byImageId。Eagerly 收集保证无订阅者时 `.value` 也已追平 DB。
     * M4-T9：同 [downloadedIds] 按激活 serverId 过滤。
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    val downloadedUris: StateFlow<Map<Long, String>> =
        activeServer
            .flatMapLatest { server ->
                if (server == null) flowOf(emptyList())
                else graph.db.downloadDao().observeDownloaded(server.id)
            }
            .map { rows -> rows.associate { it.imageId to it.mediaStoreUri } }
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptyMap())

    /** 连接状态：写按钮/下载按钮按需置灰（Task 11）。 */
    val connState: StateFlow<ConnState> = graph.connectionMonitor.state

    /** 某图下载中/成功/失败状态（WorkManager WorkInfo；downloads 表无状态列，只成功后落一行）。 */
    fun downloadState(imageId: Long): Flow<WorkInfo.State?> {
        val serverId = activeServer.value?.id ?: return flowOf(null)
        return graph.downloadManager.observeState(serverId, imageId)
    }

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
        val activeId = activeServer.value?.id
        val uriString = downloadedUris.value[image.id]
        if (uriString != null) {
            val uri = uriString.toUri()
            if (gateway.exists(uri)) return uri
            // 映射失效：清行（异步，本服域——downloadedUris 已按激活 serverId 过滤），本次回退 preview。
            if (activeId != null) {
                viewModelScope.launch { graph.db.downloadDao().delete(activeId, image.id) }
            }
        }
        return previewRequest(graph.appContext, baseUrl, activeId ?: 0L, image.id)
    }

    /**
     * 详情面板数据：byId + tagNamesOf + galleryIdsOf 组装（entity 必须存在——viewer 只对可见图调用）。
     *
     * 注意：行在同步中途被删（对账清行）时 requireNotNull 会抛 [IllegalArgumentException]——
     * 调用方（Task 11 详情面板）须捕获并优雅降级（关闭面板/不弹出），不得让异常冒泡崩溃。
     */
    suspend fun detailOf(imageId: Long): ImageDetail {
        val dao = graph.db.imageDao()
        val entity = requireNotNull(dao.byId(imageId)) { "图片不存在: $imageId" }
        return ImageDetail(
            entity = entity,
            tagNames = dao.tagNamesOf(imageId),
            galleryIds = dao.galleryIdsOf(imageId),
        )
    }

    // ---- Task 11 委托：Screen 不直接触 graph，写操作/下载/级联删副本均经 VM 单点 ----

    /** 图集列表（「加入图集」picker + 详情面板图集名解析），按名升序。 */
    val galleries: Flow<List<GalleryEntity>> = graph.db.galleryDao().observeAll()

    /** 删除当前图（T6：乐观删镜像 + 404 当成功 + 失败回滚）。 */
    suspend fun deleteImage(imageId: Long): WriteResult = graph.writeRepository.deleteImage(imageId)

    /** 加标签（T6：已知 tag 本地乐观建链）。 */
    suspend fun addTags(imageId: Long, names: List<String>): WriteResult =
        graph.writeRepository.addTags(imageId, names)

    /** 移标签。 */
    suspend fun removeTags(imageId: Long, names: List<String>): WriteResult =
        graph.writeRepository.removeTags(imageId, names)

    /** 加入图集（更多菜单）。 */
    suspend fun addToGallery(galleryId: Long, imageId: Long): WriteResult =
        graph.writeRepository.addToGallery(galleryId, listOf(imageId))

    /** 移出图集（更多菜单，仅图集上下文可用）。 */
    suspend fun removeFromGallery(galleryId: Long, imageId: Long): WriteResult =
        graph.writeRepository.removeFromGallery(galleryId, listOf(imageId))

    /** 查看原图：入队下载（T8 唯一工作名 KEEP，重复点击不叠加；mime 由 format 推导；无激活服务器不入队）。 */
    fun enqueueDownload(image: ImageEntity) {
        val serverId = activeServer.value?.id ?: return
        graph.downloadManager.enqueue(serverId, image.id, image.filename, mimeOf(image.format))
    }

    /** 分享完整流（D9）：未下载先入队原图下载，等终态后返回可分享 uri；无激活服务器/下载失败 → failure。 */
    suspend fun ensureDownloadedThenUri(image: ImageEntity): Result<String> {
        val serverId = activeServer.value?.id ?: return Result.failure(IllegalStateException("无激活服务器"))
        val coordinator = ShareCoordinator(
            isDownloaded = { graph.db.downloadDao().byImageId(serverId, it)?.mediaStoreUri },
            enqueue = { img -> graph.downloadManager.enqueue(serverId, img.id, img.filename, mimeOf(img.format)) },
            observeState = { graph.downloadManager.observeState(serverId, it) },
            exists = { gateway.exists(it.toUri()) },
            clearStaleRow = { graph.db.downloadDao().delete(serverId, it) },
        )
        val outcome = coordinator.ensureDownloadedUris(listOf(image))
        return outcome.uris.firstOrNull()?.let { Result.success(it) }
            ?: Result.failure(IllegalStateException("原图下载失败"))
    }

    /** 级联删本地副本：30+ 返回系统确认 PendingIntent（UI 层经 StartIntentSenderForResult 启动）；<30 返回 null（调用方走 [deleteLocalCopy]）。 */
    fun buildDeleteRequest(uri: Uri): PendingIntent? = gateway.buildDeleteRequest(listOf(uri))

    /**
     * <30 直删本地副本（M4-T9）：返回结构化结果——API 29 所有权丢失时为 NeedsConsent（携带
     * IntentSender，Screen 走与 30+ 同一个 cascadeLauncher），失败为 Failed（spec §8 不静默）。
     */
    suspend fun deleteLocalCopy(uri: Uri): DeleteOwnedResult =
        withContext(Dispatchers.IO) { gateway.deleteOwned(uri) }

    /** 清 downloads 映射行（本服域）：级联删除完成或用户拒绝系统确认后都要清（spec §8）。 */
    suspend fun clearDownloadRow(imageId: Long) {
        val serverId = activeServer.value?.id ?: return
        graph.db.downloadDao().delete(serverId, imageId)
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
