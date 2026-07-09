package com.bluskysoftware.yandegallery.ui.common

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
class MiuiOptionsSheetTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun `排序行选中态显示方向箭头_点击回调`() {
        var clicks = 0
        rule.setContent {
            YandeGalleryTheme {
                MiuiSheetCard("排序方式") {
                    MiuiSortRow("时间", selected = true, ascending = false, tag = "sort_option_time") { clicks++ }
                    MiuiSortRow("文件大小", selected = false, ascending = false, tag = "sort_option_size") { clicks++ }
                }
            }
        }
        rule.onNodeWithTag("sort_option_time").assertIsDisplayed().performClick()
        rule.onNodeWithTag("sort_option_time_dir", useUnmergedTree = true).assertIsDisplayed()   // 选中行有箭头
        rule.onNodeWithTag("sort_option_size_dir", useUnmergedTree = true).assertDoesNotExist()  // 未选行无箭头
        assertEquals(1, clicks)
    }

    @Test
    fun `单选行选中态显示勾_导航行可点`() {
        var navClicks = 0
        rule.setContent {
            YandeGalleryTheme {
                MiuiSheetCard("网格密度") {
                    MiuiChoiceRow("标准（4 列）", selected = true, tag = "density_option_day4") {}
                    MiuiChoiceRow("紧凑（5 列）", selected = false, tag = "density_option_day5") {}
                }
                MiuiSheetCard("更多") {
                    MiuiSheetNavRow("设置", tag = "sheet_settings_row") { navClicks++ }
                }
            }
        }
        rule.onNodeWithTag("density_option_day4_check", useUnmergedTree = true).assertIsDisplayed()
        rule.onNodeWithTag("density_option_day5_check", useUnmergedTree = true).assertDoesNotExist()
        rule.onNodeWithTag("sheet_settings_row").performClick()
        assertEquals(1, navClicks)
    }
}
