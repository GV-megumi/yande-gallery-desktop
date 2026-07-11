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
import coil3.request.ImageRequest
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.data.db.buildGalleryImagesQuery
import com.bluskysoftware.yandegallery.data.db.buildTimelineQuery
import com.bluskysoftware.yandegallery.data.image.previewRequest
import com.bluskysoftware.yandegallery.data.image.previewUrl
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
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
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
 * @param galleryId 非 null → 来源为该相册分页；null → 来源为时间轴全量分页（与被点网格同序）
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

    /** 大图页所处相册上下文：非 null → 从相册进入（「移出当前相册」可用）；null → 时间轴进入（该项置灰）。 */
    val contextGalleryId: Long? = galleryId

    /** 当前激活服务器：提供 baseUrl，其 id 供 [modelFor] 拼 preview 缓存键命名空间。 */
    val activeServer: StateFlow<ServerEntity?> =
        graph.serverRepository.observeActive()
            .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /**
     * 排序快照（v0.6 spec §3.4 + 评审修复）：VM 构造期一次性读共享 ViewPrefs——工厂每代（Room 失效
     * 重建 PagingSource）只用快照，单次 Viewer 会话恒同序，不会中途换序把当前页瞬移到别的图。
     * 常规导航路径无脏读：viewer 只能从已应用该排序的网格进入，内存态先于导航更新。进程被杀后
     * 直接恢复进 Viewer（返回栈还原）时 ViewPrefs 异步回填可能未落地、快照取到 DEFAULT——属冷启动
     * 闪档同族取舍：仅初始序可能不同，会话内不再漂移。
     */
    private val timelineSort = graph.viewPrefs.photoSort.value
    private val detailSort = graph.viewPrefs.detailSort.value

    /**
     * 分页流：galleryId != null → 相册分页（GalleryDao，按构造期快照的详情排序与网格同序）；
     * 否则 → 时间轴分页（ImageDao，按构造期快照的照片排序）。只出 ImageEntity（不插日期分组头，
     * 那是网格的视觉层）。搜索进入沿用时间轴上下文（既有口径）。
     */
    val pagingFlow: Flow<PagingData<ImageEntity>> =
        Pager(PagingConfig(pageSize = 120, enablePlaceholders = false)) {
            val gid = galleryId
            if (gid != null) {
                graph.db.galleryDao().galleryImagesPagingSource(
                    buildGalleryImagesQuery(gid, detailSort),
                )
            } else {
                graph.db.imageDao().timelinePagingSource(buildTimelineQuery(timelineSort))
            }
        }.flow.cachedIn(viewModelScope)

    /**
     * 已下载映射（M4-T15）：收集期在 IO 线程预校验 gateway.exists，失效行直接清除——
     * map 里只留「文件确实存在」的映射，[modelFor]/预取读 map 零 IPC（D13/A3：主线程 binder 从热路径整体移除）。
     * 前置收集成 map：[modelFor] 在 composition 同步调用，不能走 suspend 版 byImageId。
     * M4-T9：按激活 serverId 过滤（flatMapLatest 挂在 observeActive 上，切服即换域；无激活服务器发空 map）。
     * Eagerly 收集保证无订阅者时 `.value` 也已追平 DB。
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    val downloadedUris: StateFlow<Map<Long, String>> =
        graph.serverRepository.observeActive()
            .flatMapLatest { server ->
                if (server == null) flowOf(emptyMap())
                else graph.db.downloadDao().observeDownloaded(server.id).map { rows ->
                    val valid = mutableMapOf<Long, String>()
                    for (row in rows) {
                        if (gateway.exists(row.mediaStoreUri.toUri())) {
                            valid[row.imageId] = row.mediaStoreUri
                        } else {
                            graph.db.downloadDao().delete(server.id, row.imageId)   // 映射失效即清（spec §6.4）
                        }
                    }
                    valid
                }
            }
            .flowOn(Dispatchers.IO)
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptyMap())

    /**
     * 已下载 id 集合：由 [downloadedUris] 派生（只含收集期预校验存在的行），语义与映射一致。
     * M4-T9 的 serverId 过滤随 [downloadedUris] 一并生效；Eagerly 语义不变。
     */
    val downloadedIds: StateFlow<Set<Long>> =
        downloadedUris
            .map { it.keys }
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())

    /** 连接状态：写按钮/下载按钮按需置灰（Task 11）。 */
    val connState: StateFlow<ConnState> = graph.connectionMonitor.state

    /** 某图下载中/成功/失败状态（WorkManager WorkInfo；downloads 表无状态列，只成功后落一行）。 */
    fun downloadState(imageId: Long): Flow<WorkInfo.State?> {
        val serverId = activeServer.value?.id ?: return flowOf(null)
        return graph.downloadManager.observeState(serverId, imageId)
    }

    /**
     * 三档模型（**同步**、零 IPC）：map 命中即本地 [Uri]（存在性已由 [downloadedUris] 收集链路担保），
     * 否则 1600 档 [previewRequest]。gateway.exists 已整体前移到收集期，modelFor 本体只读 map（D13/A3）。
     *
     * 无激活服务器的退化态**不伪造 s0 命名空间**：返回不带缓存键的裸请求（此时 baseUrl 为空串，
     * 请求自然失败 → T5 占位；绝不能用 serverId=0 落一份假命名空间的缓存条目串图）。
     */
    fun modelFor(image: ImageEntity, baseUrl: String): Any {
        val uriString = downloadedUris.value[image.id]
        if (uriString != null) return uriString.toUri()
        val server = activeServer.value
            ?: return ImageRequest.Builder(graph.appContext)
                .data(previewUrl(baseUrl, image.id))
                .build()
        return previewRequest(graph.appContext, baseUrl, server.id, image.id)
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

    /** 相册列表（「加入相册」picker + 详情面板相册名解析），按名升序。 */
    val galleries: Flow<List<GalleryEntity>> = graph.db.galleryDao().observeAll()

    /** 删除当前图（T6：乐观删镜像 + 404 当成功 + 失败回滚）。 */
    suspend fun deleteImage(imageId: Long): WriteResult = graph.writeRepository.deleteImage(imageId)

    /** 加标签（T6：已知 tag 本地乐观建链）。 */
    suspend fun addTags(imageId: Long, names: List<String>): WriteResult =
        graph.writeRepository.addTags(imageId, names)

    /** 移标签。 */
    suspend fun removeTags(imageId: Long, names: List<String>): WriteResult =
        graph.writeRepository.removeTags(imageId, names)

    /** 加入相册（更多菜单）。 */
    suspend fun addToGallery(galleryId: Long, imageId: Long): WriteResult =
        graph.writeRepository.addToGallery(galleryId, listOf(imageId))

    /** 移出相册（更多菜单，仅相册上下文可用）。 */
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

/** 详情面板模型：图片实体 + 标签名（按名升序）+ 所属相册 id。 */
data class ImageDetail(
    val entity: ImageEntity,
    val tagNames: List<String>,
    val galleryIds: List<Long>,
)
