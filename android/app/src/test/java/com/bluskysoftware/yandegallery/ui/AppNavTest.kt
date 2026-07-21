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

    @Test
    fun `其他相册路由注册且不被相册详情模式吞掉`() {
        compose.setContent { AppNavForTest() }
        // AppNavForTest 的相册占位带一颗测试触发按钮（v0.6 T8 加），经真 NavHost 跳转
        compose.onNodeWithTag("tab_albums").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("test_open_other_albums").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("其他相册占位").assertIsDisplayed()   // 命中占位而非「相册详情占位」
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

    @Test
    fun `底导含手机相册tab_点击落到device_albums路由`() {
        compose.setContent { AppNavForTest() }
        compose.onNodeWithTag("tab_device_albums").performClick()
        compose.onNodeWithText("手机相册占位").assertIsDisplayed()
    }

    @Test
    fun `手机相册tab上底部导航栏保持可见`() {
        compose.setContent { AppNavForTest() }
        compose.onNodeWithTag("tab_device_albums").performClick()
        compose.onNodeWithTag("tab_photos").assertIsDisplayed()   // 底导仍在
    }
}
