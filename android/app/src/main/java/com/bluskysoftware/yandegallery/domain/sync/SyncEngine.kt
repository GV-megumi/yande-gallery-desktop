package com.bluskysoftware.yandegallery.domain.sync

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * 同步引擎（spec §6.3）：meta 校验 →（全量重建 | 增量）分页拉取 → image-ids 对账删除
 * → galleries/tags 全量覆盖。纯 Kotlin，无 Android 依赖，注入 SyncApi/MirrorStore 便于 JVM 测试。
 */
class SyncEngine(
    private val api: SyncApi,
    private val store: MirrorStore,
    private val pageLimit: Int = 2000,
    private val now: () -> String,
) {
    private val _progress = MutableStateFlow<SyncPhase>(SyncPhase.Idle)
    val progress: StateFlow<SyncPhase> = _progress

    suspend fun sync(): SyncOutcome {
        try {
            val meta = api.meta()
            val state = store.readSyncState()
            val fullRebuild = state == null ||
                state.remoteServerId != meta.serverId ||
                state.dataVersion != meta.dataVersion

            if (fullRebuild) {
                store.clearMirror()
                _progress.value = SyncPhase.FullSync(0, meta.imageCount)
            } else {
                _progress.value = SyncPhase.Incremental
            }

            var cursor: String? = if (fullRebuild) null else state!!.cursor
            var upserted = 0L
            while (true) {
                val page = api.images(cursor, pageLimit)
                if (page.items.isNotEmpty()) {
                    store.applyImagePage(page.items)
                    upserted += page.items.size
                    if (fullRebuild) {
                        _progress.value = SyncPhase.FullSync(upserted, meta.imageCount)
                    }
                }
                cursor = page.nextCursor ?: cursor
                // 每页落游标：中断后可断点续传
                store.writeSyncState(SyncState(meta.serverId, cursor, meta.dataVersion, now()))
                if (!page.hasMore) break
            }

            _progress.value = SyncPhase.Reconciling
            val remoteIds = api.imageIds().toHashSet()
            val stale = store.localImageIds().filter { it !in remoteIds }
            if (stale.isNotEmpty()) {
                store.deleteImages(stale)
            }

            store.replaceGalleries(api.galleries())
            store.replaceTags(api.tags())
            store.writeSyncState(SyncState(meta.serverId, cursor, meta.dataVersion, now()))

            _progress.value = SyncPhase.Done
            return SyncOutcome(fullRebuild = fullRebuild, upserted = upserted, deleted = stale.size)
        } catch (e: CancellationException) {
            throw e   // 取消不是失败：不置 Failed（否则 UI 误报「同步失败」），对齐 T6/T8 重抛惯例
        } catch (e: Exception) {
            _progress.value = SyncPhase.Failed(e.message ?: "sync failed")
            throw e
        }
    }
}
