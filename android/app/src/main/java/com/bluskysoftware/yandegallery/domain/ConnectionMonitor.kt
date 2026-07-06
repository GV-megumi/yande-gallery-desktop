package com.bluskysoftware.yandegallery.domain

import com.bluskysoftware.yandegallery.data.api.ApiException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * 连接状态快照，驱动 PhotosScreen 顶部横幅（spec §8）。
 * 默认 online=true：任何同步失败前不出横幅（冷启动无扰动）。
 */
data class ConnState(
    val online: Boolean = true,
    val serverName: String? = null,
    val unauthorized: Boolean = false,
)

/**
 * 连接监视器：同步/请求成功失败通过 report* 汇入；serverName 由注入的激活服务器名 Flow 维护。
 * 真实 401 一定是 ApiException（Task 3 错误映射拦截器保证），code=="UNAUTHORIZED" → 需要重新配对。
 */
class ConnectionMonitor(
    activeServerName: Flow<String?>,
    scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(ConnState())
    val state: StateFlow<ConnState> = _state

    init {
        scope.launch {
            activeServerName.collect { name ->
                _state.update { it.copy(serverName = name) }
            }
        }
    }

    fun reportSuccess() {
        _state.update { it.copy(online = true, unauthorized = false) }
    }

    fun reportFailure(e: Throwable) {
        val unauthorized = (e as? ApiException)?.code == "UNAUTHORIZED"
        _state.update { it.copy(online = false, unauthorized = unauthorized) }
    }

    /** 系统网络断开（NetworkCallback.onLost）：直接压横幅离线，不等下一次同步失败推断（D6b）。 */
    fun reportNetworkLost() {
        _state.update { it.copy(online = false) }
    }

    /** 系统网络恢复：直接收横幅；unauthorized 保留（密钥失效与网络无关）。 */
    fun reportNetworkRestored() {
        _state.update { it.copy(online = true) }
    }
}
