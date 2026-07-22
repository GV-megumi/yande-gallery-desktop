package com.bluskysoftware.yandegallery.ui.device

import android.app.PendingIntent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.PagingSource
import androidx.paging.cachedIn
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import com.bluskysoftware.yandegallery.data.device.DeviceMediaGateway
import com.bluskysoftware.yandegallery.data.device.DeviceSource
import com.bluskysoftware.yandegallery.data.device.pendingAlbumPath
import com.bluskysoftware.yandegallery.data.device.validateNewAlbumName
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

/**
 * 本机大图页 VM（Task 8，spec §2.3）：同 [bucketKey] 上下文分页 + 首屏定位 id 透传 + 单张写操作。
 *
 * 与网格页 VM（DeviceAlbumDetailViewModel）的关系：分页/失效链完全同构（observeChanges 脉冲 →
 * 当前 PagingSource invalidate → Pager 重拉），但无标题/张数（大图页 chrome 显当前张日期时间）、
 * 无多选（单张上下文）。操作方法与 Task 7 同形态但收单张——入参直接是屏上正显示的 [DeviceMedia]
 * 完整行，不需要 mediaByIds 还原，因此删除/移动授权请求为普通 fun（网关的
 * deleteRequest/writeRequest 本身非 suspend；brief 字面签名是可空 PendingIntent?，那是批量版
 * 「空选中返回 null」的形状残留——单张恒有 uri，这里按网关真实签名收敛为非空，记录性偏差）。
 *
 * 删除后的翻页语义（brief 契约）：系统删除弹窗 RESULT_OK → MediaStore ContentObserver 脉冲 →
 * 本 VM invalidate → Pager 自然收缩、当前页落到相邻页（Paging 默认行为，Screen 不手工跳页）。
 */
class DeviceViewerViewModel(
    private val gateway: DeviceMediaGateway,
    private val prefsStore: PrefsStore,
    mediaIdInitial: Long,
    bucketKeyRaw: String,
) : ViewModel() {

    /** 深链/路由参数解码失败兜底回退全部照片（DeviceAlbumDetailViewModel 同款契约）。 */
    val bucketKey: BucketKey = BucketKey.decode(bucketKeyRaw) ?: BucketKey.All

    /**
     * 首屏定位契约（对照 ViewerViewModel.initialImageId）：仅暴露被点媒体 id，由 Screen 在
     * LazyPagingItems 快照里按 id 匹配定位初始页——不预算绝对下标（enablePlaceholders=false 时
     * itemCount 随滚动增长，绝对下标首帧多半越界）。
     */
    val initialMediaId: Long = mediaIdInitial

    /** 当前世代 PagingSource：脉冲到达时手动 invalidate；Pager 首次被收集前恒为 null，安全。 */
    private var currentPagingSource: PagingSource<Int, DeviceMedia>? = null

    /** 同 bucketKey 上下文分页流（与网格页同源同序，翻页范围即所来网格的范围）。 */
    val media: Flow<PagingData<DeviceMedia>> =
        Pager(PagingConfig(pageSize = PAGE_SIZE, enablePlaceholders = false)) {
            gateway.pagingSource(bucketKey).also { currentPagingSource = it }
        }.flow.cachedIn(viewModelScope)

    /**
     * 最近一次 [albumTargets] 结果快照：给 [createTargetAlbum] 做同步重名校验（Task 7 同款惯例，
     * picker 打开前必先走一遍 albumTargets，快照必然新鲜）。
     */
    private var lastTargetAlbums: List<DeviceAlbum> = emptyList()

    init {
        // 待落地相册恒空、进不来大图页；防御性保持与网格页同门控，Pending 上下文不订阅脉冲
        if (bucketKey !is BucketKey.Pending) {
            gateway.observeChanges()
                .onEach { currentPagingSource?.invalidate() }
                .launchIn(viewModelScope)
        }
    }

    /** 单张删除授权意图：uri 单项包装批量网关（createDeleteRequest，30+ 由操作栏门控入口）。 */
    fun deleteRequest(media: DeviceMedia): PendingIntent = gateway.deleteRequest(listOf(media.uri))

    /** 移动第一步：单张系统写授权意图（createWriteRequest，30+ 由操作栏门控入口）。 */
    fun moveWriteRequest(media: DeviceMedia): PendingIntent = gateway.writeRequest(listOf(media.uri))

    /** 移动第二步：授权 RESULT_OK 后改 RELATIVE_PATH；单张语义下成功条数 >0 即成功。 */
    suspend fun moveTo(media: DeviceMedia, path: String): Boolean =
        gateway.moveTo(listOf(media.uri), path).getOrDefault(0) > 0

    /**
     * 复制单张到目标相册（spec §5.3）：成功且目标恰为某待落地占位的 `Pictures/<名>/` 路径时顺手
     * 清占位记录（Task 7 copySelectedTo 同款即时收编快路径，spec §5.5）。
     */
    suspend fun copyTo(media: DeviceMedia, path: String): Boolean {
        val ok = gateway.insertCopy(DeviceSource.Media(media), path).isSuccess
        if (ok) {
            val pending = prefsStore.devicePendingAlbums.first()
            pending.firstOrNull { pendingAlbumPath(it) == path }?.let { prefsStore.removePendingAlbum(it) }
        }
        return ok
    }

    /**
     * 复制/移动目标候选（picker 数据源）：真实相册 + 未收编待落地占位，复用 [buildWritableTargets]
     * 组装（brief Task 8 契约：albumTargets 只含可写路径相册——原内联 filter 于 v0.8.1 A5 上收
     * 为共享层，三入口候选/重名校验同口径，picker 侧的过滤退化为幂等兜底）；
     * 查询异常兜底同网格页（CancellationException 重抛、其余退化空列表）。
     */
    suspend fun albumTargets(): List<DeviceAlbum> {
        val real = runCatching { gateway.queryAlbums() }
            .onFailure { if (it is CancellationException) throw it }
            .getOrElse { emptyList() }
        val pending = prefsStore.devicePendingAlbums.first()
        return buildWritableTargets(real, pending).also { lastTargetAlbums = it }
    }

    /** picker 内联新建（Task 7 同款语义）：对最近候选快照重名校验，通过即写待落地占位并返回 null。 */
    fun createTargetAlbum(name: String): String? {
        val trimmed = name.trim()
        val error = validateNewAlbumName(trimmed, lastTargetAlbums.map { it.name }.toSet())
        if (error != null) return error
        viewModelScope.launch { prefsStore.addPendingAlbum(trimmed) }
        return null
    }

    companion object {
        private const val PAGE_SIZE = 60

        fun factory(graph: AppGraph, mediaId: Long, bucketKeyRaw: String): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    DeviceViewerViewModel(graph.deviceMediaGateway, graph.prefsStore, mediaId, bucketKeyRaw)
                }
            }
    }
}
