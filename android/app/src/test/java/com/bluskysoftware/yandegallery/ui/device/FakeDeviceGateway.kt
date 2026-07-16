package com.bluskysoftware.yandegallery.ui.device

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
 * 断言 invalidate。写操作类方法本任务用不到，未实现即抛，误用即测试失败而非静默返回假数据。
 */
class FakeDeviceGateway : DeviceMediaGateway {
    var albums: List<DeviceAlbum> = emptyList()
    var queryError: Throwable? = null
    var media: List<DeviceMedia> = emptyList()
    val changes = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val createdPagingSources = mutableListOf<PagingSource<Int, DeviceMedia>>()

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

    override suspend fun mediaByIds(ids: List<Long>) = emptyList<DeviceMedia>()

    override suspend fun insertCopy(source: DeviceSource, targetRelativePath: String) =
        Result.failure<Uri>(UnsupportedOperationException())

    override fun deleteRequest(uris: List<Uri>) = throw UnsupportedOperationException()

    override fun writeRequest(uris: List<Uri>) = throw UnsupportedOperationException()

    override suspend fun moveTo(uris: List<Uri>, targetRelativePath: String) =
        Result.failure<Int>(UnsupportedOperationException())
}
