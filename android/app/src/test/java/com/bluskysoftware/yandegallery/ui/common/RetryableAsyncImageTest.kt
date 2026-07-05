package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class RetryableAsyncImageTest {
    @get:Rule val rule = createComposeRule()

    @Test fun `失败占位渲染且点按触发重试回调`() {
        var retries = 0
        rule.setContent { ImageErrorPlaceholder(dark = false, onRetry = { retries++ }) }
        rule.onNodeWithTag("image_error_placeholder").assertIsDisplayed().performClick()
        assertEquals(1, retries)
    }

    @Test fun `黑底样式渲染不崩`() {
        rule.setContent { ImageErrorPlaceholder(dark = true, onRetry = {}) }
        rule.onNodeWithTag("image_error_placeholder").assertIsDisplayed()
    }
}
