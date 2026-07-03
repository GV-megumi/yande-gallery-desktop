package com.bluskysoftware.yandegallery.data.db

import androidx.paging.PagingSource
import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface GalleryDao {
    @Query("SELECT * FROM galleries ORDER BY name")
    fun observeAll(): Flow<List<GalleryEntity>>

    @Query("SELECT * FROM galleries WHERE id = :id")
    suspend fun byId(id: Long): GalleryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<GalleryEntity>)

    @Query("DELETE FROM galleries")
    suspend fun clearAll()

    @Transaction
    suspend fun replaceAll(items: List<GalleryEntity>) {
        clearAll()
        insertAll(items)
    }

    /** 封面兜底：coverImageId 缺省时取图集内最新一张（spec §7.2）。 */
    @Query(
        """SELECT i.* FROM images i
           JOIN gallery_images gi ON gi.imageId = i.id
           WHERE gi.galleryId = :galleryId
           ORDER BY i.createdAt DESC, i.id DESC LIMIT 1"""
    )
    suspend fun coverFallback(galleryId: Long): ImageEntity?

    @Query(
        """SELECT i.* FROM images i
           JOIN gallery_images gi ON gi.imageId = i.id
           WHERE gi.galleryId = :galleryId
           ORDER BY i.createdAt DESC, i.id DESC"""
    )
    fun galleryImagesPagingSource(galleryId: Long): PagingSource<Int, ImageEntity>
}
