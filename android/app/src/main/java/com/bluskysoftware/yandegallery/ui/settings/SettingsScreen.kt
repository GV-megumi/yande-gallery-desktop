package com.bluskysoftware.yandegallery.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag

/**
 * 设置页 hub（spec §7.6）：三区结构——服务器管理 / 缓存管理 / 关于。缓存管理入口经 onOpenCache 跳
 * CacheScreen（T8 补入）。versionName 由 MainActivity 从 PackageManager 读取传入（工程未开 buildConfig）。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onOpenServers: () -> Unit,
    versionName: String,
    onOpenCache: () -> Unit = {},
) {
    var showLicenses by rememberSaveable { mutableStateOf(false) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("设置") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            ListItem(
                headlineContent = { Text("服务器管理") },
                supportingContent = { Text("列表、扫码/手动添加、编辑、切换、删除") },
                modifier = Modifier.clickable(onClick = onOpenServers).testTag("settings_servers"),
            )
            ListItem(
                headlineContent = { Text("缓存管理") },
                supportingContent = { Text("缩略图/预览占用与清理、上限调整、已下载记录") },
                modifier = Modifier.clickable(onClick = onOpenCache).testTag("settings_cache"),
            )
            HorizontalDivider()
            ListItem(
                headlineContent = { Text("版本") },
                supportingContent = { Text(versionName) },
                modifier = Modifier.testTag("settings_version"),
            )
            ListItem(
                headlineContent = { Text("开源协议") },
                modifier = Modifier.clickable { showLicenses = true }.testTag("settings_licenses"),
            )
        }
    }
    if (showLicenses) {
        AlertDialog(
            onDismissRequest = { showLicenses = false },
            title = { Text("开源协议") },
            text = {
                Text(
                    "本应用使用以下开源组件（Apache-2.0）：Jetpack Compose、Room、WorkManager、" +
                        "DataStore、Paging、Navigation、Coil、OkHttp、Retrofit、kotlinx.serialization、" +
                        "kotlinx.coroutines；条码识别使用 Google ML Kit Barcode Scanning。",
                )
            },
            confirmButton = { TextButton(onClick = { showLicenses = false }) { Text("关闭") } },
        )
    }
}
