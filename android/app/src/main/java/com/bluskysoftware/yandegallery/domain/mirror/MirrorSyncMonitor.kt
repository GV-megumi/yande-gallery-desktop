package com.bluskysoftware.yandegallery.domain.mirror

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/** 镜像同步可视状态（存储页/设置行消费，spec §3.4/§5.2）；worker 经 AppWorkerFactory 注入更新。 */
class MirrorSyncMonitor {
    enum class MirrorSyncError { SERVER_TOO_OLD, DISK_FULL, NETWORK }

    data class MirrorSyncState(
        val running: Boolean = false,
        val done: Long = 0,
        val total: Long = 0,
        val error: MirrorSyncError? = null,
    )

    private val _state = MutableStateFlow(MirrorSyncState())
    val state: StateFlow<MirrorSyncState> = _state

    fun start(total: Long) { _state.value = MirrorSyncState(running = true, total = total) }
    fun progress(done: Long, total: Long) { _state.update { it.copy(done = done, total = total) } }
    fun finish(error: MirrorSyncError? = null) { _state.update { it.copy(running = false, error = error) } }
}
