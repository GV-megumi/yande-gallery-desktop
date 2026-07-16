package com.bluskysoftware.yandegallery.ui.device

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.DriveFileMove
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.data.device.DeviceCapabilities

/**
 * 本机大图页底部操作栏（Task 8，spec §2.3/§7）：分享 / 删除 / 复制到 / 移动到 / 详情。
 * 门控项**不渲染**（[DeviceCapabilities] 三写操作，26–28 只余分享/详情——入口隐藏而非置灰，
 * DeviceSelectionBottomBar 同款口径）；观感对照桌面域 ViewerActionBar（黑底白字沉浸风格）。
 * [isVideo] 当前仅作语义占位透传（分享 mime 由 Screen 侧按行内 isVideo 组 Intent，
 * 操作项集合图片/视频同权，spec F4）。
 */
@Composable
fun DeviceViewerActionBar(
    isVideo: Boolean,
    onShare: () -> Unit,
    onDelete: () -> Unit,
    onCopyTo: () -> Unit,
    onMoveTo: () -> Unit,
    onDetail: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth().testTag("device_viewer_action_bar"),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        DeviceViewerAction(Icons.Filled.Share, "分享", tag = "device_viewer_action_share", onClick = onShare)
        if (DeviceCapabilities.canDelete()) {
            DeviceViewerAction(Icons.Filled.Delete, "删除", tag = "device_viewer_action_delete", onClick = onDelete)
        }
        if (DeviceCapabilities.canCopy()) {
            DeviceViewerAction(
                Icons.Filled.ContentCopy, "复制到",
                tag = "device_viewer_action_copy_to",
                onClick = onCopyTo,
            )
        }
        if (DeviceCapabilities.canMove()) {
            DeviceViewerAction(
                Icons.AutoMirrored.Filled.DriveFileMove, "移动到",
                tag = "device_viewer_action_move_to",
                onClick = onMoveTo,
            )
        }
        DeviceViewerAction(Icons.Filled.Info, "详情", tag = "device_viewer_action_detail", onClick = onDetail)
    }
}

/** 单个操作项：图标 + 小字标签（桌面域 BarAction 同款观感；本域无置灰态，能渲染即可点）。 */
@Composable
private fun DeviceViewerAction(
    icon: ImageVector,
    label: String,
    tag: String,
    onClick: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .testTag(tag),
    ) {
        Icon(icon, contentDescription = label, tint = Color.White, modifier = Modifier.size(22.dp))
        Text(label, color = Color.White, style = MaterialTheme.typography.labelSmall)
    }
}
