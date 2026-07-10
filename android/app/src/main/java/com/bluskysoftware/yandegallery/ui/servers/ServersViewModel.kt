package com.bluskysoftware.yandegallery.ui.servers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.bluskysoftware.yandegallery.data.api.ApiClientFactory
import com.bluskysoftware.yandegallery.data.api.unwrap
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.launch

// scheme + host[:port][/path]；host 两分支：方括号 IPv6 字面量（括号内允许冒号，如 [::1]）或常规主机名/IPv4。
private val BASE_URL_REGEX =
    Regex("""^https?://(\[[0-9A-Fa-f:]+]|[A-Za-z0-9.\-]+)(:\d{1,5})?(/.*)?$""")

/**
 * 归一化手输 baseUrl（M4-T14）：trim + 去尾斜杠；缺 scheme 自动补 `http://`；
 * 正则校验 scheme + host[:port]（不匹配返回 null，调用方据此报「地址格式不正确」不落库，
 * 与扫码路径 [parsePairingPayload] 的 scheme 校验对齐）。
 */
fun normalizeBaseUrl(raw: String): String? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return null
    val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        trimmed
    } else {
        "http://$trimmed"
    }
    val normalized = withScheme.trimEnd('/')
    return if (BASE_URL_REGEX.matches(normalized)) normalized else null
}

class ServersViewModel(private val graph: AppGraph) : ViewModel() {
    val servers = graph.serverRepository.observeAll()
    val active = graph.serverRepository.observeActive()

    /**
     * 连接测试：临时构建 api 调手机面 service/info（`api/app/v1/service/info`），不落库。
     * 手机 App 全部调用走手机面命名空间 `/api/app/v1`，整面仅受桌面「允许手机端连接」（`app.enabled`）
     * 单开关控制——本调用能成功即代表手机面已开、全部能力（含缩略图/同步/写操作）均可用，
     * 无需再看响应里的 agent 面 11 键细化权限（含 imageBinary）：那是桌面 agent 面命名空间 `/api/v1`
     * 专属概念，与手机 App 完全无关，成功即只有一种「连接成功」文案。
     * 与「保存」同路归一化（BUG-08）：裸 IP 不补 scheme 会在 Retrofit 构建期抛英文
     * IllegalArgumentException——同一输入曾出现测试判失败、保存却成功的相反判定。
     */
    suspend fun testConnection(baseUrl: String, apiKey: String): Result<String> {
        val normalized = normalizeBaseUrl(baseUrl)
            ?: return Result.failure(IllegalArgumentException("地址格式不正确，应为 http://主机:端口"))
        return runCatching {
            val api = ApiClientFactory.desktopApi(
                normalized,
                ApiClientFactory.okHttp({ apiKey.trim() }),
            )
            api.serviceInfo().unwrap()
            "连接成功"
        }
    }

    fun add(name: String, baseUrl: String, apiKey: String, onDone: () -> Unit) {
        viewModelScope.launch {
            graph.serverRepository.addAndActivate(name.ifBlank { baseUrl }, baseUrl, apiKey)
            onDone()
        }
    }

    fun activate(id: Long) = viewModelScope.launch { graph.serverRepository.activate(id) }
    fun delete(id: Long) = viewModelScope.launch { graph.serverRepository.delete(id) }

    /** 编辑服务器（spec §7.6）：归一化落库。SSE 重连/同步 nudge 由 AppGraph 激活行收集器按
     *  baseUrl/apiKey 变化收敛触发（BUG-10：此处手动 restart 会读到尚未追平的陈旧快照连回旧 URL）。 */
    fun update(id: Long, name: String, baseUrl: String, apiKey: String, onDone: () -> Unit) {
        viewModelScope.launch {
            graph.serverRepository.updateServer(id, name, baseUrl, apiKey)
            onDone()
        }
    }

    suspend fun serverById(id: Long) = graph.serverRepository.byId(id)

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { ServersViewModel(graph) }
        }
    }
}
