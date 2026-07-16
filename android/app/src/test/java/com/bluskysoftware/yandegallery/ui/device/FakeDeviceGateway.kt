package com.bluskysoftware.yandegallery.ui.device

import android.net.Uri
import androidx.paging.PagingSource
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
 * 模拟 MediaStore 变更脉冲。分页/写操作类方法本任务用不到，未实现即抛，误用即测试失败而非静默
 * 返回假数据。
 */
class FakeDeviceGateway : DeviceMediaGateway {
    var albums: List<DeviceAlbum> = emptyList()
    var queryError: Throwable? = null
    val changes = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    override suspend fun queryAlbums(): List<DeviceAlbum> {
        queryError?.let { throw it }
        return albums
    }

    override fun observeChanges(): Flow<Unit> = changes

    override fun pagingSource(key: BucketKey): PagingSource<Int, DeviceMedia> = throw UnsupportedOperationException()

    override suspend fun mediaByIds(ids: List<Long>) = emptyList<DeviceMedia>()

    override suspend fun insertCopy(source: DeviceSource, targetRelativePath: String) =
        Result.failure<Uri>(UnsupportedOperationException())

    override fun deleteRequest(uris: List<Uri>) = throw UnsupportedOperationException()

    override fun writeRequest(uris: List<Uri>) = throw UnsupportedOperationException()

    override suspend fun moveTo(uris: List<Uri>, targetRelativePath: String) =
        Result.failure<Int>(UnsupportedOperationException())
}
