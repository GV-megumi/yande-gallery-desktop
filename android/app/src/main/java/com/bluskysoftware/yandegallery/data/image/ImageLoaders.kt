package com.bluskysoftware.yandegallery.data.image

import android.content.Context
import coil3.ImageLoader
import coil3.decode.DataSource
import coil3.decode.ImageSource
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.fetch.Fetcher
import coil3.fetch.SourceFetchResult
import coil3.request.ImageRequest
import coil3.request.Options
import com.bluskysoftware.yandegallery.data.api.APP_API_PATH
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okio.Buffer
import okio.FileSystem
import okio.Path.Companion.toOkioPath
import okio.buffer
import java.io.File
import java.io.IOException

fun thumbnailUrl(baseUrl: String, imageId: Long): String =
    "${baseUrl.trimEnd('/')}/$APP_API_PATH/images/$imageId/thumbnail"

/**
 * 缓存键按本机 servers 行 id 做命名空间：多服务器的 imageId 各来自不同桌面库，可能重号，
 * 仅用 imageId 会让 Coil 命中别台服务器的同 id 缩略图（串图）。serverId 切服即变、始终可用、
 * 简单正确。代价：同库换 IP（= 换 server 行）会重新缓存——正确性优先于该微优化。
 */
fun thumbnailCacheKey(serverId: Long, imageId: Long): String = "s$serverId:t$imageId"

/** 网格缩略图请求模型（镜像 spec §4.1）：携带定位三元组，Fetcher 据此先查本地镜像再回退网络。 */
data class ThumbnailSpec(val serverId: Long, val imageId: Long, val url: String)

/**
 * 镜像优先 Fetcher（spec §4.1/D11）：本地有镜像文件（HQ/原图）→ 直接文件 Source（手机自产降采样、
 * 零网络零盘缓存写入）；未镜像 → 先查 Coil 磁盘缓存，未命中再由注入的 OkHttp 自行拉桌面端
 * /thumbnail（自管请求绕开 Coil 网络层，但写穿 imageLoader.diskCache，成功响应落盘供下次复用）。
 * localFile 注入挂 ImageMirrorStore::localFile（已校验文件存在性，行在文件亡按未命中处理）。
 */
