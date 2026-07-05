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

    suspend fun byId(id: Long): ServerEntity? = serverDao.byId(id)

    /**
     * 编辑服务器（spec §7.6）：读旧行 copy 覆盖三字段，归一化同 addAndActivate（trim/trimEnd('/')），
     * 保留 isActive——编辑激活行不应把它意外降级为未激活。旧行不存在则静默跳过。
     */
    suspend fun updateServer(id: Long, name: String, baseUrl: String, apiKey: String) {
        val old = serverDao.byId(id) ?: return
        serverDao.update(
            old.copy(
                name = name.trim(),
                baseUrl = baseUrl.trim().trimEnd('/'),
                apiKey = apiKey.trim(),
            )
        )
    }
}
