package com.bluskysoftware.yandegallery.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface ServerDao {
    @Query("SELECT * FROM servers ORDER BY id")
    fun observeAll(): Flow<List<ServerEntity>>

    @Query("SELECT * FROM servers WHERE isActive = 1 LIMIT 1")
    fun observeActive(): Flow<ServerEntity?>

    @Query("SELECT * FROM servers WHERE isActive = 1 LIMIT 1")
    suspend fun active(): ServerEntity?

    @Query("SELECT * FROM servers WHERE id = :id")
    suspend fun byId(id: Long): ServerEntity?

    @Insert
    suspend fun insert(server: ServerEntity): Long

    @Update
    suspend fun update(server: ServerEntity)

    @Query("DELETE FROM servers WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("UPDATE servers SET isActive = 0")
    suspend fun deactivateAll()

    @Query("UPDATE servers SET isActive = 1 WHERE id = :id")
    suspend fun activateRow(id: Long)

    @Transaction
    suspend fun activate(id: Long) {
        deactivateAll()
        activateRow(id)
    }

    /**
     * 新增即激活的原子版本：insert 与 activate 若为两笔独立事务，过渡窗口里
     * 直连 okHttp apiKeyProvider 的调用方（如 Coil）可能拿旧 key 打新 baseUrl。
     * 单事务保证 observeActive 只发射最终态，无撕裂窗口。
     */
    @Transaction
    suspend fun insertAndActivate(server: ServerEntity): Long {
        val id = insert(server)
        deactivateAll()
        activateRow(id)
        return id
    }
}
