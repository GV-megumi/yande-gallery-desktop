package com.bluskysoftware.yandegallery.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * M3-T13: SelectionState 纯逻辑（多选模式）——toggle 增删 / selectAll / clear / count / active 随非空切换。
 * 无 Android 依赖，普通 JVM 单测。
 */
class SelectionStateTest {

    @Test
    fun `初始为空——未激活且 count 为 0`() {
        val state = SelectionState()

        assertEquals(emptySet<Long>(), state.selected)
        assertFalse(state.active)
        assertEquals(0, state.count)
    }

    @Test
    fun `toggle 未选中的 id——加入选择`() {
        val state = SelectionState()

        state.toggle(7)

        assertEquals(setOf(7L), state.selected)
    }

    @Test
    fun `toggle 已选中的 id——移出选择`() {
        val state = SelectionState()
        state.toggle(7)

        state.toggle(7)

        assertEquals(emptySet<Long>(), state.selected)
    }

    @Test
    fun `toggle 多个 id——互不影响`() {
        val state = SelectionState()

        state.toggle(1)
        state.toggle(2)
        state.toggle(3)
        state.toggle(2)

        assertEquals(setOf(1L, 3L), state.selected)
    }

    @Test
    fun `selectAll——并集语义，不丢已有选择`() {
        val state = SelectionState()
        state.toggle(1)

        state.selectAll(listOf(2, 3))

        assertEquals(setOf(1L, 2L, 3L), state.selected)
    }

    @Test
    fun `selectAll 含重复 id——集合去重`() {
        val state = SelectionState()

        state.selectAll(listOf(1, 1, 2))

        assertEquals(setOf(1L, 2L), state.selected)
        assertEquals(2, state.count)
    }

    @Test
    fun `clear——清空并退出激活态`() {
        val state = SelectionState()
        state.selectAll(listOf(1, 2))

        state.clear()

        assertEquals(emptySet<Long>(), state.selected)
        assertFalse(state.active)
    }

    @Test
    fun `active 随非空切换——空到非空为 true，回到空为 false`() {
        val state = SelectionState()
        assertFalse(state.active)

        state.toggle(5)
        assertTrue(state.active)

        state.toggle(5)
        assertFalse(state.active)
    }

    @Test
    fun `count 跟随选中数量`() {
        val state = SelectionState()

        state.toggle(1)
        assertEquals(1, state.count)

        state.selectAll(listOf(2, 3))
        assertEquals(3, state.count)
    }

    @Test
    fun `selectedFlow 与 selected 同步——Compose 端订阅同一份状态`() {
        val state = SelectionState()

        state.toggle(9)

        assertEquals(setOf(9L), state.selectedFlow.value)
    }
}
