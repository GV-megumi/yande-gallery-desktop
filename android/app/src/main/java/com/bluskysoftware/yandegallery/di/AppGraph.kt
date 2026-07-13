package com.bluskysoftware.yandegallery.di

import android.content.Context
import com.bluskysoftware.yandegallery.data.api.APP_API_PATH
import com.bluskysoftware.yandegallery.data.api.ApiClientFactory
import com.bluskysoftware.yandegallery.data.api.DesktopApi
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ServerEntity
import com.bluskysoftware.yandegallery.data.image.buildPreviewImageLoader
import com.bluskysoftware.yandegallery.data.image.buildThumbnailImageLoader
import com.bluskysoftware.yandegallery.data.image.previewCacheKey
import com.bluskysoftware.yandegallery.data.image.thumbnailCacheKey
import com.bluskysoftware.yandegallery.data.media.AndroidMediaStoreGateway
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.data.prefs.uiPrefsDataStore
import com.bluskysoftware.yandegallery.data.repo.RoomMirrorStore
import com.bluskysoftware.yandegallery.data.repo.ServerRepository
import com.bluskysoftware.yandegallery.domain.ConnectionMonitor
import com.bluskysoftware.yandegallery.domain.NetworkMonitor
import com.bluskysoftware.yandegallery.domain.download.DownloadManager
import com.bluskysoftware.yandegallery.domain.mirror.MirrorSyncManager
import com.bluskysoftware.yandegallery.domain.mirror.MirrorSyncMonitor
import com.bluskysoftware.yandegallery.domain.sync.RetrofitSyncApi
import com.bluskysoftware.yandegallery.domain.sync.SseClient
import com.bluskysoftware.yandegallery.domain.sync.SyncEngine
import com.bluskysoftware.yandegallery.domain.sync.SyncScheduler
import com.bluskysoftware.yandegallery.domain.write.RetrofitWriteApi
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.concurrent.TimeUnit

