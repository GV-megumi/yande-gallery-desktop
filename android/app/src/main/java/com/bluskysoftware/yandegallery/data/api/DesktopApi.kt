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

/**
 * 手机面命名空间前缀（不带首尾斜杠；对应桌面端 appNamespace.ts 的 APP_API_PREFIX）。
 * 全部 Retrofit 注解、URL 拼接与二进制路径正则共用此单一真值——const val 拼接是编译期常量，
 * 注解里也能用；下次前缀迁移只改这一处。
 */
const val APP_API_PATH = "api/app/v1"

interface DesktopApi {
    @GET("$APP_API_PATH/service/info")
    suspend fun serviceInfo(): ApiEnvelope<JsonObject>

    @GET("$APP_API_PATH/sync/meta")
    suspend fun syncMeta(): ApiEnvelope<SyncMetaDto>

    @GET("$APP_API_PATH/sync/images")
    suspend fun syncImages(
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int? = null,
    ): ApiEnvelope<SyncImagesPageDto>

    @GET("$APP_API_PATH/sync/galleries")
    suspend fun syncGalleries(): ApiEnvelope<ItemsDto<SyncGalleryDto>>

    @GET("$APP_API_PATH/sync/tags")
    suspend fun syncTags(): ApiEnvelope<ItemsDto<SyncTagDto>>

    @GET("$APP_API_PATH/sync/image-ids")
    suspend fun syncImageIds(): ApiEnvelope<ImageIdsDto>

    // ---- 写接口（M3）----
    // Retrofit 的 @DELETE 不允许 @Body，带 body 的删除用 @HTTP(hasBody=true)。

    @DELETE("$APP_API_PATH/images/{imageId}")
    suspend fun deleteImage(@Path("imageId") imageId: Long): ApiEnvelope<RemovedDto>

    @POST("$APP_API_PATH/images/batch-delete")
    suspend fun batchDeleteImages(@Body body: ImageIdsBody): ApiEnvelope<BatchDeleteDto>

    @POST("$APP_API_PATH/images/{imageId}/tags")
    suspend fun addImageTags(@Path("imageId") imageId: Long, @Body body: TagNamesDto): ApiEnvelope<UpdatedDto>

    @HTTP(method = "DELETE", path = "$APP_API_PATH/images/{imageId}/tags", hasBody = true)
    suspend fun removeImageTags(@Path("imageId") imageId: Long, @Body body: TagNamesDto): ApiEnvelope<UpdatedDto>

    @POST("$APP_API_PATH/galleries")
    suspend fun createGallery(@Body body: GalleryNameDto): ApiEnvelope<CreatedIdDto>

    @PATCH("$APP_API_PATH/galleries/{galleryId}")
    suspend fun renameGallery(@Path("galleryId") galleryId: Long, @Body body: GalleryNameDto): ApiEnvelope<UpdatedDto>

    // v0.6：设相册封面（桌面 PATCH 已扩展接受 coverImageId，spec §6.1）
    @PATCH("$APP_API_PATH/galleries/{galleryId}")
    suspend fun setGalleryCover(@Path("galleryId") galleryId: Long, @Body body: GalleryCoverDto): ApiEnvelope<UpdatedDto>

    @DELETE("$APP_API_PATH/galleries/{galleryId}")
    suspend fun deleteGallery(@Path("galleryId") galleryId: Long): ApiEnvelope<RemovedDto>

    @POST("$APP_API_PATH/galleries/{galleryId}/images")
    suspend fun addGalleryImages(@Path("galleryId") galleryId: Long, @Body body: ImageIdsBody): ApiEnvelope<AddMembersDto>

    @HTTP(method = "DELETE", path = "$APP_API_PATH/galleries/{galleryId}/images", hasBody = true)
    suspend fun removeGalleryImages(@Path("galleryId") galleryId: Long, @Body body: ImageIdsBody): ApiEnvelope<RemoveMembersDto>

    // 原图流式下载：@Streaming 避免整体缓存到内存；Range 头支持断点续传（Task 8 用）。
    @Streaming
    @GET("$APP_API_PATH/images/{imageId}/file")
    suspend fun downloadOriginal(
        @Path("imageId") imageId: Long,
        @Header("Range") range: String? = null,
    ): Response<ResponseBody>
}
