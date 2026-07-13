package com.bluskysoftware.yandegallery.data.repo

import androidx.core.net.toUri
import androidx.room.withTransaction
import com.bluskysoftware.yandegallery.data.api.SyncGalleryDto
import com.bluskysoftware.yandegallery.data.api.SyncImageItemDto
import com.bluskysoftware.yandegallery.data.api.SyncTagDto
import com.bluskysoftware.yandegallery.data.db.*
import com.bluskysoftware.yandegallery.data.media.MediaStoreGateway
import com.bluskysoftware.yandegallery.domain.sync.MirrorStore
import com.bluskysoftware.yandegallery.domain.sync.SyncState

private const val DELETE_CHUNK = 900 // SQLite 绑定变量上限保守值

/**
 * MirrorStore 的 Room 实现。schema 已是最终形态（Task 4）：gallery_images/image_tags
 * 只对 images 建 CASCADE FK，不对 galleries/tags 建 FK——同步分页时关联行可能短暂引用
 * 尚未拉取的 gallery/tag id，此形态下不会因 FK 校验整批失败。
 *
 * M4-T9：承担 spec §5.4/§6.3-2 对账级联清理全量（README M3 已知后置项收口）——gateway/
 * activeServerId/removeCachedImage 带默认参数，既有纯镜像用法（及测试）零改动。
 */
class RoomMirrorStore(
    private val db: AppDatabase,
    private val gateway: MediaStoreGateway? = null,
    private val activeServerId: suspend () -> Long? = { null },
    private val removeCachedImage: (serverId: Long, imageId: Long) -> Unit = { _, _ -> },
    private val removeMirrorFiles: suspend (serverId: Long, imageIds: List<Long>) -> Unit = { _, _ -> },
    private val clearMirrorFiles: suspend () -> Unit = {},
) : MirrorStore {

    override suspend fun readSyncState(): SyncState? =
        db.syncStateDao().get()?.let { SyncState(it.remoteServerId, it.cursor, it.dataVersion, it.lastSyncAt) }

    override suspend fun writeSyncState(state: SyncState) =
        db.syncStateDao().upsert(
            SyncStateEntity(
                remoteServerId = state.remoteServerId,
                cursor = state.cursor,
                dataVersion = state.dataVersion,
                lastSyncAt = state.lastSyncAt,
            )
        )

    override suspend fun clearMirror() {
        db.withTransaction {
            db.imageDao().clearAll() // CASCADE 连带清 image_tags/gallery_images
            db.galleryDao().clearAll()
            db.tagDao().clearAll()
            // 镜像身份失效（换服务器/dataVersion 变更）意味着 imageId→本地文件映射全部作废，
            // 必须一并清空，否则跨服同号 id 会命中错误的本地原图；系统相册中的文件本身保留。
            db.downloadDao().clearAll()
            // album_prefs 同理（对齐 D10）：偏好按 galleryId 键，跨服低位 id 几乎必然撞号，
            // 残留行会附身新服务器的同号相册（凭空置顶/从相册主区消失）；deleteOrphans 只管
            // 「id 已不存在」的孤儿，撞号行它删不掉，必须随全量重建整表清空。
            db.albumPrefsDao().clearAll()
            // 镜像身份失效 → 图片镜像登记同域作废（spec §3.4 对账清理）；文件删除在事务外回调
            db.imageFileDao().clearAll()
            db.syncStateDao().clear()
        }
        clearMirrorFiles()
    }

    override suspend fun applyImagePage(items: List<SyncImageItemDto>) = db.withTransaction {
        db.imageDao().upsertAll(items.map {
            ImageEntity(it.id, it.filename, it.width, it.height, it.fileSize, it.format, it.createdAt, it.updatedAt)
        })
        for (item in items) {
            db.imageDao().replaceTagLinks(item.id, item.tagIds)
            db.imageDao().replaceGalleryLinks(item.id, item.galleryIds)
        }
    }

    override suspend fun localImageIds(): List<Long> = db.imageDao().allIds()

    /**
     * 对账删除（spec §5.4/§6.3-2 级联清理收口，M4-T9）：镜像行 + 本服 downloads 行 + 系统相册
     * 副本 + 两级盘缓存条目。副本删除走 gateway.discard（吞异常）——**后台路径有意定界**：
     * app 重装等所有权丢失场景抛 SecurityException/RecoverableSecurityException 时仅清行保留
     * 文件、不弹系统确认窗（同步后台无 UI 可承载 IntentSender；文件残留属可接受，D15 记录）。
     * 本方法由 SyncEngine 在 IO 调度器调用，discard/DiskCache.remove 的阻塞 IO 合规。
     */
    override suspend fun deleteImages(ids: List<Long>) {
        val serverId = activeServerId()
        // ① 删行前按当前 serverId 批量取 downloads 行（拿 uri，行删了就取不到了）
        val downloadRows = if (serverId != null) {
            ids.chunked(DELETE_CHUNK).flatMap { db.downloadDao().byImageIds(serverId, it) }
        } else emptyList()
        // ②' 事务内 images 行 + 本服 downloads 行 + image_files 镜像登记行分块删除
        db.withTransaction {
            ids.chunked(DELETE_CHUNK).forEach { chunk ->
                db.imageDao().deleteByIds(chunk)
                if (serverId != null) {
                    db.downloadDao().deleteByImageIds(serverId, chunk)
                    db.imageFileDao().deleteByImageIds(serverId, chunk)
                }
            }
        }
        // ③ 事务外 IO 级联：(a) owned 系统相册副本直删 (b) 两级盘缓存条目按键清除
        for (row in downloadRows) {
            gateway?.discard(row.mediaStoreUri.toUri())
        }
        if (serverId != null) {
            ids.forEach { id -> removeCachedImage(serverId, id) }
        }
        // ③' 事务外 IO 级联追加：镜像目录删除（ORIGINAL 档同样跟随删除，spec §3.4）
        if (serverId != null) {
            removeMirrorFiles(serverId, ids)
        }
    }

    override suspend fun replaceGalleries(items: List<SyncGalleryDto>) = db.withTransaction {
        db.galleryDao().replaceAll(
            items.map { GalleryEntity(it.id, it.name, it.coverImageId, it.imageCount, it.createdAt) },
        )
        // 对账清孤儿偏好（spec §2.1）：相册已消失的置顶/分组/手动序行一并清掉，
        // 与 replaceAll 同事务——不留「相册没了偏好还在」的中间态窗口
        db.albumPrefsDao().deleteOrphans()
    }

    override suspend fun replaceTags(items: List<SyncTagDto>) =
        db.tagDao().replaceAll(items.map { TagEntity(it.id, it.name, it.category) })
}
