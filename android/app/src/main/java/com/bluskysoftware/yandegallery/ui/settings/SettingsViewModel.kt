package com.bluskysoftware.yandegallery.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import com.bluskysoftware.yandegallery.data.mirror.mirrorTierOf
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.mirror.MirrorSyncMonitor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 设置页「图片同步」分组（Task 9，spec 见 task-9-brief）：保存方式（高质量/原图，D 系列既定
 * MirrorTier）+ 允许移动网络同步开关 + 同步状态展示。两者写偏好后都以 replace=true 重新
 * 入队一次镜像同步（切原图要追平已有 HQ 缺口；开关变化要么放行蜂窝下的排队任务、要么让
 * 下次到 WiFi 前先停手——都不是"下次自然轮询"能覆盖的即时语义，故立即 requestMirrorSync）。
 */
class SettingsViewModel(private val graph: AppGraph) : ViewModel() {
    /** 当前保存方式（未设置默认 HQ，mirrorTierOf 归一）；UI 单选行读此渲染选中态。 */
    val saveMode: StateFlow<MirrorTier> =
        graph.prefsStore.imageSaveModeName.map { mirrorTierOf(it) }
            .stateIn(viewModelScope, SharingStarted.Eagerly, MirrorTier.HQ)

    /** 允许移动网络同步镜像（默认 false，仅 WiFi）。 */
    val cellular: StateFlow<Boolean> =
        graph.prefsStore.mirrorSyncCellular.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    /** 镜像同步进度/错误态，供「图片同步」分组末行展示。 */
    val syncState: StateFlow<MirrorSyncMonitor.MirrorSyncState> = graph.mirrorSyncMonitor.state

    /**
     * 切原图确认框展示用预估：(还需补下的原图字节数, 镜像盘可用字节数)。无激活服务器时两者皆 0
     * （理论上不会发生——设置页在有激活服务器时才可达，此处仅作防御）。
     */
    suspend fun estimateOriginalBytes(): Pair<Long, Long> = withContext(Dispatchers.IO) {
        val serverId = graph.serverRepository.activeServer()?.id ?: return@withContext 0L to 0L
        val need = graph.db.imageFileDao().missingOriginalBytes(serverId) ?: 0L
        need to graph.imageMirrorStore.rootFreeBytes()
    }

    /** 确认弹窗「确认」回调：写偏好 + 立即 REPLACE 重新入队（补齐/回落缺口）。 */
    fun confirmSaveMode(mode: MirrorTier) {
        viewModelScope.launch {
            graph.prefsStore.setImageSaveModeName(mode.name)
            graph.requestMirrorSync(replace = true)
        }
    }

    /** 移动网络开关：写偏好 + 立即重新入队（放行/收紧蜂窝下的排队任务）。 */
    fun setCellular(allow: Boolean) {
        viewModelScope.launch {
            graph.prefsStore.setMirrorSyncCellular(allow)
            graph.requestMirrorSync(replace = true)
        }
    }

    companion object {
        fun factory(graph: AppGraph): ViewModelProvider.Factory = viewModelFactory {
            initializer { SettingsViewModel(graph) }
        }
    }
}
