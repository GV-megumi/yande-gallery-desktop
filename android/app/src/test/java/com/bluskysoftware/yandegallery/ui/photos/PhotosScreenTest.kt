package com.bluskysoftware.yandegallery.ui.photos

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
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

    /** 测试替身格子：AsyncImage 在 Robolectric 下无网络，注入可断言的 tag Box。 */
    private val stubCell: @androidx.compose.runtime.Composable (TimelineItem.Photo) -> Unit = { p ->
        Box(Modifier.aspectRatio(1f).testTag("photo_cell_${p.image.id}"))
    }

    @Test
    fun `网格渲染日期头文本与照片格子`() {
        val header = TimelineItem.Header("2026-07-03", "2026年7月3日")
        val photo = TimelineItem.Photo(image(1, "2026-07-03T00:00:00.000Z"))
        compose.setContent {
            val items = flowOf(PagingData.from(listOf<TimelineItem>(header, photo)))
                .collectAsLazyPagingItems()
            PhotosGrid(items = items, columns = 4, photoCell = stubCell)
        }
        compose.waitForIdle()

        compose.onNodeWithText("2026年7月3日").assertIsDisplayed()
        compose.onNodeWithTag("photo_cell_1").assertIsDisplayed()
    }

    @Test
    fun `columns=3 渲染不崩且照片格子数不变`() {
        val data = listOf<TimelineItem>(
            TimelineItem.Header("2026-07-03", "2026年7月3日"),
            TimelineItem.Photo(image(1, "2026-07-03T00:00:00.000Z")),
            TimelineItem.Photo(image(2, "2026-07-03T01:00:00.000Z")),
            TimelineItem.Photo(image(3, "2026-07-03T02:00:00.000Z")),
            TimelineItem.Photo(image(4, "2026-07-03T03:00:00.000Z")),
        )
        compose.setContent {
            val items = flowOf(PagingData.from(data)).collectAsLazyPagingItems()
            PhotosGrid(items = items, columns = 3, photoCell = stubCell)
        }
        compose.waitForIdle()

        // 3 列下 4 张照片折两行，全部格子照常渲染（Header 满行跨列不占格）
        (1L..4L).forEach { compose.onNodeWithTag("photo_cell_$it").assertIsDisplayed() }
    }

    @Test
    fun `columns=6 月分组数据渲染月文案`() {
        val data = listOf<TimelineItem>(
            TimelineItem.Header("2026-07", "2026年7月"),   // 月模式 Header：dayKey 字段承载 monthKey
            TimelineItem.Photo(image(1, "2026-07-03T00:00:00.000Z")),
            TimelineItem.Photo(image(2, "2026-07-15T00:00:00.000Z")),
        )
        compose.setContent {
            val items = flowOf(PagingData.from(data)).collectAsLazyPagingItems()
            PhotosGrid(items = items, columns = 6, photoCell = stubCell)
        }
        compose.waitForIdle()

        compose.onNodeWithText("2026年7月").assertIsDisplayed()
        compose.onNodeWithTag("photo_cell_1").assertIsDisplayed()
        compose.onNodeWithTag("photo_cell_2").assertIsDisplayed()
    }

    @Test
    fun `冷启动闪档 日分组4列翻转月分组6列不崩`() {
        // 模拟冷启动闪档路径（T2 已知限制）：持久 MONTH 时首帧仍按 DEFAULT(DAY_4) 渲染日分组，
        // DataStore 读到后翻转为月分组 6 列——Header key 族整体从 yyyy-MM-dd 换成 yyyy-MM，
        // animateItem 下数据集+列数同帧切换不得崩溃/丢格子。
        val dayData = listOf<TimelineItem>(
            TimelineItem.Header("2026-07-03", "2026年7月3日"),
            TimelineItem.Photo(image(1, "2026-07-03T00:00:00.000Z")),
            TimelineItem.Photo(image(2, "2026-07-03T01:00:00.000Z")),
        )
        val monthData = listOf<TimelineItem>(
            TimelineItem.Header("2026-07", "2026年7月"),
            TimelineItem.Photo(image(1, "2026-07-03T00:00:00.000Z")),
            TimelineItem.Photo(image(2, "2026-07-03T01:00:00.000Z")),
        )
        val monthMode = mutableStateOf(false)
        compose.setContent {
            val mode by monthMode
            val items = flowOf(PagingData.from(if (mode) monthData else dayData))
                .collectAsLazyPagingItems()
            PhotosGrid(items = items, columns = if (mode) 6 else 4, photoCell = stubCell)
        }
        compose.waitForIdle()
        compose.onNodeWithText("2026年7月3日").assertIsDisplayed()

        compose.runOnIdle { monthMode.value = true }
        compose.waitForIdle()

        compose.onNodeWithText("2026年7月").assertIsDisplayed()
        compose.onNodeWithTag("photo_cell_1").assertIsDisplayed()
        compose.onNodeWithTag("photo_cell_2").assertIsDisplayed()
    }
}
