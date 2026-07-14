package com.bluskysoftware.yandegallery.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import com.bluskysoftware.yandegallery.domain.mirror.MirrorSyncMonitor
import com.bluskysoftware.yandegallery.ui.common.MiuiCardGroup
import com.bluskysoftware.yandegallery.ui.common.MiuiChoiceRow
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import com.bluskysoftware.yandegallery.ui.common.MiuiListItem
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar
import com.bluskysoftware.yandegallery.ui.common.MiuiSwitchItem
import kotlinx.coroutines.launch

/**
 * 设置页 hub（spec §7.6/§8.1/Task 9 §5.1）：MIUI 卡片分组——服务器/存储一组、图片同步一组、
 * 关于一组；灰底白卡。存储管理入口经 onOpenCache 跳 CacheScreen（改版为存储页，T8/T9）。
 * 「图片同步」分组：保存方式两档单选（高质量直切生效；原图先弹确认框展示预估补量再切，
 * spec §4.5）、允许移动网络同步开关、同步状态（复用 CacheScreen 的文案逻辑，点击跳存储页）。
 * versionName 由 MainActivity 从 PackageManager 读取传入（工程未开 buildConfig）。
 */
@Composable
fun SettingsScreen(
    vm: SettingsViewModel,
    onBack: () -> Unit,
    onOpenServers: () -> Unit,
    versionName: String,
    onOpenCache: () -> Unit = {},
) {
    var showLicenses by rememberSaveable { mutableStateOf(false) }
    val saveMode by vm.saveMode.collectAsStateWithLifecycle()
    val cellular by vm.cellular.collectAsStateWithLifecycle()
    val sync by vm.syncState.collectAsStateWithLifecycle()
    var confirmOriginal by rememberSaveable { mutableStateOf(false) }
    var estimate by remember { mutableStateOf<Pair<Long, Long>?>(null) }
    val scope = rememberCoroutineScope()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        topBar = { MiuiSubPageTopBar(title = "设置", onBack = onBack) },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            MiuiCardGroup {
                MiuiListItem("服务器管理", supporting = "列表、扫码/手动添加、编辑、切换、删除", chevron = true, onClick = onOpenServers, modifier = Modifier.testTag("settings_servers"))
                MiuiListItem("存储管理", supporting = "镜像占用、缩略图缓存、同步进度", chevron = true, onClick = onOpenCache, modifier = Modifier.testTag("settings_cache"))
            }
            MiuiCardGroup(title = "图片同步") {
                MiuiListItem(
                    "图片保存方式",
                    supporting = "高质量约几百 KB/张；原图完整体积",
                    value = if (saveMode == MirrorTier.ORIGINAL) "原图" else "高质量",
                    modifier = Modifier.testTag("settings_save_mode"),
                )
                MiuiChoiceRow(
                    label = "高质量",
                    selected = saveMode == MirrorTier.HQ,
                    tag = "settings_save_mode_hq",
                    // 高质量为默认低占用档，直接生效无需确认（已有原图不受影响，spec §4.5）
                    onClick = { vm.confirmSaveMode(MirrorTier.HQ) },
                )
                MiuiChoiceRow(
                    label = "原图",
                    selected = saveMode == MirrorTier.ORIGINAL,
                    tag = "settings_save_mode_original",
                    // 切原图先算补量预估再弹确认框，用户明确知晓额外占用后才真正切换
                    onClick = { scope.launch { estimate = vm.estimateOriginalBytes(); confirmOriginal = true } },
                )
                MiuiSwitchItem(
                    "允许移动网络同步",
                    checked = cellular,
                    onCheckedChange = vm::setCellular,
                    supporting = "默认仅 WiFi 同步图片",
                    modifier = Modifier.testTag("settings_cellular_switch"),
                )
                MiuiListItem(
                    "同步状态",
                    supporting = syncStateSupporting(sync),
                    chevron = true,
                    onClick = onOpenCache,
                    modifier = Modifier.testTag("settings_sync_state"),
                )
            }
            MiuiCardGroup {
                MiuiListItem("版本", value = versionName, modifier = Modifier.testTag("settings_version"))
                MiuiListItem("开源协议", chevron = true, onClick = { showLicenses = true }, modifier = Modifier.testTag("settings_licenses"))
            }
        }
    }
    if (confirmOriginal) {
        MiuiDialog(
            title = "切换为保存原图？",
            text = "预计需补充下载 ${formatBytes(estimate?.first ?: 0L)}（可用空间 ${formatBytes(estimate?.second ?: 0L)}）。" +
                "切换后新图与已有高质量图将逐步替换为原图，替换完成即删除对应高质量图。",
            onDismiss = { confirmOriginal = false },
            dismissText = "取消",
            confirmText = "确定",
            onConfirm = {
                confirmOriginal = false
                vm.confirmSaveMode(MirrorTier.ORIGINAL)
            },
            dialogTag = "save_mode_confirm_dialog",
        )
    }
    if (showLicenses) {
        MiuiDialog(
            title = "开源协议",
            text = "本应用使用以下开源组件（Apache-2.0）：Jetpack Compose、Room、WorkManager、" +
                "DataStore、Paging、Navigation、Coil、OkHttp、Retrofit、kotlinx.serialization、" +
                "kotlinx.coroutines；条码识别使用 Google ML Kit Barcode Scanning。",
            onDismiss = { showLicenses = false },
            dismissText = null,
            confirmText = "关闭",
            onConfirm = { showLicenses = false },
        )
    }
}

/** 同步状态行文案（CacheScreen 同用一套措辞，故收在此处顶层供两边共享，Task 9）。 */
fun syncStateSupporting(sync: MirrorSyncMonitor.MirrorSyncState): String = when {
    sync.running -> "同步中 ${sync.done}/${sync.total}"
    sync.error == MirrorSyncMonitor.MirrorSyncError.SERVER_TOO_OLD -> "桌面端版本过旧，不支持高质量图档"
    sync.error == MirrorSyncMonitor.MirrorSyncError.DISK_FULL -> "存储空间不足，同步已暂停"
    sync.error == MirrorSyncMonitor.MirrorSyncError.NETWORK -> "网络中断，将自动重试"
    else -> "空闲"
}
