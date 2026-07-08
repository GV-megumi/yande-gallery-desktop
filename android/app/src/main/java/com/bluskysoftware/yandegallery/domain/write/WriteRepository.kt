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
 *
 * 回滚对称性（BUG-03/04/15）：apply 用 IGNORE 建链时，回滚只能删「本次真正新建」的链，
 * 无条件全删会把操作前就存在的链一并删掉；删除类回滚须重建被 CASCADE 级联删的图集/标签链——
 * 例行增量同步不会重拉 changeSeq 未变的图，丢掉的链不自愈（持续到全量重建）。
 */
class WriteRepository(
    private val writeApi: WriteApi,
    private val db: AppDatabase,
    private val monitor: ConnectionMonitor,
    private val requestSync: () -> Unit,
) {
    /**
     * 统一：跑一次写调用，成功 reportSuccess+nudge，404 当成功，其它失败 reportFailure。
     * 服务器已应答的失败（ApiException 非 404）额外 requestSync：回滚残差以服务端为准收敛（BUG-02）。
     */
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
                rollback(); monitor.reportFailure(e); requestSync()
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
        // 链快照（BUG-03）：deleteByIds 会 CASCADE 删掉 gallery_images/image_tags，回滚只 upsert
        // 镜像行不会带回链——曾致「删除失败」后图从图集/标签搜索凭空消失
        val galleryLinks = db.imageDao().galleryLinksOfImages(listOf(imageId))
        val tagLinks = db.imageDao().tagLinksOfImages(listOf(imageId))
        return guarded(
            optimisticApply = { db.imageDao().deleteByIds(listOf(imageId)) },
            rollback = {
                if (snapshot != null) {
                    db.imageDao().upsertAll(listOf(snapshot))
                    if (galleryLinks.isNotEmpty()) db.imageDao().insertGalleryLinks(galleryLinks)
                    if (tagLinks.isNotEmpty()) db.imageDao().insertTagLinks(tagLinks)
                }
            },
            call = { writeApi.deleteImage(imageId) },
        )
    }

    suspend fun addTags(imageId: Long, names: List<String>): WriteResult {
        val ids = names.mapNotNull { db.tagDao().byName(it)?.id }   // 仅已知 tag 本地建链
        // 只回滚真正新建的链（BUG-15）：apply 的 IGNORE 对已存在链无操作，回滚无条件全删
        // 会把操作前就存在的同名链删掉
        val newIds = ids - db.imageDao().existingTagLinkTagIds(imageId, ids).toSet()
        return guarded(
            optimisticApply = {
                if (newIds.isNotEmpty()) db.imageDao().insertTagLinks(newIds.map { ImageTagEntity(imageId, it) })
            },
            rollback = { if (newIds.isNotEmpty()) db.imageDao().deleteTagLinks(imageId, newIds) },
            call = { writeApi.addImageTags(imageId, names) },
        )
    }

    suspend fun removeTags(imageId: Long, names: List<String>): WriteResult {
        val ids = names.mapNotNull { db.tagDao().byName(it)?.id }
        // 只回滚删前真实存在的链（与 addTags 对称）：不存在的链回滚重建会凭空加标签
        val present = db.imageDao().existingTagLinkTagIds(imageId, ids)
        return guarded(
            optimisticApply = { if (present.isNotEmpty()) db.imageDao().deleteTagLinks(imageId, present) },
            rollback = {
                if (present.isNotEmpty()) db.imageDao().insertTagLinks(present.map { ImageTagEntity(imageId, it) })
            },
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
        // 成员链快照（BUG-03 同族）：clearMembership 后回滚只恢复图集行，成员链例行同步不重建
        //（成员图 changeSeq 未变）——曾致「删除失败」的图集回来时变空
        val membership = db.galleryDao().membershipOf(galleryId)
        return guarded(
            optimisticApply = { db.galleryDao().deleteById(galleryId); db.galleryDao().clearMembership(galleryId) },
            rollback = {
                if (old != null) {
                    db.galleryDao().insertOne(old)
                    if (membership.isNotEmpty()) db.imageDao().insertGalleryLinks(membership)
                }
            },
            call = { writeApi.deleteGallery(galleryId) },
        )
    }

    suspend fun addToGallery(galleryId: Long, imageIds: List<Long>): WriteResult {
        // 空集直接成功（BUG-14）：调用方滤重/滤死后可能为空，发给桌面会 422 → 虚假「失败」
        if (imageIds.isEmpty()) return WriteResult.Success
        // 只回滚真正新增的链（BUG-04）：选中项含已在图集的 X 时，失败回滚曾把 X 一并静默移出
        val existing = db.imageDao().existingGalleryLinkImageIds(galleryId, imageIds).toSet()
        val newIds = imageIds.filter { it !in existing }
        return guarded(
            optimisticApply = {
                if (newIds.isNotEmpty()) db.imageDao().insertGalleryLinks(newIds.map { GalleryImageEntity(galleryId, it) })
            },
            rollback = { if (newIds.isNotEmpty()) db.imageDao().deleteGalleryLinks(galleryId, newIds) },
            call = { writeApi.addImagesToGallery(galleryId, imageIds) },
        )
    }

    suspend fun removeFromGallery(galleryId: Long, imageIds: List<Long>): WriteResult {
        if (imageIds.isEmpty()) return WriteResult.Success   // 空集直接成功（BUG-14，同 addToGallery）
        // 只回滚删前真实存在的链：不存在的链回滚重建会凭空加成员
        val present = db.imageDao().existingGalleryLinkImageIds(galleryId, imageIds)
        return guarded(
            optimisticApply = { if (present.isNotEmpty()) db.imageDao().deleteGalleryLinks(galleryId, present) },
            rollback = {
                if (present.isNotEmpty()) db.imageDao().insertGalleryLinks(present.map { GalleryImageEntity(galleryId, it) })
            },
            call = { writeApi.removeImagesFromGallery(galleryId, imageIds) },
        )
    }

    /** 批删（M4-T14 加固）：去重 + 按 900 分块调 batch 端点；某块失败回滚该块与未发块，已成块保持。 */
    suspend fun batchDeleteImages(imageIds: List<Long>): WriteResult {
        val unique = imageIds.distinct()
        val snapshots = unique.mapNotNull { db.imageDao().byId(it) }.associateBy { it.id }
        // 链快照按 900 分块查（BUG-03 批量版）：回滚 upsert 镜像行不会带回被 CASCADE 删的链
        val galleryLinks = unique.chunked(BATCH_CHUNK)
            .flatMap { db.imageDao().galleryLinksOfImages(it) }.groupBy { it.imageId }
        val tagLinks = unique.chunked(BATCH_CHUNK)
            .flatMap { db.imageDao().tagLinksOfImages(it) }.groupBy { it.imageId }

        suspend fun restore(ids: Collection<Long>) {
            val rows = ids.mapNotNull { snapshots[it] }
            if (rows.isEmpty()) return
            db.imageDao().upsertAll(rows)
            rows.flatMap { galleryLinks[it.id].orEmpty() }
                .let { if (it.isNotEmpty()) db.imageDao().insertGalleryLinks(it) }
            rows.flatMap { tagLinks[it.id].orEmpty() }
                .let { if (it.isNotEmpty()) db.imageDao().insertTagLinks(it) }
        }

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
                restore(chunks.drop(index).flatten())
                monitor.reportFailure(e)
                if (e is ApiException) requestSync()   // 服务器已应答：对账一次收敛回滚残差（BUG-02）
                return WriteResult.Failed(
                    (e as? ApiException)?.message ?: (e.message ?: "批量删除失败"),
                    unauthorized = (e as? ApiException)?.code == "UNAUTHORIZED",
                )
            }
        }
        restore(failedIds)
        monitor.reportSuccess(); requestSync()
        return if (failedIds.isEmpty()) WriteResult.Success else WriteResult.Failed("部分删除失败")
    }
}
