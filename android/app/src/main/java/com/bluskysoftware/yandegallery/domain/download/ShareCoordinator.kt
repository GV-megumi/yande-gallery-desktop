package com.bluskysoftware.yandegallery.domain.download

import androidx.work.WorkInfo
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first

/**
 * 「下载后自动分享」协调器（spec §7.3/§7.5 / D9）：对 WorkManager 零依赖（三原语注入），纯逻辑可单测。
 * 取消语义：调用方协程取消只放弃等待，不取消底层下载（KEEP 队列继续、产物照常落库，本就有用）。
 * 已知窄边界：KEEP 唯一工作名下 observeState 可能先命中历史终态——随后重查行为 null 即判失败，
 * 用户重试一次即恢复；不为此引入 tag 机制。
 */
class ShareCoordinator(
    private val isDownloaded: suspend (imageId: Long) -> String?,
    private val enqueue: (ImageEntity) -> Unit,
    private val observeState: (imageId: Long) -> Flow<WorkInfo.State?>,
    private val exists: (uri: String) -> Boolean,
    private val clearStaleRow: suspend (imageId: Long) -> Unit,
) {
    data class ShareOutcome(val uris: List<String>, val failedIds: List<Long>)

    suspend fun ensureDownloadedUris(images: List<ImageEntity>): ShareOutcome {
        val ready = mutableMapOf<Long, String>()
        val pending = mutableListOf<ImageEntity>()
        for (image in images) {
            val uri = isDownloaded(image.id)
            if (uri != null && exists(uri)) {
                ready[image.id] = uri
            } else {
                if (uri != null) clearStaleRow(image.id)   // 行在文件亡：清行重下（关闭 stale-URI 分享）
                enqueue(image)                              // 先全量入队（并行下载），再逐个等
                pending += image
            }
        }
        val failed = mutableListOf<Long>()
        for (image in pending) {
            observeState(image.id).first { it != null && it.isFinished }
            val uri = isDownloaded(image.id)
            if (uri != null && exists(uri)) ready[image.id] = uri else failed += image.id
        }
        return ShareOutcome(uris = images.mapNotNull { ready[it.id] }, failedIds = failed)
    }
}
