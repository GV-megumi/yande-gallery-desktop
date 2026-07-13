package com.bluskysoftware.yandegallery.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
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
import com.bluskysoftware.yandegallery.ui.common.MiuiCardGroup
import com.bluskysoftware.yandegallery.ui.common.MiuiListItem
import com.bluskysoftware.yandegallery.ui.common.MiuiSecondaryButton
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar
import kotlinx.coroutines.launch

private const val GB = 1024L * 1024 * 1024

// 上限档位（字节）：缩略图 1/2/4/8 GB（spec §6.4；预览档已下线，存储页改版归 Task 9）。
private val THUMB_LIMITS = listOf("1 GB" to GB, "2 GB" to 2 * GB, "4 GB" to 4 * GB, "8 GB" to 8 * GB)

/**
 * 缓存管理页（spec §6.4/§8.2；预览档下线后剩缩略图一区）：MIUI 卡片分组——缩略图缓存
 * （占用展示、上限档位、清理）+ 已下载记录（条数 + 文件名列表 + 清空记录，文案明示只清记录
 * 不删相册文件）；页脚提示上限调整下次启动生效。进页 refresh() 读盘统计；清理后 VM 内部再刷新。
 */
@Composable
fun CacheScreen(vm: CacheViewModel, onBack: () -> Unit) {
    val stats by vm.stats.collectAsStateWithLifecycle()
    val thumbLimit by vm.thumbLimitBytes.collectAsStateWithLifecycle(PrefsStore.DEFAULT_THUMB_MAX_BYTES)
    val downloads by vm.downloads.collectAsStateWithLifecycle(emptyList())

    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { vm.refresh() }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        topBar = { MiuiSubPageTopBar("缓存管理", onBack) },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
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
            item {
                MiuiCardGroup(title = "已下载记录（${downloads.size}）") {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        MiuiSecondaryButton(
                            "清空记录",
                            onClick = {
                                vm.clearDownloadRecords()
                                scope.launch { snackbar.showSnackbar("已清空记录") }
                            },
                            enabled = downloads.isNotEmpty(),
                            modifier = Modifier.testTag("cache_clear_downloads"),
                        )
                        Text(
                            "仅清除应用内记录，不会删除系统相册中的文件",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    // 记录行随卡片同 item 渲染（量级为已下载数，可接受；spec §8.2 计划期裁定）
                    downloads.forEach { rec ->
                        MiuiListItem(
                            headline = rec.filename ?: "图片 #${rec.imageId}",
                            supporting = rec.downloadedAt,
                        )
                    }
                }
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
    MiuiCardGroup(title = title) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
            MiuiSecondaryButton("清理", onClick = onClear, modifier = Modifier.testTag(clearTag))
        }
    }
}
