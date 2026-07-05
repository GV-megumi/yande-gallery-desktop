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
}
