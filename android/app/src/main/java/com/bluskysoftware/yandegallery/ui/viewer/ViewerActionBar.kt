package com.bluskysoftware.yandegallery.ui.viewer

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.DownloadDone
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.data.db.ImageEntity

/**
 * 大图页底部操作栏（Task 11，spec §7.3）：分享 / 查看原图 / 删除 / 详情 / 更多（加入相册、移出当前相册）。
 *
 * - 查看原图三态：未下载「查看原图」可点入队；下载中「下载中」置灰；已下载「已保存」置灰（已直读本地）。
 * - online=false 时写动作（删除/更多）置灰——离线写操作不排队（spec §8）；分享/详情读本地仍可用。
 * - [highZoom]（装配层判定：scale>2.5x 且未下载）时显「1600 档像素不足，可查看原图」轻提示。
 * - [onRemoveFromGallery] 为 null 表示无相册上下文（时间轴进入），菜单项置灰。
 */
@Composable
fun ViewerActionBar(
    image: ImageEntity,
    isDownloaded: Boolean,
    downloading: Boolean,
    online: Boolean,
    highZoom: Boolean,
    onShare: () -> Unit,
    onViewOriginal: () -> Unit,
    onDelete: () -> Unit,
    onDetail: () -> Unit,
    onAddToGallery: () -> Unit,
    onRemoveFromGallery: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth().testTag("viewer_action_bar"), horizontalAlignment = Alignment.CenterHorizontally) {
        if (highZoom) {
            Text(
                "1600 档像素不足，可查看原图",
                color = Color.White.copy(alpha = 0.9f),
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier
                    .padding(bottom = 4.dp)
                    .testTag("viewer_zoom_hint"),
            )
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            BarAction(Icons.Filled.Share, "分享", enabled = true, tag = "viewer_action_share", onClick = onShare)
            BarAction(
                icon = if (isDownloaded) Icons.Filled.DownloadDone else Icons.Filled.Download,
                label = when {
                    isDownloaded -> "已保存"
                    downloading -> "下载中"
                    else -> "查看原图"
                },
                enabled = !isDownloaded && !downloading,
                tag = "viewer_action_download",
                onClick = onViewOriginal,
            )
            BarAction(Icons.Filled.Delete, "删除", enabled = online, tag = "viewer_action_delete", onClick = onDelete)
            BarAction(Icons.Filled.Info, "详情", enabled = true, tag = "viewer_action_detail", onClick = onDetail)
            Box {
                var menuOpen by remember { mutableStateOf(false) }
                BarAction(Icons.Filled.MoreVert, "更多", enabled = online, tag = "viewer_action_more") {
                    menuOpen = true
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("加入相册") },
                        onClick = {
                            menuOpen = false
                            onAddToGallery()
                        },
                        modifier = Modifier.testTag("viewer_menu_add_to_gallery"),
                    )
                    DropdownMenuItem(
                        text = { Text("移出当前相册") },
                        enabled = onRemoveFromGallery != null,
                        onClick = {
                            menuOpen = false
                            onRemoveFromGallery?.invoke()
                        },
                        modifier = Modifier.testTag("viewer_menu_remove_from_gallery"),
                    )
                }
            }
        }
    }
}

/** 单个操作项：图标 + 小字标签；禁用态整体降透明度（黑底白字，沉浸风格）。 */
@Composable
private fun BarAction(
    icon: ImageVector,
    label: String,
    enabled: Boolean,
    tag: String,
    onClick: () -> Unit,
) {
    val tint = if (enabled) Color.White else Color.White.copy(alpha = 0.38f)
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .testTag(tag),
    ) {
        Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(22.dp))
        Text(label, color = tint, style = MaterialTheme.typography.labelSmall)
    }
}
