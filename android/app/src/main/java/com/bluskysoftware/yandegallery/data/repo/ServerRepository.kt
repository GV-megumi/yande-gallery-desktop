package com.bluskysoftware.yandegallery.data.repo

import com.bluskysoftware.yandegallery.data.db.ServerDao
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import kotlinx.coroutines.flow.Flow

class ServerRepository(private val serverDao: ServerDao) {
    fun observeAll(): Flow<List<ServerEntity>> = serverDao.observeAll()
    fun observeActive(): Flow<ServerEntity?> = serverDao.observeActive()
    suspend fun activeServer(): ServerEntity? = serverDao.active()

    /**
     * 新增即激活：配对完成后立即以新服务器为准（spec §4.1 同时激活一个）。
     * 单事务原子完成 insert+activate——避免过渡窗口里 okHttp apiKeyProvider
     * 读到旧 key 而请求已指向新 baseUrl（Bearer 撕裂）。
     */
    suspend fun addAndActivate(name: String, baseUrl: String, apiKey: String): Long =
        serverDao.insertAndActivate(
            ServerEntity(
                name = name.trim(),
                baseUrl = baseUrl.trim().trimEnd('/'),
                apiKey = apiKey.trim(),
            )
        )

    suspend fun update(server: ServerEntity) = serverDao.update(server)
    suspend fun delete(id: Long) = serverDao.deleteById(id)
    suspend fun activate(id: Long) = serverDao.activate(id)
}
