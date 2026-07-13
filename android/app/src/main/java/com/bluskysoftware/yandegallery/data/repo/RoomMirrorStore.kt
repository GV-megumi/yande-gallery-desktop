package com.bluskysoftware.yandegallery.data.repo

import androidx.room.withTransaction
import com.bluskysoftware.yandegallery.data.api.SyncGalleryDto
import com.bluskysoftware.yandegallery.data.api.SyncImageItemDto
import com.bluskysoftware.yandegallery.data.api.SyncTagDto
import com.bluskysoftware.yandegallery.data.db.*
import com.bluskysoftware.yandegallery.domain.sync.MirrorStore
import com.bluskysoftware.yandegallery.domain.sync.SyncState

private const val DELETE_CHUNK = 900 // SQLite 绑定变量上限保守值

/**
 * MirrorStore 的 Room 实现。schema 已是最终形态（Task 4）：gallery_images/image_tags
 * 只对 images 建 CASCADE FK，不对 galleries/tags 建 FK——同步分页时关联行可能短暂引用
 * 尚未拉取的 gallery/tag id，此形态下不会因 FK 校验整批失败。
 *
 * M4-T9（Task 10 收尾：MediaStore 链路退役，级联收敛为镜像文件一条线）：承担 spec §5.4/
 * §6.3-2 对账级联清理全量（README M3 已知后置项收口）——activeServerId/removeCachedImage/
 * removeMirrorFiles 带默认参数，既有纯镜像用法（及测试）零改动。
 */
class RoomMirrorStore(
    private val db: AppDatabase,
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
     * 对账删除（spec §5.4/§6.3-2 级联清理收口，M4-T9；Task 10 删 MediaStore 链路后简化为
     * 单一副本形态）：镜像行 + 两级盘缓存条目 + 镜像文件目录。本方法由 SyncEngine 在 IO
     * 调度器调用，removeMirrorFiles/DiskCache.remove 的阻塞 IO 合规。
     */
    override suspend fun deleteImages(ids: List<Long>) {
        val serverId = activeServerId()
        // ① 事务内 images 行 + image_files 镜像登记行分块删除
        db.withTransaction {
            ids.chunked(DELETE_CHUNK).forEach { chunk ->
                db.imageDao().deleteByIds(chunk)
                if (serverId != null) {
                    db.imageFileDao().deleteByImageIds(serverId, chunk)
                }
            }
        }
        // ② 事务外 IO 级联：两级盘缓存条目按键清除
        if (serverId != null) {
            ids.forEach { id -> removeCachedImage(serverId, id) }
        }
        // ③ 事务外 IO 级联追加：镜像目录删除（ORIGINAL 档同样跟随删除，spec §3.4）
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
