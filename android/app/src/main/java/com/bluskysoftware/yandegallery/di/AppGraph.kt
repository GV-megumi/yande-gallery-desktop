package com.bluskysoftware.yandegallery.di

import android.content.Context
import com.bluskysoftware.yandegallery.data.api.ApiClientFactory
import com.bluskysoftware.yandegallery.data.api.DesktopApi
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.data.repo.RoomMirrorStore
import com.bluskysoftware.yandegallery.data.repo.ServerRepository
import com.bluskysoftware.yandegallery.domain.sync.RetrofitSyncApi
import com.bluskysoftware.yandegallery.domain.sync.SyncEngine
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

    // Bearer 动态取当前激活 key。唯一写者是 init 里的预热 collector；api() 只读不写——
    // 缓存命中判断绝不能用这个被后台持续刷新的共享字段（否则切换服务器后 collector
    // 一追平，命中判断恒真，api() 永远返回绑在旧 baseUrl 上的陈旧客户端且不自愈）。
    @Volatile private var activeSnapshot: ServerEntity? = null

    // api 实例按 (baseUrl, apiKey) 缓存，切换服务器自动重建；缓存键只在 api() 内写入
    @Volatile private var cachedApi: DesktopApi? = null
    @Volatile private var cachedBaseUrl: String? = null
    @Volatile private var cachedApiKey: String? = null

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
            cachedApi = null; cachedBaseUrl = null; cachedApiKey = null
            return null
        }
        val cached = cachedApi
        if (cached != null && cachedBaseUrl == active.baseUrl && cachedApiKey == active.apiKey) {
            return cached
        }
        cachedBaseUrl = active.baseUrl
        cachedApiKey = active.apiKey
        return ApiClientFactory.desktopApi(active.baseUrl, okHttp).also { cachedApi = it }
    }

    val mirrorStore by lazy { RoomMirrorStore(db) }
    val syncEngine by lazy {
        SyncEngine(
            api = RetrofitSyncApi { api() },
            store = mirrorStore,
            now = { java.time.Instant.now().toString() },
        )
    }
}
