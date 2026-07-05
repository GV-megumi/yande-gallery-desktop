package com.bluskysoftware.yandegallery.ui.search

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * SearchScreen 无状态子件 Robolectric 冒烟：搜索历史区（无历史提示 / chip 回填 / 清空回调）。
 * 结果网格与 debounce 分页逻辑由 SearchViewModelTest 覆盖，此处只验交互接线，镜像 DetailPanelTest 装配。
 */
@RunWith(RobolectricTestRunner::class)
class SearchScreenTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `无历史时显示提示`() {
        compose.setContent {
            SearchHistory(history = emptyList(), onPick = {}, onClear = {})
        }
        compose.onNodeWithTag("search_empty_hint").assertIsDisplayed()
    }

    @Test
    fun `历史 chip 点击回填该词`() {
        var picked: String? = null
        compose.setContent {
            SearchHistory(history = listOf("neko", "sunset"), onPick = { picked = it }, onClear = {})
        }
        compose.onNodeWithTag("search_history_neko").assertIsDisplayed()
        compose.onNodeWithTag("search_history_neko").performClick()
        assertEquals("neko", picked)
    }

    @Test
    fun `清空按钮回调 onClear`() {
        var cleared = false
        compose.setContent {
            SearchHistory(history = listOf("neko"), onPick = {}, onClear = { cleared = true })
        }
        compose.onNodeWithTag("search_clear_history").performClick()
        assertTrue(cleared)
    }
}
