package com.bluskysoftware.yandegallery.ui.device

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.DriveFileMove
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.ui.common.debouncedClickable

/**
 * 手机域多选底栏桥（Task 7，对照 PhotosSelectionBars 同款 swap-bridge 模式）：
 * DeviceAlbumDetailScreen 每次重组经 SideEffect 回填 [model]（闭包捕获屏内状态），壳（AppScaffold）
 * 据非空与否把底部导航栏 swap 成 [DeviceSelectionBottomBar]；离开路由/退出多选回 null。
 * 与照片域桥分居两类而非复用：字段语义完全不同（online/下载/加入相册 ↔ 版本门控三写操作），
 * 硬凑同壳只会让两域互相迁就（Task 4 临时借 PhotosSelectionBars 占位，本任务修正）。
 */
class DeviceSelectionBars {
    var model by mutableStateOf<Model?>(null)

    /**
     * 门控三布尔来自 [com.bluskysoftware.yandegallery.data.device.DeviceCapabilities]（spec §7）：
     * false ⇒ 对应动作项**不渲染**（入口隐藏，不是置灰）；分享不涉本机文件写入，恒可用。
     */
    data class Model(
        val canDelete: Boolean,
        val canCopy: Boolean,
        val canMove: Boolean,
        val onShare: () -> Unit,
        val onDelete: () -> Unit,
        val onCopyTo: () -> Unit,
        val onMoveTo: () -> Unit,
    )
}

/**
 * 手机域多选底部动作栏（spec §5.3/§5.4/§7）：分享 / 删除 / 复制到 / 移动到。
 * 结构镜像照片域 SelectionBottomBar（Surface + 发丝线 + SpaceEvenly 动作排），但门控语义不同：
 * 照片域按 online 置灰，本域按版本能力**隐藏**——26–28 三写操作项整个不进组合树。
 */
@Composable
fun DeviceSelectionBottomBar(model: DeviceSelectionBars.Model, modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.surface, modifier = modifier.fillMaxWidth()) {
        Column {
            HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
            Row(
                horizontalArrangement = Arrangement.SpaceEvenly,
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(vertical = 4.dp)
                    .testTag("device_selection_bottom_bar"),
            ) {
                DeviceSelectionAction(Icons.Filled.Share, "分享", tag = "device_action_share", onClick = model.onShare)
                if (model.canDelete) {
                    DeviceSelectionAction(Icons.Filled.Delete, "删除", tag = "device_action_delete", onClick = model.onDelete)
                }
                if (model.canCopy) {
                    DeviceSelectionAction(Icons.Filled.ContentCopy, "复制到", tag = "device_action_copy_to", onClick = model.onCopyTo)
                }
                if (model.canMove) {
                    DeviceSelectionAction(
                        Icons.AutoMirrored.Filled.DriveFileMove, "移动到",
                        tag = "device_action_move_to",
                        onClick = model.onMoveTo,
                    )
                }
            }
        }
    }
}

/** 单个动作项：图标 + 小字标签（照片域 SelectionAction 同款观感；本域无置灰态，能渲染即可点）；
 *  连点防抖（v0.8.1 G2）——300ms 窗口吞双击，防删除/复制等系统弹窗动作双发。 */
@Composable
private fun DeviceSelectionAction(
    icon: ImageVector,
    label: String,
    tag: String,
    onClick: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .debouncedClickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .testTag(tag),
    ) {
        Icon(icon, contentDescription = label, tint = MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(22.dp))
        Text(label, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.labelSmall)
    }
}
