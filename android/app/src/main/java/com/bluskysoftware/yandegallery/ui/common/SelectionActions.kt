package com.bluskysoftware.yandegallery.ui.common

import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult

/**
 * 多选批量动作（M3-T13）：Photos/AlbumDetail 两个 VM 共享的实现载体，VM 以一行方法委托暴露。
 *
 * [enqueueDownload] 以回调注入（生产接 graph.downloadManager.enqueue），测试无需初始化 WorkManager。
 */
class SelectionActions(
    private val db: AppDatabase,
    private val writeRepository: WriteRepository,
    private val enqueueDownload: (ImageEntity) -> Unit,
) {
    /** 批量下载：逐个入队（T8 唯一工作名 KEEP 自动去重）；镜像行已被同步删掉的 id 静默跳过。 */
    suspend fun downloadAll(ids: List<Long>) {
        ids.forEach { id -> db.imageDao().byId(id)?.let(enqueueDownload) }
    }

    /**
     * 批量分享 URI 装配：全部已下载 → 各自 MediaStore content:// uri；任一未下载 → null（调用方提示先下载）。
     * 按需查 DownloadDao（而非 T9 的 Eagerly 常驻 map）：分享只在点击瞬间需要映射，
     * 列表 VM 不必为此常驻一个热收集器。
     */
    suspend fun shareUrisFor(ids: List<Long>): List<String>? {
        val dao = db.downloadDao()
        return ids.map { dao.byImageId(it)?.mediaStoreUri ?: return null }
    }

    /**
     * 批量删除（T6 batch 端点，部分失败自回滚失败项镜像行）；随后清掉「确实已删」的下载映射行
     * （删后镜像行仍不存在的 id）——被回滚的 id 保留其行。本机系统相册副本按 controller 裁定
     * 不级联删除（批量系统确认流是 M4 范畴），文件仍留在系统相册。
     */
    suspend fun batchDelete(ids: List<Long>): WriteResult {
        val result = writeRepository.batchDeleteImages(ids)
        val imageDao = db.imageDao()
        val downloadDao = db.downloadDao()
        ids.forEach { id -> if (imageDao.byId(id) == null) downloadDao.delete(id) }
        return result
    }

    /** 批量加入图集（GalleryPickerDialog 选定后）。 */
    suspend fun addToGallery(galleryId: Long, ids: List<Long>): WriteResult =
        writeRepository.addToGallery(galleryId, ids)

    /** 批量移出图集（仅图集详情多选）。 */
    suspend fun removeFromGallery(galleryId: Long, ids: List<Long>): WriteResult =
        writeRepository.removeFromGallery(galleryId, ids)
}
