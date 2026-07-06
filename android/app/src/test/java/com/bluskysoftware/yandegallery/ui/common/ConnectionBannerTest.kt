package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.bluskysoftware.yandegallery.domain.ConnState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** M4-T6: 连接横幅三分支渲染（Robolectric Compose）。 */
@RunWith(RobolectricTestRunner::class)
class ConnectionBannerTest {
    @get:Rule val compose = createComposeRule()

    @Test fun `密钥失效——显示重新配对横幅且点击触发回调`() {
        var reconnect = 0
        compose.setContent {
            ConnectionBanner(
                state = ConnState(online = false, serverName = "桌面", unauthorized = true),
                onReconnectAuth = { reconnect++ },
            )
        }
        compose.onNodeWithTag("banner_unauthorized").assertIsDisplayed().performClick()
        assertEquals(1, reconnect)
        // unauthorized 优先：不应同时出现离线横幅
        compose.onNodeWithTag("banner_offline").assertDoesNotExist()
    }

    @Test fun `离线——显示未连接横幅且文案含服务器名`() {
        compose.setContent {
            ConnectionBanner(
                state = ConnState(online = false, serverName = "桌面", unauthorized = false),
                onReconnectAuth = {},
            )
        }
        compose.onNodeWithTag("banner_offline").assertIsDisplayed()
        compose.onNodeWithText("未连接到 桌面", substring = true).assertIsDisplayed()
        compose.onNodeWithTag("banner_unauthorized").assertDoesNotExist()
    }

    @Test fun `离线——横幅可点且点击触发回调（IP 变化引导跳服务器页）`() {
        var manage = 0
        compose.setContent {
            ConnectionBanner(
                state = ConnState(online = false, serverName = "桌面", unauthorized = false),
                onReconnectAuth = { manage++ },
            )
        }
        compose.onNodeWithTag("banner_offline").assertIsDisplayed().performClick()
        assertEquals(1, manage)
    }

    @Test fun `在线——两横幅均不渲染`() {
        compose.setContent {
            ConnectionBanner(
                state = ConnState(online = true, serverName = "桌面", unauthorized = false),
                onReconnectAuth = {},
            )
        }
        compose.onNodeWithTag("banner_offline").assertDoesNotExist()
        compose.onNodeWithTag("banner_unauthorized").assertDoesNotExist()
    }
}
