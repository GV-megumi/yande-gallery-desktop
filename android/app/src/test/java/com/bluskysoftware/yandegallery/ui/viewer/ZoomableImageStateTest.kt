package com.bluskysoftware.yandegallery.ui.viewer

import androidx.compose.ui.geometry.Offset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ZoomableImageState 纯逻辑测试（纯 JVM，无 Robolectric）——TDD 先行：
 * 双击 1x↔2x 循环 / onTransform 累乘钳制 1x..5x / consumesHorizontalDrag 门控标志。
 */
class ZoomableImageStateTest {

    @Test
    fun `双击在 1x 与 2x 之间循环`() {
        val state = ZoomableImageState()
        assertEquals(1f, state.scale, 0f)

        state.onDoubleTap()
        assertEquals(2f, state.scale, 0f)

        state.onDoubleTap()
        assertEquals(1f, state.scale, 0f)
        assertEquals(Offset.Zero, state.offset)
    }

    @Test
    fun `任意放大态双击回 1x 并清空偏移`() {
        val state = ZoomableImageState()
        state.onTransform(3f, Offset.Zero)
        state.onTransform(1f, Offset(10f, 20f))

        state.onDoubleTap()

        assertEquals(1f, state.scale, 0f)
        assertEquals(Offset.Zero, state.offset)
    }

    @Test
    fun `onTransform 累乘钳制在 1x 到 5x`() {
        val state = ZoomableImageState()
        state.onTransform(3f, Offset.Zero)
        assertEquals(3f, state.scale, 1e-4f)

        state.onTransform(10f, Offset.Zero)
        assertEquals("上限钳 5x", 5f, state.scale, 0f)

        state.onTransform(0.01f, Offset.Zero)
        assertEquals("下限钳 1x", 1f, state.scale, 0f)
    }

    @Test
    fun `scale 等于 1 时不吃横滑且 pan 不产生偏移`() {
        val state = ZoomableImageState()
        assertFalse(state.consumesHorizontalDrag)

        state.onTransform(1f, Offset(30f, 0f))
        assertEquals(Offset.Zero, state.offset)
    }

    @Test
    fun `scale 大于 1 时吃横滑且 pan 累加偏移`() {
        val state = ZoomableImageState()
        state.onTransform(2f, Offset.Zero)
        assertTrue(state.consumesHorizontalDrag)

        state.onTransform(1f, Offset(5f, 7f))
        state.onTransform(1f, Offset(1f, 1f))
        assertEquals(Offset(6f, 8f), state.offset)
    }
}
