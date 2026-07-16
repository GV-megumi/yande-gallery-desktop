package com.bluskysoftware.yandegallery.ui.device

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
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import com.bluskysoftware.yandegallery.data.device.DeviceMediaGateway
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.ui.common.SelectionState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.onStart

/**
 * 相册网格页 VM（Task 6，spec §2.2）：解出 [bucketKey] 上下文（All/Bucket/Pending），驱动分页网格
 * 与标题/张数展示。MediaStore 无原生可观察查询，[gateway] 的 [DeviceMediaGateway.observeChanges]
 * 脉冲驱动两件事：
 * 1）让 [Pager] 手上持有的当前 [PagingSource] 失效重拉（brief 契约，非重建整个 Pager）；
 * 2）顺带刷新 [title]/[count]（brief 未明确要求，但与 DeviceAlbumsViewModel 同源同款查询、同款
 *    异常兜底——本屏「N 张」跟着相册实际内容走才是正确行为，复用 sibling 惯例成本几乎为零）。
 * Pending（待落地）相册恒无成员、名称已内嵌 key，不查询、不订阅脉冲。
 */
class DeviceAlbumDetailViewModel(
    private val gateway: DeviceMediaGateway,
    bucketKeyRaw: String,
) : ViewModel() {

    /** 深链/路由参数解码失败（脏值、旧版本残留）兜底回退全部照片，不崩溃不留白页（brief 契约）。 */
    val bucketKey: BucketKey = BucketKey.decode(bucketKeyRaw) ?: BucketKey.All

    private val _title = MutableStateFlow(
        when (val key = bucketKey) {
            BucketKey.All -> ALL_TITLE
            is BucketKey.Bucket -> ""
            is BucketKey.Pending -> key.name
        },
    )
    val title: StateFlow<String> = _title.asStateFlow()

    private val _count = MutableStateFlow(0)
    val count: StateFlow<Int> = _count.asStateFlow()

    /** 当前世代 PagingSource：脉冲到达时手动 invalidate；Pager 首次被收集前恒为 null，安全。 */
    private var currentPagingSource: PagingSource<Int, DeviceMedia>? = null

    /** 本相册（或全部照片）分页流；observeChanges 脉冲经下方 init 收口触发失效重拉。 */
    val media: Flow<PagingData<DeviceMedia>> =
        Pager(PagingConfig(pageSize = PAGE_SIZE, enablePlaceholders = false)) {
            gateway.pagingSource(bucketKey).also { currentPagingSource = it }
        }.flow.cachedIn(viewModelScope)

    /** 多选状态：Screen 订阅驱动顶栏/角标（Task 7 接批量动作真回调）。 */
    val selection = SelectionState()

    /** 网格列数（spec §2.3 YAGNI）：仅内存态，默认 4，捏合钳 3..5，不持久化、不跨进程存活。 */
    val columns = MutableStateFlow(DEFAULT_COLUMNS)

    init {
        // 待落地相册永远查不到成员（尚无落地文件），名称已内嵌 key——跳过查询与订阅，省一路无意义脉冲
        if (bucketKey !is BucketKey.Pending) {
            gateway.observeChanges()
                .onStart { emit(Unit) } // 初始一发：不必等首次真实 MediaStore 变更才刷新标题/张数
                .onEach {
                    currentPagingSource?.invalidate()
                    refreshTitleAndCount()
                }
                .launchIn(viewModelScope)
        }
    }

    /**
     * 查一轮真实相册聚合，按当前上下文解出标题/张数；与 DeviceAlbumsViewModel 同款异常兜底——
     * CancellationException 必须原样重抛（结构化并发要求），其余异常退化空列表，本轮刷新静默
     * 跳过（权限中途被撤销等场景下不炸屏，保留上一次已知的标题/张数）。
     */
    private suspend fun refreshTitleAndCount() {
        val real = runCatching { gateway.queryAlbums() }
            .onFailure { if (it is CancellationException) throw it }
            .getOrElse { emptyList() }
        when (val key = bucketKey) {
            BucketKey.All -> {
                _title.value = ALL_TITLE
                _count.value = real.sumOf { it.count }
            }
            is BucketKey.Bucket -> {
                val album = real.firstOrNull { it.key == key } ?: return
                _title.value = album.name
                _count.value = album.count
            }
            is BucketKey.Pending -> Unit // 不可达：init 已按 Pending 跳过订阅
        }
    }

    companion object {
        const val MIN_COLUMNS = 3
        const val DEFAULT_COLUMNS = 4
        const val MAX_COLUMNS = 5
        private const val PAGE_SIZE = 60
        private const val ALL_TITLE = "全部照片"

        fun factory(graph: AppGraph, bucketKeyRaw: String): ViewModelProvider.Factory = viewModelFactory {
            initializer { DeviceAlbumDetailViewModel(graph.deviceMediaGateway, bucketKeyRaw) }
        }
    }
}
