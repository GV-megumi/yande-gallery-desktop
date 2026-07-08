package com.bluskysoftware.yandegallery.ui.search

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * SearchScreen 无状态子件 Robolectric 冒烟：搜索历史区（无历史提示 / chip 回填 / 清空回调）。
 * 结果网格与 debounce 分页逻辑由 SearchViewModelTest 覆盖，此处只验交互接线，镜像 DetailPanelTest 装配。
 */
@RunWith(RobolectricTestRunner::class)
class SearchScreenTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `无历史时显示提示`() {
        compose.setContent {
            SearchHistory(history = emptyList(), onPick = {}, onClear = {})
        }
        compose.onNodeWithTag("search_empty_hint").assertIsDisplayed()
    }

    @Test
    fun `历史 chip 点击回填该词`() {
        var picked: String? = null
        compose.setContent {
            SearchHistory(history = listOf("neko", "sunset"), onPick = { picked = it }, onClear = {})
        }
        compose.onNodeWithTag("search_history_neko").assertIsDisplayed()
        compose.onNodeWithTag("search_history_neko").performClick()
        assertEquals("neko", picked)
    }

    @Test
    fun `清空按钮回调 onClear`() {
        var cleared = false
        compose.setContent {
            SearchHistory(history = listOf("neko"), onPick = {}, onClear = { cleared = true })
        }
        compose.onNodeWithTag("search_clear_history").performClick()
        assertTrue(cleared)
    }

    /**
     * D12A 旋转/进程重建守卫：预填 "cat" 进入 → 用户改词 "dog" → 模拟状态恢复重建 →
     * 查询仍为 "dog"（prefillConsumed 经 rememberSaveable 存活，不被 initialQuery 回冲）。
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `预填后改词 重建不被 initialQuery 回冲`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        val graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db)
        val vm = SearchViewModel(graph)
        try {
            val restorationTester = StateRestorationTester(compose)
            restorationTester.setContent {
                SearchScreen(viewModel = vm, onOpenViewer = {}, onBack = {}, initialQuery = "cat")
            }
            compose.waitForIdle()
            assertEquals("cat", vm.query.value)   // 预填生效

            vm.onQueryChange("dog")                // 用户改词
            compose.waitForIdle()

            restorationTester.emulateSavedInstanceStateRestore()
            compose.waitForIdle()

            assertEquals("dog", vm.query.value)    // 重建后不回冲为 cat
        } finally {
            graph.shutdownForTest()
            db.close()
            Dispatchers.resetMain()
        }
    }

    /**
     * 审查修复回归：清除按钮必须是真按钮（IconButton 提供最小 48dp 命中区 + Role.Button 语义）。
     * 裸 Icon.clickable 不套 minimumInteractiveComponentSize（命中区仅 20dp）且无 Role——
     * performClick 打精确坐标测不出命中区缩水，故用 Role 断言钉住按钮语义，点击走旧契约清空查询。
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `清除按钮具按钮语义且点击清空查询`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        val graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db)
        val vm = SearchViewModel(graph)
        try {
            compose.setContent {
                SearchScreen(viewModel = vm, onOpenViewer = {}, onBack = {})
            }
            vm.onQueryChange("neko")
            compose.waitForIdle()

            compose.onNodeWithTag("search_clear_query")
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
                .performClick()
            compose.waitForIdle()

            assertEquals("", vm.query.value)
        } finally {
            graph.shutdownForTest()
            db.close()
            Dispatchers.resetMain()
        }
    }

    /** BUG-16 回归：无激活服务器时输入词显示引导文案——serverId=0/baseUrl="" 兜底只会整屏破图。 */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `无激活服务器时输入词显示引导而非结果网格（BUG-16）`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        val graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db)
        val vm = SearchViewModel(graph)
        try {
            compose.setContent {
                SearchScreen(viewModel = vm, onOpenViewer = {}, onBack = {})
            }
            vm.onQueryChange("neko")
            compose.waitForIdle()

            compose.onNodeWithTag("search_no_server").assertIsDisplayed()
            compose.onNodeWithTag("search_grid").assertDoesNotExist()
        } finally {
            graph.shutdownForTest()
            db.close()
            Dispatchers.resetMain()
        }
    }
}
