package com.bluskysoftware.yandegallery.ui.viewer

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
        onMoveTo: (() -> Unit)? = null,
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
                onCopyTo = {},
                onMoveTo = onMoveTo,
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
    fun `highZoom 显示清晰度不足提示`() {
        setBar(highZoom = true)
        compose.onNodeWithTag("viewer_zoom_hint").assertIsDisplayed()
    }

    @Test
    fun `更多菜单含复制到项_旧加入相册tag不存在`() {
        setBar()
        compose.onNodeWithTag("viewer_action_more").performClick()
        compose.onNodeWithTag("viewer_menu_copy_to").assertIsDisplayed()
        compose.onNodeWithText("复制到").assertIsDisplayed()
        compose.onNodeWithTag("viewer_menu_add_to_gallery").assertDoesNotExist()
        compose.onNodeWithText("加入相册").assertDoesNotExist()
    }

    @Test
    fun `移动到菜单项_onMoveTo为null置灰`() {
        setBar(onMoveTo = null)
        compose.onNodeWithTag("viewer_action_more").performClick()
        compose.onNodeWithTag("viewer_menu_move_to").assertIsDisplayed()
        compose.onNodeWithTag("viewer_menu_move_to").assertIsNotEnabled()
    }

    @Test
    fun `移动到菜单项_相册上下文非null可点且回调`() {
        var moved = 0
        setBar(onMoveTo = { moved++ })
        compose.onNodeWithTag("viewer_action_more").performClick()
        compose.onNodeWithTag("viewer_menu_move_to").assertIsEnabled()
        compose.onNodeWithTag("viewer_menu_move_to").performClick()
        assertEquals(1, moved)
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
