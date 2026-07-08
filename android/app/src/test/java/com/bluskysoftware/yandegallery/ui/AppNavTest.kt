package com.bluskysoftware.yandegallery.ui

import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
        compose.onNodeWithTag("tab_photos").assertIsDisplayed()
        compose.onNodeWithTag("tab_albums").assertIsDisplayed()
        compose.onNodeWithTag("tab_albums").performClick()
        compose.onNodeWithText("相册页占位").assertIsDisplayed()
    }

    // v0.5 壳重构后顶部入口归属适配（spec §10）：photos_search/设置齿轮随顶栏下放进
    // PhotosScreen（装配件 PhotosPinnedTopBar），AppNavForTest 照片占位挂该真件走真
    // NavHost——全局唯一搜索入口的「点击 → 路由落点」链条保持端到端覆盖，不因壳瘦身断链。
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
        // 齿轮指 Settings（v0.4 起直达设置页）：点击后应落到设置页占位
        compose.onNodeWithContentDescription("设置").performClick()
        compose.onNodeWithText("设置页占位").assertIsDisplayed()
    }

    // 壳只验证底栏 swap（顶部选择栏已在 PhotosScreen 内自渲染）
    @Test
    fun `照片tab多选激活时壳级swap底栏`() {
        lateinit var bars: PhotosSelectionBars
        compose.setContent {
            bars = remember { PhotosSelectionBars() }
            AppNavForTest(photosSelectionBars = bars)
        }
        compose.onNodeWithTag("selection_bottom_bar").assertDoesNotExist()
        compose.runOnUiThread {
            bars.model = PhotosSelectionBars.Model(true, {}, {}, {}, {})
        }
        compose.onNodeWithTag("selection_bottom_bar").assertIsDisplayed()
        compose.onNodeWithTag("tab_photos").assertDoesNotExist()   // 导航栏被替换
        compose.runOnUiThread { bars.model = null }
        compose.onNodeWithTag("selection_bottom_bar").assertDoesNotExist()
        compose.onNodeWithTag("tab_photos").assertIsDisplayed()
    }
}
