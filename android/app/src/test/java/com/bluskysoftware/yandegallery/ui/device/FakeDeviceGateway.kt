package com.bluskysoftware.yandegallery.ui.device

import android.app.PendingIntent
import android.net.Uri
import androidx.paging.PagingSource
import androidx.paging.PagingState
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import com.bluskysoftware.yandegallery.data.device.DeviceMediaGateway
import com.bluskysoftware.yandegallery.data.device.DeviceSource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow

/**
 * [DeviceMediaGateway] 测试替身（Task 5 起共享，Task 6/7/8 复用）：[albums] 直接赋值模拟
 * queryAlbums 返回；[queryError] 非空时 queryAlbums 改为抛出该异常（review Finding 1：模拟权限
 * 会话中途被撤销时 MediaStoreDeviceGateway 抛 SecurityException 的场景）；[changes] 手动 tryEmit
 * 模拟 MediaStore 变更脉冲。[media]/[pagingSource]（Task 6 起）：内部 [FakeMediaPagingSource]
 * 镜像 MediaStoreDeviceGateway.DeviceMediaPagingSource 的 offset 分页与 prevKey/nextKey 公式，
 * 数据源换成内存 List；每次调用都把新建实例记进 [createdPagingSources]，供测试取「上一代」
 * 断言 invalidate。
 *
 * 写操作（Task 7 起）：全部带「入参记录 + 可配置结果」双旋钮——insertCopy 走 [insertCopyHandler]
 * （逐张定制成败），moveTo/deleteRequest/writeRequest 各配 result 字段；**未显式配置时保持
 * 未实现即抛/返回失败**（沿用建立以来的口径：误用即测试红灯，而非静默返回假数据）。
 */
class FakeDeviceGateway : DeviceMediaGateway {
    var albums: List<DeviceAlbum> = emptyList()
    var queryError: Throwable? = null
    var media: List<DeviceMedia> = emptyList()
    val changes = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val createdPagingSources = mutableListOf<PagingSource<Int, DeviceMedia>>()

    /** insertCopy 入参记录（source + targetRelativePath），按调用顺序追加。 */
    val insertCopyCalls = mutableListOf<Pair<DeviceSource, String>>()

    /** insertCopy 结果定制：默认未配置即失败（UnsupportedOperationException），测试显式覆写。 */
    var insertCopyHandler: (DeviceSource, String) -> Result<Uri> =
        { _, _ -> Result.failure(UnsupportedOperationException("insertCopy 未配置")) }

    /** findCopy 入参记录与结果定制（Task 10 导出查重）：默认查无副本 null——查重是"没有才插"
     * 语义，null 即"放行 insert"，是无害缺省，不沿用"未配置即抛"口径。 */
    val findCopyCalls = mutableListOf<Pair<String, String>>()
    var findCopyHandler: (String, String) -> Uri? = { _, _ -> null }

    /** moveTo 入参记录（uris + targetRelativePath）与可配置结果（null=未配置即失败）。 */
    val moveToCalls = mutableListOf<Pair<List<Uri>, String>>()
    var moveToResult: Result<Int>? = null

    /** deleteRequest/writeRequest 入参记录与占位 PendingIntent（null=未配置即抛，Robolectric 下用 PendingIntent.getActivity 构造）。 */
    val deleteRequestCalls = mutableListOf<List<Uri>>()
    var deleteRequestResult: PendingIntent? = null
    val writeRequestCalls = mutableListOf<List<Uri>>()
    var writeRequestResult: PendingIntent? = null

    override suspend fun queryAlbums(): List<DeviceAlbum> {
        queryError?.let { throw it }
        return albums
    }

    override fun observeChanges(): Flow<Unit> = changes

    override fun pagingSource(key: BucketKey): PagingSource<Int, DeviceMedia> =
        FakeMediaPagingSource(key).also { createdPagingSources += it }

    /** 镜像生产 DeviceMediaPagingSource：LIMIT/OFFSET 换成 List.drop/take，公式原样照抄；inner
     * class 直接读外层可变 [media]，每次 load() 都是"即时查询"语义，不缓存构造期快照。 */
    private inner class FakeMediaPagingSource(private val key: BucketKey) : PagingSource<Int, DeviceMedia>() {
        override fun getRefreshKey(state: PagingState<Int, DeviceMedia>): Int? {
            val anchor = state.anchorPosition ?: return null
            val page = state.closestPageToPosition(anchor) ?: return null
            return page.prevKey?.plus(state.config.pageSize) ?: page.nextKey?.minus(state.config.pageSize)
        }

        override suspend fun load(params: LoadParams<Int>): LoadResult<Int, DeviceMedia> {
            if (key is BucketKey.Pending) return LoadResult.Page(emptyList(), null, null)
            val offset = params.key ?: 0
            val limit = params.loadSize
            val items = media.drop(offset).take(limit)
            val prevKey = if (offset == 0) null else maxOf(0, offset - limit)
            val nextKey = if (items.size < limit) null else offset + limit
            return LoadResult.Page(items, prevKey, nextKey)
        }
    }

    /** 选中 id → 完整行还原：镜像生产语义按 [media] 现有列表过滤（保持入参顺序无关、以库序为准）。 */
    override suspend fun mediaByIds(ids: List<Long>): List<DeviceMedia> {
        val wanted = ids.toSet()
        return media.filter { it.mediaId in wanted }
    }

    override suspend fun insertCopy(source: DeviceSource, targetRelativePath: String): Result<Uri> {
        insertCopyCalls += source to targetRelativePath
        return insertCopyHandler(source, targetRelativePath)
    }

    override suspend fun findCopy(targetRelativePath: String, displayName: String): Uri? {
        findCopyCalls += targetRelativePath to displayName
        return findCopyHandler(targetRelativePath, displayName)
    }

    override fun deleteRequest(uris: List<Uri>): PendingIntent {
        deleteRequestCalls += uris
        return deleteRequestResult ?: throw UnsupportedOperationException("deleteRequest 未配置")
    }

    override fun writeRequest(uris: List<Uri>): PendingIntent {
        writeRequestCalls += uris
        return writeRequestResult ?: throw UnsupportedOperationException("writeRequest 未配置")
    }

    override suspend fun moveTo(uris: List<Uri>, targetRelativePath: String): Result<Int> {
        moveToCalls += uris to targetRelativePath
        return moveToResult ?: Result.failure(UnsupportedOperationException("moveTo 未配置"))
    }
}
