package com.bluskysoftware.yandegallery.domain.sync

import com.bluskysoftware.yandegallery.data.api.SyncGalleryDto
import com.bluskysoftware.yandegallery.data.api.SyncImageItemDto
import com.bluskysoftware.yandegallery.data.api.SyncTagDto

/**
 * 本地镜像存储抽象。Task 7 用 Room 实现；测试用 InMemory。
 */
interface MirrorStore {
    suspend fun readSyncState(): SyncState?
    suspend fun writeSyncState(state: SyncState)
    suspend fun clearMirror()                                    // 清五张镜像表 + downloads + album_prefs + sync_state
    suspend fun applyImagePage(items: List<SyncImageItemDto>)    // upsert 图片行 + 全量替换其 tag/gallery 关联
    suspend fun localImageIds(): List<Long>
    suspend fun deleteImages(ids: List<Long>)
    suspend fun replaceGalleries(items: List<SyncGalleryDto>)
    suspend fun replaceTags(items: List<SyncTagDto>)
}
