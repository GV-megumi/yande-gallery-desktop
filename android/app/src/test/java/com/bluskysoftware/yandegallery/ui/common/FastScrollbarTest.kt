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
        // fix 轮统一基底：与 fastScrollThumbFraction 同取「可滚动范围 [0, N-V]」——brief 原公式
        // 以 N-1 为基底、与比例函数不互逆（评审确认内在不一致），测试向量随之更新
        assertEquals(0, fastScrollTargetIndex(0f, 100, 20))
        assertEquals(80, fastScrollTargetIndex(1f, 100, 20))
        assertEquals(40, fastScrollTargetIndex(0.5f, 100, 20))
        assertEquals(0, fastScrollTargetIndex(-0.5f, 100, 20))   // 越界钳制
        assertEquals(80, fastScrollTargetIndex(1.5f, 100, 20))
        assertEquals(0, fastScrollTargetIndex(0.5f, 0, 20))      // 空列表
        assertEquals(0, fastScrollTargetIndex(0.5f, 10, 20))     // 不足一屏（滑块本就隐藏，防御）
    }

    @Test
    fun `滚动位置到 thumb 比例`() {
        assertEquals(0f, fastScrollThumbFraction(0, 20, 100), 0.001f)
        assertEquals(1f, fastScrollThumbFraction(80, 20, 100), 0.001f)
        assertEquals(0.5f, fastScrollThumbFraction(40, 20, 100), 0.001f)
        assertEquals(0f, fastScrollThumbFraction(0, 20, 10), 0.001f)   // 不足一屏
    }

    @Test
    fun `fraction 与 index 映射互逆_松手 thumb 不跳位`() {
        // 评审缺陷场景：N=30、V=20 时旧公式（index 基底 N-1 vs 比例基底 N-V）半轨松手即钳到底；
        // 统一基底后任意可滚动 index 往返恒等
        for (i in 0..10) {
            assertEquals(i, fastScrollTargetIndex(fastScrollThumbFraction(i, 20, 30), 30, 20))
        }
        for (i in 0..80) {
            assertEquals(i, fastScrollTargetIndex(fastScrollThumbFraction(i, 20, 100), 100, 20))
        }
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

    @Test
    fun `按压轨道空白处直接跳至对应位置`() {
        // fix 轮（评审 Important）：命中层必须是 24dp 轨道整条而非 6dp thumb 本体——
        // thumb 停在顶部时按住轨道纵向中点（thumb 之外的空白），网格应跳到列表中段
        var state: LazyGridState? = null
        compose.setContent { fixture(count = 300, onState = { state = it }) }
        compose.waitForIdle()

        compose.onNodeWithTag("fast_scrollbar").performTouchInput {
            down(center)                 // 轨道中点（300px 轨道 y≈150，thumb 只占顶部 48px）
            moveBy(Offset(0f, 30f))      // 越过 touch slop 触发 drag start → 按点映射跳位
            up()
        }
        compose.waitForIdle()
        compose.runOnIdle {
            assertTrue("按压轨道中点应跳至列表中段", state!!.firstVisibleItemIndex > 50)
        }
    }
}
