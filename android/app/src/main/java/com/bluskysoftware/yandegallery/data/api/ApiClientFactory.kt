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

    private val BINARY_PATH = Regex("""/$APP_API_PATH/images/\d+/(thumbnail|preview|hq|file)/?$""")

    // 对账 nudge 触发路径刻意排除 hq：nudge 的语义是「二进制 404 ⇒ 桌面端图片已被删除 ⇒
    // 触发一次 image-ids 对账，对方 sync 会把这行删掉，循环收敛」。但 /hq 是新增端点，
    // 旧桌面（未升级）压根没有这条路由，对旧桌面的 hq 探测 404 恒为「端点不存在」而非
    // 「图片已删除」——对账不会删任何行，nudge 后镜像同步 worker 又立刻被重新调度，
    // 5 张探测又是 5 个 hq 404，形成 SERVER_TOO_OLD 活锁（前台常驻时呈 req/s 量级空转）。
    // thumbnail/file 404 仍覆盖「图片已删除」场景，足以让对账收敛，故仅这两者触发 nudge。
    private val BINARY_NUDGE_PATH = Regex("""/$APP_API_PATH/images/\d+/(thumbnail|file)/?$""")

    /**
     * Bearer 拦截器动态取 key：切换激活服务器后无需重建 OkHttpClient。
     * key 为 null（未配对）时不加头，让服务端 401 走统一错误路径。
     *
     * 关键：桌面端所有错误都是「非 2xx + {success:false,error:{code,message}} envelope」——
     * Retrofit 对非 2xx 会在反序列化之前抛 HttpException，错误 envelope 永远到不了 unwrap()。
     * 故在此加错误映射拦截器：非 2xx → 解析错误体 → 抛 ApiException(code, message, httpStatus)。
     * 顺带实现 spec §6.3-4：二进制路径 404 触发一次 image-ids 对账（onBinaryNotFound 钩子，hq 除外）。
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
                val path = chain.request().url.encodedPath
                val isBinaryPath = BINARY_PATH.containsMatchIn(path)
                // 空体 200 的图片响应视为失败：旧桌面/缩略图生成中断会对二进制路径发 Content-Length:0
                // 的 200，Coil 会把它当「成功但空」写入磁盘缓存并永久命中，RetryableAsyncImage 重试也
                // 只命中这条空缓存、重打同一 URL 却读不到网络、无法自愈（真机联调实证的封面「加载失败」）。
                // 抛错让 Coil 不缓存该响应、并让重试真正重打网络。仅限二进制图片路径，避免误伤 JSON 端点。
                if (isBinaryPath && response.isSuccessful && response.body.contentLength() == 0L) {
                    val code = response.code
                    response.close()
                    throw ApiException(code = "EMPTY_BINARY", message = "空的图片响应", httpStatus = code)
                }
                if (response.isSuccessful) return@addInterceptor response
                val status = response.code
                val bodyText = runCatching { response.peekBody(64 * 1024).string() }.getOrNull()
                response.close()
                if (status == 404 && BINARY_NUDGE_PATH.containsMatchIn(path)) {
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
