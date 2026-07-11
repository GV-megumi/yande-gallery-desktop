package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
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
 * v0.6 T7：相册页组织能力 compose 契约——长按菜单组织项 / 置顶分区 / 「其他相册」折叠行 / 排序面板。
 * 装置沿用 AlbumsWriteTest 真件屏形态（真 VM + in-memory graph + rememberNavController 包 AlbumsScreen）；
 * 排序写走真 DataStore，临时文件独立实例隔离进程级单例（PhotosScreenTest 同款）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class AlbumsOrganizeTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("albums-organize-prefs", ".preferences_pb").also { it.delete() }

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

    private fun seedGalleries(vararg ids: Long) = runBlocking {
        db.galleryDao().replaceAll(ids.map { GalleryEntity(it, "album-$it", null, 0) })
    }

    /** 挂真 AlbumsScreen：sections 经 Room 后台 executor 首发射，waitUntil 轮询目标卡片落定。 */
    private fun setAlbumsScreen(waitCardId: Long) {
        val vm = AlbumsViewModel(graph)
        compose.setContent {
            AlbumsScreen(viewModel = vm, navController = rememberNavController())
        }
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("album_card_$waitCardId").fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun `长按菜单含组织项_置顶后出现置顶分区`() {
        seedGalleries(1)   // 种子：相册 1
        setAlbumsScreen(waitCardId = 1)
        compose.onNodeWithTag("album_card_1").performTouchInput { longClick() }
        compose.waitForIdle()
        compose.onNodeWithTag("album_menu_pin_1").assertIsDisplayed()
        compose.onNodeWithTag("album_menu_to_other_1").assertIsDisplayed()
        compose.onNodeWithTag("album_menu_pin_1").performClick()
        // 置顶写落 Room 真实执行器再回推 sections，waitForIdle 不追踪 → waitUntil 轮询分区头出现
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("albums_section_pinned").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("albums_section_pinned").assertIsDisplayed()
        // 再长按：置顶态菜单换「取消置顶」
        compose.onNodeWithTag("album_card_1").performTouchInput { longClick() }
        compose.waitForIdle()
        compose.onNodeWithTag("album_menu_unpin_1").assertIsDisplayed()
    }

    @Test
    fun `移入其他相册后主列表折叠行出现`() {
        seedGalleries(1, 2)   // 种子：相册 1、2
        setAlbumsScreen(waitCardId = 1)
        compose.onNodeWithTag("album_card_1").performTouchInput { longClick() }
        compose.waitForIdle()
        compose.onNodeWithTag("album_menu_to_other_1").performClick()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("other_albums_row").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("other_albums_row").assertIsDisplayed()
        compose.onNodeWithTag("album_card_1").assertDoesNotExist()   // 已收进其他相册，不在主网格
    }

    @Test
    fun `排序面板_点张数切COUNT_DESC`() {
        seedGalleries(1)
        setAlbumsScreen(waitCardId = 1)
        compose.onNodeWithTag("albums_more").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("album_sort_option_count").performClick()
        compose.waitForIdle()
        assertEquals(AlbumSort.COUNT_DESC, graph.viewPrefs.albumsSort.value)
    }
}
