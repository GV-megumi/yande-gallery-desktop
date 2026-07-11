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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * v0.6 T8：「其他相册」二级页 compose 契约——收纳区列出 / 移出 / 清空自动返回（spec §4.6）。
 * 装置沿用 AlbumsOrganizeTest（真 VM + in-memory graph + rememberNavController 宿主）；
 * onBack 注入计数器验证「清空自动返回」。Room 写落真实执行器再回推 sections，
 * waitForIdle 不追踪 → waitUntil 轮询（AlbumsOrganizeTest 同款）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class OtherAlbumsScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph
    private var backCount = 0

    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("other-albums-prefs", ".preferences_pb").also { it.delete() }

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

    /** 挂真 OtherAlbumsScreen：onBack 只计数；[waitCardId] 非 null 时轮询等目标卡片落定。 */
    private fun setScreen(waitCardId: Long? = null) {
        val vm = AlbumsViewModel(graph)
        compose.setContent {
            OtherAlbumsScreen(viewModel = vm, navController = rememberNavController(), onBack = { backCount++ })
        }
        if (waitCardId != null) {
            compose.waitUntil(timeoutMillis = 5_000) {
                compose.onAllNodesWithTag("album_card_$waitCardId").fetchSemanticsNodes().isNotEmpty()
            }
        }
    }

    @Test
    fun `列出其他相册_移出后清空自动返回`() {
        // 种子：相册 1 置 inOther=true
        runBlocking {
            db.galleryDao().replaceAll(listOf(GalleryEntity(1, "album-1", null, 0)))
            db.albumPrefsDao().setInOther(1, inOther = true)
        }
        setScreen(waitCardId = 1)
        compose.onNodeWithTag("other_albums_grid").assertIsDisplayed()
        compose.onNodeWithTag("album_card_1").performTouchInput { longClick() }
        compose.waitForIdle()
        compose.onNodeWithTag("album_menu_from_other_1").performClick()
        // 移出写落 Room 后台执行器 → sections 清空 → LaunchedEffect 自动返回；轮询 backCount 落定
        compose.waitUntil(timeoutMillis = 5_000) { backCount >= 1 }
        assertEquals(false, runBlocking { db.albumPrefsDao().byId(1)!!.inOther })
        assertTrue(backCount >= 1)   // 清空 → 自动返回（spec §4.6）
    }

    @Test
    fun `进入时已空直接返回`() {
        // 种子：无任何 inOther 行
        setScreen()
        compose.waitUntil(timeoutMillis = 5_000) { backCount >= 1 }
        assertTrue(backCount >= 1)
    }
}
