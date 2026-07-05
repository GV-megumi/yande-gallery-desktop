package com.bluskysoftware.yandegallery.domain.write

import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.db.*
import com.bluskysoftware.yandegallery.domain.ConnectionMonitor
import kotlinx.coroutines.CancellationException

// 批删语义分块上限（对齐 RoomMirrorStore 的 900：SQLite 绑定变量/URL 长度保守值，M4-T14）
private const val BATCH_CHUNK = 900

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

    /** 批删（M4-T14 加固）：去重 + 按 900 分块调 batch 端点；某块失败回滚该块与未发块，已成块保持。 */
    suspend fun batchDeleteImages(imageIds: List<Long>): WriteResult {
        val unique = imageIds.distinct()
        val snapshots = unique.mapNotNull { db.imageDao().byId(it) }.associateBy { it.id }
        db.imageDao().deleteByIds(unique)                       // 乐观全删
        val failedIds = mutableListOf<Long>()
        val chunks = unique.chunked(BATCH_CHUNK)
        for ((index, chunk) in chunks.withIndex()) {
            try {
                val results = writeApi.batchDeleteImages(chunk)
                // NOT_FOUND 视为已删成功（spec §8）；真失败回滚镜像行
                failedIds += results.filter { !it.success && it.error != "NOT_FOUND" }.map { it.imageId }
            } catch (e: CancellationException) {
                throw e   // 取消时结果未知：不回滚不上报，镜像靠下一轮同步对账收敛（M3 惯例）
            } catch (e: Exception) {
                // 本块 + 未发块整体回滚；已成功块保持删除
                val rollback = (chunks.drop(index).flatten()).mapNotNull { snapshots[it] }
                if (rollback.isNotEmpty()) db.imageDao().upsertAll(rollback)
                monitor.reportFailure(e)
                return WriteResult.Failed(
                    (e as? ApiException)?.message ?: (e.message ?: "批量删除失败"),
                    unauthorized = (e as? ApiException)?.code == "UNAUTHORIZED",
                )
            }
        }
        snapshots.values.filter { it.id in failedIds }.let { if (it.isNotEmpty()) db.imageDao().upsertAll(it) }
        monitor.reportSuccess(); requestSync()
        return if (failedIds.isEmpty()) WriteResult.Success else WriteResult.Failed("部分删除失败")
    }
}
