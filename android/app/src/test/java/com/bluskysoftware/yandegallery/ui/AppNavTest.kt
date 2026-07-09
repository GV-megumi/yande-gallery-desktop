package com.bluskysoftware.yandegallery.ui

import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
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
    fun `照片顶栏更多入口存在`() {
        compose.setContent { AppNavForTest() }
        // v0.6：设置入口迁入「⋯」面板（spec §3.1）——顶栏只验 photos_more 存在；
        // 「设置行 → onOpenSettings」跳转覆盖移至 PhotosScreenTest 的面板设置行用例，本处不再穿 NavHost。
        compose.onNodeWithTag("photos_more").assertIsDisplayed()
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
