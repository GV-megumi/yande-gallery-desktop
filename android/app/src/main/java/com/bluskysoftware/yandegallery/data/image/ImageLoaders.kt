package com.bluskysoftware.yandegallery.data.image

import android.content.Context
import coil3.ImageLoader
import coil3.decode.DataSource
import coil3.decode.ImageSource
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.fetch.Fetcher
import coil3.fetch.SourceFetchResult
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
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
import java.io.File

fun thumbnailUrl(baseUrl: String, imageId: Long): String =
    "${baseUrl.trimEnd('/')}/$APP_API_PATH/images/$imageId/thumbnail"

/**
 * 缓存键按本机 servers 行 id 做命名空间：多服务器的 imageId 各来自不同桌面库，可能重号，
 * 仅用 imageId 会让 Coil 命中别台服务器的同 id 缩略图（串图）。serverId 切服即变、始终可用、
 * 简单正确。代价：同库换 IP（= 换 server 行）会重新缓存——正确性优先于该微优化。
 */
fun thumbnailCacheKey(serverId: Long, imageId: Long): String = "s$serverId:t$imageId"

/**
 * 参数化档位 ImageLoader（M4-T8 收拢，清 M3-T2「两 builder 结构重复」记债）：独立盘缓存目录 + 可调上限。
 * maxSizeBytes 经设置页调整（spec §6.4「设置可调」）、构建期定死——改后须重建 loader（下次进程启动）才生效。
 */
fun buildTierImageLoader(
    context: Context,
    okHttp: OkHttpClient,
    cacheDirName: String,
    maxSizeBytes: Long,
): ImageLoader =
    ImageLoader.Builder(context)
        .components { add(OkHttpNetworkFetcherFactory(callFactory = { okHttp })) }
        .diskCache(
            DiskCache.Builder()
                .directory(context.cacheDir.resolve(cacheDirName).toOkioPath())
                .maxSizeBytes(maxSizeBytes)
                .build()
        )
        .build()

/** 网格缩略图请求模型（镜像 spec §4.1）：携带定位三元组，Fetcher 据此先查本地镜像再回退网络。 */
data class ThumbnailSpec(val serverId: Long, val imageId: Long, val url: String)

/**
 * 镜像优先 Fetcher（spec §4.1/D11）：本地有镜像文件（HQ/原图）→ 直接文件 Source（手机自产降采样、
 * 零网络零盘缓存写入）；未镜像 → 注入的 OkHttp 自行拉桌面端 /thumbnail（自管请求绕开 Coil 网络层，
 * 故不写 Coil 盘缓存——代价仅限于「刚入库未同步」这段窗口的重复拉取，可接受，见任务 brief 实现注意）。
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
                fetchRemote(data.url)
            }
        }

    /**
     * 网络回退：注入的 okHttp（已带 Bearer 拦截器）直接执行，不借道 Coil 网络层。响应体整段读进
     * 内存 Buffer 后再关闭连接——与 Coil 自身 NetworkFetcher 的处理方式一致，避免 ImageSource 持有的
     * 流跑在已经 close() 的连接上；缩略图体积小，一次性读入内存无虞。工程未引入 okhttp3.coroutines
     * 的 executeAsync，故用 withContext(Dispatchers.IO) 包同步 execute()（沿用 ImageMirrorStore 先例）。
     */
    private suspend fun fetchRemote(url: String): SourceFetchResult =
        withContext(Dispatchers.IO) {
            val request = Request.Builder().url(url).build()
            okHttp.newCall(request).execute().use { response ->
                val bytes = response.body.bytes()
                SourceFetchResult(
                    source = ImageSource(source = Buffer().apply { write(bytes) }, fileSystem = FileSystem.SYSTEM),
                    mimeType = response.header("Content-Type"),
                    dataSource = DataSource.NETWORK,
                )
            }
        }
}

/** 缩略图档（spec §4.1/D9）：不设上限（1 TiB 形式值，实质仅受磁盘约束）+ 镜像优先 Fetcher。 */
fun buildThumbnailImageLoader(
    context: Context,
    okHttp: OkHttpClient,
    localFile: suspend (serverId: Long, imageId: Long) -> File?,
): ImageLoader =
    ImageLoader.Builder(context)
        .components {
            add(MirrorFirstFetcherFactory(localFile, okHttp))
            add(OkHttpNetworkFetcherFactory(callFactory = { okHttp }))
        }
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

fun previewUrl(baseUrl: String, imageId: Long): String =
    "${baseUrl.trimEnd('/')}/$APP_API_PATH/images/$imageId/preview"

fun fileUrl(baseUrl: String, imageId: Long): String =
    "${baseUrl.trimEnd('/')}/$APP_API_PATH/images/$imageId/file"

/**
 * serverId 命名空间（与 v0.2.0 review 修复的 thumbnailCacheKey 一致）：多服务器同 imageId 不同图，
 * 缓存键须含本机 servers 行 id，否则切服命中错图。
 */
fun previewCacheKey(serverId: Long, imageId: Long): String = "s$serverId:preview:$imageId"

/** 预览档：LRU 语义目录 previews，默认 1GB（spec §6.4，上限设置页可调）。 */
fun buildPreviewImageLoader(
    context: Context,
    okHttp: OkHttpClient,
    maxSizeBytes: Long = 1L * 1024 * 1024 * 1024,
): ImageLoader = buildTierImageLoader(context, okHttp, "previews", maxSizeBytes)

fun previewRequest(context: Context, baseUrl: String, serverId: Long, imageId: Long): ImageRequest =
    ImageRequest.Builder(context)
        .data(previewUrl(baseUrl, imageId))
        .diskCacheKey(previewCacheKey(serverId, imageId))
        .memoryCacheKey(previewCacheKey(serverId, imageId))
        .build()
