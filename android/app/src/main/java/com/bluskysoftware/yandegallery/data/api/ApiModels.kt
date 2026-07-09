package com.bluskysoftware.yandegallery.data.api

import kotlinx.serialization.Serializable

@Serializable
data class ApiErrorDto(val code: String, val message: String)

@Serializable
data class ApiEnvelope<T>(
    val success: Boolean,
    val data: T? = null,
    val error: ApiErrorDto? = null,
)

/**
 * 统一 API 异常。继承 IOException：OkHttp 拦截器内只能抛 IOException 族，
 * 这样非 2xx → ApiException 的映射可以在拦截器层完成并穿透 Retrofit suspend 调用。
 */
class ApiException(
    val code: String,
    override val message: String,
    val httpStatus: Int? = null,
) : java.io.IOException(message)

fun <T> ApiEnvelope<T>.unwrap(): T {
    if (success && data != null) return data
    val err = error ?: ApiErrorDto("INTERNAL_ERROR", "Malformed envelope")
    throw ApiException(err.code, err.message)
}

@Serializable
data class SyncMetaDto(
    val serverId: String,
    val dataVersion: Long,
    val imageCount: Long,
    val latestCursor: String?,
)

@Serializable
data class SyncImageItemDto(
    val id: Long,
    val filename: String,
    val width: Int,
    val height: Int,
    val fileSize: Long,
    val format: String,
    val createdAt: String,
    val updatedAt: String,
    val tagIds: List<Long>,
    val galleryIds: List<Long>,
)

@Serializable
data class SyncImagesPageDto(
    val items: List<SyncImageItemDto>,
    val nextCursor: String?,
    val hasMore: Boolean,
)

@Serializable
data class SyncGalleryDto(
    val id: Long,
    val name: String,
    val coverImageId: Long?,
    val imageCount: Int,
    val createdAt: String? = null,   // v0.6：旧桌面缺字段反序列化为 null（spec §2.2/§6.3）
)

@Serializable
data class SyncTagDto(
    val id: Long,
    val name: String,
    val category: String?,
)

@Serializable
data class ImageIdsDto(val ids: List<Long>)

@Serializable
data class ItemsDto<T>(val items: List<T>)
