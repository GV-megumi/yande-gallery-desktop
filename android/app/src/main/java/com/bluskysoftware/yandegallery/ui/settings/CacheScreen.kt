package com.bluskysoftware.yandegallery.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import kotlinx.coroutines.launch

private const val GB = 1024L * 1024 * 1024

// 上限档位（字节）：缩略图 1/2/4/8 GB，预览 0.5/1/2/4 GB（spec §6.4）。
private val THUMB_LIMITS = listOf("1 GB" to GB, "2 GB" to 2 * GB, "4 GB" to 4 * GB, "8 GB" to 8 * GB)
private val PREVIEW_LIMITS = listOf("0.5 GB" to GB / 2, "1 GB" to GB, "2 GB" to 2 * GB, "4 GB" to 4 * GB)

/**
 * 缓存管理页（spec §6.4 / D7）：三区——缩略图缓存 / 预览缓存（各含占用展示、上限档位、清理）+ 已下载记录
 * （条数 + 文件名列表 + 清空记录，文案明示只清记录不删相册文件）；页脚提示上限调整下次启动生效。
 * 进页 refresh() 读盘统计；清理后 VM 内部再刷新。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CacheScreen(vm: CacheViewModel, onBack: () -> Unit) {
    val stats by vm.stats.collectAsStateWithLifecycle()
    val thumbLimit by vm.thumbLimitBytes.collectAsStateWithLifecycle(PrefsStore.DEFAULT_THUMB_MAX_BYTES)
    val previewLimit by vm.previewLimitBytes.collectAsStateWithLifecycle(PrefsStore.DEFAULT_PREVIEW_MAX_BYTES)
    val downloads by vm.downloads.collectAsStateWithLifecycle(emptyList())

    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { vm.refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("缓存管理") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                CacheTierSection(
                    title = "缩略图缓存",
                    usedBytes = stats?.thumbBytes,
                    maxBytes = stats?.thumbMax,
                    options = THUMB_LIMITS,
                    selectedLimit = thumbLimit,
                    onSelect = vm::setThumbLimitBytes,
                    clearTag = "cache_clear_thumb",
                    onClear = {
                        vm.clearThumbnails()
                        scope.launch { snackbar.showSnackbar("已清理") }
                    },
                )
            }
            item { HorizontalDivider() }
            item {
                CacheTierSection(
                    title = "预览缓存",
                    usedBytes = stats?.previewBytes,
                    maxBytes = stats?.previewMax,
                    options = PREVIEW_LIMITS,
                    selectedLimit = previewLimit,
                    onSelect = vm::setPreviewLimitBytes,
                    clearTag = "cache_clear_preview",
                    onClear = {
                        vm.clearPreviews()
                        scope.launch { snackbar.showSnackbar("已清理") }
                    },
                )
            }
            item { HorizontalDivider() }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("已下载记录（${downloads.size}）", style = MaterialTheme.typography.titleMedium)
                    OutlinedButton(
                        onClick = {
                            vm.clearDownloadRecords()
                            scope.launch { snackbar.showSnackbar("已清空记录") }
                        },
                        enabled = downloads.isNotEmpty(),
                        modifier = Modifier.testTag("cache_clear_downloads"),
                    ) { Text("清空记录") }
                    Text(
                        "仅清除应用内记录，不会删除系统相册中的文件",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            items(downloads, key = { it.imageId }) { rec ->
                ListItem(
                    headlineContent = { Text(rec.filename ?: "图片 #${rec.imageId}") },
                    supportingContent = { Text(rec.downloadedAt) },
                )
            }
            item {
                Text(
                    "缓存上限调整在下次启动应用后生效；清理当前显示的图片会在需要时自动重新拉取",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CacheTierSection(
    title: String,
    usedBytes: Long?,
    maxBytes: Long?,
    options: List<Pair<String, Long>>,
    selectedLimit: Long,
    onSelect: (Long) -> Unit,
    clearTag: String,
    onClear: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        val usage = if (usedBytes == null || maxBytes == null) "统计中…"
        else "${formatBytes(usedBytes)} / 上限 ${formatBytes(maxBytes)}"
        Text(usage, style = MaterialTheme.typography.bodyMedium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (label, bytes) ->
                FilterChip(
                    selected = selectedLimit == bytes,
                    onClick = { onSelect(bytes) },
                    label = { Text(label) },
                )
            }
        }
        OutlinedButton(onClick = onClear, modifier = Modifier.testTag(clearTag)) { Text("清理") }
    }
}
