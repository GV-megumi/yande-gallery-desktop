package com.bluskysoftware.yandegallery.ui.viewer

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.ui.common.mimeOf
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** ViewerActionBar Robolectric 冒烟（Task 11）：离线置灰 / 查看原图三态 / highZoom 提示 / mimeOf 映射。 */
@RunWith(RobolectricTestRunner::class)
class ViewerActionBarTest {
    @get:Rule
    val compose = createComposeRule()

    private val image = ImageEntity(
        id = 1, filename = "a.jpg", width = 100, height = 100,
        fileSize = 1, format = "jpg", createdAt = "t", updatedAt = "t",
    )

    private fun setBar(
        online: Boolean = true,
        isDownloaded: Boolean = false,
        downloading: Boolean = false,
        highZoom: Boolean = false,
    ) {
        compose.setContent {
            ViewerActionBar(
                image = image,
                isDownloaded = isDownloaded,
                downloading = downloading,
                online = online,
                highZoom = highZoom,
                onShare = {},
                onViewOriginal = {},
                onDelete = {},
                onDetail = {},
                onAddToGallery = {},
                onRemoveFromGallery = null,
            )
        }
    }

    @Test
    fun `离线时删除与更多置灰，分享详情仍可用`() {
        setBar(online = false)
        compose.onNodeWithTag("viewer_action_delete").assertIsNotEnabled()
        compose.onNodeWithTag("viewer_action_more").assertIsNotEnabled()
        compose.onNodeWithTag("viewer_action_share").assertIsEnabled()
        compose.onNodeWithTag("viewer_action_detail").assertIsEnabled()
    }

    @Test
    fun `已下载显示已保存且不可再点下载`() {
        setBar(isDownloaded = true)
        compose.onNodeWithText("已保存").assertIsDisplayed()
        compose.onNodeWithTag("viewer_action_download").assertIsNotEnabled()
    }

    @Test
    fun `下载中显示下载中且不可重复入队`() {
        setBar(downloading = true)
        compose.onNodeWithText("下载中").assertIsDisplayed()
        compose.onNodeWithTag("viewer_action_download").assertIsNotEnabled()
    }

    @Test
    fun `highZoom 显示 1600 档像素不足提示`() {
        setBar(highZoom = true)
        compose.onNodeWithTag("viewer_zoom_hint").assertIsDisplayed()
    }

    @Test
    fun `mimeOf 常见格式映射与未知回退`() {
        assertEquals("image/jpeg", mimeOf("jpg"))
        assertEquals("image/jpeg", mimeOf("JPEG"))
        assertEquals("image/png", mimeOf("png"))
        assertEquals("image/webp", mimeOf("webp"))
        assertEquals("image/*", mimeOf("tiff"))
    }
}
