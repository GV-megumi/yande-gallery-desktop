package com.bluskysoftware.yandegallery.data.api

import kotlinx.serialization.Serializable

// 写接口请求 DTO——字段名须与桌面 JSON 逐字节一致。
@Serializable
data class TagNamesDto(val names: List<String>)

@Serializable
data class ImageIdsBody(val imageIds: List<Long>)

@Serializable
data class GalleryNameDto(val name: String)

@Serializable
data class GalleryCoverDto(val coverImageId: Long)

// 写接口响应 DTO。
@Serializable
data class RemovedDto(val removed: Boolean)

@Serializable
data class UpdatedDto(val updated: Boolean)

@Serializable
data class CreatedIdDto(val id: Long)

@Serializable
data class AddMembersDto(val added: Int, val missingImageIds: List<Long>)

@Serializable
data class RemoveMembersDto(val removed: Int)

@Serializable
data class BatchDeleteItemDto(val imageId: Long, val success: Boolean, val error: String? = null)

@Serializable
data class BatchDeleteDto(val results: List<BatchDeleteItemDto>)
