package com.bluskysoftware.yandegallery.ui

import androidx.compose.runtime.remember
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.assertIsDisplayed
import com.bluskysoftware.yandegallery.ui.common.PhotosSelectionBars
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AppNavTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `底部双tab渲染且可切换`() {
        compose.setContent { AppNavForTest() }
        // 「照片/相册」文本在顶栏标题与 tab 标签中各出现一次，onNodeWithText 会因多匹配报错——用 testTag 定位
        compose.onNodeWithTag("tab_photos").assertIsDisplayed()
        compose.onNodeWithTag("tab_albums").assertIsDisplayed()
        compose.onNodeWithTag("tab_albums").performClick()
        compose.onNodeWithText("相册页占位").assertIsDisplayed()
    }

    @Test
    fun `照片顶栏搜索图标跳搜索页`() {
        compose.setContent { AppNavForTest() }
        compose.onNodeWithTag("photos_search").assertIsDisplayed()
        compose.onNodeWithTag("photos_search").performClick()
        compose.onNodeWithText("搜索页占位").assertIsDisplayed()
    }

    @Test
    fun `设置齿轮跳设置页`() {
        compose.setContent { AppNavForTest() }
        // 齿轮改指 Settings（原直达 Servers）：点击后应落到设置页占位
        compose.onNodeWithContentDescription("设置").performClick()
        compose.onNodeWithText("设置页占位").assertIsDisplayed()
    }

    @Test
    fun `照片tab多选激活时壳级swap为选择栏`() {
        lateinit var bars: PhotosSelectionBars
        compose.setContent {
            bars = remember { PhotosSelectionBars() }
            AppNavForTest(photosSelectionBars = bars)
        }
        compose.onNodeWithTag("selection_top_bar").assertDoesNotExist()
        compose.runOnUiThread {
            bars.model = PhotosSelectionBars.Model(2, true, {}, {}, {}, {}, {}, {})
        }
        compose.onNodeWithTag("selection_top_bar").assertIsDisplayed()
        compose.onNodeWithTag("selection_bottom_bar").assertIsDisplayed()
        compose.onNodeWithTag("tab_photos").assertDoesNotExist()   // NavigationBar 被替换
        // 退出多选（桥回 null）：壳恢复常规 TopAppBar/NavigationBar
        compose.runOnUiThread { bars.model = null }
        compose.onNodeWithTag("selection_top_bar").assertDoesNotExist()
        compose.onNodeWithTag("selection_bottom_bar").assertDoesNotExist()
        compose.onNodeWithTag("tab_photos").assertIsDisplayed()
    }
}
