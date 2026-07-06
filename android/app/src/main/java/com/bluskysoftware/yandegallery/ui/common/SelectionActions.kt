package com.bluskysoftware.yandegallery.ui.common

import androidx.work.WorkInfo
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.domain.download.ShareCoordinator
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

private const val QUERY_CHUNK = 900 // SQLite 绑定变量上限保守值（对齐 RoomMirrorStore.DELETE_CHUNK）

/**
 * 多选批量动作（M3-T13；M4-T9 注入 activeServerId——downloads 全链按激活服务器域读写）：
 * Photos/AlbumDetail 两个 VM 共享的实现载体，VM 以一行方法委托暴露。
 *
 * [enqueueDownload]/[observeDownloadState]/[gatewayExists] 以回调注入（生产接
 * graph.downloadManager 与 mediaStoreGateway），测试无需初始化 WorkManager/MediaStore。
 */
class SelectionActions(
    private val db: AppDatabase,
    private val writeRepository: WriteRepository,
    private val activeServerId: suspend () -> Long?,
    private val enqueueDownload: (Long, ImageEntity) -> Unit,
    private val observeDownloadState: (serverId: Long, imageId: Long) -> Flow<WorkInfo.State?>,
    private val gatewayExists: (String) -> Boolean,
) {
    /**
     * 批量动作前过滤隐形残留选中（M4-T14）：同步对账删行后，选择集里可能残留镜像无行的死 id，
     * 一律先滤除再操作，避免死 id 进服务端请求。
     */
    suspend fun filterExisting(ids: List<Long>): List<Long> =
        ids.filter { db.imageDao().byId(it) != null }

    /** 批量下载：逐个入队（T8 唯一工作名 KEEP 自动去重）；镜像行已被同步删掉的 id 静默跳过；无激活服务器无操作。 */
    suspend fun downloadAll(ids: List<Long>) {
        val serverId = activeServerId() ?: return
        filterExisting(ids).forEach { id -> db.imageDao().byId(id)?.let { enqueueDownload(serverId, it) } }
    }

    /**
     * 批量分享完整流（M4-T11 / D9）：已下载且文件仍在 → 直接取 uri；映射失效（行在文件亡）→
     * 清行后按未下载处理；未下载 → 入队原图下载（KEEP 去重）等终态后重查行分拆成败。
     * 镜像行已被同步删除的 id 无从下载，直接计入 failedIds；无激活服务器 → 全部计失败。
     * 取消语义：调用方协程取消只放弃等待，不取消底层下载（KEEP 队列继续、产物照常落库）。
     */
    suspend fun ensureShareUris(ids: List<Long>): ShareCoordinator.ShareOutcome {
        val serverId = activeServerId()
            ?: return ShareCoordinator.ShareOutcome(uris = emptyList(), failedIds = ids)
        val imageDao = db.imageDao()
        val existing = filterExisting(ids)                   // M4-T14：先滤死 id
        val missing = ids - existing.toSet()                 // 镜像已删：无从下载，直接计失败
        val entities = existing.mapNotNull { imageDao.byId(it) }
        val coordinator = ShareCoordinator(
            isDownloaded = { db.downloadDao().byImageId(serverId, it)?.mediaStoreUri },
            enqueue = { img -> enqueueDownload(serverId, img) },
            observeState = { observeDownloadState(serverId, it) },
            exists = gatewayExists,
            clearStaleRow = { db.downloadDao().delete(serverId, it) },
        )
        // 整段下移 IO（审查 Minor）：gatewayExists 为同步 MediaStore 查询，批量 N 次（预检 + 终态后重查）
        // 不宜占主线程；Room/入队/WorkInfo 收集均为挂起或线程安全调用，随迁无碍。
        val outcome = withContext(Dispatchers.IO) { coordinator.ensureDownloadedUris(entities) }
        return if (missing.isEmpty()) outcome
        else outcome.copy(failedIds = outcome.failedIds + missing)
    }

    /**
     * 选中项里是否有本服已下载副本（D12A 删除确认文案分支依据）：短路 any——命中首个即返回，
     * 不必物化整份 uri 列表。无激活服务器视为无副本。
     */
    suspend fun anyDownloaded(ids: List<Long>): Boolean {
        val serverId = activeServerId() ?: return false
        return filterExisting(ids).any { db.downloadDao().byImageId(serverId, it) != null }
    }

    /** 批删前快照已下载 uri（batchDelete 会清行，必须先取）；无激活服务器返回空。 */
    suspend fun downloadedUrisFor(ids: List<Long>): List<String> {
        val serverId = activeServerId() ?: return emptyList()
        return ids.chunked(QUERY_CHUNK).flatMap { chunk ->
            db.downloadDao().byImageIds(serverId, chunk).map { it.mediaStoreUri }
        }
    }

    /**
     * 批量删除（T6 batch 端点，部分失败自回滚失败项镜像行）；随后清掉「确实已删」id 的本服下载
     * 映射行（删后镜像行仍不存在的 id）——被回滚的 id 保留其行。本机系统相册副本的级联由
     * Screen 侧在成功后处理（spec §8：30+ 一次系统批量确认 / <30 逐条 deleteOwned）。
     */
    suspend fun batchDelete(ids: List<Long>): WriteResult {
        val existing = filterExisting(ids)                    // M4-T14：死 id 不进 batch 端点
        val result = writeRepository.batchDeleteImages(existing)
        val serverId = activeServerId()
        if (serverId != null) {
            val imageDao = db.imageDao()
            val downloadDao = db.downloadDao()
            existing.forEach { id -> if (imageDao.byId(id) == null) downloadDao.delete(serverId, id) }
        }
        return result
    }

    /** 批量加入图集（GalleryPickerDialog 选定后）；死 id 先滤（M4-T14）。 */
    suspend fun addToGallery(galleryId: Long, ids: List<Long>): WriteResult =
        writeRepository.addToGallery(galleryId, filterExisting(ids))

    /** 批量移出图集（仅图集详情多选）；死 id 先滤（M4-T14）。 */
    suspend fun removeFromGallery(galleryId: Long, ids: List<Long>): WriteResult =
        writeRepository.removeFromGallery(galleryId, filterExisting(ids))
}
