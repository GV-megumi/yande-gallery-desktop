package com.bluskysoftware.yandegallery.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/** 镜像登记 DAO（spec §3.2）：全部查询带 serverId 域（多服务器同号 imageId 互不污染，对齐 DownloadDao 惯例）。 */
@Dao
interface ImageFileDao {
    @Query("SELECT * FROM image_files WHERE serverId = :serverId AND imageId = :imageId")
    suspend fun byImageId(serverId: Long, imageId: Long): ImageFileEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: ImageFileEntity)

    @Query("DELETE FROM image_files WHERE serverId = :serverId AND imageId = :imageId")
    suspend fun delete(serverId: Long, imageId: Long)

    /** 对账删除级联：serverId 域内清行（调用方负责删对应镜像目录）。 */
    @Query("DELETE FROM image_files WHERE serverId = :serverId AND imageId IN (:imageIds)")
    suspend fun deleteByImageIds(serverId: Long, imageIds: List<Long>)

    @Query("SELECT * FROM image_files WHERE serverId = :serverId AND imageId IN (:imageIds)")
    suspend fun byImageIds(serverId: Long, imageIds: List<Long>): List<ImageFileEntity>

    /** clearMirror 用：镜像身份失效即全清（对齐 DownloadDao.clearAll 语义）。 */
    @Query("DELETE FROM image_files")
    suspend fun clearAll()

    /** 启动孤儿清扫用：本服全量行（登记 vs 磁盘互查）。 */
    @Query("SELECT * FROM image_files WHERE serverId = :serverId")
    suspend fun allFor(serverId: Long): List<ImageFileEntity>

    /** 大图页/分享同步判断用：本服全量行 Flow（收集成 map，对齐 downloads observeDownloaded 用法）。 */
    @Query("SELECT * FROM image_files WHERE serverId = :serverId")
    fun observeFor(serverId: Long): Flow<List<ImageFileEntity>>

    /**
     * 同步缺失集合（spec §3.4-2）：无登记行的图恒缺；needOriginal=true 时 HQ 行也算缺
     * （原图模式要补原图）。按 createdAt 降序——新图优先，用户先看得到。
     */
    @Query("""SELECT i.id FROM images i
              LEFT JOIN image_files f ON f.serverId = :serverId AND f.imageId = i.id
              WHERE f.imageId IS NULL OR (:needOriginal AND f.tier = 'HQ')
              ORDER BY i.createdAt DESC, i.id DESC""")
    suspend fun missingImageIds(serverId: Long, needOriginal: Boolean): List<Long>

    /** 存储页统计（spec §5.2）：按档位分组张数/字节。 */
    @Query("""SELECT tier AS tier, COUNT(*) AS count, SUM(bytes) AS bytes
              FROM image_files WHERE serverId = :serverId GROUP BY tier""")
    suspend fun statsFor(serverId: Long): List<TierStat>

    /** 切原图模式预估补量（spec §4.5）：缺原图的 images.fileSize 总和（空集 SUM 为 NULL）。 */
    @Query("""SELECT SUM(i.fileSize) FROM images i
              LEFT JOIN image_files f ON f.serverId = :serverId AND f.imageId = i.id
              WHERE f.imageId IS NULL OR f.tier = 'HQ'""")
    suspend fun missingOriginalBytes(serverId: Long): Long?

    @Query("SELECT COUNT(*) FROM image_files WHERE serverId = :serverId")
    suspend fun countFor(serverId: Long): Long
}

/** [ImageFileDao.statsFor] 投影：档位聚合（存储页「高质量 n 张 xx MB / 原图 n 张 xx GB」）。 */
data class TierStat(val tier: String, val count: Long, val bytes: Long)
