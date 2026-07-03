package com.bluskysoftware.yandegallery.di

import android.content.Context
import com.bluskysoftware.yandegallery.data.api.ApiClientFactory
import com.bluskysoftware.yandegallery.data.api.DesktopApi
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.data.repo.ServerRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** 手写组合根：单例依赖都挂在这里（v1 单模块，不引 Hilt）。 */
class AppGraph(
    val appContext: Context,
    dbOverride: AppDatabase? = null,   // 测试注入缝（Task 11/13 用 in-memory db 构造 AppGraph）
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val db: AppDatabase by lazy { dbOverride ?: AppDatabase.build(appContext) }
    val serverRepository by lazy { ServerRepository(db.serverDao()) }

    // Bearer 动态取当前激活 key；api 实例按 (baseUrl, apiKey) 缓存，切换服务器自动重建
    @Volatile private var activeSnapshot: ServerEntity? = null
    @Volatile private var cachedApi: DesktopApi? = null

    /** 二进制 404 → 触发一次对账（spec §6.3-4）；Task 12 接到 SyncScheduler */
    @Volatile var onBinaryNotFound: (() -> Unit)? = null

    init {
        // 启动即跟踪激活服务器：冷启动时 Coil 的首个缩略图请求也要带上 Bearer，
        // 不能等到第一次 api() 调用才填 snapshot
        scope.launch { serverRepository.observeActive().collect { activeSnapshot = it } }
    }

    val okHttp by lazy {
        ApiClientFactory.okHttp(
            apiKeyProvider = { activeSnapshot?.apiKey },
            onBinaryNotFound = { onBinaryNotFound?.invoke() },
        )
    }

    suspend fun api(): DesktopApi? {
        val active = serverRepository.activeServer() ?: run {
            activeSnapshot = null; cachedApi = null; return null
        }
        val cached = cachedApi
        if (cached != null && activeSnapshot?.baseUrl == active.baseUrl && activeSnapshot?.apiKey == active.apiKey) {
            activeSnapshot = active
            return cached
        }
        activeSnapshot = active
        return ApiClientFactory.desktopApi(active.baseUrl, okHttp).also { cachedApi = it }
    }
}
