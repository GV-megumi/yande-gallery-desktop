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

/**
 * 缓存键按本机 servers 行 id 做命名空间：多服务器的 imageId 各来自不同桌面库，可能重号，
 * 仅用 imageId 会让 Coil 命中别台服务器的同 id 缩略图（串图）。serverId 切服即变、始终可用、
 * 简单正确。代价：同库换 IP（= 换 server 行）会重新缓存——正确性优先于该微优化。
 */
fun thumbnailCacheKey(serverId: Long, imageId: Long): String = "s$serverId:t$imageId"

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

fun thumbnailRequest(context: Context, baseUrl: String, serverId: Long, imageId: Long): ImageRequest =
    ImageRequest.Builder(context)
        .data(thumbnailUrl(baseUrl, imageId))
        .diskCacheKey(thumbnailCacheKey(serverId, imageId))
        .memoryCacheKey(thumbnailCacheKey(serverId, imageId))
        .build()
