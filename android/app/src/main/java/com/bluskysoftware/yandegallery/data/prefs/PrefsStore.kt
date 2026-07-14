package com.bluskysoftware.yandegallery.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException

// 进程级单例委托（DataStore 同文件多实例会抛 IllegalStateException）；测试经 PrefsStore 构造注入独立实例
private val Context.uiPrefs: DataStore<Preferences> by preferencesDataStore(name = "ui_prefs")

/** 生产装配出口：AppGraph 经此取进程级 DataStore（测试勿用，走构造注入）。 */
fun uiPrefsDataStore(context: Context): DataStore<Preferences> = context.uiPrefs

/**
 * 全仓首个 DataStore Preferences（M4-T1，D3）：时间轴密度档位记忆、列表排序与列数、
 * 图片保存方式（MirrorTier）与允许移动网络同步镜像等易失 UI 偏好。
 * 服务器配置仍在 Room servers 表（M2 既定偏离，spec §6.1 备注）；本仓只放「易失 UI 偏好」。
 * 两档盘缓存上限（缩略图/预览）已随 Task 9 存储页改版下线——镜像层落地后缩略图仅剩
 * Coil 自身磁盘缓存、无独立可调上限概念，预览档更是早随 Task 8 一并下线。
 */
class PrefsStore(private val dataStore: DataStore<Preferences>) {

    // 全文件唯一安全读源：磁盘读失败（IOException）回退空 Preferences——各键回各自默认值，
    // 收集方（T2/T3/T8 消费者）不因盘故障崩溃；非 IO 异常照常抛出、不吞取消
    // （CancellationException 不是 IOException，走 throw 分支，保持全仓取消约定）。
    private val safeData: Flow<Preferences> = dataStore.data.catch { e ->
        if (e is IOException) emit(emptyPreferences()) else throw e
    }

    /** 时间轴密度档位名（DensityTier.name）；未设置为 null，映射与默认档收敛在 UI 层。 */
    val densityTierName: Flow<String?> = safeData.map { it[KEY_DENSITY] }

    suspend fun setDensityTierName(name: String) {
        dataStore.edit { it[KEY_DENSITY] = name }
    }

    /** 照片页排序（PhotoSort.name）；未设置为 null，映射与默认收敛在 ViewPrefs（spec §2.3）。 */
    val photosSortName: Flow<String?> = safeData.map { it[KEY_PHOTOS_SORT] }

    suspend fun setPhotosSortName(name: String) {
        dataStore.edit { it[KEY_PHOTOS_SORT] = name }
    }

    /** 相册页排序（AlbumSort.name）。 */
    val albumsSortName: Flow<String?> = safeData.map { it[KEY_ALBUMS_SORT] }

    suspend fun setAlbumsSortName(name: String) {
        dataStore.edit { it[KEY_ALBUMS_SORT] = name }
    }

    /** 相册详情排序（PhotoSort.name，全部相册共用）。 */
    val albumDetailSortName: Flow<String?> = safeData.map { it[KEY_DETAIL_SORT] }

    suspend fun setAlbumDetailSortName(name: String) {
        dataStore.edit { it[KEY_DETAIL_SORT] = name }
    }

    /** 相册详情列数档（3/4/5）。 */
    val albumDetailColumns: Flow<Int?> = safeData.map { it[KEY_DETAIL_COLUMNS] }

    suspend fun setAlbumDetailColumns(columns: Int) {
        dataStore.edit { it[KEY_DETAIL_COLUMNS] = columns }
    }

    /** 图片保存方式（MirrorTier.name）；未设置为 null，映射与默认档（HQ）收敛在读取方 mirrorTierOf。 */
    val imageSaveModeName: Flow<String?> = safeData.map { it[KEY_IMAGE_SAVE_MODE] }

    suspend fun setImageSaveModeName(name: String) {
        dataStore.edit { it[KEY_IMAGE_SAVE_MODE] = name }
    }

    /** 允许移动网络同步镜像（spec §5.1/D4），默认 false（仅 WiFi）。 */
    val mirrorSyncCellular: Flow<Boolean> = safeData.map { it[KEY_MIRROR_CELLULAR] ?: false }

    suspend fun setMirrorSyncCellular(allow: Boolean) {
        dataStore.edit { it[KEY_MIRROR_CELLULAR] = allow }
    }

    companion object {
        private val KEY_DENSITY = stringPreferencesKey("timeline_density")
        private val KEY_PHOTOS_SORT = stringPreferencesKey("photos_sort")
        private val KEY_ALBUMS_SORT = stringPreferencesKey("albums_sort")
        private val KEY_DETAIL_SORT = stringPreferencesKey("album_detail_sort")
        private val KEY_DETAIL_COLUMNS = intPreferencesKey("album_detail_columns")
        private val KEY_IMAGE_SAVE_MODE = stringPreferencesKey("image_save_mode")
        private val KEY_MIRROR_CELLULAR = booleanPreferencesKey("mirror_sync_cellular")
    }
}
