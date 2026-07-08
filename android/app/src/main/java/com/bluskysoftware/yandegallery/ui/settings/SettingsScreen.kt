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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.ui.common.MiuiCardGroup
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import com.bluskysoftware.yandegallery.ui.common.MiuiListItem
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar

/**
 * 设置页 hub（spec §7.6/§8.1）：MIUI 卡片分组——服务器/缓存一组、关于一组；灰底白卡。
 * 缓存管理入口经 onOpenCache 跳 CacheScreen（T8 补入）。versionName 由 MainActivity 从
 * PackageManager 读取传入（工程未开 buildConfig）。
 */
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onOpenServers: () -> Unit,
    versionName: String,
    onOpenCache: () -> Unit = {},
) {
    var showLicenses by rememberSaveable { mutableStateOf(false) }
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
                MiuiListItem("缓存管理", supporting = "缩略图/预览占用与清理、上限调整、已下载记录", chevron = true, onClick = onOpenCache, modifier = Modifier.testTag("settings_cache"))
            }
            MiuiCardGroup {
                MiuiListItem("版本", value = versionName, modifier = Modifier.testTag("settings_version"))
                MiuiListItem("开源协议", chevron = true, onClick = { showLicenses = true }, modifier = Modifier.testTag("settings_licenses"))
            }
        }
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
