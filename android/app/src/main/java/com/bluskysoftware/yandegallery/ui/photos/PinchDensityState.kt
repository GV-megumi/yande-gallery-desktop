package com.bluskysoftware.yandegallery.ui.photos

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.positionChanged

/**
 * 捏合切档纯状态机（D2 离散 snap）：累乘 zoom，越过阈值 snap 一档并复位累计。
 * 逐帧 zoom 只进普通字段（非 Compose 状态）——composition 只见离散档位变化，无逐帧重组。
 */
class PinchDensityState {
    private var tier: DensityTier = DensityTier.DEFAULT
    private var accumulated = 1f

    fun onGestureStart(current: DensityTier) {
        tier = current
        accumulated = 1f
    }

    /** 喂一帧 zoom 变化；越档返回新档位（调用方持久化），未越档返回 null。 */
    fun onZoom(zoomChange: Float): DensityTier? {
        accumulated *= zoomChange
        return when {
            accumulated >= ZOOM_IN_THRESHOLD -> {
                accumulated = 1f
                tier.larger()?.also { tier = it }
            }
            accumulated <= ZOOM_OUT_THRESHOLD -> {
                accumulated = 1f
                tier.smaller()?.also { tier = it }
            }
            else -> null
        }
    }

    companion object {
        const val ZOOM_IN_THRESHOLD = 1.25f
        const val ZOOM_OUT_THRESHOLD = 0.8f
    }
}

/**
 * 网格捏合手势协调器：单 awaitEachGesture + **PointerEventPass.Initial**。
 *
 * 遍序说明（与 ZoomableImage.detectTransformOrDismiss 相反）：ZoomableImage 是图片子节点
 * 自己消费，Main pass（自内向外）子先于父天然成立；本手势挂在网格外围父层——Main 上子
 * LazyVerticalGrid 先见 move 并已驱动滚动，父层事后 consume 拦不住。Initial pass 自外向内
 * 隧道下发，父层先见事件：多指时在 Initial 消费，内层网格只看到已消费事件、不再滚动；
 * 单指全程零消费，滚动/点击/长按照常。
 */
suspend fun PointerInputScope.detectPinchDensity(
    state: PinchDensityState,
    currentTier: () -> DensityTier,
    onTierChange: (DensityTier) -> Unit,
) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        var pinching = false
        while (true) {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val pressedCount = event.changes.count { it.pressed }
            if (pressedCount == 0) break
            if (pressedCount > 1) {
                if (!pinching) {
                    pinching = true
                    state.onGestureStart(currentTier())
                }
                val zoom = event.calculateZoom()
                if (zoom != 1f) {
                    state.onZoom(zoom)?.let(onTierChange)
                }
                // 多指期间全量消费（含未产生 zoom 的帧），避免半消费状态下网格滚动抖动
                event.changes.forEach { if (it.positionChanged()) it.consume() }
            }
            // 单指：不消费任何事件（滚动/点击/长按照常）
        }
    }
}
