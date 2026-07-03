package com.bluskysoftware.yandegallery.di

import android.content.Context
import com.bluskysoftware.yandegallery.data.api.ApiClientFactory
import com.bluskysoftware.yandegallery.data.api.DesktopApi
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.data.image.buildThumbnailImageLoader
import com.bluskysoftware.yandegallery.data.repo.RoomMirrorStore
import com.bluskysoftware.yandegallery.data.repo.ServerRepository
import com.bluskysoftware.yandegallery.domain.ConnectionMonitor
import com.bluskysoftware.yandegallery.domain.sync.RetrofitSyncApi
import com.bluskysoftware.yandegallery.domain.sync.SseClient
import com.bluskysoftware.yandegallery.domain.sync.SyncEngine
import com.bluskysoftware.yandegallery.domain.sync.SyncScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

/** 手写组合根：单例依赖都挂在这里（v1 单模块，不引 Hilt）。 */
class AppGraph(
    val appContext: Context,
    dbOverride: AppDatabase? = null,   // 测试注入缝（Task 11/13 用 in-memory db 构造 AppGraph）
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val db: AppDatabase by lazy { dbOverride ?: AppDatabase.build(appContext) }
    val serverRepository by lazy { ServerRepository(db.serverDao()) }

    // Bearer 动态取当前激活 key（okHttp 拦截器与 SSE urlProvider 从此读）。两处写入、都写
    // 当前激活行，收敛一致：① init 里的预热 collector（后台 Room Flow，异步追平）；② api()
    // 拿到激活行后同步回写（保证冷启动首个请求也带 Bearer，不必等 collector）。
    // 但缓存命中判断绝不能读它——必须用独立的 cachedBaseUrl/cachedApiKey。否则切换服务器后
    // collector 一追平，命中判断恒真，api() 永远返回绑在旧 baseUrl 上的陈旧客户端且不自愈。
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
        // 二进制 404 → 触发一次对账（spec §6.3-4；钩子在 Task 3 拦截器里，此处接到调度器）
        onBinaryNotFound = { syncScheduler.requestSync("binary-404") }
    }

    val okHttp by lazy {
        ApiClientFactory.okHttp(
            apiKeyProvider = { activeSnapshot?.apiKey },
            onBinaryNotFound = { onBinaryNotFound?.invoke() },
        )
    }

    /** 缩略图 Coil ImageLoader：独立 2GB 持久盘缓存 + 复用带 Bearer 的 okHttp（Task 9）。 */
    val thumbnailLoader by lazy { buildThumbnailImageLoader(appContext, okHttp) }

    suspend fun api(): DesktopApi? {
        val active = serverRepository.activeServer() ?: run {
            cachedApi = null; cachedBaseUrl = null; cachedApiKey = null
            return null
        }
        // Bearer 保鲜：api() 同步取到激活行后立即回写，避免冷启动时 okHttp 拦截器
        // 读到尚未被预热 collector 填充的 null key（漏 Authorization → 误报 401/密钥失效）。
        activeSnapshot = active
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

    /** 连接监视器：激活服务器名喂给横幅；同步成功/失败经 scheduler 汇入。 */
    val connectionMonitor by lazy {
        ConnectionMonitor(
            activeServerName = serverRepository.observeActive().map { it?.name },
            scope = scope,
        )
    }

    /** 同步调度器：前台/下拉/SSE/二进制404 请求合并串行，注入 sync 函数（final class 不可 fake）。 */
    val syncScheduler by lazy {
        SyncScheduler(
            syncRun = syncEngine::sync,
            monitor = connectionMonitor,
            scope = scope,
            hadMirrorBefore = { mirrorStore.readSyncState() != null },
        )
    }

    // SSE 专用客户端：readTimeout=0，避免桌面无心跳空闲流被 30s 超时误杀成断连循环。
    private val sseHttpClient by lazy {
        okHttp.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    }

    /** 事件订阅：/api/v1/events/system 有 gallery 事件 → 触发一次对账。 */
    val sseClient by lazy {
        SseClient(
            client = sseHttpClient,
            urlProvider = {
                activeSnapshot?.baseUrl?.let { base ->
                    "${base.trimEnd('/')}/api/v1/events/system"
                }
            },
            onGalleryEvent = { syncScheduler.requestSync("sse") },
            scope = scope,
        )
    }
}
