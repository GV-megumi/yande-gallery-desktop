package com.bluskysoftware.yandegallery.data.db

import androidx.paging.PagingSource
import androidx.room.*

@Dao
interface ImageDao {
    // 时间轴分页（v0.6 spec §3.3）：ORDER BY 随 PhotoSort 运行时拼接，走 @RawQuery（同 search 先例）；
    // 查询由 TimelineQueries.buildTimelineQuery 构造，白名单枚举无注入面。
    @RawQuery(observedEntities = [ImageEntity::class])
    fun timelinePagingSource(query: androidx.sqlite.db.SupportSQLiteQuery): PagingSource<Int, ImageEntity>

    // 搜索分页：多关键词 AND 交集用运行时拼 SQL（@Query 的 IN 展开无法表达多子句 AND），故走 @RawQuery。
    // observedEntities 声明三表，使标签/关联变更也能触发 Paging 失效刷新。
    @RawQuery(observedEntities = [ImageEntity::class, TagEntity::class, ImageTagEntity::class])
    fun searchPagingSource(query: androidx.sqlite.db.SupportSQLiteQuery): PagingSource<Int, ImageEntity>

    @Query("SELECT * FROM images WHERE id = :id")
    suspend fun byId(id: Long): ImageEntity?

    @Query("""SELECT t.name FROM tags t JOIN image_tags it ON it.tagId = t.id
              WHERE it.imageId = :imageId ORDER BY t.name""")
    suspend fun tagNamesOf(imageId: Long): List<String>

    @Query("SELECT galleryId FROM gallery_images WHERE imageId = :imageId")
    suspend fun galleryIdsOf(imageId: Long): List<Long>

    // ---- 写回滚快照（BUG-03/04/15）：删除回滚须重建被 CASCADE 删的链；加链回滚须区分“操作前已存在” ----

    @Query("SELECT * FROM gallery_images WHERE imageId IN (:imageIds)")
    suspend fun galleryLinksOfImages(imageIds: List<Long>): List<GalleryImageEntity>

    @Query("SELECT * FROM image_tags WHERE imageId IN (:imageIds)")
    suspend fun tagLinksOfImages(imageIds: List<Long>): List<ImageTagEntity>

    @Query("SELECT imageId FROM gallery_images WHERE galleryId = :galleryId AND imageId IN (:imageIds)")
    suspend fun existingGalleryLinkImageIds(galleryId: Long, imageIds: List<Long>): List<Long>

    @Query("SELECT tagId FROM image_tags WHERE imageId = :imageId AND tagId IN (:tagIds)")
    suspend fun existingTagLinkTagIds(imageId: Long, tagIds: List<Long>): List<Long>

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

/**
 * 多关键词 AND 交集：每词命中「某标签名前缀 OR 文件名包含」。空关键词退化为全表倒序。
 * 用户词内 % / _ / \ 已转义（ESCAPE '\'），通配符按字面匹配（M4-T14）。
 */
fun buildSearchQuery(keywords: List<String>): androidx.sqlite.db.SupportSQLiteQuery {
    val terms = keywords.map { it.trim() }.filter { it.isNotEmpty() }
    if (terms.isEmpty()) {
        return androidx.sqlite.db.SimpleSQLiteQuery("SELECT * FROM images ORDER BY createdAt DESC, id DESC")
    }
    val escaped = terms.map { it.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") }
    val clauses = terms.joinToString(" AND ") {
        "(EXISTS(SELECT 1 FROM image_tags it JOIN tags t ON t.id=it.tagId " +
            "WHERE it.imageId=images.id AND t.name LIKE ? ESCAPE '\\') OR images.filename LIKE ? ESCAPE '\\')"
    }
    val args = escaped.flatMap { listOf("$it%", "%$it%") }.toTypedArray()
    return androidx.sqlite.db.SimpleSQLiteQuery(
        "SELECT * FROM images WHERE $clauses ORDER BY createdAt DESC, id DESC", args,
    )
}
