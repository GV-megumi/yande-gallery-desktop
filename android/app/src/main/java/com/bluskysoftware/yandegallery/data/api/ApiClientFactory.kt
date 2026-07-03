package com.bluskysoftware.yandegallery.data.api

import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

object ApiClientFactory {
    val json = Json { ignoreUnknownKeys = true }

    @kotlinx.serialization.Serializable
    private data class ErrorEnvelope(val error: ApiErrorDto? = null)

    private val BINARY_PATH = Regex("""/api/v1/images/\d+/(thumbnail|preview|file)/?$""")

    /**
     * Bearer 拦截器动态取 key：切换激活服务器后无需重建 OkHttpClient。
     * key 为 null（未配对）时不加头，让服务端 401 走统一错误路径。
     *
     * 关键：桌面端所有错误都是「非 2xx + {success:false,error:{code,message}} envelope」——
     * Retrofit 对非 2xx 会在反序列化之前抛 HttpException，错误 envelope 永远到不了 unwrap()。
     * 故在此加错误映射拦截器：非 2xx → 解析错误体 → 抛 ApiException(code, message, httpStatus)。
     * 顺带实现 spec §6.3-4：二进制路径 404 触发一次 image-ids 对账（onBinaryNotFound 钩子）。
     */
    fun okHttp(
        apiKeyProvider: () -> String?,
        onBinaryNotFound: (() -> Unit)? = null,
    ): OkHttpClient =
        OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val key = apiKeyProvider()
                val request = if (key.isNullOrEmpty()) chain.request()
                else chain.request().newBuilder().header("Authorization", "Bearer $key").build()
                chain.proceed(request)
            }
            .addInterceptor { chain ->
                val response = chain.proceed(chain.request())
                if (response.isSuccessful) return@addInterceptor response
                val status = response.code
                val bodyText = runCatching { response.peekBody(64 * 1024).string() }.getOrNull()
                response.close()
                if (status == 404 && BINARY_PATH.containsMatchIn(chain.request().url.encodedPath)) {
                    onBinaryNotFound?.invoke()
                }
                val error = bodyText?.let {
                    runCatching { json.decodeFromString<ErrorEnvelope>(it).error }.getOrNull()
                }
                throw ApiException(
                    code = error?.code ?: "INTERNAL_ERROR",
                    message = error?.message ?: "HTTP $status",
                    httpStatus = status,
                )
            }
            .build()

    fun desktopApi(baseUrl: String, okHttp: OkHttpClient): DesktopApi {
        val normalized = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        return Retrofit.Builder()
            .baseUrl(normalized)
            .client(okHttp)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(DesktopApi::class.java)
    }
}
