package com.bluskysoftware.yandegallery.ui.photos

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.paging.testing.asSnapshot
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.sync.SyncPhase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.time.LocalDate

/**
 * PhotosViewModel 单元测试——Robolectric + :memory: Room + 临时文件 PrefsStore（隔离进程级 DataStore 单例）。
 *
 * M3-T13 多选守卫：切换激活服务器后清空选择（镜像全量重建，旧 id 可能撞新服同号图）。批量动作本体见
 * SelectionActionsTest。autoSyncOnActiveChange=false 关掉切服自动同步/SSE（无真实服务器）。
 * M4-T2 密度档：月/日分组由 densityTier.monthGrouping 驱动，档位经真 DataStore 回环持久。
 *
 * 档位切换走真 Dispatchers.IO 的 DataStore 回环：任何翻档用例都先 `densityTier.first { it == 目标 }` 等落定
 * 再 asSnapshot/断言，否则拿到旧档快照（critic 定准的确定性要求）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class PhotosViewModelTest {
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    // 密度档位走真 DataStore 文件（临时文件独立实例）：隔离每个用例、避开进程级单例状态泄漏。
    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("photos-vm-prefs", ".preferences_pb").also { it.delete() }

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

    // 跨月两张图：取月中正午（±14h 内本地月不变，月键/月文案与机器 TZ 解耦）。
    // timelinePagingSource 按 createdAt DESC 排序 → 快照头为 7 月在前、6 月在后。
    private fun image(id: Long, createdAt: String) = ImageEntity(
        id = id, filename = "img$id.jpg", width = 1, height = 1,
        fileSize = 1, format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    private suspend fun seedCrossMonth() {
        db.imageDao().upsertAll(
            listOf(
                image(1, "2026-06-15T12:00:00.000Z"),
                image(2, "2026-07-15T12:00:00.000Z"),
            ),
        )
    }

    private suspend fun headerDisplays(vm: PhotosViewModel): List<String> =
        vm.pagingFlow.asSnapshot { }
            .filterIsInstance<TimelineItem.Header>()
            .map { it.display }

    /** MIUI 日头文案含周X且随运行日期/时区变：期望经生产同函数（dayKeyOf→dayHeaderDisplayOf）拼装。 */
    private fun expectedDayHeaders(today: LocalDate = LocalDate.now()): List<String> = listOf(
        dayHeaderDisplayOf(dayKeyOf("2026-07-15T12:00:00.000Z"), today),
        dayHeaderDisplayOf(dayKeyOf("2026-06-15T12:00:00.000Z"), today),
    )

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

    @Test
    fun `activeServerResolved——DB 首发射后翻 true（无激活服务器亦然，resolved 不等于有服务器）`() = runTest {
        // 不种服务器：observeActive 首发射 null，但 resolved（map{true}）仍应翻 true——门控只判「DB 是否已答复」。
        val vm = PhotosViewModel(graph)
        vm.activeServerResolved.test {
            var resolved = awaitItem()
            while (!resolved) resolved = awaitItem()
            assertTrue("DB 首发射后 activeServerResolved 应为 true（即使无激活服务器）", resolved)
            cancelAndIgnoreRemainingEvents()
        }
        assertEquals("此用例无激活服务器：resolved=true 与「有服务器」无关", null, graph.serverRepository.activeServer())
    }

    @Test
    fun `refreshing 判据——增量对账转圈，FullSync 及 Idle Done 不转圈`() {
        // 下拉转圈只在无数字进度的增量/对账阶段；FullSync 有顶部数字进度条不叠加转圈（A8）。
        assertTrue(SyncPhase.Incremental.showsRefreshSpinner())
        assertTrue(SyncPhase.Reconciling.showsRefreshSpinner())
        assertFalse(SyncPhase.FullSync(0, 10).showsRefreshSpinner())
        assertFalse(SyncPhase.Idle.showsRefreshSpinner())
        assertFalse(SyncPhase.Done.showsRefreshSpinner())
        assertFalse(SyncPhase.Failed("x").showsRefreshSpinner())
    }

    @Test
    fun `月档分组头为月键`() = runTest {
        seedCrossMonth()
        val vm = PhotosViewModel(graph)
        vm.setDensityTier(DensityTier.MONTH)
        // 真 IO 回环：不等档位落定即取快照会拿到旧（日）分组，先 await MONTH 再断言（critic 定准）。
        vm.densityTier.first { it == DensityTier.MONTH }
        // MIUI 月头同年只显月/跨年带年：期望用与生产同函数拼，防跨年后脆断
        val today = LocalDate.now()
        assertEquals(
            listOf(monthHeaderDisplayOf("2026-07", today), monthHeaderDisplayOf("2026-06", today)),
            headerDisplays(vm),
        )
    }

    @Test
    fun `日档维持日分组`() = runTest {
        seedCrossMonth()
        val vm = PhotosViewModel(graph)
        // 默认 DAY_4（日分组）；prefs 为空 → densityTierName=null → fromName=DEFAULT。
        vm.densityTier.first { it == DensityTier.DAY_4 }
        assertEquals("日档分组头应为 MIUI 日头形态", expectedDayHeaders(), headerDisplays(vm))
    }

    // D2 可观测面：纯列数变化（默认 DAY_4 → DAY_3，monthGrouping 不翻）分组粒度须仍为「日」，不得误翻月。
    // 注：「不重建 Pager」的滚动保留优化由 pagingFlow 的 distinctUntilChanged(monthGrouping) 结构性保证
    // （标准 Paging 惯用法，开发中经 flatMapLatest 埋点实证：纯列数变化不再触发内层重建）；因 cachedIn 向
    // 被动收集者投递「世代」不确定，无法在本测试架构里对「重建次数」做确定断言，故此处只断言可观测的分组粒度。
    @Test
    fun `纯列数变化维持日分组不翻月`() = runTest {
        seedCrossMonth()
        val vm = PhotosViewModel(graph)
        vm.setDensityTier(DensityTier.DAY_3)
        vm.densityTier.first { it == DensityTier.DAY_3 }
        assertEquals("纯列数变化后仍应为日分组", expectedDayHeaders(), headerDisplays(vm))
    }

    @Test
    fun `photoSort 写穿 ViewPrefs 并异步落盘`() = runTest {
        // 装置：沿用本文件既有 AppGraph 构造（in-memory db + 临时 PrefsStore override）
        val vm = PhotosViewModel(graph)
        vm.setPhotoSort(PhotoSort.SIZE_DESC)
        assertEquals(PhotoSort.SIZE_DESC, graph.viewPrefs.photoSort.value)   // 共享实例即时可见（spec §3.4）
        // 落盘走 graph 真 IO scope（advanceUntilIdle 驱不动真 Dispatchers.IO）：
        // 按本文件档位持久化用例既有惯例 first{} 等值到位（写丢失时此处 runTest 超时红灯）
        assertEquals("SIZE_DESC", graph.prefsStore.photosSortName.first { it == "SIZE_DESC" })
    }

    @Test
    fun `档位持久化——冷启动第二个 VM 回放上次档位`() = runTest {
        val vm1 = PhotosViewModel(graph)
        vm1.setDensityTier(DensityTier.DAY_3)
        // BUG-18 后内存态即时生效、落盘异步：须等 DataStore 真正写完再建第二个 VM（其 init 只回填一次）
        graph.prefsStore.densityTierName.first { it == DensityTier.DAY_3.name }

        // 同 graph（同 DataStore）新建第二个 VM：首帧默认，init 回填持久档 DAY_3。
        val vm2 = PhotosViewModel(graph)
        assertEquals(DensityTier.DAY_3, vm2.densityTier.first { it != DensityTier.DEFAULT })
    }
}
