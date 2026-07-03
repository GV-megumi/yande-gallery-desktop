package com.bluskysoftware.yandegallery.data.api

import kotlinx.serialization.json.JsonObject
import retrofit2.http.GET
import retrofit2.http.Query

interface DesktopApi {
    @GET("api/v1/service/info")
    suspend fun serviceInfo(): ApiEnvelope<JsonObject>

    @GET("api/v1/sync/meta")
    suspend fun syncMeta(): ApiEnvelope<SyncMetaDto>

    @GET("api/v1/sync/images")
    suspend fun syncImages(
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int? = null,
    ): ApiEnvelope<SyncImagesPageDto>

    @GET("api/v1/sync/galleries")
    suspend fun syncGalleries(): ApiEnvelope<ItemsDto<SyncGalleryDto>>

    @GET("api/v1/sync/tags")
    suspend fun syncTags(): ApiEnvelope<ItemsDto<SyncTagDto>>

    @GET("api/v1/sync/image-ids")
    suspend fun syncImageIds(): ApiEnvelope<ImageIdsDto>
}
