package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** D12A：GalleryPickerDialog excludeIds 过滤——被排除图集不出现在列表；过滤后为空复用空态文案。 */
@RunWith(RobolectricTestRunner::class)
class GalleryPickerDialogTest {
    @get:Rule
    val compose = createComposeRule()

    private fun gallery(id: Long, name: String) = GalleryEntity(id, name, null, 0)

    @Test
    fun `excludeIds 过滤掉当前图集条目`() {
        compose.setContent {
            GalleryPickerDialog(
                galleries = listOf(gallery(1, "旅行"), gallery(2, "风景")),
                onPick = {},
                onDismiss = {},
                excludeIds = setOf(1L),
            )
        }
        compose.onNodeWithTag("gallery_pick_2").assertIsDisplayed()
        compose.onNodeWithTag("gallery_pick_1").assertDoesNotExist()
    }

    @Test
    fun `不传 excludeIds 时全部呈现`() {
        compose.setContent {
            GalleryPickerDialog(
                galleries = listOf(gallery(1, "旅行"), gallery(2, "风景")),
                onPick = {},
                onDismiss = {},
            )
        }
        compose.onNodeWithTag("gallery_pick_1").assertIsDisplayed()
        compose.onNodeWithTag("gallery_pick_2").assertIsDisplayed()
    }

    @Test
    fun `过滤后为空复用空态文案`() {
        compose.setContent {
            GalleryPickerDialog(
                galleries = listOf(gallery(1, "旅行")),
                onPick = {},
                onDismiss = {},
                excludeIds = setOf(1L),
            )
        }
        compose.onNodeWithText("暂无图集，可先在相册 tab 新建").assertIsDisplayed()
        compose.onNodeWithTag("gallery_pick_1").assertDoesNotExist()
    }
}
