package com.bluskysoftware.yandegallery.ui.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * SettingsScreen Robolectric 冒烟：hub 的「服务器管理」入口回调、「版本」行显示传入版本号、
 * 「开源协议」点开弹窗含许可证文案。缓存管理区由 T8 补入，本任务不测。
 */
@RunWith(RobolectricTestRunner::class)
class SettingsScreenTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `服务器管理项点击触发 onOpenServers`() {
        var opened = false
        compose.setContent {
            SettingsScreen(onBack = {}, onOpenServers = { opened = true }, versionName = "9.9.9")
        }
        compose.onNodeWithTag("settings_servers").assertIsDisplayed()
        compose.onNodeWithTag("settings_servers").performClick()
        assertTrue(opened)
    }

    @Test
    fun `版本行显示传入版本号`() {
        compose.setContent {
            SettingsScreen(onBack = {}, onOpenServers = {}, versionName = "1.2.3-test")
        }
        compose.onNodeWithTag("settings_version").assertIsDisplayed()
        compose.onNodeWithText("1.2.3-test").assertIsDisplayed()
    }

    @Test
    fun `点开源协议弹窗含 Apache 文案`() {
        compose.setContent {
            SettingsScreen(onBack = {}, onOpenServers = {}, versionName = "1.0")
        }
        compose.onNodeWithTag("settings_licenses").performClick()
        compose.onNodeWithText("Apache", substring = true).assertIsDisplayed()
    }
}
