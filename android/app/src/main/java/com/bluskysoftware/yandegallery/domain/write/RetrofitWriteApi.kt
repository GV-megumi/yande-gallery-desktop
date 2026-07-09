package com.bluskysoftware.yandegallery.domain.write

import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.api.DesktopApi
import com.bluskysoftware.yandegallery.data.api.GalleryCoverDto
import com.bluskysoftware.yandegallery.data.api.GalleryNameDto
import com.bluskysoftware.yandegallery.data.api.ImageIdsBody
import com.bluskysoftware.yandegallery.data.api.TagNamesDto
import com.bluskysoftware.yandegallery.data.api.unwrap

/**
 * WriteApi 的 Retrofit 实现。apiProvider 动态取当前激活服务器的 DesktopApi——
 * 未配置服务器时返回 null，抛 ApiException("SERVICE_UNAVAILABLE") 走统一错误路径。
 * 各方法 unwrap() 把 envelope 拆成业务结果，非 2xx 已在拦截器层映射为 ApiException。
 */
class RetrofitWriteApi(private val apiProvider: suspend () -> DesktopApi?) : WriteApi {
    private suspend fun api(): DesktopApi =
        apiProvider() ?: throw ApiException("SERVICE_UNAVAILABLE", "未配置服务器")

    override suspend fun deleteImage(imageId: Long) {
        api().deleteImage(imageId).unwrap()
    }

    override suspend fun batchDeleteImages(imageIds: List<Long>) =
        api().batchDeleteImages(ImageIdsBody(imageIds)).unwrap().results

    override suspend fun addImageTags(imageId: Long, names: List<String>) {
        api().addImageTags(imageId, TagNamesDto(names)).unwrap()
    }

    override suspend fun removeImageTags(imageId: Long, names: List<String>) {
        api().removeImageTags(imageId, TagNamesDto(names)).unwrap()
    }

    override suspend fun createGallery(name: String) =
        api().createGallery(GalleryNameDto(name)).unwrap().id

    override suspend fun renameGallery(galleryId: Long, name: String) {
        api().renameGallery(galleryId, GalleryNameDto(name)).unwrap()
    }

    override suspend fun setGalleryCover(galleryId: Long, coverImageId: Long) {
        api().setGalleryCover(galleryId, GalleryCoverDto(coverImageId)).unwrap()
    }

    override suspend fun deleteGallery(galleryId: Long) {
        api().deleteGallery(galleryId).unwrap()
    }

    override suspend fun addImagesToGallery(galleryId: Long, imageIds: List<Long>) =
        api().addGalleryImages(galleryId, ImageIdsBody(imageIds)).unwrap()

    override suspend fun removeImagesFromGallery(galleryId: Long, imageIds: List<Long>) =
        api().removeGalleryImages(galleryId, ImageIdsBody(imageIds)).unwrap().removed
}
