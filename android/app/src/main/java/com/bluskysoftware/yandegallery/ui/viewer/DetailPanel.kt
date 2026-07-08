package com.bluskysoftware.yandegallery.ui.viewer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/**
 * 详情面板内容（Task 11，无 VM 依赖，Robolectric 可直测）：
 * 文件名/分辨率/大小/格式/入库时间 + 标签 chips（可点击——跳搜索由 T12 接线）+
 * 所属图集 chips（可点击跳图集详情）+「编辑」标签入口。
 * online=false 时编辑入口禁用（离线写操作置灰不排队，spec §8）。
 *
 * @param galleryNames 图集 id→名称（装配层从 VM 的图集列表解析）；缺失时兜底显示「图集 #id」。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DetailPanel(
    detail: ImageDetail,
    online: Boolean,
    onEditTags: () -> Unit,
    onTagClick: (String) -> Unit,
    onGalleryClick: (Long) -> Unit,
    galleryNames: Map<Long, String> = emptyMap(),
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp)
            .padding(bottom = 24.dp)
            .testTag("detail_panel"),
    ) {
        Text("详情", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(12.dp))
        DetailRow("文件名", detail.entity.filename)
        DetailRow("分辨率", "${detail.entity.width} × ${detail.entity.height}")
        DetailRow("大小", formatFileSize(detail.entity.fileSize))
        DetailRow("格式", detail.entity.format.uppercase(Locale.ROOT))
        DetailRow("入库时间", formatTimestamp(detail.entity.createdAt))

        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("标签", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            TextButton(
                onClick = onEditTags,
                enabled = online,
                modifier = Modifier.testTag("detail_edit_tags"),
            ) { Text("编辑") }
        }
        if (detail.tagNames.isEmpty()) {
            Text("暂无标签", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                detail.tagNames.forEach { name ->
                    AssistChip(
                        onClick = { onTagClick(name) },
                        label = { Text(name) },
                        modifier = Modifier.testTag("detail_tag_$name"),
                    )
                }
            }
        }

        if (detail.galleryIds.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text("所属图集", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                detail.galleryIds.forEach { id ->
                    AssistChip(
                        onClick = { onGalleryClick(id) },
                        label = { Text(galleryNames[id] ?: "图集 #$id") },
                        modifier = Modifier.testTag("detail_gallery_$id"),
                    )
                }
            }
        }
    }
}

/** 标签行：左标签名右值，值列自然换行。 */
@Composable
private fun DetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.width(80.dp),
        )
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * 标签编辑对话框：现有标签点 chip（带 ✕）移除，输入框加新标签。
 * 本对话框只发意图（onAdd/onRemove），结果回写由装配层重查 detailOf 刷新 [tagNames]。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TagEditDialog(
    tagNames: List<String>,
    onAdd: (String) -> Unit,
    onRemove: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var input by remember { mutableStateOf("") }
    MiuiDialog(
        title = "编辑标签",
        onDismiss = onDismiss,
        dismissText = null,
        confirmText = "完成",
        onConfirm = onDismiss,
        content = {
            if (tagNames.isEmpty()) {
                Text("暂无标签", style = MaterialTheme.typography.bodySmall)
            } else {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    tagNames.forEach { name ->
                        InputChip(
                            selected = false,
                            onClick = { onRemove(name) },
                            label = { Text(name) },
                            trailingIcon = {
                                Icon(
                                    Icons.Filled.Close,
                                    contentDescription = "移除 $name",
                                    modifier = Modifier.size(InputChipDefaults.IconSize),
                                )
                            },
                            modifier = Modifier.testTag("tag_edit_chip_$name"),
                        )
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    label = { Text("新标签") },
                    singleLine = true,
                    modifier = Modifier.weight(1f).testTag("tag_edit_input"),
                )
                TextButton(
                    onClick = {
                        onAdd(input.trim())
                        input = ""
                    },
                    enabled = input.isNotBlank(),
                    modifier = Modifier.testTag("tag_edit_add"),
                ) { Text("添加") }
            }
        },
    )
}

/** 文件大小人性化：<1KB 原字节；KB/MB/GB 各保留一位小数。 */
internal fun formatFileSize(bytes: Long): String {
    val kb = 1024.0
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024L * 1024 -> String.format(Locale.US, "%.1f KB", bytes / kb)
        bytes < 1024L * 1024 * 1024 -> String.format(Locale.US, "%.1f MB", bytes / (kb * kb))
        else -> String.format(Locale.US, "%.1f GB", bytes / (kb * kb * kb))
    }
}

/** ISO-8601（服务端 createdAt）→ 本地时区 `yyyy-MM-dd HH:mm`；解析失败回退原串（不崩详情面板）。 */
internal fun formatTimestamp(iso: String): String = try {
    Instant.parse(iso).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
} catch (e: DateTimeParseException) {
    iso
}
