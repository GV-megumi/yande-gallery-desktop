package com.bluskysoftware.yandegallery.ui.viewer

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.paging.PagingData
import androidx.paging.compose.collectAsLazyPagingItems
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * ViewerPager Robolectric 冒烟（镜像 PhotosScreenTest 装配）：fake PagingData 单图注入骨架层，
 * 渲染不崩 + 返回控件（testTag=viewer_back）存在且可点。
 * AsyncImage 在 Robolectric 下无网络，model 用不存在的 file uri——加载失败静默进 error 态即可。
 */
@RunWith(RobolectricTestRunner::class)
class ViewerScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private fun image(id: Long) = ImageEntity(
        id = id,
        filename = "img_$id.jpg",
        width = 100,
        height = 100,
        fileSize = 1234,
        format = "jpg",
        createdAt = "2026-07-03T00:00:00.000Z",
        updatedAt = "2026-07-03T00:00:00.000Z",
    )

    @Test
    fun `单图渲染不崩且返回控件存在可点`() {
        var backCount = 0
        compose.setContent {
            val items = flowOf(PagingData.from(listOf(image(1)))).collectAsLazyPagingItems()
            val context = androidx.compose.ui.platform.LocalContext.current
            ViewerPager(
                items = items,
                initialImageId = 1L,
                imageLoader = ImageLoader.Builder(context).build(),
                modelFor = { "file:///nonexistent/${it.id}.jpg" },
                onPrefetch = {},
                onBack = { backCount++ },
            )
        }
        compose.waitForIdle()

        compose.onNodeWithTag("viewer_pager").assertIsDisplayed()
        compose.onNodeWithTag("viewer_back").assertIsDisplayed()
        compose.onNodeWithTag("viewer_back").performClick()
        compose.waitForIdle()
        assertEquals("返回控件点击应回调 onBack", 1, backCount)
    }
}
