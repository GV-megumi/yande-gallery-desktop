package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.ui.theme.MiuiTokens

/**
 * tab 页折叠大标题状态（spec §2.3，exitUntilCollapsed）：
 * - onPreScroll：上滑（y<0）先收头部、消费掉收缩量，再把余量给内容滚动；
 * - onPostScroll：下滑（y>0）内容滚到顶后未消费的余量用来展开头部——中途下滑不弹头（exitUntilCollapsed 语义）；
 * - [settle]：松手后按 0.5 阈值动画贴齐全收/全展，不留半截标题。
 *
 * 挂载位置约束：与 PullToRefreshBox 同屏时 [connection] 必须挂其内层（内容侧）——post 阶段
 * 内层连接先分发，顶部下拉余量先展开头部、展满后才轮到 PTR 攒刷新指示器；挂外层会被 PTR
 * 全额截胡，收起态无法拖拽展开且拉标题误触发刷新（评审修复，Task 6 相册页复用同约束）。
 */
@Stable
class MiuiHeaderState(val heightPx: Float) {
    var offsetPx by mutableFloatStateOf(0f)   // 0（展开）.. -heightPx（收起）
        private set
    val collapseFraction: Float get() = if (heightPx <= 0f) 1f else -offsetPx / heightPx

    /**
     * 收起态判定用 derivedStateOf：组合期直读（PhotosScreen 顶栏门控等 inline 重组域）只在
     * 阈值翻转时失效重组，折叠过渡逐帧 offsetPx 变化不再逐帧扰动读者（A8/D13 隔离纪律）。
     */
    val scrolled: Boolean by derivedStateOf { collapseFraction > 0.9f }

    val connection = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            if (available.y >= 0) return Offset.Zero
            val new = (offsetPx + available.y).coerceIn(-heightPx, 0f)
            val consumed = new - offsetPx
            offsetPx = new
            return Offset(0f, consumed)
        }

        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            if (available.y <= 0) return Offset.Zero
            val new = (offsetPx + available.y).coerceIn(-heightPx, 0f)
            val used = new - offsetPx
            offsetPx = new
            return Offset(0f, used)
        }
    }

    suspend fun settle() {
        val target = if (collapseFraction > 0.5f) -heightPx else 0f
        if (target == offsetPx) return
        animate(initialValue = offsetPx, targetValue = target) { v, _ -> offsetPx = v }
    }
}

@Composable
fun rememberMiuiHeaderState(height: Dp = MiuiTokens.LargeTitleHeight): MiuiHeaderState {
    val px = with(LocalDensity.current) { height.toPx() }
    return remember(px) { MiuiHeaderState(px) }
}

/** 大标题行：高度随折叠收缩、文字随之淡出；挂在常驻顶栏与内容之间的普通布局位。 */
@Composable
fun MiuiLargeTitle(title: String, state: MiuiHeaderState, modifier: Modifier = Modifier) {
    val heightDp = with(LocalDensity.current) { (state.heightPx + state.offsetPx).toDp() }
    Box(
        modifier
            .fillMaxWidth()
            .height(heightDp)
            .clipToBounds()
            .testTag("miui_large_title"),
        contentAlignment = Alignment.BottomStart,
    ) {
        Text(
            title,
            style = MaterialTheme.typography.headlineLarge,
            modifier = Modifier
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .graphicsLayer { alpha = 1f - state.collapseFraction },
        )
    }
}

/** tab 页常驻顶栏：状态栏垫高 + 44dp；居中小标题在大标题收起后淡入；右侧动作常驻；收起态补发丝线。 */
@Composable
fun MiuiPinnedTopBar(
    title: String,
    scrolled: Boolean,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Column(
        modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .testTag("miui_pinned_bar"),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .height(MiuiTokens.PinnedBarHeight),
        ) {
            // 全限定调用：Box 外层还有 Column，非限定名会命中 ColumnScope.AnimatedVisibility
            // 扩展（DslMarker 禁用隐式外层接收者 → 编译错），此处要的是顶层重载
            androidx.compose.animation.AnimatedVisibility(
                visible = scrolled,
                enter = fadeIn(tween(150)),
                exit = fadeOut(tween(150)),
                modifier = Modifier.align(Alignment.Center),
            ) {
                Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.testTag("miui_pinned_title"))
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.align(Alignment.CenterEnd).padding(end = 4.dp),
            ) { actions() }
        }
        if (scrolled) {
            HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}