/** 手写组合根：单例依赖都挂在这里（v1 单模块，不引 Hilt）。 */
class AppGraph(
    val appContext: Context,
    dbOverride: AppDatabase? = null,   // 测试注入缝（Task 11/13 用 in-memory db 构造 AppGraph）
    // 测试注入缝：手动驱动 syncEngine.sync() 的用例（EndToEndSyncTest/AppGraphTest）关掉自动触发，
    // 避免 collector 的自动同步与手动同步争抢同一 MockWebServer 的 FIFO 响应。生产恒 true。
    private val autoSyncOnActiveChange: Boolean = true,
    private val prefsStoreOverride: com.bluskysoftware.yandegallery.data.prefs.PrefsStore? = null,
    // 测试注入缝：切服取消动作间接层。生产走真实 mirrorSyncManager.cancel；Robolectric 环境下
    // WorkManager 未显式初始化（AndroidManifest 移除了默认初始化器），直接调用会抛
    // IllegalStateException——AppGraphTest 注入 fake 观察"是否取消了正确的旧 id"而不触发它。
    private val cancelMirrorSyncOverride: ((Long) -> Unit)? = null,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * 测试收尾专用：取消组合根全部后台协程（init 激活跟踪、ConnectionMonitor/SyncScheduler/SSE）
     * 并阻塞等到全部退出。注入 in-memory db 的测试必须先调用本方法、再 db.close()——否则
     * 常驻的 Room Flow 收集器可能在关库后才去取连接，偶发 connection pool has been closed
     * 且被 kotlinx-coroutines-test 记到当时正在跑的 runTest 头上（收尾竞态 flake）。
     * 生产组合根与进程同生命周期，不调用。
     */
    internal fun shutdownForTest() = runBlocking { scope.coroutineContext.job.cancelAndJoin() }

    val db: AppDatabase by lazy { dbOverride ?: AppDatabase.build(appContext) }
    val serverRepository by lazy { ServerRepository(db.serverDao()) }

    /** UI 偏好（档位记忆/缓存上限，M4-T1）；测试注入独立临时文件实例避免 DataStore 单例冲突。 */
    val prefsStore by lazy { prefsStoreOverride ?: PrefsStore(uiPrefsDataStore(appContext)) }

    /** 视图偏好共享态（排序/列数，v0.6）：VM 与 Viewer 共读同一实例保证顺序一致（spec §3.4）。 */
    val viewPrefs by lazy { com.bluskysoftware.yandegallery.data.prefs.ViewPrefs(prefsStore, scope) }

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
        // 启动即跟踪激活服务器：① 冷启动时 Coil 的首个缩略图请求也要带上 Bearer（每次发射都刷新
        // activeSnapshot）；② 激活服务器按 id 变化时（新增/切服/删除）自动触发一次同步并重连 SSE
        // ——这样 README 承诺的「配对即激活→自动首次全量同步」与切服可靠性由一处收敛覆盖。
        // lastActive 初值 null：既作「尚未同步任何服务器」哨兵，也让冷启动无服务器时(null==null)不误触发；
        // 加服务器(null→id)/切服(idA→idB)/删除(id→null) 都是一次 id 变化，恰触发一次。
        // ③ 编辑激活行（id 不变、baseUrl/apiKey 变）也在此收敛（BUG-10）：activeSnapshot 已先行更新，
        // restart 的 urlProvider 必读到新地址——曾由 ServersViewModel 手动 nudge，读到陈旧快照连回旧 URL。
        scope.launch {
            var lastActive: ServerEntity? = null
            var seeded = false
            serverRepository.observeActive().collect { active ->
                activeSnapshot = active
                val idChanged = active?.id != lastActive?.id
                val endpointChanged = seeded && !idChanged &&
                    (active?.baseUrl != lastActive?.baseUrl || active?.apiKey != lastActive?.apiKey)
                val previousId = lastActive?.id   // 切服取消要用旧 id，须在下面覆盖前存好局部变量
                lastActive = active
                seeded = true
                if ((idChanged || endpointChanged) && autoSyncOnActiveChange) {
                    // 切服（非编辑）→ 取消旧服残留的镜像同步工作，避免残留任务写脏新服数据（spec §6）
                    previousId?.takeIf { idChanged && it != active?.id }
                        ?.let { cancelMirrorSync(it) }
                    // 切到/编辑出真实服务器才发起同步；切到「无服务器」只重连 SSE（拆掉旧连接）。
                    if (active != null) {
                        syncScheduler.requestSync(if (idChanged) "server-changed" else "server-edited")
                    }
                    sseClient.restart()
                }
            }
        }
        // 二进制 404 → 触发一次对账（spec §6.3-4；钩子在 Task 3 拦截器里，此处接到调度器）
        onBinaryNotFound = { syncScheduler.requestSync("binary-404") }
    }

    val okHttp by lazy {
        ApiClientFactory.okHttp(
            apiKeyProvider = { activeSnapshot?.apiKey },
            onBinaryNotFound = { onBinaryNotFound?.invoke() },
        )
    }

    /** 缩略图 loader：上限来自设置（改后下次启动生效——DiskCache.maxSize 构建期定死，M4-T8）。 */
    val thumbnailLoader by lazy {
        val maxBytes = runBlocking { prefsStore.thumbnailCacheMaxBytes.first() }   // 一次性小文件读
        buildThumbnailImageLoader(appContext, okHttp, maxBytes)
    }

    /** 1600px 预览档 loader：上限来自设置（改后下次启动生效，M4-T8）。 */
    val previewLoader by lazy {
        val maxBytes = runBlocking { prefsStore.previewCacheMaxBytes.first() }
        buildPreviewImageLoader(appContext, okHttp, maxBytes)
    }

    /** 原图下载写入系统相册的网关（Task 8 DownloadWorker 用）；真机语义留待实机验证。 */
    val mediaStoreGateway by lazy { AndroidMediaStoreGateway(appContext) }

    /** 原图下载入队 + WorkInfo 状态观察（唯一工作名 KEEP，避免重复入队）。 */
    val downloadManager by lazy { DownloadManager(appContext) }

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

    /** 图片镜像层（spec §3）：外部私有目录 + image_files 登记；无外部存储回退内部 filesDir。 */
    val imageMirrorStore by lazy {
        ImageMirrorStore(
            rootDir = java.io.File(appContext.getExternalFilesDir(null) ?: appContext.filesDir, "mirror"),
            imageFileDao = db.imageFileDao(),
            imageDao = db.imageDao(),
            apiProvider = { api() },
            activeServerId = { serverRepository.activeServer()?.id },
        )
    }
    val mirrorSyncMonitor by lazy { MirrorSyncMonitor() }
    val mirrorSyncManager by lazy { MirrorSyncManager(appContext) }

    /**
     * 切服取消的真正出口：默认转发到 mirrorSyncManager.cancel（惰性求值不受影响——override 非空时
     * 完全不触碰 mirrorSyncManager，不会意外初始化 WorkManager）；测试注入 cancelMirrorSyncOverride
     * 拦截观察调用参数，验证 previousId 在 lastActive 覆盖前捕获、仅真实 id 变化才取消（AppGraphTest）。
     */
    private fun cancelMirrorSync(serverId: Long) {
        val override = cancelMirrorSyncOverride
        if (override != null) override(serverId) else mirrorSyncManager.cancel(serverId)
    }

    /** 镜像同步入队（读保存方式无关——worker 自读；此处只解偏好约束与激活服务器）。 */
    fun requestMirrorSync(replace: Boolean = false) {
        scope.launch {
            val serverId = serverRepository.activeServer()?.id ?: return@launch
            val cellular = prefsStore.mirrorSyncCellular.first()
            mirrorSyncManager.requestSync(serverId, cellular, replace)
        }
    }

    /** 启动期镜像孤儿清扫入口（YandeGalleryApp 调）；无激活服务器时空跑。 */
    fun scopeLaunchSweep() {
        scope.launch {
            serverRepository.activeServer()?.id?.let { imageMirrorStore.sweepOrphans(it) }
        }
    }

    val mirrorStore by lazy {
        RoomMirrorStore(
            db,
            gateway = mediaStoreGateway,
            activeServerId = { serverRepository.activeServer()?.id },
            removeCachedImage = { serverId, imageId ->
                // 对账删除的行级联清两级盘缓存条目（Coil 3.5 DiskCache.remove(key) 已核）
                thumbnailLoader.diskCache?.remove(thumbnailCacheKey(serverId, imageId))
                previewLoader.diskCache?.remove(previewCacheKey(serverId, imageId))
            },
            removeMirrorFiles = { serverId, ids -> imageMirrorStore.deleteDirs(serverId, ids) },
            clearMirrorFiles = { imageMirrorStore.clearAllFiles() },
        )
    }
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
            onSyncSuccess = { requestMirrorSync() },
        )
    }

    /** 写操作仓库：乐观镜像 + 回滚 + 404 当成功；写成功后 requestSync 冗余对账（M3-T6）。 */
    val writeRepository by lazy {
        WriteRepository(
            writeApi = RetrofitWriteApi { api() },
            db = db,
            monitor = connectionMonitor,
            requestSync = { syncScheduler.requestSync("write") },
        )
    }

    // SSE 专用客户端：readTimeout=0（桌面无心跳的空闲流不能被 30s 超时误杀）+ **独立 Dispatcher**
    // （BUG-05）——newBuilder() 会共享原 Dispatcher，SSE 长连滞留会占满共享 maxRequestsPerHost=5
    // 槽位，饿死同主机的缩略图/同步/下载请求；隔离后即便出现滞留连接也伤不到数据面。
    private val sseHttpClient by lazy {
        okHttp.newBuilder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .dispatcher(okhttp3.Dispatcher())
            .build()
    }

    /** 事件订阅：/api/app/v1/events/system 有 gallery 事件 → 触发一次对账。 */
    val sseClient by lazy {
        SseClient(
            client = sseHttpClient,
            urlProvider = {
                activeSnapshot?.baseUrl?.let { base ->
                    "${base.trimEnd('/')}/$APP_API_PATH/events/system"
                }
            },
            onGalleryEvent = { syncScheduler.requestSync("sse") },
            scope = scope,
        )
    }

    /**
     * 网络回调（M4-T6）：恢复 → 横幅收起 + 增量同步 + SSE 重连（兜底断网期间漏的事件）；
     * 断开 → 横幅离线（D6b 直驱，不等下次同步失败推断）。回调在 binder 线程触发，下游
     * connectionMonitor.update / syncScheduler.requestSync / sseClient.restart(@Synchronized) 均线程安全。
     * 生命周期绑进程前后台（YandeGalleryApp start/stop），非 scope 常驻协程，无需 shutdownForTest 覆盖。
     */
    val networkMonitor by lazy {
        NetworkMonitor(
            appContext,
            onAvailable = {
                connectionMonitor.reportNetworkRestored()
                syncScheduler.requestSync("network-restored")
                sseClient.restart()
            },
            onLost = { connectionMonitor.reportNetworkLost() },
        )
    }
}
