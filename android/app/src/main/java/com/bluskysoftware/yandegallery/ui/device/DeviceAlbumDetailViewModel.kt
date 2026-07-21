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
import com.bluskysoftware.yandegallery.data.device.validateNewAlbumName
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.ui.common.SelectionState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.launch

/**
 * 相册网格页 VM（Task 6，spec §2.2）：解出 [bucketKey] 上下文（All/Bucket/Pending），驱动分页网格
 * 与标题/张数展示。MediaStore 无原生可观察查询，[gateway] 的 [DeviceMediaGateway.observeChanges]
 * 脉冲驱动两件事：
 * 1）让 [Pager] 手上持有的当前 [PagingSource] 失效重拉（brief 契约，非重建整个 Pager）；
 * 2）顺带刷新 [title]/[count]（brief 未明确要求，但与 DeviceAlbumsViewModel 同源同款查询、同款
 *    异常兜底——本屏「N 张」跟着相册实际内容走才是正确行为，复用 sibling 惯例成本几乎为零）。
 * Pending（待落地）相册恒无成员、名称已内嵌 key，不查询、不订阅脉冲。
 *
 * 批量操作（Task 7，spec §5.3/§5.4）：分享/删除/复制/移动统一先把选中 id 经
 * [DeviceMediaGateway.mediaByIds] 还原完整行——因此删除/移动的授权请求也是 suspend
 * （brief 接口签名按字面是普通 fun，但其 Consumes 清单里的 mediaByIds 本身是 suspend，
 * id→uri 还原绕不开异步，Screen 侧统一 `scope.launch` 收口）。删除/移动的系统弹窗 uris
 * **批量一次全量传入**；大图页（Task 8）复用同一套方法，单张 = 恰选一项。
 * [prefsStore] 只用于复制落地后的待落地占位收编与 picker 内联新建（spec §5.5）。
 */
class DeviceAlbumDetailViewModel(
    private val gateway: DeviceMediaGateway,
    private val prefsStore: PrefsStore,
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

    /** 多选状态：Screen 订阅驱动顶栏/角标与批量动作（Task 7 底栏真回调）。 */
    val selection = SelectionState()

    /** 网格列数（spec §2.3 YAGNI）：仅内存态，默认 4，捏合钳 3..5，不持久化、不跨进程存活。 */
    val columns = MutableStateFlow(DEFAULT_COLUMNS)

    /**
     * 最近一次 [targetAlbums] 结果快照：给 [createTargetAlbum] 做同步重名校验用（对照
     * DeviceAlbumsViewModel.createPendingAlbum 读 albums.value 的既有惯例——picker 打开前必先
     * 走一遍 targetAlbums，快照必然新鲜）。
     */
    private var lastTargetAlbums: List<DeviceAlbum> = emptyList()

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

    /** 选中 id → 完整行（顺序以 MediaStore 库序为准，网关契约）；空选中天然得空列表。 */
    private suspend fun selectedMedia(): List<DeviceMedia> =
        gateway.mediaByIds(selection.selected.toList())

    /** 分享：还原选中完整行交 Screen 组 ACTION_SEND(_MULTIPLE)（uri/mime 都在行内，VM 不碰 Intent）。 */
    suspend fun shareSelected(): List<DeviceMedia> = selectedMedia()

    /**
     * 删除授权意图（spec §5.3）：选中 uris **批量一次全量**传入 `createDeleteRequest`；空选中返回
     * null 不触网关。Screen 用 StartIntentSenderForResult 发射，RESULT_OK 后只 `selection.clear()`
     * ——列表刷新靠 MediaStore observer 脉冲，不手动重查。
     */
    suspend fun deleteSelected(): PendingIntent? {
        val uris = selectedMedia().map { it.uri }
        if (uris.isEmpty()) return null
        return gateway.deleteRequest(uris)
    }

    /** 移动第一步：系统写授权意图（`createWriteRequest`，同款批量一次/空选中 null 语义）。 */
    suspend fun moveWriteRequest(): PendingIntent? {
        val uris = selectedMedia().map { it.uri }
        if (uris.isEmpty()) return null
        return gateway.writeRequest(uris)
    }

    /** 移动第二步：授权 RESULT_OK 后批量改 RELATIVE_PATH；目标路径原样透传网关（spec §5.3）。 */
    suspend fun moveSelectedTo(path: String): Result<Int> {
        val uris = selectedMedia().map { it.uri }
        if (uris.isEmpty()) return Result.success(0)
        return gateway.moveTo(uris, path)
    }

    /**
     * 复制到目标相册（spec §5.3/§6.1）：逐张 `insertCopy(DeviceSource.Media, path)` 计成功数并返回
     * （失败数 = 选中数 - 返回值，由 Screen 提示）。成功 ≥1 张且目标恰为某待落地占位的
     * `Pictures/<名>/` 路径时顺手清占位记录——真实 bucket 已随首张落地诞生（Task 5 的收编逻辑
     * 对「下一轮相册查询才发现」的时序兜底，这里是即时清理的快路径，spec §5.5）。
     */
    suspend fun copySelectedTo(path: String): Int {
        val medias = selectedMedia()
        var ok = 0
        for (m in medias) {
            if (gateway.insertCopy(DeviceSource.Media(m), path).isSuccess) ok++
        }
        if (ok > 0) {
            val pending = prefsStore.devicePendingAlbums.first()
            pending.firstOrNull { "Pictures/$it/" == path }?.let { prefsStore.removePendingAlbum(it) }
        }
        return ok
    }

    /**
     * 复制/移动目标候选（picker 数据源）：真实相册 + 未收编待落地占位，复用 DeviceAlbumsViewModel
     * 的 [buildTargetAlbums] 组装（同款收编去重/排序，无聚合卡）；查询异常兜底同 [refreshTitleAndCount]。
     */
    suspend fun targetAlbums(): List<DeviceAlbum> {
        val real = runCatching { gateway.queryAlbums() }
            .onFailure { if (it is CancellationException) throw it }
            .getOrElse { emptyList() }
        val pending = prefsStore.devicePendingAlbums.first()
        return buildTargetAlbums(real, pending).also { lastTargetAlbums = it }
    }

    /**
     * picker 内联新建（spec §5.5）：对最近一次目标候选快照做重名校验（真实与待落地一视同仁），
     * 通过即写入待落地占位并返回 null；错误文案由 picker 就地显示。落地闭环：新建 → onPick
     * `Pictures/<名>/` → [copySelectedTo] 成功 ≥1 张 → 占位记录即时清除。
     */
    fun createTargetAlbum(name: String): String? {
        val trimmed = name.trim()
        val error = validateNewAlbumName(trimmed, lastTargetAlbums.map { it.name }.toSet())
        if (error != null) return error
        viewModelScope.launch { prefsStore.addPendingAlbum(trimmed) }
        return null
    }

    companion object {
        const val MIN_COLUMNS = 3
        const val DEFAULT_COLUMNS = 4
        const val MAX_COLUMNS = 5
        private const val PAGE_SIZE = 60
        private const val ALL_TITLE = "全部照片"

        fun factory(graph: AppGraph, bucketKeyRaw: String): ViewModelProvider.Factory = viewModelFactory {
            initializer { DeviceAlbumDetailViewModel(graph.deviceMediaGateway, graph.prefsStore, bucketKeyRaw) }
        }
    }
}
