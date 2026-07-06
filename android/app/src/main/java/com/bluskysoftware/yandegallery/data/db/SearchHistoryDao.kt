package com.bluskysoftware.yandegallery.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface SearchHistoryDao {
    // tiebreak query DESC（M4-T14）：同秒写入的历史顺序稳定，测试不再偶发换序
    @Query("SELECT query FROM search_history ORDER BY at DESC, query DESC LIMIT :limit")
    fun observeRecent(limit: Int): Flow<List<String>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: SearchHistoryEntity)

    @Query("DELETE FROM search_history")
    suspend fun clear()
}
