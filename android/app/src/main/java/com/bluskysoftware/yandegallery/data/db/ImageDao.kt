package com.bluskysoftware.yandegallery.data.db

import androidx.paging.PagingSource
import androidx.room.*

@Dao
interface ImageDao {
    @Query("SELECT * FROM images ORDER BY createdAt DESC, id DESC")
    fun timelinePagingSource(): PagingSource<Int, ImageEntity>

    @Query("SELECT * FROM images WHERE id = :id")
    suspend fun byId(id: Long): ImageEntity?

    @Query("""SELECT t.name FROM tags t JOIN image_tags it ON it.tagId = t.id
              WHERE it.imageId = :imageId ORDER BY t.name""")
    suspend fun tagNamesOf(imageId: Long): List<String>

    @Query("SELECT galleryId FROM gallery_images WHERE imageId = :imageId")
    suspend fun galleryIdsOf(imageId: Long): List<Long>

    @Query("DELETE FROM image_tags WHERE imageId = :imageId AND tagId IN (:tagIds)")
    suspend fun deleteTagLinks(imageId: Long, tagIds: List<Long>)

    @Query("DELETE FROM gallery_images WHERE galleryId = :galleryId AND imageId IN (:imageIds)")
    suspend fun deleteGalleryLinks(galleryId: Long, imageIds: List<Long>)

    @Upsert
    suspend fun upsertAll(items: List<ImageEntity>)

    @Query("SELECT id FROM images")
    suspend fun allIds(): List<Long>

    @Query("DELETE FROM images WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)

    @Query("SELECT COUNT(*) FROM images")
    suspend fun countAll(): Long

    @Query("SELECT COUNT(*) FROM image_tags")
    suspend fun tagLinkCount(): Int

    @Query("DELETE FROM image_tags WHERE imageId = :imageId")
    suspend fun clearTagLinks(imageId: Long)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertTagLinks(links: List<ImageTagEntity>)

    @Query("DELETE FROM gallery_images WHERE imageId = :imageId")
    suspend fun clearGalleryLinks(imageId: Long)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertGalleryLinks(links: List<GalleryImageEntity>)

    @Transaction
    suspend fun replaceTagLinks(imageId: Long, tagIds: List<Long>) {
        clearTagLinks(imageId)
        insertTagLinks(tagIds.map { ImageTagEntity(imageId, it) })
    }

    @Transaction
    suspend fun replaceGalleryLinks(imageId: Long, galleryIds: List<Long>) {
        clearGalleryLinks(imageId)
        // 注意：GalleryImageEntity 构造顺序是 (galleryId, imageId)——与 brief 原文顺序相反地修正，
        // 否则会把 imageId 误写进 galleryId 列（自查发现，非 brief 要求的 FK 修正范畴，见报告）。
        insertGalleryLinks(galleryIds.map { GalleryImageEntity(it, imageId) })
    }

    @Query("DELETE FROM images")
    suspend fun clearAll()
}
