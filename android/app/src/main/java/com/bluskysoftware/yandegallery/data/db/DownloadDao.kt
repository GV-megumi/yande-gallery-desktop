package com.bluskysoftware.yandegallery.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface DownloadDao {
    @Query("SELECT * FROM downloads WHERE imageId = :imageId")
    suspend fun byImageId(imageId: Long): DownloadEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: DownloadEntity)

    @Query("DELETE FROM downloads WHERE imageId = :imageId")
    suspend fun delete(imageId: Long)

    @Query("DELETE FROM downloads")
    suspend fun clearAll()

    @Query("SELECT imageId FROM downloads")
    fun observeDownloadedIds(): Flow<List<Long>>

    /**
     * ViewerViewModel 在 composition 中用 modelFor 同步取 uri，无法调用 suspend 版 byImageId，
     * 需要一个可 collectAsState 的 Flow 来建 Map<imageId, mediaStoreUri>（brief §Task 4 备注）。
     */
    @Query("SELECT * FROM downloads")
    fun observeDownloaded(): Flow<List<DownloadEntity>>

    /** 缓存管理页「已下载记录」列表（LEFT JOIN 容忍镜像行已被对账删除，filename 取空）。 */
    @Query("""SELECT d.imageId AS imageId, d.mediaStoreUri AS mediaStoreUri,
                     d.downloadedAt AS downloadedAt, i.filename AS filename
              FROM downloads d LEFT JOIN images i ON i.id = d.imageId
              ORDER BY d.downloadedAt DESC""")
    fun observeDownloadedWithMeta(): Flow<List<DownloadWithMeta>>
}

/** 已下载记录 + 镜像元数据投影（缓存管理页用）；filename 为 LEFT JOIN 值，镜像行缺失时为 null。 */
data class DownloadWithMeta(
    val imageId: Long,
    val mediaStoreUri: String,
    val downloadedAt: String,
    val filename: String?,
)
