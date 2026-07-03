package com.bluskysoftware.yandegallery.domain.sync

import com.bluskysoftware.yandegallery.data.api.SyncGalleryDto
import com.bluskysoftware.yandegallery.data.api.SyncImagesPageDto
import com.bluskysoftware.yandegallery.data.api.SyncMetaDto
import com.bluskysoftware.yandegallery.data.api.SyncTagDto

/**
 * 同步数据源抽象。Task 7 用 Retrofit 适配真实后端；测试用脚本化 Fake。
 */
interface SyncApi {
    suspend fun meta(): SyncMetaDto
    suspend fun images(cursor: String?, limit: Int): SyncImagesPageDto
    suspend fun galleries(): List<SyncGalleryDto>
    suspend fun tags(): List<SyncTagDto>
    suspend fun imageIds(): List<Long>
}
