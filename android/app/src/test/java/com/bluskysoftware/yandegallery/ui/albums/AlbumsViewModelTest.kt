package com.bluskysoftware.yandegallery.ui.albums

import com.bluskysoftware.yandegallery.awaitValue
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class AlbumsViewModelTest {
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    @Before
    fun setup() {
        // sections 改 stateIn(viewModelScope,…) 后收集器跑在 Dispatchers.Main 上；换 Unconfined 让
        // WhileSubscribed 收集器随 Room 发射即时追平（否则 turbine 只看到初始哨兵）。
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db)
    }

    @After
    fun teardown() {
        graph.shutdownForTest()   // 先停 graph 后台协程再关库——防关库后仍触 Room 的收尾竞态
        db.close()
        Dispatchers.resetMain()
    }

    private fun image(id: Long, createdAt: String) = ImageEntity(
        id = id, filename = "$id.jpg", width = 100, height = 100,
        fileSize = 1, format = "jpg", createdAt = createdAt, updatedAt = createdAt,
    )

    /**
     * 种子写入必须在订阅 Turbine 之前全部完成——T5 报告记录的 Room-Flow 时序坑：
     * 若订阅横跨多次独立写入，后台失效轮询可能先对某次写入的失效信号发一次过渡态查询，
     * 断言拿到的不是最终态。这里不测试"活体推送"，只测试稳定后的首发射，因此先写后订阅是安全的。
     */
    @Test
    fun `sections 加载中哨兵为 null`() = runTest {
        // 无种子：stateIn 初始值即加载中哨兵 null（AlbumsScreen 据此在 DB 首发射前不显空态，A7）。
        val viewModel = AlbumsViewModel(graph)
        assertNull("sections 初始应为加载中哨兵 null", viewModel.sections.value)
    }

    @Test
    fun `sections 首发射两卡片入普通分区，null 封面取相册内最新图`() = runTest {
        db.galleryDao().replaceAll(
            listOf(
                GalleryEntity(id = 1, name = "a-has-cover", coverImageId = 10, imageCount = 1),
                GalleryEntity(id = 2, name = "b-null-cover", coverImageId = null, imageCount = 2),
            ),
        )
        db.imageDao().upsertAll(
            listOf(
                image(10, "2026-01-01T00:00:00.000Z"),
                image(20, "2026-01-01T00:00:00.000Z"),
                image(21, "2026-01-03T00:00:00.000Z"),
            ),
        )
        db.imageDao().replaceGalleryLinks(10, listOf(1))
        db.imageDao().replaceGalleryLinks(20, listOf(2))
        db.imageDao().replaceGalleryLinks(21, listOf(2))

        val viewModel = AlbumsViewModel(graph)
        viewModel.sections.test {
            // 首帧加载中哨兵 null，DB 发射后翻非空分区
            assertNull("sections 首帧应为加载中哨兵 null", awaitItem())
            var sections = awaitItem()
            while (sections == null || sections.isEmpty) sections = awaitItem()
            // 无组织偏好：全部落普通分区
            val cards = sections.normal
            assertEquals(2, cards.size)
            assertEquals(0, sections.pinned.size)
            assertEquals(0, sections.other.size)

            val cardWithCover = cards.first { it.gallery.id == 1L }
            assertEquals(10L, cardWithCover.coverImageId)

            val cardWithFallback = cards.first { it.gallery.id == 2L }
            // 相册 2 的成员图里 21 的 createdAt 最新——observeAlbumCards 的相关子查询兜底应取它。
            assertEquals(21L, cardWithFallback.coverImageId)
        }
    }

    @Test
    fun `setPinned与setInOther写入album_prefs并互斥`() = runTest {
        db.galleryDao().replaceAll(listOf(GalleryEntity(1, "a", null, 0)))
        val viewModel = AlbumsViewModel(graph)

        viewModel.setPinned(1, true)
        // 组织写经 viewModelScope 落到 Room 真实执行器线程；advanceUntilIdle 只推虚拟时钟不等
        // 真实线程（SearchViewModelTest 同坑）——用 observeAll().first{谓词} 挂起等目标态，确定性等价。
        awaitValue({ db.albumPrefsDao().observeAll().first() }) { rows -> rows.any { it.galleryId == 1L && it.pinned } }
        assertTrue(db.albumPrefsDao().byId(1)!!.pinned)

        viewModel.setInOther(1, true)
        awaitValue({ db.albumPrefsDao().observeAll().first() }) { rows -> rows.any { it.galleryId == 1L && it.inOther } }
        val row = db.albumPrefsDao().byId(1)!!
        assertTrue(row.inOther)
        assertFalse(row.pinned)   // 互斥由 DAO 事务保证
    }
}
