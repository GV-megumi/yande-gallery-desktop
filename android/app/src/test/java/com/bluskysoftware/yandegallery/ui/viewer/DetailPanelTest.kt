package com.bluskysoftware.yandegallery.ui.viewer

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * DetailPanel Robolectric 冒烟（Task 11 TDD Step 1）：
 * 字段文本渲染 / 标签 chip 存在可点 / online=false 时编辑入口禁用 / 相册 chip 回调 / 格式化函数边界。
 *
 * qualifiers 拉高窗口：Robolectric 默认 320x470 视口装不下整个面板，
 * 底部「所属相册」chips 会溢出可见区被 assertIsDisplayed 判为未显示。
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w480dp-h1000dp")
class DetailPanelTest {
    @get:Rule
    val compose = createComposeRule()

    private fun detail(
        tags: List<String> = listOf("apple", "zebra"),
        galleries: List<Long> = listOf(7L),
    ) = ImageDetail(
        entity = ImageEntity(
            id = 1,
            filename = "sunset.jpg",
            width = 1920,
            height = 1080,
            fileSize = 2_500_000,
            format = "jpg",
            createdAt = "2026-07-03T08:30:00.000Z",
            updatedAt = "2026-07-03T08:30:00.000Z",
        ),
        tagNames = tags,
        galleryIds = galleries,
    )

    @Test
    fun `渲染文件名分辨率大小格式`() {
        compose.setContent {
            DetailPanel(detail = detail(), online = true, onEditTags = {}, onTagClick = {}, onGalleryClick = {})
        }
        compose.onNodeWithText("sunset.jpg").assertIsDisplayed()
        compose.onNodeWithText("1920 × 1080").assertIsDisplayed()
        compose.onNodeWithText("2.4 MB").assertIsDisplayed()
        compose.onNodeWithText("JPG").assertIsDisplayed()
    }

    @Test
    fun `标签 chip 存在且点击回调标签名`() {
        var clicked: String? = null
        compose.setContent {
            DetailPanel(detail = detail(), online = true, onEditTags = {}, onTagClick = { clicked = it }, onGalleryClick = {})
        }
        compose.onNodeWithTag("detail_tag_apple").assertIsDisplayed()
        compose.onNodeWithTag("detail_tag_apple").performClick()
        assertEquals("apple", clicked)
    }

    @Test
    fun `online=false 时编辑标签入口禁用`() {
        compose.setContent {
            DetailPanel(detail = detail(), online = false, onEditTags = {}, onTagClick = {}, onGalleryClick = {})
        }
        compose.onNodeWithTag("detail_edit_tags").assertIsNotEnabled()
    }

    @Test
    fun `所属相册 chip 显示相册名且点击回调 id`() {
        var clicked: Long? = null
        compose.setContent {
            DetailPanel(
                detail = detail(),
                online = true,
                onEditTags = {},
                onTagClick = {},
                onGalleryClick = { clicked = it },
                galleryNames = mapOf(7L to "风景"),
            )
        }
        compose.onNodeWithText("风景").assertIsDisplayed()
        compose.onNodeWithTag("detail_gallery_7").performClick()
        assertEquals(7L, clicked)
    }

    @Test
    fun `格式化函数：大小分档与时间解析失败回退原串`() {
        assertEquals("512 B", formatFileSize(512))
        assertEquals("2.0 KB", formatFileSize(2048))
        assertEquals("2.4 MB", formatFileSize(2_500_000))
        assertEquals("not-a-date", formatTimestamp("not-a-date"))
        // 本地时区未知（±14h 内），只断言日期前缀不含具体日
        assertTrue(formatTimestamp("2026-07-03T08:30:00.000Z").startsWith("2026-07-0"))
    }
}
