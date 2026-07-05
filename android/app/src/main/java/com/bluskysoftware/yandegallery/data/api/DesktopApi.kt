package com.bluskysoftware.yandegallery.data.api

import kotlinx.serialization.json.JsonObject
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

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

    // ---- 写接口（M3）----
    // Retrofit 的 @DELETE 不允许 @Body，带 body 的删除用 @HTTP(hasBody=true)。

    @DELETE("api/v1/images/{imageId}")
    suspend fun deleteImage(@Path("imageId") imageId: Long): ApiEnvelope<RemovedDto>

    @POST("api/v1/images/batch-delete")
    suspend fun batchDeleteImages(@Body body: ImageIdsBody): ApiEnvelope<BatchDeleteDto>

    @POST("api/v1/images/{imageId}/tags")
    suspend fun addImageTags(@Path("imageId") imageId: Long, @Body body: TagNamesDto): ApiEnvelope<UpdatedDto>

    @HTTP(method = "DELETE", path = "api/v1/images/{imageId}/tags", hasBody = true)
    suspend fun removeImageTags(@Path("imageId") imageId: Long, @Body body: TagNamesDto): ApiEnvelope<UpdatedDto>

    @POST("api/v1/galleries")
    suspend fun createGallery(@Body body: GalleryNameDto): ApiEnvelope<CreatedIdDto>

    @PATCH("api/v1/galleries/{galleryId}")
    suspend fun renameGallery(@Path("galleryId") galleryId: Long, @Body body: GalleryNameDto): ApiEnvelope<UpdatedDto>

    @DELETE("api/v1/galleries/{galleryId}")
    suspend fun deleteGallery(@Path("galleryId") galleryId: Long): ApiEnvelope<RemovedDto>

    @POST("api/v1/galleries/{galleryId}/images")
    suspend fun addGalleryImages(@Path("galleryId") galleryId: Long, @Body body: ImageIdsBody): ApiEnvelope<AddMembersDto>

    @HTTP(method = "DELETE", path = "api/v1/galleries/{galleryId}/images", hasBody = true)
    suspend fun removeGalleryImages(@Path("galleryId") galleryId: Long, @Body body: ImageIdsBody): ApiEnvelope<RemoveMembersDto>

    // 原图流式下载：@Streaming 避免整体缓存到内存；Range 头支持断点续传（Task 8 用）。
    @Streaming
    @GET("api/v1/images/{imageId}/file")
    suspend fun downloadOriginal(
        @Path("imageId") imageId: Long,
        @Header("Range") range: String? = null,
    ): Response<ResponseBody>
}
