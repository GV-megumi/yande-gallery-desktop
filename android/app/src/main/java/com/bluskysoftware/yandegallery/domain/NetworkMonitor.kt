package com.bluskysoftware.yandegallery.domain

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest

/**
 * 网络可用性回调（M4-T6，spec §8「恢复后自动增量同步」）：
 * onAvailable/onLost 在 ConnectivityManager binder 线程触发，下游必须线程安全（当前接线满足）。
 * start/stop 绑进程前后台（YandeGalleryApp），幂等。
 */
class NetworkMonitor(
    context: Context,
    private val onAvailable: () -> Unit,
    private val onLost: () -> Unit,
) {
    private val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    @Volatile private var registered = false

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = onAvailable()
        override fun onLost(network: Network) = onLost()
    }

    fun start() {
        if (registered) return
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        runCatching { cm.registerNetworkCallback(request, callback) }
            .onSuccess { registered = true }
        // 注册回调不覆盖「既缺网络」：Android 只对存活网络重放 onAvailable，对早已断开的网络
        // 永不投递 onLost——冷启动断网时什么信号都不会来，横幅停留在默认 online=true 直到首次
        // 同步失败才推断出离线。故此处主动快照一次当前连接态（能力集与上面注册的 request 对齐，
        // 仅 INTERNET）：无网或缺 INTERNET 能力 → 补发 onLost 立即压横幅。
        // 非对称设计：有网时不手动补 onAvailable——注册本身会对存活网络重放 onAvailable，
        // 手动补会二次触发同步/SSE 重连。快照取态异常（个别 ROM getNetworkCapabilities 会抛
        // SecurityException）→ 放弃快照，退回既有的同步失败推断路径，不误报离线。
        runCatching { cm.activeNetwork?.let { cm.getNetworkCapabilities(it) } }
            .onSuccess { caps ->
                if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                    onLost()
                }
            }
    }

    fun stop() {
        if (!registered) return
        registered = false
        runCatching { cm.unregisterNetworkCallback(callback) }
    }
}
