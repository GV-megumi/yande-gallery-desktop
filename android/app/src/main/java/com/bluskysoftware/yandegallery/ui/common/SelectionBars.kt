package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.RemoveCircleOutline
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * 多选顶部选择栏（M3-T13）：取消 × / 「已选 N 项」 / 全选。
 *
 * 系统栏 inset 由 [insetStatusBar] 门控（D12A）：
 * - 照片 tab 嵌在 AppScaffold 内容区、相册详情放 Scaffold topBar 槽——都需状态栏 inset，传 `insetStatusBar = true`，
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
    Surface(color = MaterialTheme.colorScheme.surface, modifier = modifier.fillMaxWidth()) {
        Column {
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
                    style = MaterialTheme.typography.titleLarge,   // spec §6 定 17sp（终审 Minor#4 对齐）
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onSelectAll, modifier = Modifier.testTag("selection_select_all")) {
                    Icon(Icons.Filled.SelectAll, contentDescription = "全选")
                }
            }
            HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/**
 * 多选底部动作栏（M3-T13）：下载 / 分享 / 删除 / 加入相册（相册内多一项移出当前相册）。
 *
 * - online=false 置灰写动作（删除/加入/设封面/移出）——离线写操作不排队（spec §8）；
 *   下载（WorkManager 网络约束自会等待）与分享（读本地副本）保持可用，对齐大图页操作栏语义。
 * - [inGallery] 为 true（相册详情）才呈现「移出相册」项，并回调 [onRemoveFromGallery]。
 * - [onSetCover] 非空才呈现「设为封面」项（v0.6 spec §5.3：相册详情恰选 1 张时传入）。
 */
@Composable
fun SelectionBottomBar(
    online: Boolean,
    inGallery: Boolean,
    onDownload: () -> Unit,
    onShare: () -> Unit,
    onDelete: () -> Unit,
    onAddToGallery: () -> Unit,
    onSetCover: (() -> Unit)? = null,
    onRemoveFromGallery: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Surface(color = MaterialTheme.colorScheme.surface, modifier = modifier.fillMaxWidth()) {
        Column {
            HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
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
                    Icons.Filled.AddToPhotos, "加入相册",
                    enabled = online,
                    tag = "selection_action_add_to_gallery",
                    onClick = onAddToGallery,
                )
                if (onSetCover != null) {
                    SelectionAction(
                        Icons.Filled.Image, "设为封面",
                        enabled = online,
                        tag = "selection_action_set_cover",
                        onClick = onSetCover,
                    )
                }
                if (inGallery) {
                    SelectionAction(
                        Icons.Filled.RemoveCircleOutline, "移出相册",
                        enabled = online,
                        tag = "selection_action_remove_from_gallery",
                        onClick = { onRemoveFromGallery?.invoke() },
                    )
                }
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
        Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(22.dp))
        Text(label, color = tint, style = MaterialTheme.typography.labelSmall)
    }
}

/**
 * 可多选的网格格子包装（Photos/AlbumDetail 共用）：
 * - 非多选态：单击开大图（onOpen），长按进多选并选中当前格（onToggle）；
 * - 多选态：单击即切换选中，长按同样切换（不再进大图）；
 * - 选中态：内容微缩 + 半透明遮罩 + 右上角蓝底白勾角标；多选中未选格子显空心圈提示可选（spec §3）。
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
        // MIUI 手感：选中格子微缩（spec §3）；缩放只作用内容，角标不缩
        val scale by animateFloatAsState(if (selected) 0.94f else 1f, label = "cell_scale")
        Box(Modifier.matchParentSize().graphicsLayer { scaleX = scale; scaleY = scale }) { content() }
        if (selected) {
            Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = 0.3f)))
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(6.dp)
                    .size(20.dp)
                    .background(MaterialTheme.colorScheme.primary, CircleShape)
                    .border(1.5.dp, Color.White, CircleShape)
                    .testTag("selection_badge"),
            ) {
                Icon(Icons.Filled.Check, contentDescription = "已选中", tint = Color.White, modifier = Modifier.size(14.dp))
            }
        } else if (selectionActive) {
            // 多选中未选：空心圈提示可选（MIUI 同款）
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(6.dp)
                    .size(20.dp)
                    .border(1.5.dp, Color.White.copy(alpha = 0.85f), CircleShape)
                    .testTag("selection_ring"),
            )
        }
    }
}
