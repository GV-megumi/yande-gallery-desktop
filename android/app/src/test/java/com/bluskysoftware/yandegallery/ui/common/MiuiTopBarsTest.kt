package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MiuiTopBarsTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var scrolledState: MutableState<Boolean>

    @Test
    fun `折叠状态机：上滑先收头、余量给内容，下滑余量展开，clamp 生效`() {
        val state = MiuiHeaderState(heightPx = 100f)
        // 上滑 60px：全部被头部消费
        var consumed = state.connection.onPreScroll(Offset(0f, -60f), NestedScrollSource.UserInput)
        assertEquals(-60f, consumed.y)
        assertEquals(0.6f, state.collapseFraction)
        // 再上滑 80px：只剩 40 可收，余量放行给内容
        consumed = state.connection.onPreScroll(Offset(0f, -80f), NestedScrollSource.UserInput)
        assertEquals(-40f, consumed.y)
        assertTrue(state.scrolled)
        // 中途下滑走 onPreScroll 不展开（exitUntilCollapsed）
        consumed = state.connection.onPreScroll(Offset(0f, 50f), NestedScrollSource.UserInput)
        assertEquals(0f, consumed.y)
        // 内容到顶后的 onPostScroll 余量展开
        consumed = state.connection.onPostScroll(Offset.Zero, Offset(0f, 30f), NestedScrollSource.UserInput)
        assertEquals(30f, consumed.y)
        assertFalse(state.scrolled)
    }

    @Test
    fun `常驻顶栏：未滚动无小标题，滚动后小标题浮现，动作槽常驻可点`() {
        var clicks = 0
        compose.setContent {
            val s = remember { mutableStateOf(false) }
            scrolledState = s
            MiuiPinnedTopBar(title = "照片", scrolled = s.value, actions = {
                IconButton(onClick = { clicks++ }, modifier = Modifier.testTag("t_action")) {
                    Icon(Icons.Filled.Search, contentDescription = "搜索")
                }
            })
        }
        compose.onNodeWithTag("miui_pinned_title").assertDoesNotExist()
        compose.onNodeWithTag("t_action").assertIsDisplayed()
        compose.onNodeWithTag("t_action").performClick()
        assertEquals(1, clicks)
        compose.runOnUiThread { scrolledState.value = true }
        compose.onNodeWithTag("miui_pinned_title").assertIsDisplayed()
    }
}
