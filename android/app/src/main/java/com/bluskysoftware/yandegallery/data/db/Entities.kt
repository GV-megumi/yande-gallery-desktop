package com.bluskysoftware.yandegallery.data.db

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "images", indices = [Index(value = ["createdAt"])])
data class ImageEntity(
    @PrimaryKey val id: Long,
    val filename: String,
    val width: Int,
    val height: Int,
    val fileSize: Long,
    val format: String,
    val createdAt: String,
    val updatedAt: String,
)

@Entity(tableName = "galleries")
data class GalleryEntity(
    @PrimaryKey val id: Long,
    val name: String,
    val coverImageId: Long?,
    val imageCount: Int,
)

// 修正（T7 消费，schema 一步到位）：只保留对 images 的 CASCADE FK，不对 galleries 建 FK。
// 原因：同步时先整页拉图片，随后才全量拉 galleries；关联行会短暂引用尚不存在的 gallery 行，
// 若带 galleries FK 会在这个中间态整批失败。
@Entity(
    tableName = "gallery_images",
    primaryKeys = ["galleryId", "imageId"],
    indices = [Index(value = ["imageId"])],
    foreignKeys = [
        ForeignKey(entity = ImageEntity::class, parentColumns = ["id"], childColumns = ["imageId"], onDelete = ForeignKey.CASCADE),
    ],
)
data class GalleryImageEntity(val galleryId: Long, val imageId: Long)

@Entity(tableName = "tags")
data class TagEntity(
    @PrimaryKey val id: Long,
    val name: String,
    val category: String?,
)

// 修正（T7 消费，schema 一步到位）：只保留对 images 的 CASCADE FK，不对 tags 建 FK。
// 原因同上：同步时先整页拉图片，随后才全量拉 tags；关联行会短暂引用尚不存在的 tag 行。
@Entity(
    tableName = "image_tags",
    primaryKeys = ["imageId", "tagId"],
    indices = [Index(value = ["tagId"])],
    foreignKeys = [
        ForeignKey(entity = ImageEntity::class, parentColumns = ["id"], childColumns = ["imageId"], onDelete = ForeignKey.CASCADE),
    ],
)
data class ImageTagEntity(val imageId: Long, val tagId: Long)

@Entity(tableName = "servers")
data class ServerEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val baseUrl: String,
    val apiKey: String,
    val isActive: Boolean = false,
)

@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val id: Int = 1,           // 单行表：镜像全局只对应一个激活服务器
    // spec §6.2 字段名为 serverId；此处更名 remoteServerId 以区分本机 servers.id（有意偏离，语义同）
    val remoteServerId: String,
    val cursor: String?,
    val dataVersion: Long,
    val lastSyncAt: String,
)

@Entity(tableName = "downloads")
data class DownloadEntity(
    @PrimaryKey val imageId: Long,
    val mediaStoreUri: String,
    val downloadedAt: String,
)
