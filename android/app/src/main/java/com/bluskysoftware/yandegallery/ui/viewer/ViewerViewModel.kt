package com.bluskysoftware.yandegallery.ui.viewer

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
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest
import com.bluskysoftware.yandegallery.data.image.thumbnailUrl
import com.bluskysoftware.yandegallery.data.mirror.LocalImage
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import com.bluskysoftware.yandegallery.data.mirror.mirrorTierOf
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnState
import com.bluskysoftware.yandegallery.domain.download.ShareCoordinator
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.DeviceCopyTargets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * 大图页 ViewModel（Task 10 消费；镜像层改造 spec §4.2/§4.4）：分页来源二选一 + 本地镜像直出/
 * 缩略图占位的模型选择 + 详情组装 + 下载/连接状态。
 *
 * 关键：[modelFor] 在 composition 中**同步**调用，直接读两个 StateFlow 的 `.value`
 * （localImages / activeServer）。为保证无订阅者时 `.value` 仍新鲜，这几个流用
 * `SharingStarted.Eagerly`——不能依赖 Task 10 一定订阅它们才生效（否则永远读到初始空值）。
 *
 * @param imageId  被点开的图片 id（首屏定位用，见 [initialImageId]）
 * @param galleryId 非 null → 来源为该相册分页；null → 来源为时间轴全量分页（与被点网格同序）
 */
