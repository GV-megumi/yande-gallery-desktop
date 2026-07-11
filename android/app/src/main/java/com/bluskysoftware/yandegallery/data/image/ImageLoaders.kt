package com.bluskysoftware.yandegallery.data.image

import android.content.Context
import coil3.ImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.ImageRequest
import com.bluskysoftware.yandegallery.data.api.APP_API_PATH
import okhttp3.OkHttpClient
import okio.Path.Companion.toOkioPath

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

/** 缩略图档：持久语义目录 thumbnails，默认 2GB（spec §6.4，上限设置页可调）。 */
fun buildThumbnailImageLoader(
    context: Context,
    okHttp: OkHttpClient,
    maxSizeBytes: Long = 2L * 1024 * 1024 * 1024,
): ImageLoader = buildTierImageLoader(context, okHttp, "thumbnails", maxSizeBytes)

fun thumbnailRequest(context: Context, baseUrl: String, serverId: Long, imageId: Long): ImageRequest =
    ImageRequest.Builder(context)
        .data(thumbnailUrl(baseUrl, imageId))
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
