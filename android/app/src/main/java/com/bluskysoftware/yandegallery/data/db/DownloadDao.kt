package com.bluskysoftware.yandegallery.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/** v3（M4-T9，D10）：全部查询带 serverId 域——多服务器同号 imageId 的下载映射互不污染。 */
@Dao
interface DownloadDao {
    @Query("SELECT * FROM downloads WHERE serverId = :serverId AND imageId = :imageId")
    suspend fun byImageId(serverId: Long, imageId: Long): DownloadEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: DownloadEntity)

    @Query("DELETE FROM downloads WHERE serverId = :serverId AND imageId = :imageId")
    suspend fun delete(serverId: Long, imageId: Long)

    /** clearMirror 用：镜像身份失效即全清（最小正确实现，D10）。 */
    @Query("DELETE FROM downloads")
    suspend fun clearAll()

    /** 对账/批量级联前批量取行（拿 uri 删系统相册副本、清缓存键）。 */
    @Query("SELECT * FROM downloads WHERE serverId = :serverId AND imageId IN (:imageIds)")
    suspend fun byImageIds(serverId: Long, imageIds: List<Long>): List<DownloadEntity>

    /** 对账删除级联（spec §5.4/§6.3-2）：serverId 域内清行，跨服同号 imageId 的他服映射不受波及。 */
    @Query("DELETE FROM downloads WHERE serverId = :serverId AND imageId IN (:imageIds)")
    suspend fun deleteByImageIds(serverId: Long, imageIds: List<Long>)

    @Query("SELECT imageId FROM downloads WHERE serverId = :serverId")
    fun observeDownloadedIds(serverId: Long): Flow<List<Long>>

    /**
     * ViewerViewModel 在 composition 中用 modelFor 同步取 uri，无法调用 suspend 版 byImageId，
     * 需要一个可 collectAsState 的 Flow 来建 Map<imageId, mediaStoreUri>（brief §Task 4 备注）。
     */
    @Query("SELECT * FROM downloads WHERE serverId = :serverId")
    fun observeDownloaded(serverId: Long): Flow<List<DownloadEntity>>

    /** 缓存管理页「已下载记录」列表（LEFT JOIN 容忍镜像行已被对账删除，filename 取空）。 */
    @Query("""SELECT d.imageId AS imageId, d.mediaStoreUri AS mediaStoreUri,
                     d.downloadedAt AS downloadedAt, i.filename AS filename
              FROM downloads d LEFT JOIN images i ON i.id = d.imageId
              WHERE d.serverId = :serverId
              ORDER BY d.downloadedAt DESC""")
    fun observeDownloadedWithMeta(serverId: Long): Flow<List<DownloadWithMeta>>
}

/** 已下载记录 + 镜像元数据投影（缓存管理页用）；filename 为 LEFT JOIN 值，镜像行缺失时为 null。 */
data class DownloadWithMeta(
    val imageId: Long,
    val mediaStoreUri: String,
    val downloadedAt: String,
    val filename: String?,
)