class ViewerViewModel(
    private val graph: AppGraph,
    imageId: Long,
    private val galleryId: Long?,
) : ViewModel() {

    /** 大图 loader（预览档下线后取缩略图 loader）：本地镜像文件直出走 Fetcher 本地分支，占位走缩略图键。 */
    val imageLoader: ImageLoader get() = graph.thumbnailLoader

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

    /** 当前激活服务器：提供 baseUrl，其 id 供 [modelFor] 拼缩略图缓存键命名空间。 */
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

    /** 本地镜像映射（spec §4.2）：行 Flow 收集 + 文件存在性 IO 预校验；modelFor 同步读零 IO。 */
    @OptIn(ExperimentalCoroutinesApi::class)
    val localImages: StateFlow<Map<Long, LocalImage>> =
        graph.serverRepository.observeActive()
            .flatMapLatest { server ->
                if (server == null) flowOf(emptyMap())
                else graph.db.imageFileDao().observeFor(server.id).map { rows ->
                    val valid = mutableMapOf<Long, LocalImage>()
                    for (row in rows) {
                        val file = graph.imageMirrorStore.fileOf(row)
                        if (file.isFile && file.length() > 0) {
                            valid[row.imageId] = LocalImage(mirrorTierOf(row.tier), file)
                        }
                    }
                    valid
                }
            }
            .flowOn(Dispatchers.IO)
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptyMap())

    /** 已有本机原图的 id 集（「查看原图」按钮态：已有→打勾禁用）。 */
    val downloadedIds: StateFlow<Set<Long>> =
        localImages
            .map { m -> m.filterValues { it.tier == MirrorTier.ORIGINAL }.keys }
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())

    /** 连接状态：写按钮/下载按钮按需置灰（Task 11）。 */
    val connState: StateFlow<ConnState> = graph.connectionMonitor.state

    /** 某图下载中/成功/失败状态（WorkManager WorkInfo；原图 ensure 成功后落 image_files 行）。 */
    fun downloadState(imageId: Long): Flow<WorkInfo.State?> {
        val serverId = activeServer.value?.id ?: return flowOf(null)
        return graph.downloadManager.observeState(serverId, imageId)
    }

    /**
     * 大图模型（同步零 IO，spec §4.2）：本地镜像命中 → File 直出（Coil 按视图降采样）；
     * 未镜像 → 缩略图请求占位（ThumbnailSpec 命中缩略图缓存），清晰版由 [ensureViewable]
     * 在线插队补齐后经 localImages 流自动切换。无激活服务器退化裸缩略图 URL（不伪造缓存键）。
     */
    fun modelFor(image: ImageEntity, baseUrl: String): Any {
        val local = localImages.value[image.id]
        if (local != null) return local.file
        val server = activeServer.value
            ?: return ImageRequest.Builder(graph.appContext).data(thumbnailUrl(baseUrl, image.id)).build()
        return thumbnailRequest(graph.appContext, baseUrl, server.id, image.id)
    }

    /** 在线插队补当前图（spec §4.2）：不排 Worker 队列，独立协程 ensure；离线/失败静默（占位已示意）。 */
    fun ensureViewable(image: ImageEntity) {
        val serverId = activeServer.value?.id ?: return
        if (localImages.value[image.id] != null || !graph.connectionMonitor.state.value.online) return
        viewModelScope.launch(Dispatchers.IO) {
            val tier = mirrorTierOf(graph.prefsStore.imageSaveModeName.first())
            graph.imageMirrorStore.ensure(serverId, image.id, tier)
        }
    }

    /** 分享文件（spec §4.4）：四级规则单张版。 */
    suspend fun shareFileFor(image: ImageEntity): Result<java.io.File> {
        val serverId = activeServer.value?.id ?: return Result.failure(IllegalStateException("无激活服务器"))
        val coordinator = ShareCoordinator(
            localFile = { graph.imageMirrorStore.localFile(serverId, it)?.file },
            ensure = { id, tier -> graph.imageMirrorStore.ensure(serverId, id, tier) },
            saveMode = { mirrorTierOf(graph.prefsStore.imageSaveModeName.first()) },
            online = { graph.connectionMonitor.state.value.online },
        )
        val outcome = coordinator.shareFiles(listOf(image))
        return outcome.files.firstOrNull()?.let { Result.success(it) }
            ?: Result.failure(IllegalStateException(if (graph.connectionMonitor.state.value.online) "拉取失败" else "未同步且离线"))
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

    // ---- Task 11 委托：Screen 不直接触 graph，写操作/下载均经 VM 单点 ----

    /** 相册列表（「加入相册」picker + 详情面板相册名解析），按名升序。 */
    val galleries: Flow<List<GalleryEntity>> = graph.db.galleryDao().observeAll()

    /** 删除当前图（T6：乐观删镜像 + 404 当成功 + 失败回滚）；镜像文件由 WriteRepository 在
     *  本次调用内主动级联清理，对账/sweepOrphans 兜底异常退出场景（Task 10 遗留审查项）。 */
    suspend fun deleteImage(imageId: Long): WriteResult = graph.writeRepository.deleteImage(imageId)

    /** 加标签（T6：已知 tag 本地乐观建链）。 */
    suspend fun addTags(imageId: Long, names: List<String>): WriteResult =
        graph.writeRepository.addTags(imageId, names)

    /** 移标签。 */
    suspend fun removeTags(imageId: Long, names: List<String>): WriteResult =
        graph.writeRepository.removeTags(imageId, names)

    /** 加入相册（更多菜单「复制到」桌面相册节）。 */
    suspend fun addToGallery(galleryId: Long, imageId: Long): WriteResult =
        graph.writeRepository.addToGallery(galleryId, listOf(imageId))

    /** 移出相册（更多菜单，仅相册上下文可用）。 */
    suspend fun removeFromGallery(galleryId: Long, imageId: Long): WriteResult =
        graph.writeRepository.removeFromGallery(galleryId, listOf(imageId))

    /** 单张移动到目标相册（更多菜单「移动到」，仅相册上下文；spec §6.2）：目标加入 + 当前移除。 */
    suspend fun moveTo(targetGalleryId: Long, imageId: Long): WriteResult {
        val from = contextGalleryId ?: return WriteResult.Failed("无相册上下文")
        return graph.writeRepository.moveToGallery(from, targetGalleryId, listOf(imageId))
    }

    // ---- Task 11「复制到」手机相册节：数据源/内联新建/导出入队 ----

    private val deviceTargets = DeviceCopyTargets(graph.deviceMediaGateway, graph.prefsStore, viewModelScope)

    /** 手机相册节候选（CopyTargetPicker Copy 模式，spec §6.1）：真实相册 + 待落地占位。 */
    suspend fun deviceAlbumTargets(): List<DeviceAlbum> = deviceTargets.targets()

    /** picker 内联新建手机相册（spec §5.5）：错误文案就地显示；null=成功（写入待落地占位）。 */
    fun createDeviceAlbum(name: String): String? = deviceTargets.create(name)

    /**
     * 桌面→手机导出入队（spec §6.1 单张版）：唯一工作名顺序排队。返回是否成功入队
     * （v0.8.1 D1 防御）：无激活服务器 false（不触 WorkManager）、enqueue 异常 false——
     * Screen 据此分流成败提示，不再谎报「已开始复制」。
     */
    fun exportToDevice(imageId: Long, targetPath: String): Boolean {
        val serverId = activeServer.value?.id ?: return false
        return graph.deviceExportManager.enqueue(serverId, listOf(imageId), targetPath)
    }

    /** 查看原图：入队下载（T8 唯一工作名 KEEP，重复点击不叠加；无激活服务器不入队）。 */
    fun enqueueDownload(image: ImageEntity) {
        val serverId = activeServer.value?.id ?: return
        graph.downloadManager.enqueue(serverId, image.id, image.filename)
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
