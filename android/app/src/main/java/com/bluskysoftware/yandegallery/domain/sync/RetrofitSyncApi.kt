package com.bluskysoftware.yandegallery.domain.sync

import com.bluskysoftware.yandegallery.data.api.*

/**
 * SyncApi 的 Retrofit 实现。apiProvider 由 AppGraph.api() 注入（未配置/激活服务器时返回 null）。
 */
class RetrofitSyncApi(private val apiProvider: suspend () -> DesktopApi?) : SyncApi {
    private suspend fun api(): DesktopApi =
        apiProvider() ?: throw ApiException("SERVICE_UNAVAILABLE", "未配置服务器")

    override suspend fun meta() = api().syncMeta().unwrap()
    override suspend fun images(cursor: String?, limit: Int) = api().syncImages(cursor, limit).unwrap()
    override suspend fun galleries() = api().syncGalleries().unwrap().items
    override suspend fun tags() = api().syncTags().unwrap().items
    override suspend fun imageIds() = api().syncImageIds().unwrap().ids
}
