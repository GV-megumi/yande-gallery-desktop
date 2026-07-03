package com.bluskysoftware.yandegallery.domain.sync

import com.bluskysoftware.yandegallery.domain.ConnectionMonitor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch

/**
 * 同步编排：任意来源（前台/下拉/SSE/二进制404/切服）请求合并为串行执行，
 * 静默失败上报横幅（spec §6.3）。注入 suspend 函数而非 SyncEngine（final class 不可 fake）。
 *
 * 互斥用「合并式 pending」而非「取消式」：进行中的一次不主动取消——SyncEngine catch(Exception)
 * 会把 CancellationException 也置 Failed（Task 6 遗留），取消式合并会误报断连。运行期间到达的
 * 请求不再被丢弃，而是记一笔 pending，当前同步完成后补跑一轮（始终只有一个同步任务在跑）。
 */
class SyncScheduler(
    private val syncRun: suspend () -> SyncOutcome,
    private val monitor: ConnectionMonitor,
    private val scope: CoroutineScope,
    private val hadMirrorBefore: suspend () -> Boolean,   // 注入：store.readSyncState() != null
) {
    // running/pending 均在实例锁下读写；不持有 Job 引用（不取消进行中的任务）。
    private var running = false
    private var pending = false

    private val _rebuildNotices = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    /** dataVersion/serverId 变化导致的全量重建提示（spec §8）；首次同步不提示 */
    val rebuildNotices: SharedFlow<Unit> = _rebuildNotices

    @Synchronized
    fun requestSync(reason: String) {
        if (running) {
            pending = true   // 运行中：记一笔，当前同步收尾后补跑，不丢弃
            return
        }
        running = true
        scope.launch {
            do {
                runOnce()
            } while (consumePendingOrStop())
        }
    }

    /** 一轮完整同步 + 成功/失败上报（含全量重建提示）。 */
    private suspend fun runOnce() {
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

    /**
     * 收尾裁决（与 requestSync 同锁互斥，无丢触发窗口）：有 pending 则清标志再跑一轮，
     * 否则置 running=false 退出——此后新请求会重新启动一个任务。
     */
    @Synchronized
    private fun consumePendingOrStop(): Boolean {
        if (pending) {
            pending = false
            return true
        }
        running = false
        return false
    }
}
