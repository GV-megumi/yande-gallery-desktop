package com.bluskysoftware.yandegallery.ui.photos

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.paging.PagingData
import androidx.paging.compose.collectAsLazyPagingItems
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import kotlinx.coroutines.flow.flowOf
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PhotosScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private fun image(id: Long, createdAt: String) = ImageEntity(
        id = id,
        filename = "img_$id.jpg",
        width = 100,
        height = 100,
        fileSize = 1234,
        format = "jpg",
        createdAt = createdAt,
        updatedAt = createdAt,
    )

    @Test
    fun `网格渲染日期头文本与照片格子`() {
        val header = TimelineItem.Header("2026-07-03", "2026年7月3日")
        val photo = TimelineItem.Photo(image(1, "2026-07-03T00:00:00.000Z"))
        // AsyncImage 在 Robolectric 下无网络——把图片格子换成可断言的测试替身格子
        compose.setContent {
            val items = flowOf(PagingData.from(listOf<TimelineItem>(header, photo)))
                .collectAsLazyPagingItems()
            PhotosGrid(
                items = items,
                photoCell = { p ->
                    Box(Modifier.aspectRatio(1f).testTag("photo_cell_${p.image.id}"))
                },
            )
        }
        compose.waitForIdle()

        compose.onNodeWithText("2026年7月3日").assertIsDisplayed()
        compose.onNodeWithTag("photo_cell_1").assertIsDisplayed()
    }
}
