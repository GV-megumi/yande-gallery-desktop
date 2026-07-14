package com.bluskysoftware.yandegallery.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.bluskysoftware.yandegallery.ui.common.MiuiCardGroup
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import com.bluskysoftware.yandegallery.ui.common.MiuiListItem
import com.bluskysoftware.yandegallery.ui.common.MiuiSecondaryButton
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar
import kotlinx.coroutines.launch

/**
 * 存储管理页（Task 9 改版；原「缓存管理」，spec §5.2/§8.2）：MIUI 卡片分组——
 * ①图片镜像（HQ/原图分档张数+字节、立即同步、清空确认后连清行与文件并重新入队）
 * ②缩略图缓存（占用展示 + 清理，逻辑不变，只是移除了两档上限选择——上限概念随
 * 两档 FilterChip 一并下线，见 PrefsStore Task 9 变更）③同步状态（文案与设置页
 * 「图片同步」分组同款，见 [syncStateSupporting]）。两档上限/预览档/已下载记录
 * 三块随本次改版下线（详见 [CacheViewModel] KDoc）。进页 refresh() 读盘/读库统计；
 * 清理/清空后 VM 内部再刷新。
 */
@Composable
fun CacheScreen(vm: CacheViewModel, onBack: () -> Unit) {
    val mirrorStats by vm.mirrorStats.collectAsStateWithLifecycle()
    val thumbBytes by vm.thumbBytes.collectAsStateWithLifecycle()
    val sync by vm.syncState.collectAsStateWithLifecycle()
    var confirmClear by rememberSaveable { mutableStateOf(false) }

    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { vm.refresh() }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        topBar = { MiuiSubPageTopBar("存储管理", onBack) },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                MiuiCardGroup(title = "图片镜像") {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        val stats = mirrorStats
                        val usage = if (stats == null) "统计中…"
                        else "高质量 ${stats.hqCount} 张 ${formatBytes(stats.hqBytes)}；" +
                            "原图 ${stats.originalCount} 张 ${formatBytes(stats.originalBytes)}"
                        Text(usage, style = MaterialTheme.typography.bodyMedium)
                        MiuiSecondaryButton(
                            "立即同步",
                            onClick = {
                                vm.requestSyncNow()
                                scope.launch { snackbar.showSnackbar("已开始同步") }
                            },
                            modifier = Modifier.testTag("storage_sync_now"),
                        )
                        MiuiSecondaryButton(
                            "清空图片镜像",
                            onClick = { confirmClear = true },
                            modifier = Modifier.testTag("storage_clear_mirror"),
                        )
                    }
                }
            }
            item {
                MiuiCardGroup(title = "缩略图缓存") {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            thumbBytes?.let { "占用 ${formatBytes(it)}" } ?: "统计中…",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        MiuiSecondaryButton(
                            "清理",
                            onClick = {
                                vm.clearThumbnails()
                                scope.launch { snackbar.showSnackbar("已清理") }
                            },
                            modifier = Modifier.testTag("cache_clear_thumb"),
                        )
                    }
                }
            }
            item {
                MiuiCardGroup(title = "同步状态") {
                    MiuiListItem(
                        "同步状态",
                        supporting = syncStateSupporting(sync),
                        modifier = Modifier.testTag("storage_sync_state"),
                    )
                }
            }
        }
    }
    if (confirmClear) {
        MiuiDialog(
            title = "清空图片镜像？",
            text = "本地已缓存的高质量图与原图都会被删除，清空后将自动重新同步。",
            onDismiss = { confirmClear = false },
            dismissText = "取消",
            confirmText = "清空",
            destructive = true,
            onConfirm = {
                confirmClear = false
                vm.clearMirror()
                scope.launch { snackbar.showSnackbar("已清空，正在重新同步") }
            },
            dialogTag = "storage_clear_mirror_dialog",
        )
    }
}
