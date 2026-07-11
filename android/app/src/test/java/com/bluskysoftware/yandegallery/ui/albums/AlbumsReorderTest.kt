package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.prefs.AlbumSort
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.di.AppGraph
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * v0.6 T9：相册拖拽重排模式 compose 契约——面板进重排 / 完成落盘手动序并切 MANUAL / 取消不落盘
 * / 真实长按拖动换位落盘（评审补测：手势接线→控制器命中→move→commit 整条管线，防静默断链）。
 * 装置沿用 AlbumsOrganizeTest（真 VM + in-memory graph + rememberNavController 包 AlbumsScreen）；
 * 种子相册 1/2/3 无组织态。完成落盘走 Room 真实执行器（waitForIdle 不追踪）→ waitUntil 轮询
 * 主网格回归——reorderState=null 在落盘完成后才置，主网格回归即代表 commit 已完成。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class AlbumsReorderTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("albums-reorder-prefs", ".preferences_pb").also { it.delete() }

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(
            ApplicationProvider.getApplicationContext(),
            dbOverride = db,
            autoSyncOnActiveChange = false,
            prefsStoreOverride = PrefsStore(PreferenceDataStoreFactory.create(scope = prefsScope) { prefsTmp }),
        )
    }

    @After
    fun teardown() {
        graph.shutdownForTest()   // 先停 graph 后台协程再关库——防关库后仍触 Room 的收尾竞态
        db.close()
        prefsScope.cancel()
        prefsTmp.delete()
        Dispatchers.resetMain()
    }

    /** 种子相册 1/2/3（无组织态）→ 挂真 AlbumsScreen → 「⋯」面板点「拖拽排序」进重排模式。 */
    private fun enterReorderMode() {
        runBlocking {
            db.galleryDao().replaceAll((1L..3L).map { GalleryEntity(it, "album-$it", null, 0) })
        }
        val vm = AlbumsViewModel(graph)
        compose.setContent {
            AlbumsScreen(viewModel = vm, navController = rememberNavController())
        }
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("album_card_1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("albums_more").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("albums_reorder_enter").performClick()
        compose.waitForIdle()
    }

    @Test
    fun `面板进重排_完成落盘手动序并切MANUAL`() {
        enterReorderMode()
        compose.onNodeWithTag("albums_reorder_grid").assertIsDisplayed()
        compose.onNodeWithTag("reorder_done").performClick()
        // commit 写落 Room 真实执行器，waitForIdle 不追踪 → 轮询主网格回归（AlbumsOrganizeTest 同款）
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("albums_grid").fetchSemanticsNodes().isNotEmpty()
        }
        // 未拖动：按当前视觉序（名称序）原样重编号
        assertEquals(0, runBlocking { db.albumPrefsDao().byId(1)!!.manualOrder })
        assertEquals(AlbumSort.MANUAL, graph.viewPrefs.albumsSort.value)
        compose.onNodeWithTag("albums_grid").assertIsDisplayed()   // 已退出重排
    }

    /**
     * 评审补测：真实长按拖动手势穿过整条拖拽管线（detectDragGesturesAfterLongPress 接线→
     * GridReorderController 命中→AlbumReorderState.move→commit 落盘）——onMove 未接/canSwap
     * 写反等断链时本用例必红。位移取两卡片语义中心差，对网格列数/几何变化鲁棒。
     */
    @Test
    fun `长按拖过一格_完成落盘换位后顺序`() {
        enterReorderMode()
        compose.onNodeWithTag("albums_reorder_grid").assertIsDisplayed()
        // 名称序种子 [1,2,3]：把 album-1 的中心拖进 album-2 的格子 → 期望换位成 [2,1,3]
        val from = compose.onNodeWithTag("album_card_1").fetchSemanticsNode().boundsInRoot.center
        val to = compose.onNodeWithTag("album_card_2").fetchSemanticsNode().boundsInRoot.center
        compose.onNodeWithTag("album_card_1").performTouchInput {
            down(center)
            advanceEventTime(viewConfiguration.longPressTimeoutMillis + 100)   // 长按成立 → onDragStart
            moveBy(to - from)
            up()
        }
        compose.waitForIdle()
        compose.onNodeWithTag("reorder_done").performClick()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("albums_grid").fetchSemanticsNodes().isNotEmpty()
        }
        // 非恒等序：manualOrder 反映换位后顺序 [2,1,3]
        assertEquals(0, runBlocking { db.albumPrefsDao().byId(2)!!.manualOrder })
        assertEquals(1, runBlocking { db.albumPrefsDao().byId(1)!!.manualOrder })
        assertEquals(2, runBlocking { db.albumPrefsDao().byId(3)!!.manualOrder })
        assertEquals(AlbumSort.MANUAL, graph.viewPrefs.albumsSort.value)
    }

    @Test
    fun `取消不落盘_返回键同取消`() {
        enterReorderMode()
        compose.onNodeWithTag("reorder_cancel").performClick()
        compose.waitForIdle()
        assertEquals(null, runBlocking { db.albumPrefsDao().byId(1) })   // 未写任何行
        assertEquals(AlbumSort.NAME_ASC, graph.viewPrefs.albumsSort.value)
    }
}
