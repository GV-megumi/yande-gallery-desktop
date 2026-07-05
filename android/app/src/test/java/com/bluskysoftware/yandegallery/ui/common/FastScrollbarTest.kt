package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class FastScrollbarTest {
    @get:Rule
    val compose = createComposeRule()

    // ---- 纯映射函数（严格 TDD）----

    @Test
    fun `fraction 到 index 钳制映射`() {
        assertEquals(0, fastScrollTargetIndex(0f, 100))
        assertEquals(99, fastScrollTargetIndex(1f, 100))
        assertEquals(49, fastScrollTargetIndex(0.5f, 100))   // (100-1)*0.5=49.5 → 49（floor）
        assertEquals(0, fastScrollTargetIndex(-0.5f, 100))   // 越界钳制
        assertEquals(99, fastScrollTargetIndex(1.5f, 100))
        assertEquals(0, fastScrollTargetIndex(0.5f, 0))      // 空列表
    }

    @Test
    fun `滚动位置到 thumb 比例`() {
        assertEquals(0f, fastScrollThumbFraction(0, 20, 100), 0.001f)
        assertEquals(1f, fastScrollThumbFraction(80, 20, 100), 0.001f)
        assertEquals(0.5f, fastScrollThumbFraction(40, 20, 100), 0.001f)
        assertEquals(0f, fastScrollThumbFraction(0, 20, 10), 0.001f)   // 不足一屏
    }

    // ---- Robolectric 冒烟 ----

    /** 测试夹具：300dp 视口 + [count] 个 100dp 格子（3 列）挂 FastScrollbar。 */
    @androidx.compose.runtime.Composable
    private fun fixture(count: Int, onState: (LazyGridState) -> Unit) {
        val state = rememberLazyGridState().also(onState)
        Box(Modifier.size(300.dp)) {
            LazyVerticalGrid(columns = GridCells.Fixed(3), state = state) {
                items(count) { Box(Modifier.size(100.dp)) }
            }
            FastScrollbar(
                gridState = state,
                itemCount = count,
                labelFor = { "6月15日" },
                modifier = Modifier.align(Alignment.CenterEnd),
            )
        }
    }

    @Test
    fun `内容不足一屏时滑块隐藏`() {
        compose.setContent { fixture(count = 3, onState = {}) }
        compose.waitForIdle()
        compose.onNodeWithTag("fast_scrollbar").assertDoesNotExist()
    }

    @Test
    fun `内容超一屏时滑块出现`() {
        compose.setContent { fixture(count = 60, onState = {}) }
        compose.waitForIdle()
        compose.onNodeWithTag("fast_scrollbar").assertExists()
    }

    @Test
    fun `拖动 thumb 滚动网格且浮出日期气泡_松手气泡消失`() {
        var state: LazyGridState? = null
        compose.setContent { fixture(count = 300, onState = { state = it }) }
        compose.waitForIdle()

        // 按下 thumb 拖到底（400px 远超 300px 轨道，比例钳制 1 → 末项）；先不抬手
        compose.onNodeWithTag("fast_scroll_thumb").performTouchInput {
            down(center)
            moveBy(Offset(0f, 400f))
        }
        compose.waitForIdle()
        compose.onNodeWithTag("fast_scroll_bubble").assertExists()
        compose.runOnIdle {
            assertTrue("拖动应已触发网格滚动", state!!.firstVisibleItemIndex > 0)
        }

        compose.onNodeWithTag("fast_scroll_thumb").performTouchInput { up() }
        compose.waitForIdle()
        compose.onNodeWithTag("fast_scroll_bubble").assertDoesNotExist()
    }
}
