package com.bluskysoftware.yandegallery.ui.photos

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.paging.LoadState
import androidx.paging.LoadStates
import androidx.paging.PagingData
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.ui.common.PhotosSelectionBars
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class PhotosScreenTest {
    @get:Rule
    val compose = createComposeRule()

    // ---- 真 VM + in-memory graph 装置（v0.6 T6 面板用例用；PhotosViewModelTest/AlbumsWriteTest 形态合流）----

    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    // 排序/密度走真 DataStore（临时文件独立实例）：隔离每个用例、避开进程级单例状态泄漏。
    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("photos-screen-prefs", ".preferences_pb").also { it.delete() }

    @Before
    fun setup() {
        // viewModelScope（Main.immediate）在 Robolectric paused looper 下不推进，换 Unconfined
        // 让 StateFlow 收集即时追平（AlbumsWriteTest 真件屏测试同款；不影响 compose 自有帧钟）。
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(
            ApplicationProvider.getApplicationContext(),
            dbOverride = db,
            autoSyncOnActiveChange = false,
            prefsStoreOverride = PrefsStore(PreferenceDataStoreFactory.create(scope = prefsScope) { prefsTmp }),
        )
        // 激活服务器：PhotosScreen 须穿过引导态门进入网格分支常态顶栏（关自动同步/SSE，无真实服务器）
        runBlocking { graph.serverRepository.addAndActivate("t6", "http://127.0.0.1:1", "k") }
    }

    @After
    fun teardown() {
        graph.shutdownForTest()   // 先停 graph 后台协程再关库——防关库后仍触 Room 的收尾竞态
        db.close()
        prefsScope.cancel()
        prefsTmp.delete()
        Dispatchers.resetMain()
    }

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

    // ---- sticky 滚动显隐门（Task7 审查回补：唯一有状态新行为，须经 AnimatedVisibility 门断言）----

    /** sticky 显隐门夹具：网格 + ScrollAwareStickyDate 按 PhotosScreen 生产装配叠放（200dp 视口）。 */
    @androidx.compose.runtime.Composable
    private fun StickyFixture(gridState: LazyGridState, onScope: (CoroutineScope) -> Unit) {
        onScope(rememberCoroutineScope())
        // 流实例须 remember：防意外重组新建流重置网格（同锚定用例的豁口注释）
        val flow = remember {
            flowOf(
                PagingData.from(
                    listOf<TimelineItem>(
                        TimelineItem.Header("2026-07-03", "2026年7月3日"),
                        TimelineItem.Photo(image(1, "2026-07-03T00:00:00.000Z")),
                    ),
                ),
            )
        }
        val items = flow.collectAsLazyPagingItems()
        Box(Modifier.size(200.dp)) {
            PhotosGrid(items = items, columns = 4, state = gridState, photoCell = stubCell)
            ScrollAwareStickyDate(
                gridState = gridState,
                label = "2026年7月3日",
                modifier = Modifier.align(Alignment.TopStart),
            )
        }
    }

    /**
     * 开一段受控滚动会话：composition 作用域内 launch gridState.scroll 挂在 gate 上——
     * isScrollInProgress 保持 true 直到放行 gate。比触摸手势免 slop/fling 时序噪声，
     * 配合 mainClock 虚拟时间可精确排布 500ms 显隐计时（CompletableDeferred 门控为
     * SyncSchedulerTest 同款惯例）。
     */
    private fun startScrollSession(scope: CoroutineScope, gridState: LazyGridState): CompletableDeferred<Unit> {
        val gate = CompletableDeferred<Unit>()
        compose.runOnIdle { scope.launch { gridState.scroll { gate.await() } } }
        compose.waitForIdle()
        return gate
    }

    /** 结束滚动会话（isScrollInProgress → false），等隐藏计时挂起就绪后返回。 */
    private fun endScrollSession(gate: CompletableDeferred<Unit>) {
        compose.runOnIdle { gate.complete(Unit) }
        compose.waitForIdle()
    }

    @Test
    fun `sticky 显隐门——静止不显示_滚动中显示_停止500ms后隐藏`() {
        val gridState = LazyGridState()
        lateinit var scope: CoroutineScope
        compose.setContent { StickyFixture(gridState) { scope = it } }
        compose.waitForIdle()

        // 静止：label 非空也不得浮现——AnimatedVisibility 显隐门生效（门被删除/visible 写反在此变红）
        compose.onNodeWithTag("sticky_date").assertDoesNotExist()

        // 滚动中：浮现
        val gate = startScrollSession(scope, gridState)
        compose.onNodeWithTag("sticky_date").assertIsDisplayed()

        // 停止滚动：500ms 计时内仍显示……
        endScrollSession(gate)
        compose.onNodeWithTag("sticky_date").assertIsDisplayed()
        compose.mainClock.advanceTimeBy(400)
        compose.onNodeWithTag("sticky_date").assertIsDisplayed()
        // ……越过 500ms 计时触发隐藏，淡出动画走完后消失
        compose.mainClock.advanceTimeBy(200)
        compose.waitForIdle()
        compose.onNodeWithTag("sticky_date").assertDoesNotExist()
    }

    @Test
    fun `sticky 停止后500ms内重新滚动——挂起中的隐藏被取消（collectLatest 语义）`() {
        val gridState = LazyGridState()
        lateinit var scope: CoroutineScope
        compose.setContent { StickyFixture(gridState) { scope = it } }
        compose.waitForIdle()

        // 脉冲 #1：滚动浮现，停止（记 t≈0）挂起 500ms 隐藏计时
        endScrollSession(startScrollSession(scope, gridState))
        compose.onNodeWithTag("sticky_date").assertIsDisplayed()

        // t≈300ms 重新滚动、t≈430ms 再停止：应取消旧计时并以第二次停止重开（新期限 t≈930ms）
        compose.mainClock.advanceTimeBy(300)
        val gate2 = startScrollSession(scope, gridState)
        compose.mainClock.advanceTimeBy(130)
        endScrollSession(gate2)

        // t≈800ms：已越过首次停止的 500ms 原期限。误改 collect（c5050e1 同族缺陷）时旧计时
        // 不可取消——t≈500ms 即隐藏、且挂起期间的重滚动被 snapshotFlow 终值重读吞掉不回显，
        // 退场动画至 t≈700ms 落幕后节点消失；正确实现此刻必须仍完整可见。
        compose.mainClock.advanceTimeBy(370)
        compose.onNodeWithTag("sticky_date").assertIsDisplayed()

        // 第二次停止的 500ms 期限过后照常隐藏
        compose.mainClock.advanceTimeBy(200)
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

    // ---- v0.6 T6：「⋯」选项面板（排序/密度/设置，spec §3.1）----

    /** 挂真 PhotosScreen：等 activeServer 的 Room 首发射穿过引导门、常态顶栏落定后返回。 */
    private fun setPhotosScreen(vm: PhotosViewModel, onOpenSettings: () -> Unit = {}) {
        compose.setContent {
            PhotosScreen(
                viewModel = vm,
                barsState = PhotosSelectionBars(),
                onAddServer = {},
                onOpenViewer = {},
                onOpenSearch = {},
                onOpenSettings = onOpenSettings,
            )
        }
        // activeServer 经 Room 后台 executor 首发射，waitForIdle 不追踪它 → waitUntil 轮询顶栏落定
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("photos_more").fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun `更多面板_切排序即生效并收面板_设置行触发回调`() {
        var settingsOpened = 0
        val vm = PhotosViewModel(graph)
        setPhotosScreen(vm, onOpenSettings = { settingsOpened++ })
        compose.onNodeWithTag("photos_more").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("options_sheet").assertIsDisplayed()
        compose.onNodeWithTag("sort_option_size").performClick()
        compose.waitForIdle()
        assertEquals(PhotoSort.SIZE_DESC, graph.viewPrefs.photoSort.value)
        compose.onNodeWithTag("options_sheet").assertDoesNotExist()   // 选择即收
        compose.onNodeWithTag("photos_more").performClick()
        compose.waitForIdle()
        // Robolectric 默认 470dp 矮屏放不下整面板：先滚到尾部行再点（面板列可滚动，真机同语义）
        compose.onNodeWithTag("sheet_settings_row").performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(1, settingsOpened)
    }

    @Test
    fun `更多面板_密度行走 changeTier 档位即时切换`() {
        val vm = PhotosViewModel(graph)
        setPhotosScreen(vm)
        compose.onNodeWithTag("photos_more").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("density_option_day3").performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(DensityTier.DAY_3, vm.densityTier.value)
    }
}
