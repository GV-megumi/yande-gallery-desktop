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
 * 无条件全删会把操作前就存在的链一并删掉；删除类回滚须重建被 CASCADE 级联删的相册/标签链——
 * 例行增量同步不会重拉 changeSeq 未变的图，丢掉的链不自愈（持续到全量重建）。
 */
class WriteRepository(
    private val writeApi: WriteApi,
    private val db: AppDatabase,
    private val monitor: ConnectionMonitor,
    private val activeServerId: suspend () -> Long? = { null },
    private val removeMirrorFiles: suspend (Long, List<Long>) -> Unit = { _, _ -> },
    private val requestSync: () -> Unit,
) {
    // IN (:ids) 类 DAO 调用一律经此分块（审查确认 major）：API 26–30 框架 SQLite 绑定变量
    // 上限 999，千级全选「加入/移出相册」会在乐观路径抛 too many SQL variables 直接崩溃
    //（Robolectric 自带 SQLite 上限 32766，单测拦不住，靠此约定守护）。
    private suspend fun existingGalleryLinksChunked(galleryId: Long, imageIds: List<Long>): List<Long> =
        imageIds.chunked(BATCH_CHUNK).flatMap { db.imageDao().existingGalleryLinkImageIds(galleryId, it) }

    private suspend fun deleteGalleryLinksChunked(galleryId: Long, imageIds: List<Long>) {
        imageIds.chunked(BATCH_CHUNK).forEach { db.imageDao().deleteGalleryLinks(galleryId, it) }
    }

    /**
     * 主动级联清理镜像文件（Task 8 审查遗留项：App 内发起的删除永不级联镜像文件）：
     * db.imageDao().deleteByIds 把 images 行整行抹掉后，SyncEngine 对账的 stale-diff
     * （本地 id 集合里挑「不在远端集合」的）从此永远看不到该 id，RoomMirrorStore.deleteImages
     * 那条既有对账级联路径永远轮不到触发——image_files 行与磁盘镜像文件会永久泄漏。
     *
     * 用「事后现状」ground truth 判定，不依赖调用方自行区分各出口分支的成功/回滚子集：
     * candidateIds 传入本次尝试删除的全量候选，重新查一次 images 现存 id 作差集——
     * 真正消失的才级联；因失败被回滚恢复的 id 会重新出现在 existingIds 里，天然被排除。
     * 先按 image_files registered 收窄候选（而非直接对 candidateIds 做差集）：批量删除的
     * candidateIds 可能整段传入（含从未在 images 表出现过的 id，例如调用方给了一段 id 区间），
     * 这类 id 本就不在 images 里，会被误判成「本次删除后消失」而错误级联——只有真正登记过
     * 镜像行的 id 才可能发生「泄漏」，先收窄可从根上排除这类误判。
     * activeServerId 为 null（未选中服务器/测试未注入）时直接跳过，不误删。
     */
    private suspend fun cascadeMirror(candidateIds: List<Long>) {
        if (candidateIds.isEmpty()) return
        val serverId = activeServerId() ?: return
        val registered = candidateIds.chunked(BATCH_CHUNK)
            .flatMap { db.imageFileDao().byImageIds(serverId, it) }.map { it.imageId }
        if (registered.isEmpty()) return
        val stillThere = registered.chunked(BATCH_CHUNK)
            .flatMap { db.imageDao().existingIds(it) }.toSet()
        val gone = registered.filterNot { it in stillThere }
        if (gone.isEmpty()) return
        gone.chunked(BATCH_CHUNK).forEach { db.imageFileDao().deleteByImageIds(serverId, it) }
        removeMirrorFiles(serverId, gone)
    }

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
        // 镜像行不会带回链——曾致「删除失败」后图从相册/标签搜索凭空消失
        val galleryLinks = db.imageDao().galleryLinksOfImages(listOf(imageId))
        val tagLinks = db.imageDao().tagLinksOfImages(listOf(imageId))
        val result = guarded(
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
        // 取消场景 guarded 会重抛、走不到这——符合口径：取消镜像靠下一轮同步对账收敛
        cascadeMirror(listOf(imageId))   // 真删除才会级联；回滚场景 existingIds 命中该 id，no-op
        return result
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
            // 乐观行带本机时间戳（T2 质量审）：CREATED 排序下新建相册在同步回写前不垫底；
            // 下一轮同步以桌面 createdAt 覆盖，毫秒级偏差无感
            db.galleryDao().insertOne(GalleryEntity(id, name, null, 0, java.time.Instant.now().toString()))
            monitor.reportSuccess(); requestSync(); WriteResult.Success
        } catch (e: ApiException) {
            monitor.reportFailure(e); WriteResult.Failed(e.message, e.code == "UNAUTHORIZED")
        } catch (e: CancellationException) {
            throw e   // 取消时结果未知，不回滚不上报，镜像靠下一轮同步对账收敛
        } catch (e: Exception) {
            monitor.reportFailure(e); WriteResult.Failed(e.message ?: "新建相册失败")
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

    /** 设为封面（v0.6 spec §5.3）：先服务端后写本地镜像（相册卡片即时换面）；失败不动本地。 */
    suspend fun setGalleryCover(galleryId: Long, imageId: Long): WriteResult {
        return try {
            writeApi.setGalleryCover(galleryId, imageId)
            db.galleryDao().updateCover(galleryId, imageId)
            monitor.reportSuccess(); requestSync(); WriteResult.Success
        } catch (e: ApiException) {
            // 服务器已应答的失败（404 相册已删/422 成员关系陈旧）说明镜像分歧：对账一次
            // 立即收敛幻影数据，与 guarded 的 BUG-02 约定对齐
            monitor.reportFailure(e); requestSync()
            WriteResult.Failed(e.message, e.code == "UNAUTHORIZED")
        } catch (e: CancellationException) {
            throw e   // 取消时结果未知，不上报，镜像靠下一轮同步对账收敛
        } catch (e: Exception) {
            monitor.reportFailure(e); WriteResult.Failed(e.message ?: "设为封面失败")
        }
    }

    suspend fun deleteGallery(galleryId: Long): WriteResult {
        val old = db.galleryDao().byId(galleryId)
        // 成员链快照（BUG-03 同族）：clearMembership 后回滚只恢复相册行，成员链例行同步不重建
        //（成员图 changeSeq 未变）——曾致「删除失败」的相册回来时变空
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
        // 只回滚真正新增的链（BUG-04）：选中项含已在相册的 X 时，失败回滚曾把 X 一并静默移出
        val existing = existingGalleryLinksChunked(galleryId, imageIds).toSet()
        val newIds = imageIds.filter { it !in existing }
        return guarded(
            optimisticApply = {
                if (newIds.isNotEmpty()) db.imageDao().insertGalleryLinks(newIds.map { GalleryImageEntity(galleryId, it) })
            },
            rollback = { if (newIds.isNotEmpty()) deleteGalleryLinksChunked(galleryId, newIds) },
            call = { writeApi.addImagesToGallery(galleryId, imageIds) },
        )
    }

    suspend fun removeFromGallery(galleryId: Long, imageIds: List<Long>): WriteResult {
        if (imageIds.isEmpty()) return WriteResult.Success   // 空集直接成功（BUG-14，同 addToGallery）
        // 只回滚删前真实存在的链：不存在的链回滚重建会凭空加成员
        val present = existingGalleryLinksChunked(galleryId, imageIds)
        return guarded(
            optimisticApply = { if (present.isNotEmpty()) deleteGalleryLinksChunked(galleryId, present) },
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

        unique.chunked(BATCH_CHUNK).forEach { db.imageDao().deleteByIds(it) }   // 乐观全删（IN 分块，同上限约定）
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
                cascadeMirror(unique)   // 早退也级联「已成块」；被 restore 恢复的 id 经 existingIds 天然排除
                return WriteResult.Failed(
                    (e as? ApiException)?.message ?: (e.message ?: "批量删除失败"),
                    unauthorized = (e as? ApiException)?.code == "UNAUTHORIZED",
                )
            }
        }
        restore(failedIds)
        monitor.reportSuccess(); requestSync()
        cascadeMirror(unique)   // 真失败已被 restore 恢复、existingIds 命中排除；其余（含 NOT_FOUND 当成功）级联
        return if (failedIds.isEmpty()) WriteResult.Success else WriteResult.Failed("部分删除失败")
    }
}
