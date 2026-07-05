package com.bluskysoftware.yandegallery.ui.search

import androidx.paging.testing.asSnapshot
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.db.TagEntity
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
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
 * SearchViewModel 单元测试（TDD）——Robolectric + :memory: Room，镜像 ViewerViewModelTest 装配。
 *
 * debounce(200) 依赖虚拟时钟：Main 与 runTest 共用同一 [TestCoroutineScheduler]，
 * 用 UnconfinedTestDispatcher 让 Room 挂起点即时追平，又让 debounce 的 delay 走可推进的虚拟时间。
 * pagingFlow 的内容用 paging-testing 的 asSnapshot 取快照（refresh 完成即返回，确定性无真实 sleep）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class SearchViewModelTest {
    private val scheduler = TestCoroutineScheduler()
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph
    private lateinit var vm: SearchViewModel

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher(scheduler))
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db)
        vm = SearchViewModel(graph)
    }

    @After
    fun teardown() {
        graph.shutdownForTest()   // 先停 graph 后台协程再关库——防关库后仍触 Room 的收尾竞态
        db.close()
        Dispatchers.resetMain()
    }

    private fun image(id: Long, filename: String) = ImageEntity(
        id = id, filename = filename, width = 1, height = 1,
        fileSize = 1, format = "jpg",
        createdAt = "2026-01-0${id}T00:00:00.000Z",
        updatedAt = "2026-01-0${id}T00:00:00.000Z",
    )

    /** 种子：image1 landscape+orange、image3 landscape+person、image2 person（同 SearchQueryTest）。 */
    private suspend fun seed() {
        db.imageDao().upsertAll(
            listOf(
                image(1, "sunset.jpg"),
                image(2, "portrait.png"),
                image(3, "beach_sunset.jpg"),
            ),
        )
        db.tagDao().replaceAll(
            listOf(
                TagEntity(10, "landscape", null),
                TagEntity(11, "orange", null),
                TagEntity(12, "person", null),
            ),
        )
        db.imageDao().replaceTagLinks(1, listOf(10, 11))
        db.imageDao().replaceTagLinks(3, listOf(10, 12))
        db.imageDao().replaceTagLinks(2, listOf(12))
    }

    /** 越过 debounce 后对 pagingFlow 取快照的结果 id。 */
    private suspend fun resultIds(): List<Long> = vm.pagingFlow.asSnapshot { }.map { it.id }

    @Test
    fun `onQueryChange 即时更新 query`() = runTest(scheduler) {
        vm.onQueryChange("neko")
        assertEquals("neko", vm.query.value)
    }

    @Test
    fun `单关键词命中标签前缀`() = runTest(scheduler) {
        seed()
        vm.onQueryChange("land")
        // "land" 仅经 landscape 标签前缀命中 image1、image3
        assertEquals(setOf(1L, 3L), resultIds().toSet())
    }

    @Test
    fun `单关键词命中文件名`() = runTest(scheduler) {
        seed()
        vm.onQueryChange("portrait")
        // "portrait" 无同名标签，仅经文件名 LIKE 命中 image2
        assertEquals(listOf(2L), resultIds())
    }

    @Test
    fun `多关键词取交集`() = runTest(scheduler) {
        seed()
        vm.onQueryChange("landscape person")
        // 仅 image3 同时命中 landscape 与 person 两词
        assertEquals(listOf(3L), resultIds())
    }

    // 历史写入走 Room 真实执行器线程（suspend upsert/clear 挂到 transactionExecutor），
    // advanceUntilIdle 只推虚拟时钟、不等真实线程——曾在满负载下偶发 first() 抢先查到旧态。
    // 改为 first{ 谓词 }：挂起直到 Room 失效重查发射出目标态，确定性等价且断言不减弱。

    @Test
    fun `commitSearch 写入历史`() = runTest(scheduler) {
        vm.onQueryChange("sunset")
        vm.commitSearch()
        assertTrue("sunset" in vm.history.first { "sunset" in it })
    }

    @Test
    fun `clearHistory 清空历史`() = runTest(scheduler) {
        vm.onQueryChange("sunset")
        vm.commitSearch()
        assertTrue(vm.history.first { it.isNotEmpty() }.isNotEmpty())

        vm.clearHistory()
        assertTrue(vm.history.first { it.isEmpty() }.isEmpty())
    }
}
