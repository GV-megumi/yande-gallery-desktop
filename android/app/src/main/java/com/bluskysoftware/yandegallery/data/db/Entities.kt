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
    val createdAt: String? = null,   // v5：/sync/galleries 下发的 ISO 串（旧桌面缺字段为 null，spec §2.2）
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

// v3（M4-T9，D10）：serverId 复合主键——多服务器同号 imageId 的下载映射互不污染；
// 飞行中下载跨切服的行由 worker 落行前校验拦截，不再依赖 clearMirror 时序。
@Entity(tableName = "downloads", primaryKeys = ["serverId", "imageId"])
data class DownloadEntity(
    val serverId: Long,
    val imageId: Long,
    val mediaStoreUri: String,
    val downloadedAt: String,
)

// 搜索历史（v1→2 迁移新增；v3→4 at 改 epochMillis）：query 为主键（同词覆盖去重），at 为写入
// 时间戳用于倒序——曾存 Instant.toString()，整秒省略小数位使 TEXT 字典序错位（BUG-17）。
@Entity(tableName = "search_history")
data class SearchHistoryEntity(
    @PrimaryKey val query: String,
    val at: Long,
)

/**
 * 相册组织本机态（v0.6 spec §2.1）：置顶/「其他相册」收纳/区内手动序。
 * 独立表、不建外键——图集同步是全量 replaceAll（清表重插），FK CASCADE 会把偏好一并误清；
 * 孤儿行由 RoomMirrorStore.replaceGalleries 对账后清理。置顶与收纳互斥、跨区迁移清手动序，
 * 两条规则收敛在 AlbumPrefsDao 的事务方法里。
 */
@Entity(tableName = "album_prefs")
data class AlbumPrefsEntity(
    @PrimaryKey val galleryId: Long,
    val pinned: Boolean = false,
    val pinnedAt: Long? = null,      // epoch ms，置顶区默认序（新置顶在前）
    val inOther: Boolean = false,
    val manualOrder: Int? = null,    // 区内手动序；NULL=未定序（手动模式排区尾按名兜底）
)
