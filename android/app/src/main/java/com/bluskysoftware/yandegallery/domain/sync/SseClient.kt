package com.bluskysoftware.yandegallery.domain.sync

import com.bluskysoftware.yandegallery.data.api.ApiException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

/**
 * 桌面事件订阅（spec §6/§8）：监听 /api/v1/events/system，`gallery:*` 或 `app:data-restored`
 * 事件 2s 防抖后触发一次对账；断线 30s 退避重连；403（eventsSubscribe 未开，桌面默认关）
 * 按 baseUrl 隔离降级——只对该 SSE URL 停连，切到别的服务器不受影响，也不做进程全局永久关闭。
 *
 * 生命周期以激活服务器驱动：[start]/[stop] 绑前后台；[restart] 在激活服务器变化时调用——
 * 取消旧连接、清 403 降级状态、按新 baseUrl 重连（仅当前台已 start；后台仅清状态，等下次 start）。
 *
 * 必须用专用 OkHttp（[client] 应 readTimeout(0)）：桌面 SSE 无心跳帧（订阅时一次 ready、有事件才发帧），
 * 共享客户端的 30s readTimeout 会把空闲流当作断连，陷入无谓的断连-重连循环。
 */
class SseClient(
    private val client: OkHttpClient,
    private val urlProvider: () -> String?,
    private val onGalleryEvent: () -> Unit,
    private val scope: CoroutineScope,
    private val debounceMs: Long = 2_000,
    private val reconnectDelayMs: Long = 30_000,
) {
    @Volatile private var started = false
    // 403 降级按 URL 隔离：记下收到 403 的那条 SSE URL（OkHttp 规范化字符串），只对它停连。
    @Volatile private var disabledUrl: String? = null
    @Volatile private var eventSource: EventSource? = null
    @Volatile private var debounceJob: Job? = null
    @Volatile private var reconnectJob: Job? = null

    @Synchronized
    fun start() {
        if (started) return
        started = true
        connect()
    }

    @Synchronized
    fun stop() {
        started = false
        cancelConnection()
        debounceJob?.cancel()
        reconnectJob?.cancel()
    }

    /**
     * 激活服务器变化时调用：取消旧连接、清 403 降级、按新 baseUrl 重连（仅前台已 start）。
     * urlProvider 动态读当前激活行，故重连自然指向新服务器；后台时只清状态由下次 start 兜底。
     */
    @Synchronized
    fun restart() {
        disabledUrl = null
        cancelConnection()
        reconnectJob?.cancel()
        if (started) connect()
    }

    private fun cancelConnection() {
        eventSource?.cancel()
        eventSource = null
    }

    @Synchronized
    private fun connect() {
        if (!started) return
        val url = urlProvider() ?: return   // 无激活服务器：不连，等下次 start()/restart()
        val request = Request.Builder().url(url).build()
        if (request.url.toString() == disabledUrl) return   // 该服务器 403 降级中
        eventSource = EventSources.createFactory(client).newEventSource(request, listener)
    }

    private fun scheduleReconnect() {
        if (!started) return
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(reconnectDelayMs)
            connect()
        }
    }

    /** gallery:* / app:data-restored → 2s 防抖后回调一次（连发只触发最后一发之后一次）。 */
    private fun onQualifyingEvent() {
        debounceJob?.cancel()
        debounceJob = scope.launch {
            delay(debounceMs)
            onGalleryEvent()
        }
    }

    private val listener = object : EventSourceListener() {
        override fun onEvent(source: EventSource, id: String?, type: String?, data: String) {
            if (type != null && (type.startsWith("gallery:") || type == "app:data-restored")) {
                onQualifyingEvent()
            }
        }

        override fun onFailure(source: EventSource, t: Throwable?, response: Response?) {
            response?.close()
            // 403：该服务器订阅权限未开，重连徒劳 → 只对这条 URL 降级（切服/restart 会清）。
            if (response?.code == 403 || (t as? ApiException)?.httpStatus == 403) {
                disabledUrl = source.request().url.toString()
                eventSource = null
                return
            }
            eventSource = null
            scheduleReconnect()
        }

        override fun onClosed(source: EventSource) {
            // 服务端关闭连接（非 403 错误）→ 退避重连
            eventSource = null
            scheduleReconnect()
        }
    }
}
