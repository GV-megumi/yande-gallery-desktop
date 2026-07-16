package com.bluskysoftware.yandegallery.ui.common

import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import com.bluskysoftware.yandegallery.domain.download.ShareCoordinator
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * 多选批量动作（M3-T13；镜像层改造 spec §4.4）：Photos/AlbumDetail 两个 VM 共享的实现载体，
 * VM 以一行方法委托暴露。
 *
 * [localFile]/[ensureTier]/[saveMode]/[online]/[enqueueOriginal] 以回调注入（生产接
 * graph.imageMirrorStore / prefsStore / connectionMonitor / downloadManager），
 * 测试无需初始化 WorkManager/网络栈。
 */
class SelectionActions(
    private val db: AppDatabase,
    private val writeRepository: WriteRepository,
    private val activeServerId: suspend () -> Long?,
    private val localFile: suspend (imageId: Long) -> File?,          // ImageMirrorStore.localFile(...)?.file
    private val ensureTier: suspend (imageId: Long, tier: MirrorTier) -> Result<File>,
    private val saveMode: suspend () -> MirrorTier,
    private val online: () -> Boolean,
    private val enqueueOriginal: (Long, ImageEntity) -> Unit,         // downloadAll 用（原图批量下载仍走 WorkManager）
) {
    /**
     * 批量动作前过滤隐形残留选中（M4-T14）：同步对账删行后，选择集里可能残留镜像无行的死 id，
     * 一律先滤除再操作，避免死 id 进服务端请求。
     */
    suspend fun filterExisting(ids: List<Long>): List<Long> =
        ids.filter { db.imageDao().byId(it) != null }

    /** 批量下载：逐个入队原图（T8 唯一工作名 KEEP 自动去重）；镜像行已被同步删掉的 id 静默跳过；无激活服务器无操作。 */
    suspend fun downloadAll(ids: List<Long>) {
        val serverId = activeServerId() ?: return
        filterExisting(ids).forEach { id -> db.imageDao().byId(id)?.let { enqueueOriginal(serverId, it) } }
    }

    /** 批量分享（spec §4.4）：镜像四级规则；镜像行已被同步删除的 id 直接计失败。 */
    suspend fun ensureShareFiles(ids: List<Long>): ShareCoordinator.ShareOutcome {
        val imageDao = db.imageDao()
        val existing = filterExisting(ids)
        val missing = ids - existing.toSet()
        val entities = existing.mapNotNull { imageDao.byId(it) }
        val coordinator = ShareCoordinator(localFile, ensureTier, saveMode, online)
        val outcome = withContext(Dispatchers.IO) { coordinator.shareFiles(entities) }
        return if (missing.isEmpty()) outcome
        else outcome.copy(failedIds = outcome.failedIds + missing)
    }

    /**
     * 选中项里是否有本机原图（D12A 删除确认文案分支依据）：查 image_files 登记行的档位，
     * 短路 any——命中首个即返回。无激活服务器视为无副本。
     */
    suspend fun anyDownloaded(ids: List<Long>): Boolean {
        val serverId = activeServerId() ?: return false
        return filterExisting(ids).any {
            db.imageFileDao().byImageId(serverId, it)?.tier == MirrorTier.ORIGINAL.name
        }
    }

    /**
     * 批量删除（T6 batch 端点，部分失败自回滚失败项镜像行）。镜像文件与 image_files 登记行的
     * 级联由对账链路（RoomMirrorStore.deleteImages）收口，Screen/本层不再手动清副本。
     */
    suspend fun batchDelete(ids: List<Long>): WriteResult {
        val existing = filterExisting(ids)                    // M4-T14：死 id 不进 batch 端点
        return writeRepository.batchDeleteImages(existing)
    }

    /** 批量加入相册（GalleryPickerDialog 选定后）；死 id 先滤（M4-T14）。 */
    suspend fun addToGallery(galleryId: Long, ids: List<Long>): WriteResult =
        writeRepository.addToGallery(galleryId, filterExisting(ids))

    /** 批量移出相册（仅相册详情多选）；死 id 先滤（M4-T14）。 */
    suspend fun removeFromGallery(galleryId: Long, ids: List<Long>): WriteResult =
        writeRepository.removeFromGallery(galleryId, filterExisting(ids))

    /** 移动到相册（仅相册详情多选，spec §6.2）；死 id 先滤（M4-T14 同族）。 */
    suspend fun moveToGallery(fromGalleryId: Long, toGalleryId: Long, ids: List<Long>): WriteResult =
        writeRepository.moveToGallery(fromGalleryId, toGalleryId, filterExisting(ids))
}
