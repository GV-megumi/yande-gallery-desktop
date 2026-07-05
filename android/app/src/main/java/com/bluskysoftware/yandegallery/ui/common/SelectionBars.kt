package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddToPhotos
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.RemoveCircleOutline
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/**
 * 多选顶部选择栏（M3-T13）：取消 × / 「已选 N 项」 / 全选。
 *
 * 系统栏 inset 由 [insetStatusBar] 门控（D12A）：
 * - 照片 tab 嵌在 AppScaffold 内容区、图集详情放 Scaffold topBar 槽——都需状态栏 inset，传 `insetStatusBar = true`，
 *   padding 施加在 Surface **内**的 Row 上，Surface 背景连带着色状态栏区（避免顶部留一条未着色带）；
 * - 缺省 false 时不施加 inset（无系统栏遮挡的宿主）。
 */
@Composable
fun SelectionTopBar(
    count: Int,
    onSelectAll: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    insetStatusBar: Boolean = false,
) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .then(if (insetStatusBar) Modifier.statusBarsPadding() else Modifier)
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 4.dp)
                .testTag("selection_top_bar"),
        ) {
            IconButton(onClick = onCancel, modifier = Modifier.testTag("selection_cancel")) {
                Icon(Icons.Filled.Close, contentDescription = "取消多选")
            }
            Text(
                "已选 $count 项",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onSelectAll, modifier = Modifier.testTag("selection_select_all")) {
                Icon(Icons.Filled.SelectAll, contentDescription = "全选")
            }
        }
    }
}

/**
 * 多选底部动作栏（M3-T13）：下载 / 分享 / 删除 / 加入图集（图集内多一项移出当前图集）。
 *
 * - online=false 置灰写动作（删除/加入/移出）——离线写操作不排队（spec §8）；
 *   下载（WorkManager 网络约束自会等待）与分享（读本地副本）保持可用，对齐大图页操作栏语义。
 * - [inGallery] 为 true（图集详情）才呈现「移出图集」项，并回调 [onRemoveFromGallery]。
 */
@Composable
fun SelectionBottomBar(
    online: Boolean,
    inGallery: Boolean,
    onDownload: () -> Unit,
    onShare: () -> Unit,
    onDelete: () -> Unit,
    onAddToGallery: () -> Unit,
    onRemoveFromGallery: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = modifier.fillMaxWidth()) {
        Row(
            horizontalArrangement = Arrangement.SpaceEvenly,
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(vertical = 4.dp)
                .testTag("selection_bottom_bar"),
        ) {
            SelectionAction(Icons.Filled.Download, "下载", enabled = true, tag = "selection_action_download", onClick = onDownload)
            SelectionAction(Icons.Filled.Share, "分享", enabled = true, tag = "selection_action_share", onClick = onShare)
            SelectionAction(Icons.Filled.Delete, "删除", enabled = online, tag = "selection_action_delete", onClick = onDelete)
            SelectionAction(
                Icons.Filled.AddToPhotos, "加入图集",
                enabled = online,
                tag = "selection_action_add_to_gallery",
                onClick = onAddToGallery,
            )
            if (inGallery) {
                SelectionAction(
                    Icons.Filled.RemoveCircleOutline, "移出图集",
                    enabled = online,
                    tag = "selection_action_remove_from_gallery",
                    onClick = { onRemoveFromGallery?.invoke() },
                )
            }
        }
    }
}

/** 单个动作项：图标 + 小字标签；禁用整体降透明度（主题配色，非大图页黑底风格）。 */
@Composable
private fun SelectionAction(
    icon: ImageVector,
    label: String,
    enabled: Boolean,
    tag: String,
    onClick: () -> Unit,
) {
    val tint = if (enabled) {
        MaterialTheme.colorScheme.onSurface
    } else {
        MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
    }
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .testTag(tag),
    ) {
        Icon(icon, contentDescription = label, tint = tint)
        Text(label, color = tint, style = MaterialTheme.typography.labelSmall)
    }
}

/**
 * 可多选的网格格子包装（Photos/AlbumDetail 共用）：
 * - 非多选态：单击开大图（onOpen），长按进多选并选中当前格（onToggle）；
 * - 多选态：单击即切换选中，长按同样切换（不再进大图）；
 * - 选中态叠加半透明遮罩 + 右上角勾选角标。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SelectableCell(
    selected: Boolean,
    selectionActive: Boolean,
    onOpen: () -> Unit,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier.combinedClickable(
            onClick = { if (selectionActive) onToggle() else onOpen() },
            onLongClick = onToggle,
        ),
    ) {
        content()
        if (selected) {
            Box(
                Modifier
                    .matchParentSize()
                    .background(Color.Black.copy(alpha = 0.3f)),
            )
            Icon(
                Icons.Filled.CheckCircle,
                contentDescription = "已选中",
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(4.dp)
                    .size(20.dp)
                    .background(Color.White, CircleShape)
                    .testTag("selection_badge"),
            )
        }
    }
}
