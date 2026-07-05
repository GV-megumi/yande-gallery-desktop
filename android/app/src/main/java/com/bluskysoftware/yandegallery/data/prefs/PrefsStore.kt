package com.bluskysoftware.yandegallery.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

// 进程级单例委托（DataStore 同文件多实例会抛 IllegalStateException）；测试经 PrefsStore 构造注入独立实例
private val Context.uiPrefs: DataStore<Preferences> by preferencesDataStore(name = "ui_prefs")

/** 生产装配出口：AppGraph 经此取进程级 DataStore（测试勿用，走构造注入）。 */
fun uiPrefsDataStore(context: Context): DataStore<Preferences> = context.uiPrefs

/**
 * 全仓首个 DataStore Preferences（M4-T1，D3）：时间轴密度档位记忆 + 两档盘缓存上限。
 * 服务器配置仍在 Room servers 表（M2 既定偏离，spec §6.1 备注）；本仓只放「易失 UI 偏好」。
 */
class PrefsStore(private val dataStore: DataStore<Preferences>) {

    /** 时间轴密度档位名（DensityTier.name）；未设置为 null，映射与默认档收敛在 UI 层。 */
    val densityTierName: Flow<String?> = dataStore.data.map { it[KEY_DENSITY] }

    suspend fun setDensityTierName(name: String) {
        dataStore.edit { it[KEY_DENSITY] = name }
    }

    /** 缩略图盘缓存上限（字节），默认 2GB（spec §6.4「设置可调」）。 */
    val thumbnailCacheMaxBytes: Flow<Long> =
        dataStore.data.map { it[KEY_THUMB_MAX] ?: DEFAULT_THUMB_MAX_BYTES }

    /** 预览盘缓存上限（字节），默认 1GB。 */
    val previewCacheMaxBytes: Flow<Long> =
        dataStore.data.map { it[KEY_PREVIEW_MAX] ?: DEFAULT_PREVIEW_MAX_BYTES }

    suspend fun setThumbnailCacheMaxBytes(bytes: Long) {
        dataStore.edit { it[KEY_THUMB_MAX] = bytes }
    }

    suspend fun setPreviewCacheMaxBytes(bytes: Long) {
        dataStore.edit { it[KEY_PREVIEW_MAX] = bytes }
    }

    companion object {
        private val KEY_DENSITY = stringPreferencesKey("timeline_density")
        private val KEY_THUMB_MAX = longPreferencesKey("thumb_cache_max_bytes")
        private val KEY_PREVIEW_MAX = longPreferencesKey("preview_cache_max_bytes")
        const val DEFAULT_THUMB_MAX_BYTES = 2L * 1024 * 1024 * 1024
        const val DEFAULT_PREVIEW_MAX_BYTES = 1L * 1024 * 1024 * 1024
    }
}
