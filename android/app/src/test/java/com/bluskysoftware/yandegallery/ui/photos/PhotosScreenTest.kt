package com.bluskysoftware.yandegallery.ui.photos

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.paging.LoadState
import androidx.paging.LoadStates
import androidx.paging.PagingData
import androidx.paging.compose.collectAsLazyPagingItems
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

    @Test
    fun `sticky 日期条有 label 渲染_null 不渲染`() {
        val label = mutableStateOf<String?>("2026年6月")
        compose.setContent { StickyDateOverlay(label = label.value) }
        compose.waitForIdle()

        compose.onNodeWithTag("sticky_date").assertIsDisplayed()
        compose.onNodeWithText("2026年6月").assertIsDisplayed()

        compose.runOnIdle { label.value = null }
        compose.waitForIdle()
        compose.onNodeWithTag("sticky_date").assertDoesNotExist()
    }

    @Test
    fun `切档锚定不被重建前旧快照提前弃锚`() {
        // 评审缺陷场景（fix 轮）：日→月切档置锚后，effect 会先以「重建前旧（日）快照」重跑——
        // 旧键族(yyyy-MM-dd)必然不含月锚(yyyy-MM)；小库全载时旧快照 endOfPaginationReached=true，
        // 修复前会在月 pager 诞生前误走弃锚分支清锚，月快照到达后不滚动（静默 no-op）。
        // 修复后：键族未翻到目标粒度前只等待；月快照到达 → 锚被消费、滚到「2026年6月」Header。
        val endStates = LoadStates(
            refresh = LoadState.NotLoading(endOfPaginationReached = true),
            prepend = LoadState.NotLoading(endOfPaginationReached = true),
            append = LoadState.NotLoading(endOfPaginationReached = true),
        )
        // 7 月 24 张（6 列×4 行，撑出视口外滚动空间）+ 6 月两天各 1 张
        val julyPhotos = (1L..24L).map { TimelineItem.Photo(image(it, "2026-07-15T12:00:00.000Z")) }
        val dayData = buildList<TimelineItem> {
            add(TimelineItem.Header("2026-07-15", "2026年7月15日")); addAll(julyPhotos)
            add(TimelineItem.Header("2026-06-20", "2026年6月20日")); add(TimelineItem.Photo(image(25, "2026-06-20T12:00:00.000Z")))
            add(TimelineItem.Header("2026-06-10", "2026年6月10日")); add(TimelineItem.Photo(image(26, "2026-06-10T12:00:00.000Z")))
        }
        val monthData = buildList<TimelineItem> {
            add(TimelineItem.Header("2026-07", "2026年7月")); addAll(julyPhotos)
            add(TimelineItem.Header("2026-06", "2026年6月"))
            add(TimelineItem.Photo(image(25, "2026-06-20T12:00:00.000Z")))
            add(TimelineItem.Photo(image(26, "2026-06-10T12:00:00.000Z")))
        }
        val monthMode = mutableStateOf(false)
        // 锚：视口顶正看 6 月照片时日→月切档 → 目标月键 2026-06
        val anchor = mutableStateOf<PendingAnchor?>(PendingAnchor("2026-06", monthly = true))
        var gridState: LazyGridState? = null
        compose.setContent {
            val mode by monthMode
            // 流实例须 remember：onDone 清锚触发的重组若每次新建 flow，会重建空 LazyPagingItems
            // 把网格重置回顶部（生产中 items 实例随 VM 稳定，无此问题——纯测试豁口）。
            val dayFlow = remember { flowOf(PagingData.from(dayData, sourceLoadStates = endStates)) }
            val monthFlow = remember { flowOf(PagingData.from(monthData, sourceLoadStates = endStates)) }
            val items = (if (mode) monthFlow else dayFlow).collectAsLazyPagingItems()
            val state = rememberLazyGridState().also { gridState = it }
            TimelineAnchorEffect(items, state, anchor.value, onDone = { anchor.value = null })
            Box(Modifier.size(300.dp, 150.dp)) {
                PhotosGrid(items = items, columns = 6, state = state, photoCell = stubCell)
            }
        }
        compose.waitForIdle()

        // 修复点：旧（日）快照虽已 endOfPaginationReached，键族未翻转——锚必须存活、不滚动
        assertNotNull("锚不得被重建前旧快照提前弃掉", anchor.value)
        assertEquals(0, gridState!!.firstVisibleItemIndex)

        compose.runOnIdle { monthMode.value = true }   // 模拟月分组重建快照到达
        compose.waitForIdle()

        // 月快照到达：锚被消费，视口滚到 6 月 Header（不再停留顶部）
        assertNull(anchor.value)
        compose.onNodeWithText("2026年6月").assertIsDisplayed()
        assertTrue("应已从顶部滚走", gridState!!.firstVisibleItemIndex > 0)
    }
}
