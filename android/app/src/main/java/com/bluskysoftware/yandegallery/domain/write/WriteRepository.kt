package com.bluskysoftware.yandegallery.domain.write

import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.db.*
import com.bluskysoftware.yandegallery.domain.ConnectionMonitor
import kotlinx.coroutines.CancellationException

/**
 * 写操作核心：乐观改本地 Room 镜像 → 调服务端 → 失败回滚。
 * 404 视为成功（目标已在桌面被删，spec §8），不回滚；每次写成功 requestSync() 作冗余对账 nudge。
 */
class WriteRepository(
    private val writeApi: WriteApi,
    private val db: AppDatabase,
    private val monitor: ConnectionMonitor,
    private val requestSync: () -> Unit,
) {
    /** 统一：跑一次写调用，成功 reportSuccess+nudge，404 当成功，其它失败 reportFailure。 */
    private suspend inline fun guarded(
        crossinline optimisticApply: suspend () -> Unit,
        crossinline rollback: suspend () -> Unit,
        crossinline call: suspend () -> Unit,
    ): WriteResult {
        optimisticApply()
        return try {
            call()
            monitor.reportSuccess()
            requestSync()
            WriteResult.Success
        } catch (e: ApiException) {
            if (e.httpStatus == 404) {                 // 目标已在桌面端被删——视为成功（spec §8）
                monitor.reportSuccess(); requestSync(); WriteResult.Success
            } else {
                rollback(); monitor.reportFailure(e)
                WriteResult.Failed(e.message, unauthorized = e.code == "UNAUTHORIZED")
            }
        } catch (e: CancellationException) {
            throw e   // 取消时结果未知，不回滚不上报，镜像靠下一轮同步对账收敛
        } catch (e: Exception) {
            rollback(); monitor.reportFailure(e)
            WriteResult.Failed(e.message ?: "写操作失败")
        }
    }

    suspend fun deleteImage(imageId: Long): WriteResult {
        val snapshot = db.imageDao().byId(imageId)
        return guarded(
            optimisticApply = { db.imageDao().deleteByIds(listOf(imageId)) },
            rollback = { if (snapshot != null) db.imageDao().upsertAll(listOf(snapshot)) },
            call = { writeApi.deleteImage(imageId) },
        )
    }

    suspend fun addTags(imageId: Long, names: List<String>): WriteResult = guarded(
        optimisticApply = {
            val ids = names.mapNotNull { db.tagDao().byName(it)?.id }   // 仅已知 tag 本地建链
            if (ids.isNotEmpty()) db.imageDao().insertTagLinks(ids.map { ImageTagEntity(imageId, it) })
        },
        rollback = {
            val ids = names.mapNotNull { db.tagDao().byName(it)?.id }
            if (ids.isNotEmpty()) db.imageDao().deleteTagLinks(imageId, ids)
        },
        call = { writeApi.addImageTags(imageId, names) },
    )

    suspend fun removeTags(imageId: Long, names: List<String>): WriteResult {
        val ids = names.mapNotNull { db.tagDao().byName(it)?.id }
        return guarded(
            optimisticApply = { if (ids.isNotEmpty()) db.imageDao().deleteTagLinks(imageId, ids) },
            rollback = { if (ids.isNotEmpty()) db.imageDao().insertTagLinks(ids.map { ImageTagEntity(imageId, it) }) },
            call = { writeApi.removeImageTags(imageId, names) },
        )
    }

    suspend fun createGallery(name: String): WriteResult {
        return try {
            val id = writeApi.createGallery(name)
            db.galleryDao().insertOne(GalleryEntity(id, name, null, 0))
            monitor.reportSuccess(); requestSync(); WriteResult.Success
        } catch (e: ApiException) {
            monitor.reportFailure(e); WriteResult.Failed(e.message, e.code == "UNAUTHORIZED")
        } catch (e: CancellationException) {
            throw e   // 取消时结果未知，不回滚不上报，镜像靠下一轮同步对账收敛
        } catch (e: Exception) {
            monitor.reportFailure(e); WriteResult.Failed(e.message ?: "新建图集失败")
        }
    }

    suspend fun renameGallery(galleryId: Long, name: String): WriteResult {
        val old = db.galleryDao().byId(galleryId)
        return guarded(
            optimisticApply = { db.galleryDao().updateName(galleryId, name) },
            rollback = { if (old != null) db.galleryDao().updateName(galleryId, old.name) },
            call = { writeApi.renameGallery(galleryId, name) },
        )
    }

    suspend fun deleteGallery(galleryId: Long): WriteResult {
        val old = db.galleryDao().byId(galleryId)
        return guarded(
            optimisticApply = { db.galleryDao().deleteById(galleryId); db.galleryDao().clearMembership(galleryId) },
            rollback = { if (old != null) db.galleryDao().insertOne(old) },  // 成员行靠下一轮 sync 恢复
            call = { writeApi.deleteGallery(galleryId) },
        )
    }

    suspend fun addToGallery(galleryId: Long, imageIds: List<Long>): WriteResult = guarded(
        optimisticApply = { db.imageDao().insertGalleryLinks(imageIds.map { GalleryImageEntity(galleryId, it) }) },
        rollback = { db.imageDao().deleteGalleryLinks(galleryId, imageIds) },
        call = { writeApi.addImagesToGallery(galleryId, imageIds) },
    )

    suspend fun removeFromGallery(galleryId: Long, imageIds: List<Long>): WriteResult = guarded(
        optimisticApply = { db.imageDao().deleteGalleryLinks(galleryId, imageIds) },
        rollback = { db.imageDao().insertGalleryLinks(imageIds.map { GalleryImageEntity(galleryId, it) }) },
        call = { writeApi.removeImagesFromGallery(galleryId, imageIds) },
    )

    /** 走服务端 batch-delete 端点（逐条成败），成功项乐观删镜像行；比逐个 deleteImage 少 N 次往返。 */
    suspend fun batchDeleteImages(imageIds: List<Long>): WriteResult {
        val snapshots = imageIds.mapNotNull { db.imageDao().byId(it) }
        db.imageDao().deleteByIds(imageIds)                       // 乐观全删
        return try {
            val results = writeApi.batchDeleteImages(imageIds)   // 逐条 {imageId,success,error}
            val failedIds = results.filter { !it.success && it.error != "NOT_FOUND" }.map { it.imageId }
            // NOT_FOUND 视为已删成功（spec §8）；真失败的回滚其镜像行
            snapshots.filter { it.id in failedIds }.let { if (it.isNotEmpty()) db.imageDao().upsertAll(it) }
            monitor.reportSuccess(); requestSync()
            if (failedIds.isEmpty()) WriteResult.Success else WriteResult.Failed("部分删除失败")
        } catch (e: ApiException) {
            db.imageDao().upsertAll(snapshots); monitor.reportFailure(e)
            WriteResult.Failed(e.message, e.code == "UNAUTHORIZED")
        } catch (e: CancellationException) {
            throw e   // 取消时结果未知，不回滚不上报，镜像靠下一轮同步对账收敛
        } catch (e: Exception) {
            db.imageDao().upsertAll(snapshots); monitor.reportFailure(e)
            WriteResult.Failed(e.message ?: "批量删除失败")
        }
    }
}
