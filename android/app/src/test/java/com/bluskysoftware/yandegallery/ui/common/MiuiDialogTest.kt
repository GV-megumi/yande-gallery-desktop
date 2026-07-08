package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** MiuiDialog 契约（spec §8.3）：标题/正文渲染、双按钮回调、confirmEnabled 门控、content 槽、confirmTag 透传。 */
@RunWith(RobolectricTestRunner::class)
class MiuiDialogTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `双按钮回调与危险确认渲染`() {
        var confirmed = 0
        var dismissed = 0
        compose.setContent {
            MiuiDialog(
                title = "删除图片",
                text = "确定删除？",
                onDismiss = { dismissed++ },
                confirmText = "删除",
                destructive = true,
                confirmTag = "t_confirm",
                onConfirm = { confirmed++ },
            )
        }
        compose.onNodeWithText("删除图片").assertIsDisplayed()
        compose.onNodeWithText("确定删除？").assertIsDisplayed()
        compose.onNodeWithTag("t_confirm").performClick()
        compose.onNodeWithTag("miui_dialog_dismiss").performClick()
        assertEquals(1, confirmed)
        assertEquals(1, dismissed)
    }

    @Test
    fun `confirmEnabled=false 点确认不回调`() {
        var confirmed = 0
        compose.setContent {
            MiuiDialog(
                title = "新建图集",
                onDismiss = {},
                confirmText = "创建",
                confirmEnabled = false,
                onConfirm = { confirmed++ },
                content = { Text("槽内容", Modifier) },
            )
        }
        compose.onNodeWithText("槽内容").assertIsDisplayed()
        compose.onNodeWithTag("miui_dialog_confirm").performClick()
        assertEquals(0, confirmed)
    }

    @Test
    fun `单按钮模式只渲染确认`() {
        compose.setContent {
            MiuiDialog(title = "开源协议", text = "Apache", onDismiss = {}, confirmText = "关闭", dismissText = null)
        }
        compose.onNodeWithTag("miui_dialog_confirm").assertIsDisplayed()
        compose.onNodeWithTag("miui_dialog_dismiss").assertDoesNotExist()
    }
}
