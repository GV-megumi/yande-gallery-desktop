package com.bluskysoftware.yandegallery.domain.write

import com.bluskysoftware.yandegallery.data.api.AddMembersDto
import com.bluskysoftware.yandegallery.data.api.BatchDeleteItemDto

/**
 * 写操作领域抽象——Task 6 的 WriteRepository 消费，测试中以 fake 替换。
 * 屏蔽 Retrofit/DesktopApi 细节，只暴露业务语义参数与结果。
 */
interface WriteApi {
    suspend fun deleteImage(imageId: Long)
    suspend fun batchDeleteImages(imageIds: List<Long>): List<BatchDeleteItemDto>
    suspend fun addImageTags(imageId: Long, names: List<String>)
    suspend fun removeImageTags(imageId: Long, names: List<String>)
    suspend fun createGallery(name: String): Long
    suspend fun renameGallery(galleryId: Long, name: String)
    suspend fun setGalleryCover(galleryId: Long, coverImageId: Long)
    suspend fun deleteGallery(galleryId: Long)
    suspend fun addImagesToGallery(galleryId: Long, imageIds: List<Long>): AddMembersDto
    suspend fun removeImagesFromGallery(galleryId: Long, imageIds: List<Long>): Int
}
