package com.bluskysoftware.yandegallery.ui.common

import android.os.SystemClock
import androidx.compose.foundation.clickable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier

/**
 * 连点防抖 clickable（v0.8.1 G2）：[windowMs] 窗口内的后续点击整体吞掉——收口多选底栏动作项与
 * picker 行的双击双发（导出/复制入队两次、对话框双开）。
 *
 * - 时钟取 [SystemClock.uptimeMillis]（单调，不受墙钟改时/回拨影响）；首次点击以 -1 哨兵放行，
 *   不依赖「开机足够久」这种隐式前提（Robolectric 影子时钟起点仅 100ms，用 0 作初值会吞掉首击）。
 * - 上次触发时间戳挂 remember：随组合位点存活，重组不重置窗口——宿主 SideEffect 每轮回填新
 *   lambda（如多选桥 Model 重建）也不给连点开后门。
 */
@Composable
fun Modifier.debouncedClickable(
    enabled: Boolean = true,
    windowMs: Long = 300,
    onClick: () -> Unit,
): Modifier {
    val lastFiredMs = remember { mutableLongStateOf(-1L) }
    return clickable(enabled = enabled) {
        val now = SystemClock.uptimeMillis()
        val last = lastFiredMs.longValue
        if (last < 0 || now - last >= windowMs) {
            lastFiredMs.longValue = now
            onClick()
        }
    }
}
