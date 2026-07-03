package com.bluskysoftware.yandegallery.data.repo

import com.bluskysoftware.yandegallery.data.db.ServerDao
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import kotlinx.coroutines.flow.Flow

class ServerRepository(private val serverDao: ServerDao) {
    fun observeAll(): Flow<List<ServerEntity>> = serverDao.observeAll()
    fun observeActive(): Flow<ServerEntity?> = serverDao.observeActive()
    suspend fun activeServer(): ServerEntity? = serverDao.active()

    /** 新增即激活：配对完成后立即以新服务器为准（spec §4.1 同时激活一个）。 */
    suspend fun addAndActivate(name: String, baseUrl: String, apiKey: String): Long {
        val id = serverDao.insert(
            ServerEntity(
                name = name.trim(),
                baseUrl = baseUrl.trim().trimEnd('/'),
                apiKey = apiKey.trim(),
            )
        )
        serverDao.activate(id)
        return id
    }

    suspend fun update(server: ServerEntity) = serverDao.update(server)
    suspend fun delete(id: Long) = serverDao.deleteById(id)
    suspend fun activate(id: Long) = serverDao.activate(id)
}
