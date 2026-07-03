package com.bluskysoftware.yandegallery.domain.sync

data class SyncState(
    val remoteServerId: String,
    val cursor: String?,
    val dataVersion: Long,
    val lastSyncAt: String,
)

sealed interface SyncPhase {
    data object Idle : SyncPhase
    data class FullSync(val done: Long, val total: Long) : SyncPhase
    data object Incremental : SyncPhase
    data object Reconciling : SyncPhase
    data object Done : SyncPhase
    data class Failed(val message: String) : SyncPhase
}

data class SyncOutcome(
    val fullRebuild: Boolean,
    val upserted: Long,
    val deleted: Int,
)
