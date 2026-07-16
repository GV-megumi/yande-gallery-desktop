package com.bluskysoftware.yandegallery.data.device

import android.app.PendingIntent
import android.net.Uri
import androidx.paging.PagingSource
import kotlinx.coroutines.flow.Flow
import java.io.File

/**
 * 手机域数据网关（spec §4）：本机相册/媒体的唯一数据入口，屏蔽 MediaStore 实现细节。
 * 后续 VM/worker 全部只依赖此接口，测试注入 fake；生产实现见 [MediaStoreDeviceGateway]。
 * 版本门控不在本接口内判断——`deleteRequest`/`writeRequest`/`insertCopy`/`moveTo` 能否调用
 * 由调用方经 [DeviceCapabilities] 统一判定（spec §7），接口本身对所有 API 级别都"存在"。
 */
interface DeviceMediaGateway {
    /** 真实相册聚合（不含待落地相册、不排序——排序由 [sortDeviceAlbums] 统一做，spec §4.3）。 */
    suspend fun queryAlbums(): List<DeviceAlbum>

    /** 相册网格分页数据源（时间倒序）；[BucketKey.Pending] 恒返回空页（尚无落地文件）。 */
    fun pagingSource(key: BucketKey): PagingSource<Int, DeviceMedia>

    /** 按 id 批量取行（分享/删除/移动等操作前，将已选 id 还原为完整 DeviceMedia）。 */
    suspend fun mediaByIds(ids: List<Long>): List<DeviceMedia>

    /** MediaStore 变更脉冲（ContentObserver 桥接）：仅通知"有变化"，不携带 diff，VM 侧收到后 invalidate。 */
    fun observeChanges(): Flow<Unit>

    /** 复制入本机相册（spec §5.3/§6.1）：源可以是手机媒体或桌面镜像文件，落地二者一视同仁。 */
    suspend fun insertCopy(source: DeviceSource, targetRelativePath: String): Result<Uri>

    /** 系统删除授权意图（`createDeleteRequest`，30+ API——调用方经 [DeviceCapabilities.canDelete] 门控）。 */
    fun deleteRequest(uris: List<Uri>): PendingIntent

    /** 系统写入授权意图（`createWriteRequest`，30+ API——调用方经 [DeviceCapabilities.canMove] 门控）。 */
    fun writeRequest(uris: List<Uri>): PendingIntent

    /** 授权通过后批量更新 RELATIVE_PATH 完成移动，返回成功条数（spec §5.3）。 */
    suspend fun moveTo(uris: List<Uri>, targetRelativePath: String): Result<Int>
}

/** 复制源二态（spec §5.3/§6.1）：手机→手机走 [Media]，桌面→手机（镜像文件）走 [LocalFile]。 */
sealed interface DeviceSource {
    data class Media(val media: DeviceMedia) : DeviceSource
    data class LocalFile(val file: File, val displayName: String, val mime: String) : DeviceSource
}
