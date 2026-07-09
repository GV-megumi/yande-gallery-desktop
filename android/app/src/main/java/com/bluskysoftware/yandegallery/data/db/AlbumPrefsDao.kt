package com.bluskysoftware.yandegallery.data.db

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface AlbumPrefsDao {
    @Query("SELECT * FROM album_prefs")
    fun observeAll(): Flow<List<AlbumPrefsEntity>>

    @Query("SELECT * FROM album_prefs WHERE galleryId = :galleryId")
    suspend fun byId(galleryId: Long): AlbumPrefsEntity?

    @Upsert
    suspend fun upsert(entity: AlbumPrefsEntity)

    /**
     * 置顶/取消置顶（spec §2.1）：置顶强制移出「其他相册」（互斥）；两向都清手动序（跨区迁移）。
     * 同态守卫：目标态与存量一致时直接返回——「清手动序/写 pinnedAt」只发生在真实跨区迁移，
     * 调用方基于陈旧偏好态双发不会抹掉拖拽手动序、不会扰动置顶区默认序。
     */
    @Transaction
    suspend fun setPinned(galleryId: Long, pinned: Boolean, nowMs: Long) {
        val old = byId(galleryId) ?: AlbumPrefsEntity(galleryId)
        if (old.pinned == pinned) return
        upsert(
            old.copy(
                pinned = pinned,
                pinnedAt = if (pinned) nowMs else null,
                inOther = if (pinned) false else old.inOther,
                manualOrder = null,
            ),
        )
    }

    /** 移入/移出「其他相册」（spec §2.1）：移入强制取消置顶（互斥）；两向都清手动序。同态守卫同 setPinned。 */
    @Transaction
    suspend fun setInOther(galleryId: Long, inOther: Boolean) {
        val old = byId(galleryId) ?: AlbumPrefsEntity(galleryId)
        if (old.inOther == inOther) return
        upsert(
            old.copy(
                inOther = inOther,
                pinned = if (inOther) false else old.pinned,
                pinnedAt = if (inOther) null else old.pinnedAt,
                manualOrder = null,
            ),
        )
    }

    /** 拖拽落盘（spec §4.5）：按最终视觉顺序对该分区重编号 0..n；不在列表里的行不动。 */
    @Transaction
    suspend fun applyManualOrder(orderedGalleryIds: List<Long>) {
        orderedGalleryIds.forEachIndexed { index, id ->
            val old = byId(id) ?: AlbumPrefsEntity(id)
            upsert(old.copy(manualOrder = index))
        }
    }

    /** 图集同步对账后清孤儿（spec §2.1）。 */
    @Query("DELETE FROM album_prefs WHERE galleryId NOT IN (SELECT id FROM galleries)")
    suspend fun deleteOrphans()

    /**
     * clearMirror 用：偏好按 galleryId 键，镜像身份失效（换服务器/dataVersion 变更）后跨服
     * 同号 id 几乎必然撞号，残留行会附身新服务器的同号图集——全清是最小正确实现（对齐 D10）。
     */
    @Query("DELETE FROM album_prefs")
    suspend fun clearAll()
}