class MirrorFirstFetcherFactory(
    private val localFile: suspend (serverId: Long, imageId: Long) -> File?,
    private val okHttp: OkHttpClient,
) : Fetcher.Factory<ThumbnailSpec> {

    override fun create(data: ThumbnailSpec, options: Options, imageLoader: ImageLoader): Fetcher =
        Fetcher {
            val file = localFile(data.serverId, data.imageId)
            if (file != null) {
                SourceFetchResult(
                    source = ImageSource(file = file.toOkioPath(), fileSystem = FileSystem.SYSTEM),
                    mimeType = null,
                    dataSource = DataSource.DISK,
                )
            } else {
                fetchRemote(data.url, options, imageLoader.diskCache)
            }
        }

    /**
     * 网络回退（写穿盘缓存，review 修复）：先查 Coil 磁盘缓存（未镜像但此前缓存过的缩略图零网络命中），
     * 未命中再走注入的 okHttp（已带 Bearer 拦截器）直接执行，不借道 Coil 网络层——响应体整段读进
     * 内存 Buffer 后再关闭连接，与 Coil 自身 NetworkFetcher 的处理方式一致，避免 ImageSource 持有的
     * 流跑在已经 close() 的连接上；缩略图体积小，一次性读入内存无虞。工程未引入 okhttp3.coroutines
     * 的 executeAsync，故用 withContext(Dispatchers.IO) 包同步 execute()（沿用 ImageMirrorStore 先例）。
     * 网络成功后写入磁盘缓存，供下次「未镜像+已缓存」的请求零网络命中——此前实现自管请求全程绕开
     * imageLoader.diskCache，导致缩略图翻页/刷新在服务器不可达时无法从磁盘缓存兜底（Important #3）。
     *
     * 非 2xx 必须显式拒绝（review 修复）：本方法自管请求、绕开 Coil 网络层，不能假设调用方注入的
     * okHttp 一定带错误映射拦截器（生产环境的 AppGraph.okHttp 恰好带，但该保证对本类不可见、也不应
     * 依赖）——不然 404/500 的错误体会被当成图片字节裸塞进 SourceFetchResult，Coil 解码时炸出的是
     * 「格式不对」而非「请求失败」，误导排查方向（对齐 Coil 自身 NetworkFetcher 的状态码校验）。
     */
    private suspend fun fetchRemote(url: String, options: Options, diskCache: DiskCache?): SourceFetchResult =
        withContext(Dispatchers.IO) {
            val cacheKey = options.diskCacheKey ?: url
            if (diskCache != null && options.diskCachePolicy.readEnabled) {
                diskCache.openSnapshot(cacheKey)?.use { snapshot ->
                    return@withContext SourceFetchResult(
                        source = ImageSource(
                            file = snapshot.data,
                            fileSystem = diskCache.fileSystem,
                            diskCacheKey = cacheKey,
                        ),
                        mimeType = null,
                        dataSource = DataSource.DISK,
                    )
                }
            }
            val request = Request.Builder().url(url).build()
            okHttp.newCall(request).execute().use { response ->
                // 此处直接 throw：外层 .use{} 的 finally 仍会关闭 response，无需手动再关一次。
                if (!response.isSuccessful) {
                    throw IOException("缩略图请求失败 HTTP ${response.code}: $url")
                }
                val bytes = response.body.bytes()
                if (diskCache != null && options.diskCachePolicy.writeEnabled) {
                    writeToDiskCache(diskCache, cacheKey, bytes)
                }
                SourceFetchResult(
                    source = ImageSource(source = Buffer().apply { write(bytes) }, fileSystem = FileSystem.SYSTEM),
                    mimeType = response.header("Content-Type"),
                    dataSource = DataSource.NETWORK,
                )
            }
        }

    /**
     * 写穿磁盘缓存：写失败（磁盘满/并发同 key 竞争等）仅 abort 放弃这次写入，不影响本次已经拿到的
     * 网络结果——磁盘缓存本就是「有则加速、无则退化回网络」的旁路，写失败不应连累 fetchRemote 整体
     * 失败。本函数无挂起点（同步 IO + okio 阻塞写），不涉及吞掉 CancellationException 的顾虑。
     */
    private fun writeToDiskCache(diskCache: DiskCache, key: String, bytes: ByteArray) {
        val editor = diskCache.openEditor(key) ?: return
        try {
            diskCache.fileSystem.sink(editor.data).buffer().use { it.write(bytes) }
            editor.commit()
        } catch (_: Exception) {
            editor.abort()
        }
    }
}

/**
 * 缩略图档（spec §4.1/D9）：不设上限（1 TiB 形式值，实质仅受磁盘约束）+ 镜像优先 Fetcher。
 * 仅注册 MirrorFirstFetcherFactory（review 修复：移除不可达的 OkHttpNetworkFetcherFactory 兜底）——
 * 网格侧全部请求经 thumbnailRequest() 构造，.data() 恒为 ThumbnailSpec，且 create() 从不返回 null，
 * Coil 不会再向后尝试下一个 Fetcher.Factory；也无 Mapper 把 ThumbnailSpec 转成 OkHttpNetworkFetcherFactory
 * 认得的 String/HttpUrl/Uri。网络回退已由 MirrorFirstFetcherFactory.fetchRemote() 自管，无需重复注册。
 */
fun buildThumbnailImageLoader(
    context: Context,
    okHttp: OkHttpClient,
    localFile: suspend (serverId: Long, imageId: Long) -> File?,
): ImageLoader =
    ImageLoader.Builder(context)
        .components { add(MirrorFirstFetcherFactory(localFile, okHttp)) }
        .diskCache(
            DiskCache.Builder()
                .directory(context.cacheDir.resolve("thumbnails").toOkioPath())
                .maxSizeBytes(1L shl 40)
                .build()
        )
        .build()

fun thumbnailRequest(context: Context, baseUrl: String, serverId: Long, imageId: Long): ImageRequest =
    ImageRequest.Builder(context)
        .data(ThumbnailSpec(serverId, imageId, thumbnailUrl(baseUrl, imageId)))
        .diskCacheKey(thumbnailCacheKey(serverId, imageId))
        .memoryCacheKey(thumbnailCacheKey(serverId, imageId))
        .build()

fun fileUrl(baseUrl: String, imageId: Long): String =
    "${baseUrl.trimEnd('/')}/$APP_API_PATH/images/$imageId/file"
