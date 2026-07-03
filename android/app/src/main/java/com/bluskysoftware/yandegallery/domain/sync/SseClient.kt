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
 * 事件 2s 防抖后触发一次对账；断线 30s 退避重连；403（eventsSubscribe 未开，桌面默认关）永久降级。
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
    @Volatile private var permanentlyDisabled = false
    @Volatile private var eventSource: EventSource? = null
    @Volatile private var debounceJob: Job? = null
    @Volatile private var reconnectJob: Job? = null

    @Synchronized
    fun start() {
        if (started || permanentlyDisabled) return
        started = true
        connect()
    }

    @Synchronized
    fun stop() {
        started = false
        eventSource?.cancel()
        eventSource = null
        debounceJob?.cancel()
        reconnectJob?.cancel()
    }

    @Synchronized
    private fun connect() {
        if (!started || permanentlyDisabled) return
        val url = urlProvider() ?: return   // 无激活服务器：不连，等下次 start()
        val request = Request.Builder().url(url).build()
        eventSource = EventSources.createFactory(client).newEventSource(request, listener)
    }

    private fun scheduleReconnect() {
        if (!started || permanentlyDisabled) return
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
            // 403：订阅权限未开，重连也徒劳 → 永久降级（退回轮询/前台触发）
            if (response?.code == 403 || (t as? ApiException)?.httpStatus == 403) {
                permanentlyDisabled = true
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
