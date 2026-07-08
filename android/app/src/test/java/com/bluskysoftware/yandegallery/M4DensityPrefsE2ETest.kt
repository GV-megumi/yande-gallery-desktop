package com.bluskysoftware.yandegallery

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.paging.testing.asSnapshot
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.ui.photos.DensityTier
import com.bluskysoftware.yandegallery.ui.photos.PhotosViewModel
import com.bluskysoftware.yandegallery.ui.photos.TimelineItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * M4 密度档端到端（T17）：真 DataStore 临时文件 + in-memory Room 经 AppGraph 走完整装配链——
 * PrefsStore 持久 → PhotosViewModel.densityTier（Eagerly stateIn）→ pagingFlow 月/日分组翻转。
 * 与 PhotosViewModelTest（VM 单测面）互补：这里跨 VM 实例断言「档位记忆」的持久层回环，
 * 以及切档对分页流分组粒度的端到端效果（D1/D3 验收锚点）。
 *
 * 调度器说明（critic 定准）：VM 的 Eagerly stateIn 挂 viewModelScope（Main.immediate）——
 * Robolectric paused looper 下不换 Main 调度器，densityTier 收集永不推进，first{} 死锁；
 * 必须 Dispatchers.setMain(UnconfinedTestDispatcher())。档位写入走真 Dispatchers.IO 的
 * DataStore 回环：任何断言前先 `densityTier.first { it == 目标 }` 等落定（T2 既定惯例）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class M4DensityPrefsE2ETest {

    @Before fun setUpMain() { Dispatchers.setMain(UnconfinedTestDispatcher()) }

    @After fun tearDownMain() { Dispatchers.resetMain() }

    /** 每用例独立装配：临时 DataStore 文件 + in-memory Room；收尾按仓内硬惯例 shutdownForTest → db.close。 */
    private suspend fun withGraph(block: suspend (AppGraph) -> Unit) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val tmp = File.createTempFile("e2e-prefs", ".preferences_pb").also { it.delete() }
        val prefs = PrefsStore(PreferenceDataStoreFactory.create(scope = scope) { tmp })
        val graph = AppGraph(
            context,
            dbOverride = AppDatabase.inMemory(context),
            autoSyncOnActiveChange = false,
            prefsStoreOverride = prefs,
        )
        try {
            block(graph)
        } finally {
            graph.shutdownForTest()
            graph.db.close()
            scope.cancel()
            tmp.delete()
        }
    }

    // 跨月两张图：取月中正午（±14h 内本地月不变，月键/月文案与机器 TZ 解耦）；
    // timelinePagingSource 按 createdAt DESC → 快照头为 7 月在前、6 月在后。
    private fun image(id: Long, createdAt: String) = ImageEntity(
        id = id, filename = "img$id.jpg", width = 1, height = 1,
        fileSize = 1, format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    private suspend fun headerDisplays(vm: PhotosViewModel): List<String> =
        vm.pagingFlow.asSnapshot { }
            .filterIsInstance<TimelineItem.Header>()
            .map { it.display }

    /**
     * 切档后等新世代落地：cachedIn 对新收集者先重放缓存的旧世代（多播异步窗口），单次 asSnapshot
     * 可能拿到翻档前分组——与 first{} 同语义「等到为止」，轮询直至条件世代可观测（上限 ~5s，超时
     * 返回末次结果交由断言报错）。管线最终一致由 flatMapLatest(monthGrouping) 结构保证。
     */
    private suspend fun awaitHeaderDisplays(
        vm: PhotosViewModel,
        predicate: (List<String>) -> Boolean,
    ): List<String> {
        var last: List<String> = emptyList()
        repeat(200) {
            last = headerDisplays(vm)
            if (predicate(last)) return last
            withContext(Dispatchers.Default) { delay(25) }   // 真实等待（Default 跳出 runTest 虚拟时间）
        }
        return last
    }

    @Test
    fun `档位记忆端到端：VM 设档 → 新 VM 读回持久档`() = runTest {
        withGraph { graph ->
            val vm1 = PhotosViewModel(graph)
            vm1.setDensityTier(DensityTier.DAY_3)
            // BUG-18 后内存态即时、落盘异步：等 DataStore 真 IO 写完再建新 VM（其 init 只回填一次持久档）
            graph.prefsStore.densityTierName.first { it == DensityTier.DAY_3.name }
            val vm2 = PhotosViewModel(graph)                    // 新实例（模拟重启读持久层）
            assertEquals(DensityTier.DAY_3, vm2.densityTier.first { it == DensityTier.DAY_3 })
        }
    }

    @Test
    fun `档位切换端到端：月档分页流出月分组头，切回日档恢复日分组`() = runTest {
        withGraph { graph ->
            graph.db.imageDao().upsertAll(
                listOf(
                    image(1, "2026-06-15T12:00:00.000Z"),
                    image(2, "2026-07-15T12:00:00.000Z"),
                ),
            )
            val vm = PhotosViewModel(graph)
            vm.setDensityTier(DensityTier.MONTH)
            vm.densityTier.first { it == DensityTier.MONTH }   // 先等档位落定再取快照（否则拿旧分组）
            assertEquals(listOf("2026年7月", "2026年6月"), headerDisplays(vm))

            vm.setDensityTier(DensityTier.DAY_4)
            vm.densityTier.first { it == DensityTier.DAY_4 }
            // 日头文案含本地时区日（TZ 相关不断言具体日），只断言分组粒度回到「日」
            val displays = awaitHeaderDisplays(vm) { it.size == 2 && it.all { d -> d.endsWith("日") } }
            assertEquals(2, displays.size)
            assertTrue("切回日档后分组头应为「…月…日」形态：$displays", displays.all { it.endsWith("日") })
        }
    }
}
