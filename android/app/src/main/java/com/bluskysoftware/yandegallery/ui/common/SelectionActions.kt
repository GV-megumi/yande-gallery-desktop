package com.bluskysoftware.yandegallery.ui.common

import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult

private const val QUERY_CHUNK = 900 // SQLite 绑定变量上限保守值（对齐 RoomMirrorStore.DELETE_CHUNK）

/**
 * 多选批量动作（M3-T13；M4-T9 注入 activeServerId——downloads 全链按激活服务器域读写）：
 * Photos/AlbumDetail 两个 VM 共享的实现载体，VM 以一行方法委托暴露。
 *
 * [enqueueDownload] 以回调注入（生产接 graph.downloadManager.enqueue(serverId, ...)），
 * 测试无需初始化 WorkManager。
 */
class SelectionActions(
    private val db: AppDatabase,
    private val writeRepository: WriteRepository,
    private val activeServerId: suspend () -> Long?,
    private val enqueueDownload: (Long, ImageEntity) -> Unit,
) {
    /** 批量下载：逐个入队（T8 唯一工作名 KEEP 自动去重）；镜像行已被同步删掉的 id 静默跳过；无激活服务器无操作。 */
    suspend fun downloadAll(ids: List<Long>) {
        val serverId = activeServerId() ?: return
        ids.forEach { id -> db.imageDao().byId(id)?.let { enqueueDownload(serverId, it) } }
    }

    /**
     * 批量分享 URI 装配：全部已下载 → 各自 MediaStore content:// uri；任一未下载 → null（调用方提示先下载）。
     * 按需查 DownloadDao（而非 T9 的 Eagerly 常驻 map）：分享只在点击瞬间需要映射，
     * 列表 VM 不必为此常驻一个热收集器。无激活服务器 → null（等同全部未下载）。
     */
    suspend fun shareUrisFor(ids: List<Long>): List<String>? {
        val serverId = activeServerId() ?: return null
        val dao = db.downloadDao()
        return ids.map { dao.byImageId(serverId, it)?.mediaStoreUri ?: return null }
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
        val result = writeRepository.batchDeleteImages(ids)
        val serverId = activeServerId()
        if (serverId != null) {
            val imageDao = db.imageDao()
            val downloadDao = db.downloadDao()
            ids.forEach { id -> if (imageDao.byId(id) == null) downloadDao.delete(serverId, id) }
        }
        return result
    }

    /** 批量加入图集（GalleryPickerDialog 选定后）。 */
    suspend fun addToGallery(galleryId: Long, ids: List<Long>): WriteResult =
        writeRepository.addToGallery(galleryId, ids)

    /** 批量移出图集（仅图集详情多选）。 */
    suspend fun removeFromGallery(galleryId: Long, ids: List<Long>): WriteResult =
        writeRepository.removeFromGallery(galleryId, ids)
}
