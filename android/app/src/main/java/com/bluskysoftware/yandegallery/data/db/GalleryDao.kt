package com.bluskysoftware.yandegallery.data.db

import androidx.paging.PagingSource
import androidx.room.*
import kotlinx.coroutines.flow.Flow

/**
 * 相册卡片投影：相册字段 + 相关子查询一次性算出的兜底封面 id。
 * 用于替代 ViewModel 里“逐个 coverImageId==null 的相册单查 coverFallback”的 N+1（spec §7.2）。
 */
data class AlbumCardRow(
    val id: Long,
    val name: String,
    val coverImageId: Long?,
    val imageCount: Int,
    val createdAt: String?,
    val fallbackCoverId: Long?,
)

@Dao
interface GalleryDao {
    @Query("SELECT * FROM galleries ORDER BY name")
    fun observeAll(): Flow<List<GalleryEntity>>

    /**
     * 相册卡片单查询：每个相册带一个相关子查询算出的兜底封面 id（相册内最新一张），
     * 避免 ViewModel 逐项回查 coverFallback 形成 N+1。排序与 observeAll 一致（按 name）。
     */
    @Query(
        """SELECT g.id, g.name, g.coverImageId, g.imageCount, g.createdAt,
             (SELECT i.id FROM images i
                JOIN gallery_images gi ON gi.imageId = i.id
                WHERE gi.galleryId = g.id
                ORDER BY i.createdAt DESC, i.id DESC LIMIT 1) AS fallbackCoverId
           FROM galleries g ORDER BY g.name"""
    )
    fun observeAlbumCards(): Flow<List<AlbumCardRow>>

    @Query("SELECT * FROM galleries WHERE id = :id")
    suspend fun byId(id: Long): GalleryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<GalleryEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOne(gallery: GalleryEntity)

    @Query("UPDATE galleries SET name = :name WHERE id = :id")
    suspend fun updateName(id: Long, name: String)

    /** 设封面本地回写（v0.6 spec §5.3）：PATCH 成功后即时更新镜像，下轮同步回读同值幂等。 */
    @Query("UPDATE galleries SET coverImageId = :coverImageId WHERE id = :id")
    suspend fun updateCover(id: Long, coverImageId: Long)

    @Query("DELETE FROM galleries WHERE id = :id")
    suspend fun deleteById(id: Long)

    /** galleries 无 FK 级联到 gallery_images，删相册须显式清成员行。 */
    @Query("DELETE FROM gallery_images WHERE galleryId = :galleryId")
    suspend fun clearMembership(galleryId: Long)

    /** 删相册前的成员链快照（回滚重建用——例行增量同步不重拉 changeSeq 未变的图，丢链不自愈）。 */
    @Query("SELECT * FROM gallery_images WHERE galleryId = :galleryId")
    suspend fun membershipOf(galleryId: Long): List<GalleryImageEntity>

    @Query("DELETE FROM galleries")
    suspend fun clearAll()

    @Transaction
    suspend fun replaceAll(items: List<GalleryEntity>) {
        clearAll()
        insertAll(items)
    }

    /** 相册成员分页（v0.6 spec §5.1 排序变体化）：查询由 buildGalleryImagesQuery 构造。 */
    @RawQuery(observedEntities = [ImageEntity::class, GalleryImageEntity::class])
    fun galleryImagesPagingSource(query: androidx.sqlite.db.SupportSQLiteQuery): PagingSource<Int, ImageEntity>
}
