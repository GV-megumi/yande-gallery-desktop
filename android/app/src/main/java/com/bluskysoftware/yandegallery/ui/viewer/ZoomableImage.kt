package com.bluskysoftware.yandegallery.ui.viewer

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import kotlin.math.abs

/**
 * 大图缩放纯状态（可纯 JVM 单测）：双击 1x↔2x 循环、双指累乘钳制 1x..5x、
 * [consumesHorizontalDrag] 供 HorizontalPager 的 userScrollEnabled 门控（放大态不翻页）。
 */
class ZoomableImageState {
    var scale by mutableFloatStateOf(1f)
        private set
    var offset by mutableStateOf(Offset.Zero)
        private set

    /** 放大态吃掉横向拖动（平移图片），Pager 据此禁用横滑翻页。 */
    val consumesHorizontalDrag: Boolean get() = scale > 1f

    fun onTransform(zoomChange: Float, panChange: Offset) {
        scale = (scale * zoomChange).coerceIn(1f, 5f)
        offset = if (scale > 1f) offset + panChange else Offset.Zero
    }

    fun onDoubleTap() {
        if (scale > 1f) {
            scale = 1f
            offset = Offset.Zero
        } else {
            scale = 2f
        }
    }
}

/** 单手势内的归属判定：一旦定型（transform / 下滑关闭 / 让给 Pager 横滑）本次手势不再改判（多指/放大例外，见循环内注释）。 */
private enum class GestureMode { Undecided, Transform, Dismiss, PagerPass }

/**
 * 手势归属统一协调（计划裁定，避免多个 pointerInput 争夺 move 事件）——单个 awaitEachGesture 内联判定：
 * - 多指按下或 scale>1 → Transform（捏合缩放/平移），消费事件；
 * - scale==1 单指、越过 touchSlop 后按主方向定型：近垂直 → Dismiss（累计下移超阈值触发 [onDismiss]），
 *   近水平 → PagerPass（完全不消费，留给外层 HorizontalPager 翻页）。
 */
private suspend fun PointerInputScope.detectTransformOrDismiss(
    state: ZoomableImageState,
    dismissThresholdPx: Float,
    onDismiss: () -> Unit,
) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false)
        var mode = GestureMode.Undecided
        var slopAccum = Offset.Zero
        var dismissAccum = 0f
        var dismissed = false
        while (true) {
            val event = awaitPointerEvent()
            val pressedCount = event.changes.count { it.pressed }
            if (pressedCount == 0) break
            // 多指落下或已处于放大态 → 无条件升格为 Transform（捏合永远优先于下滑/翻页判定）
            if (mode != GestureMode.Transform && (pressedCount > 1 || state.scale > 1f)) {
                mode = GestureMode.Transform
            }
            val zoomChange = event.calculateZoom()
            val panChange = event.calculatePan()
            if (mode == GestureMode.Undecided) {
                slopAccum += panChange
                if (slopAccum.getDistance() > viewConfiguration.touchSlop) {
                    mode = if (abs(slopAccum.y) > abs(slopAccum.x)) GestureMode.Dismiss else GestureMode.PagerPass
                }
            }
            when (mode) {
                GestureMode.Transform -> {
                    if (zoomChange != 1f || panChange != Offset.Zero) {
                        state.onTransform(zoomChange, panChange)
                        event.changes.forEach { if (it.positionChanged()) it.consume() }
                    }
                }
                GestureMode.Dismiss -> {
                    dismissAccum += panChange.y
                    event.changes.forEach { if (it.positionChanged()) it.consume() }
                    if (!dismissed && dismissAccum > dismissThresholdPx) {
                        dismissed = true
                        onDismiss()
                    }
                }
                // 近水平单指：不消费任何事件，横滑由外层 Pager 接管
                GestureMode.PagerPass, GestureMode.Undecided -> Unit
            }
        }
    }
}

/**
 * 单页可缩放大图：AsyncImage + graphicsLayer 应用 scale/offset。
 * 手势：transform/下滑关闭走一个协调 pointerInput（见 [detectTransformOrDismiss]）；
 * 单击（切沉浸）/双击（缩放循环）走独立的 tap pointerInput——tap 不产生位移，与 drag 不争。
 */
@Composable
fun ZoomableImage(
    model: Any,
    imageLoader: ImageLoader,
    state: ZoomableImageState,
    contentDescription: String?,
    onSingleTap: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // pointerInput 闭包长驻（key 只有 state），回调用 rememberUpdatedState 防捕获过期 lambda
    val currentOnSingleTap by rememberUpdatedState(onSingleTap)
    val currentOnDismiss by rememberUpdatedState(onDismiss)
    Box(
        modifier = modifier
            .fillMaxSize()
            .pointerInput(state) {
                detectTransformOrDismiss(state, dismissThresholdPx = 120.dp.toPx()) { currentOnDismiss() }
            }
            .pointerInput(state) {
                detectTapGestures(
                    onDoubleTap = { state.onDoubleTap() },
                    onTap = { currentOnSingleTap() },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        RetryableAsyncImage(
            model = model,
            imageLoader = imageLoader,
            contentDescription = contentDescription,
            contentScale = ContentScale.Fit,
            dark = true,
            modifier = Modifier.fillMaxSize(),
            imageModifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    scaleX = state.scale
                    scaleY = state.scale
                    translationX = state.offset.x
                    translationY = state.offset.y
                },
        )
    }
}
