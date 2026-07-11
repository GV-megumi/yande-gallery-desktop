package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.layout.Box
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import com.bluskysoftware.yandegallery.ui.theme.YandeGalleryTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MiuiMoreMenuTest {
    @get:Rule
    val rule = createComposeRule()

    /** 装配一个「排序 + 密度 + 设置直达」的两级菜单（照片页同构）。 */
    private fun setMenu(onSortClick: () -> Unit = {}, onNav: () -> Unit = {}) {
        rule.setContent {
            YandeGalleryTheme {
                Box {
                    MiuiMoreMenu(
                        expanded = true,
                        onDismiss = {},
                        root = { openPage ->
                            MiuiMenuGroupRow("排序方式", "时间 ↓", tag = "menu_group_sort") { openPage("sort", "排序方式") }
                            MiuiMenuGroupRow("网格密度", "标准", tag = "menu_group_density") { openPage("density", "网格密度") }
                            MiuiMenuDivider()
                            MiuiMenuNavRow("设置", tag = "sheet_settings_row", onClick = onNav)
                        },
                        page = { key ->
                            when (key) {
                                "sort" -> {
                                    MiuiSortRow("时间", selected = true, ascending = false, tag = "sort_option_time", onClick = onSortClick)
                                    MiuiSortRow("文件大小", selected = false, ascending = false, tag = "sort_option_size") {}
                                }
                                "density" -> {
                                    MiuiChoiceRow("标准（4 列）", selected = true, tag = "density_option_day4") {}
                                    MiuiChoiceRow("紧凑（5 列）", selected = false, tag = "density_option_day5") {}
                                }
                            }
                        },
                    )
                }
            }
        }
    }

    @Test
    fun `一级页显示分类与直达行_点分类进二级_返回行回一级`() {
        var navClicks = 0
        setMenu(onNav = { navClicks++ })
        // 一级页：分类行 + 直达行可见，二级行不存在
        rule.onNodeWithTag("menu_group_sort").assertIsDisplayed()
        rule.onNodeWithTag("sheet_settings_row").assertIsDisplayed()
        rule.onNodeWithTag("sort_option_time").assertDoesNotExist()
        // 进二级：明细行与返回头行出现，一级行消失
        rule.onNodeWithTag("menu_group_sort").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("sort_option_time").assertIsDisplayed()
        rule.onNodeWithTag("menu_back").assertIsDisplayed()
        rule.onNodeWithTag("menu_group_sort").assertDoesNotExist()
        // 返回一级
        rule.onNodeWithTag("menu_back").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("menu_group_sort").assertIsDisplayed()
        rule.onNodeWithTag("sort_option_time").assertDoesNotExist()
        // 直达行回调
        rule.onNodeWithTag("sheet_settings_row").performClick()
        assertEquals(1, navClicks)
    }

    @Test
    fun `排序行选中态显示方向箭头_点击回调`() {
        var clicks = 0
        setMenu(onSortClick = { clicks++ })
        rule.onNodeWithTag("menu_group_sort").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("sort_option_time").assertIsDisplayed().performClick()
        rule.onNodeWithTag("sort_option_time_dir", useUnmergedTree = true).assertIsDisplayed()   // 选中行有箭头
        rule.onNodeWithTag("sort_option_size_dir", useUnmergedTree = true).assertDoesNotExist()  // 未选行无箭头
        assertEquals(1, clicks)
    }

    @Test
    fun `单选行选中态显示勾`() {
        setMenu()
        rule.onNodeWithTag("menu_group_density").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("density_option_day4_check", useUnmergedTree = true).assertIsDisplayed()
        rule.onNodeWithTag("density_option_day5_check", useUnmergedTree = true).assertDoesNotExist()
    }
}
