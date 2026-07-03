package com.bluskysoftware.yandegallery.data.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class PairingPayload(
    val v: Int,
    val name: String,
    val baseUrl: String,
    val apiKey: String,
)

private val lenientJson = Json { ignoreUnknownKeys = true }

/** 解析桌面端二维码载荷（spec §4.1）；任何不合法输入返回 null，不抛异常。 */
fun parsePairingPayload(raw: String): PairingPayload? {
    val payload = runCatching { lenientJson.decodeFromString<PairingPayload>(raw) }.getOrNull() ?: return null
    if (payload.v != 1) return null
    if (!payload.baseUrl.startsWith("http://") && !payload.baseUrl.startsWith("https://")) return null
    if (payload.apiKey.isBlank()) return null
    return payload
}
