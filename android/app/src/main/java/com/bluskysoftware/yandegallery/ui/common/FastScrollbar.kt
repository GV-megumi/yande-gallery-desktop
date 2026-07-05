package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** 拖动比例 → 目标 item index（钳制 [0, itemCount-1]）；itemCount ≤ 0 → 0。 */
fun fastScrollTargetIndex(fraction: Float, itemCount: Int): Int {
    if (itemCount <= 0) return 0
    val f = fraction.coerceIn(0f, 1f)
    return (f * (itemCount - 1)).toInt().coerceIn(0, itemCount - 1)
}

/** 滚动位置 → thumb 顶部比例；不可滚动（totalCount ≤ visibleCount）返回 0f。 */
fun fastScrollThumbFraction(firstVisibleIndex: Int, visibleCount: Int, totalCount: Int): Float {
    val scrollable = totalCount - visibleCount
    if (scrollable <= 0) return 0f
    return (firstVisibleIndex.toFloat() / scrollable).coerceIn(0f, 1f)
}

/**
 * 快速滚动滑块（spec §7.1 / D4）：映射「已加载窗口 [0, itemCount)」，拖到底持续触发 append
 * 延展（既定行为，不开 Paging placeholders，体验为持续快进，不是一次跳到全库末尾）；同步中
 * itemCount 增长导致 thumb 比例微调是接受的。拖动中浮出日期气泡（labelFor null 时向前回退
 * 最多 30 项找最近非空）；内容不足一屏自动隐藏。
 *
 * 执行性约束（计划评审裁定）：
 * - 手势协程长驻（pointerInput key=Unit），itemCount 每次 append 都变、经 rememberUpdatedState
 *   保鲜——若把 itemCount 作 pointerInput key，拖动中 append 会反复重启手势协程、拖动中断。
 * - 组合期对 gridState.layoutInfo 的读取包 derivedStateOf：可见性只在布尔翻转、thumb 比例只在
 *   跨行时才变值，滚动逐帧的 layoutInfo 更新不触发重组。
 */
@Composable
fun FastScrollbar(
    gridState: LazyGridState,
    itemCount: Int,
    labelFor: (Int) -> String?,
    modifier: Modifier = Modifier,
) {
    // 可见性：derivedStateOf 只在「可滚动」布尔翻转时才触发重组
    val scrollable by remember(gridState) {
        derivedStateOf {
            val info = gridState.layoutInfo
            info.totalItemsCount > 0 && info.totalItemsCount > info.visibleItemsInfo.size
        }
    }
    if (!scrollable) return   // 不足一屏：隐藏

    val scope = rememberCoroutineScope()
    val currentItemCount by rememberUpdatedState(itemCount)
    val currentLabelFor by rememberUpdatedState(labelFor)
    var dragging by remember { mutableStateOf(false) }
    var dragFraction by remember { mutableStateOf(0f) }
    var lastTarget by remember { mutableStateOf(-1) }
    var trackHeightPx by remember { mutableStateOf(1) }

    // 非拖动时 thumb 随滚动位置：值仅在 firstVisibleItemIndex 跨行时变化（derivedStateOf 挡掉
    // 逐帧 layoutInfo 抖动）
    val scrolledFraction by remember(gridState) {
        derivedStateOf {
            val info = gridState.layoutInfo
            fastScrollThumbFraction(
                gridState.firstVisibleItemIndex,
                info.visibleItemsInfo.size,
                info.totalItemsCount,
            )
        }
    }
    val thumbFraction = if (dragging) dragFraction else scrolledFraction
    val thumbBias = BiasAlignment(1f, thumbFraction * 2f - 1f)

    // 气泡文案：视口顶部 index 就近取（越界/null 向前回退最多 30 项）；仅拖动中非空。
    // derivedStateOf：只有文案字符串本身变化才触发重组，拖动中逐项滚动不抖动。
    val bubbleLabel by remember(gridState) {
        derivedStateOf {
            if (!dragging) {
                null
            } else {
                val top = gridState.firstVisibleItemIndex
                    .coerceIn(0, (currentItemCount - 1).coerceAtLeast(0))
                (top downTo maxOf(0, top - 30)).firstNotNullOfOrNull { currentLabelFor(it) }
            }
        }
    }

    // 根 Box 固定 24dp 宽（轨道触控带）；气泡是 thumb 的兄弟 overlay，经负 x offset 画到轨道
    // 左侧、不参与轨道测量——出现/消失不挤动 thumb，文案也不被窄轨道裁剪（Box 默认不裁剪）
    Box(
        modifier
            .fillMaxHeight()
            .width(24.dp)
            .onSizeChanged { trackHeightPx = it.height.coerceAtLeast(1) }
            .testTag("fast_scrollbar"),
    ) {
        if (dragging && bubbleLabel != null) {
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.secondaryContainer,
                modifier = Modifier
                    .align(thumbBias)
                    .offset(x = (-28).dp)
                    .testTag("fast_scroll_bubble"),
            ) {
                Text(
                    bubbleLabel!!,
                    style = MaterialTheme.typography.labelLarge,
                    maxLines = 1,
                    softWrap = false,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
        }
        Box(
            Modifier
                .align(thumbBias)
                .padding(end = 4.dp)
                .size(width = 6.dp, height = 48.dp)
                .background(
                    MaterialTheme.colorScheme.primary.copy(alpha = if (dragging) 1f else 0.5f),
                    RoundedCornerShape(3.dp),
                )
                .pointerInput(Unit) {
                    detectVerticalDragGestures(
                        onDragStart = {
                            dragging = true
                            // 从 gridState 现值起算（闭包长驻，不能捕获组合期的 thumbFraction 快照）
                            dragFraction = fastScrollThumbFraction(
                                gridState.firstVisibleItemIndex,
                                gridState.layoutInfo.visibleItemsInfo.size,
                                gridState.layoutInfo.totalItemsCount,
                            )
                        },
                        onDragEnd = { dragging = false; lastTarget = -1 },
                        onDragCancel = { dragging = false; lastTarget = -1 },
                    ) { change, dragAmount ->
                        change.consume()
                        dragFraction = (dragFraction + dragAmount / trackHeightPx).coerceIn(0f, 1f)
                        val target = fastScrollTargetIndex(dragFraction, currentItemCount)
                        if (target != lastTarget) {          // 目标 index 变化才滚（去抖）
                            lastTarget = target
                            scope.launch { gridState.scrollToItem(target) }   // 非动画 snap
                        }
                    }
                }
                .testTag("fast_scroll_thumb"),
        )
    }
}
