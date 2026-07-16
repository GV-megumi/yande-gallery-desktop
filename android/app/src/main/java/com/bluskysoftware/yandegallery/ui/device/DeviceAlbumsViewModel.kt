package com.bluskysoftware.yandegallery.ui.device

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceAccessLevel
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.DeviceMediaGateway
import com.bluskysoftware.yandegallery.data.device.sortDeviceAlbums
import com.bluskysoftware.yandegallery.data.device.validateNewAlbumName
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * 手机相册列表页 VM（Task 5，spec §2/§4.3/§5.5）：[albums] 合并真实 MediaStore 相册、
 * 「全部照片」聚合卡与待落地占位相册；[accessLevel] 由 MainActivity 的权限桥喂入
 * （本 VM 不持有、不查询系统权限，纯下游消费）。DENIED 时 [albums] 直接清空——网格页/
 * 大图页在无权限时不应该还能看到任何卡片入口。
 */
class DeviceAlbumsViewModel(
    private val gateway: DeviceMediaGateway,
    private val prefsStore: PrefsStore,
    val accessLevel: StateFlow<DeviceAccessLevel>,
) : ViewModel() {

    // 初始一发 + MediaStore ContentObserver 脉冲；查询期间新脉冲经 mapLatest 打断重查，不排队。
    private val refreshTick = merge(flowOf(Unit), gateway.observeChanges())

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val albums: StateFlow<List<DeviceAlbum>> = combine(
        refreshTick, prefsStore.devicePendingAlbums, accessLevel,
    ) { _, pending, level -> pending to level }
        .mapLatest { (pending, level) ->
            if (level == DeviceAccessLevel.DENIED) return@mapLatest emptyList()
            val real = gateway.queryAlbums()
            // 收编：真实 bucket 与待落地占位撞名，占位记录失去存在意义——顺手清掉（spec §5.5），
            // 下一轮 devicePendingAlbums 重新发射时 buildAlbums 已经算过一遍、不会闪现残影。
            absorbedPendingNames(real, pending).forEach { prefsStore.removePendingAlbum(it) }
            buildAlbums(real, pending)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** 新建待落地相册：本机已有同名（真实或待落地）一律拒绝；成功返回 null，失败返回错误文案。 */
    fun createPendingAlbum(name: String): String? {
        val trimmed = name.trim()
        val existing = albums.value.map { it.name }.toSet()
        val error = validateNewAlbumName(trimmed, existing)
        if (error != null) return error
        viewModelScope.launch { prefsStore.addPendingAlbum(trimmed) }
        return null
    }

    /** 删除待落地相册记录（仅占位记录本身，不涉及任何文件，spec §5.5）。 */
    fun deletePendingAlbum(name: String) {
        viewModelScope.launch { prefsStore.removePendingAlbum(name) }
    }

    companion object {
        fun factory(graph: AppGraph, accessLevel: StateFlow<DeviceAccessLevel>): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DeviceAlbumsViewModel(graph.deviceMediaGateway, graph.prefsStore, accessLevel) }
            }
    }
}

/** 待落地占位中，名字已被真实 bucket（同名或同路径 Pictures/<名>/）命中、该收编的一批。 */
private fun absorbedPendingNames(realAlbums: List<DeviceAlbum>, pendingNames: Set<String>): Set<String> {
    val realNames = realAlbums.map { it.name }.toSet()
    val realPaths = realAlbums.mapNotNull { it.relativePath?.trimEnd('/') }.toSet()
    return pendingNames.filterTo(mutableSetOf()) { it in realNames || "Pictures/$it" in realPaths }
}

/**
 * 组装展示列表（spec §4.3）：「全部照片」聚合卡手工置首位、不参与 [sortDeviceAlbums] 排序
 * （该函数的 rank 语义面向真实/待落地相册，聚合卡塞进去只会被打乱到列表中间）；封面取
 * 查询原始顺序的首个真实相册封面（brief 字面口径，非「最新一张」的更强语义）。
 */
internal fun buildAlbums(realAlbums: List<DeviceAlbum>, pendingNames: Set<String>): List<DeviceAlbum> {
    val allCard = DeviceAlbum(
        key = BucketKey.All,
        name = "全部照片",
        relativePath = null,
        count = realAlbums.sumOf { it.count },
        coverUri = realAlbums.firstOrNull()?.coverUri,
        isPending = false,
    )
    val absorbed = absorbedPendingNames(realAlbums, pendingNames)
    val pendingCards = (pendingNames - absorbed).map { name ->
        DeviceAlbum(
            key = BucketKey.Pending(name),
            name = name,
            relativePath = "Pictures/$name/",
            count = 0,
            coverUri = null,
            isPending = true,
        )
    }
    return listOf(allCard) + sortDeviceAlbums(realAlbums + pendingCards)
}
