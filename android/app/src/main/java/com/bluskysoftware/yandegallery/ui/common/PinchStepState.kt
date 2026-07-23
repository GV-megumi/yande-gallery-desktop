package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.positionChanged

/**
 * 捏合步进纯状态机（v0.6 由 PinchDensityState 泛型化，照片页密度档与详情页列数档共用）：
 * 累乘 zoom，越过阈值 snap 一步并复位累计；逐帧 zoom 只进普通字段，composition 只见离散变化。
 * 单手势只步进一档（v0.8.2）：一旦真步进即落锁 [stepped]，本次手势剩余帧一律忽略，须松手重捏
 * （下一次 onGestureStart）解锁——避免一次长捏/大捏连跨多档；撞边界（larger/smaller 返回 null）
 * 不落锁，只复位累计，同一手势反向捏仍即时生效。
 * [larger] = 放大方向（格子变大/列数变少），[smaller] 反之；到边界返回 null 停在原档。
 */
class PinchStepState<T : Any>(
    private val larger: (T) -> T?,
    private val smaller: (T) -> T?,
) {
    private var current: T? = null
    private var accumulated = 1f
    // 本次手势是否已真步进过一档：落锁后剩余帧全部忽略，onGestureStart 复位解锁
    private var stepped = false

    fun onGestureStart(value: T) {
        current = value
        accumulated = 1f
        stepped = false
    }

    /** 喂一帧 zoom 变化；越档返回新值（调用方持久化），未越档或本手势已步进过返回 null。 */
    fun onZoom(zoomChange: Float): T? {
        val base = current ?: return null
        if (stepped) return null   // 单手势一档：已步进过则整段手势剩余帧全部忽略
        accumulated *= zoomChange
        return when {
            accumulated >= ZOOM_IN_THRESHOLD -> {
                accumulated = 1f
                larger(base)?.also { current = it; stepped = true }   // 真步进才落锁；撞边界只复位累计
            }
            accumulated <= ZOOM_OUT_THRESHOLD -> {
                accumulated = 1f
                smaller(base)?.also { current = it; stepped = true }
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
 * 网格捏合手势协调器（原 detectPinchDensity 泛型化）：单 awaitEachGesture + PointerEventPass.Initial。
 * 遍序说明：本手势挂网格外围父层——Main pass 上子 LazyVerticalGrid 先见 move 并已驱动滚动，
 * 父层事后 consume 拦不住；Initial pass 自外向内隧道下发，多指时在 Initial 全量消费，内层网格
 * 只看到已消费事件不再滚动；单指全程零消费，滚动/点击/长按照常。
 */
suspend fun <T : Any> PointerInputScope.detectPinchStep(
    state: PinchStepState<T>,
    currentValue: () -> T,
    onChange: (T) -> Unit,
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
                    state.onGestureStart(currentValue())
                }
                val zoom = event.calculateZoom()
                if (zoom != 1f) {
                    state.onZoom(zoom)?.let(onChange)
                }
                event.changes.forEach { if (it.positionChanged()) it.consume() }
            }
        }
    }
}
