package com.bluskysoftware.yandegallery.ui.viewer

import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.paging.LoadState
import androidx.paging.LoadStates
import androidx.paging.PagingData
import androidx.paging.compose.collectAsLazyPagingItems
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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

    /**
     * 审查修复回归（Important）：settle 收集器首发时 itemCount==0，若只监听 settledPage，
     * 第 0 页打开（最常见入口——时间轴最新一张）在数据到达后永远不触发相邻预取，
     * 直到用户手动翻页——须随数据到达（itemCount 变化）也跑一次相邻预取循环。
     */
    @Test
    fun `第 0 页打开时数据到达即预取相邻页`() {
        val prefetched = mutableListOf<Long>()
        compose.setContent {
            val items = flowOf(PagingData.from(listOf(image(1), image(2)))).collectAsLazyPagingItems()
            val context = androidx.compose.ui.platform.LocalContext.current
            ViewerPager(
                items = items,
                initialImageId = 1L,
                imageLoader = ImageLoader.Builder(context).build(),
                modelFor = { "file:///nonexistent/${it.id}.jpg" },
                onPrefetch = { prefetched.add(it.id) },
                onBack = {},
            )
        }
        compose.waitForIdle()

        assertTrue("第 0 页 settle 后应预取相邻页 id=2，实际：$prefetched", 2L in prefetched)
    }

    /**
     * BUG-06 回归：定位驱动 append 期间（located=false）不得渲染底部操作栏——此窗口
     * currentPage 恒 0，分享/下载/删除会静默作用在时间轴最新一张「错图」上；返回键保持可用。
     */
    @Test
    fun `定位完成前不渲染底部操作栏，返回仍可用（BUG-06）`() {
        compose.setContent {
            val items = flowOf(
                PagingData.from(
                    listOf(image(1), image(2)),
                    LoadStates(
                        refresh = LoadState.NotLoading(endOfPaginationReached = false),
                        prepend = LoadState.NotLoading(endOfPaginationReached = true),
                        // 未到底：定位循环持续等待 append，located 恒 false（静态流不再来数据）
                        append = LoadState.NotLoading(endOfPaginationReached = false),
                    ),
                ),
            ).collectAsLazyPagingItems()
            val context = androidx.compose.ui.platform.LocalContext.current
            ViewerPager(
                items = items,
                initialImageId = 999L,   // 快照中不存在的深处 id
                imageLoader = ImageLoader.Builder(context).build(),
                modelFor = { "file:///nonexistent/${it.id}.jpg" },
                onPrefetch = {},
                onBack = {},
            )
        }
        compose.waitForIdle()

        compose.onNodeWithTag("viewer_bottom_bar").assertDoesNotExist()
        compose.onNodeWithTag("viewer_back").assertIsDisplayed()
    }

    @Test
    fun `定位完成后操作栏渲染且对准目标图（非第 0 页错图）`() {
        var barImageId: Long? = null
        compose.setContent {
            val items = flowOf(PagingData.from(listOf(image(1), image(2)))).collectAsLazyPagingItems()
            val context = androidx.compose.ui.platform.LocalContext.current
            ViewerPager(
                items = items,
                initialImageId = 2L,
                imageLoader = ImageLoader.Builder(context).build(),
                modelFor = { "file:///nonexistent/${it.id}.jpg" },
                onPrefetch = {},
                onBack = {},
                actionBar = { img, _ ->
                    barImageId = img.id
                    Text("bar", modifier = Modifier.testTag("test_action_bar"))
                },
            )
        }
        compose.waitForIdle()

        // 容器存在（located 门控已放行）+ 槽内容可见；空槽容器的 isDisplayed 判定与像素尺寸有关，不作依赖
        compose.onNodeWithTag("viewer_bottom_bar").assertExists()
        compose.onNodeWithTag("test_action_bar").assertIsDisplayed()
        assertEquals("操作栏入参应为定位目标图", 2L, barImageId)
    }
}
