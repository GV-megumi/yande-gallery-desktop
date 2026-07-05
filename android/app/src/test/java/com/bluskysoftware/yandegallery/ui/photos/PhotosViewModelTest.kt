package com.bluskysoftware.yandegallery.ui.photos

import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * M3-T13: PhotosViewModel 多选守卫——切换激活服务器后清空选择（镜像全量重建，旧 id 可能撞新服同号图）。
 * 批量动作本体见 SelectionActionsTest。autoSyncOnActiveChange=false 关掉切服自动同步/SSE（无真实服务器）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class PhotosViewModelTest {
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(
            ApplicationProvider.getApplicationContext(),
            dbOverride = db,
            autoSyncOnActiveChange = false,
        )
    }

    @After
    fun teardown() {
        db.close()
        Dispatchers.resetMain()
    }

    @Test
    fun `切换激活服务器——多选清空`() = runTest {
        graph.serverRepository.addAndActivate("a", "http://a", "k")
        val vm = PhotosViewModel(graph)
        vm.selection.selectAll(listOf(1, 2))

        graph.serverRepository.addAndActivate("b", "http://b", "k")

        vm.selection.selectedFlow.test {
            var cur = awaitItem()
            while (cur.isNotEmpty()) cur = awaitItem()
            assertTrue(cur.isEmpty())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `冷启动已有激活服务器——首个发射不误清选择`() = runTest {
        graph.serverRepository.addAndActivate("a", "http://a", "k")
        val vm = PhotosViewModel(graph)

        vm.selection.selectAll(listOf(1, 2))
        advanceUntilIdle()   // 让 init 收集器消化首个（当前）发射——drop(1) 应跳过

        assertEquals(setOf(1L, 2L), vm.selection.selected)
    }
}
