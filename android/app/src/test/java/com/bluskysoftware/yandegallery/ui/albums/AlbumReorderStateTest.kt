package com.bluskysoftware.yandegallery.ui.albums

import org.junit.Assert.assertEquals
import org.junit.Test

class AlbumReorderStateTest {
    @Test
    fun `区内换位_目标位让位`() {
        val state = AlbumReorderState(pinned = listOf(1, 2), normal = listOf(10, 11, 12))
        state.move(fromId = 12, toId = 10)
        assertEquals(listOf(12L, 10L, 11L), state.normalOrder.toList())
        state.move(fromId = 1, toId = 2)
        assertEquals(listOf(2L, 1L), state.pinnedOrder.toList())
    }

    @Test
    fun `跨区与未知id忽略`() {
        val state = AlbumReorderState(pinned = listOf(1), normal = listOf(10, 11))
        state.move(fromId = 1, toId = 10)    // 跨区：忽略（spec §4.5）
        state.move(fromId = 99, toId = 10)   // 未知：忽略
        assertEquals(listOf(1L), state.pinnedOrder.toList())
        assertEquals(listOf(10L, 11L), state.normalOrder.toList())
    }

    @Test
    fun `sectionOf 判定归属`() {
        val state = AlbumReorderState(pinned = listOf(1), normal = listOf(10))
        assertEquals(ReorderSection.PINNED, state.sectionOf(1))
        assertEquals(ReorderSection.NORMAL, state.sectionOf(10))
        assertEquals(null, state.sectionOf(99))
    }
}
