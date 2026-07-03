package com.bluskysoftware.yandegallery.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface TagDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<TagEntity>)

    @Query("DELETE FROM tags")
    suspend fun clearAll()

    @Transaction
    suspend fun replaceAll(items: List<TagEntity>) {
        clearAll()
        insertAll(items)
    }
}
