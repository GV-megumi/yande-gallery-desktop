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
 */
class RoomMirrorStore(private val db: AppDatabase) : MirrorStore {

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

    override suspend fun clearMirror() = db.withTransaction {
        db.imageDao().clearAll() // CASCADE 连带清 image_tags/gallery_images
        db.galleryDao().clearAll()
        db.tagDao().clearAll()
        // 镜像身份失效（换服务器/dataVersion 变更）意味着 imageId→本地文件映射全部作废，
        // 必须一并清空，否则跨服同号 id 会命中错误的本地原图；系统相册中的文件本身保留。
        db.downloadDao().clearAll()
        db.syncStateDao().clear()
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

    override suspend fun deleteImages(ids: List<Long>) = db.withTransaction {
        ids.chunked(DELETE_CHUNK).forEach { db.imageDao().deleteByIds(it) }
    }

    override suspend fun replaceGalleries(items: List<SyncGalleryDto>) =
        db.galleryDao().replaceAll(items.map { GalleryEntity(it.id, it.name, it.coverImageId, it.imageCount) })

    override suspend fun replaceTags(items: List<SyncTagDto>) =
        db.tagDao().replaceAll(items.map { TagEntity(it.id, it.name, it.category) })
}
