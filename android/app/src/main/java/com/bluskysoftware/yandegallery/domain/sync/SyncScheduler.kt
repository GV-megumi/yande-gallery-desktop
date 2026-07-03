package com.bluskysoftware.yandegallery.domain.sync

import com.bluskysoftware.yandegallery.domain.ConnectionMonitor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch

/**
 * 同步编排：任意来源（前台/下拉/SSE/二进制404）请求合并为串行执行，
 * 静默失败上报横幅（spec §6.3）。注入 suspend 函数而非 SyncEngine（final class 不可 fake）。
 *
 * 互斥用「忽略式」而非「取消式」：进行中的一次不主动取消——SyncEngine catch(Exception)
 * 会把 CancellationException 也置 Failed（Task 6 遗留），取消式合并会误报断连。
 */
class SyncScheduler(
    private val syncRun: suspend () -> SyncOutcome,
    private val monitor: ConnectionMonitor,
    private val scope: CoroutineScope,
    private val hadMirrorBefore: suspend () -> Boolean,   // 注入：store.readSyncState() != null
) {
    private var running: Job? = null

    private val _rebuildNotices = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    /** dataVersion/serverId 变化导致的全量重建提示（spec §8）；首次同步不提示 */
    val rebuildNotices: SharedFlow<Unit> = _rebuildNotices

    @Synchronized
    fun requestSync(reason: String) {
        if (running?.isActive == true) return
        running = scope.launch {
            val hadMirror = runCatching { hadMirrorBefore() }.getOrDefault(false)
            runCatching { syncRun() }
                .onSuccess { outcome ->
                    monitor.reportSuccess()
                    if (outcome.fullRebuild && hadMirror) {
                        _rebuildNotices.tryEmit(Unit)
                    }
                }
                .onFailure { monitor.reportFailure(it) }
        }
    }
}
