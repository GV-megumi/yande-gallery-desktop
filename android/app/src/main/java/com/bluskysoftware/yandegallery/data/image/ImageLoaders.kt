package com.bluskysoftware.yandegallery.data.image

import android.content.Context
import coil3.ImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.ImageRequest
import okhttp3.OkHttpClient
import okio.Path.Companion.toOkioPath

fun thumbnailUrl(baseUrl: String, imageId: Long): String =
    "${baseUrl.trimEnd('/')}/api/v1/images/$imageId/thumbnail"

/** 稳定缓存键：只用 imageId，服务器 IP/baseUrl 变化（同一图库迁移地址）不作废缓存。 */
fun thumbnailCacheKey(imageId: Long): String = "thumb:$imageId"

/** 缩略图专用 ImageLoader：独立 2GB 持久盘缓存（spec §6.4），复用带 Bearer 的 OkHttp。 */
fun buildThumbnailImageLoader(context: Context, okHttp: OkHttpClient): ImageLoader =
    ImageLoader.Builder(context)
        .components {
            add(OkHttpNetworkFetcherFactory(callFactory = { okHttp }))
        }
        .diskCache(
            DiskCache.Builder()
                .directory(context.cacheDir.resolve("thumbnails").toOkioPath())
                .maxSizeBytes(2L * 1024 * 1024 * 1024)
                .build()
        )
        .build()

fun thumbnailRequest(context: Context, baseUrl: String, imageId: Long): ImageRequest =
    ImageRequest.Builder(context)
        .data(thumbnailUrl(baseUrl, imageId))
        .diskCacheKey(thumbnailCacheKey(imageId))
        .memoryCacheKey(thumbnailCacheKey(imageId))
        .build()
