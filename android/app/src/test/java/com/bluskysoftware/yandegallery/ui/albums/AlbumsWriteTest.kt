package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.api.AddMembersDto
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.api.BatchDeleteItemDto
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.di.AppGraph
import com.bluskysoftware.yandegallery.domain.ConnectionMonitor
import com.bluskysoftware.yandegallery.domain.write.WriteApi
import com.bluskysoftware.yandegallery.domain.write.WriteRepository
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
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

/**
 * M3-T14: AlbumsViewModel 相册写操作——新建/重命名/删除对本地镜像的效果 + 失败上报。
 * Robolectric + :memory: Room，writeRepository 经构造缝注入（镜像 AlbumDetailViewModel gateway 模式）。
 * WriteRepository 的乐观镜像/回滚本体由 WriteRepositoryTest 覆盖，此处只验 VM 委托语义与镜像可见性。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class AlbumsWriteTest {
    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(ApplicationProvider.getApplicationContext(), dbOverride = db)
    }

    @After
    fun teardown() {
        // 先停 graph 后台协程（init 激活跟踪 + connectionMonitor 的 Room Flow 收集）再关库：
        // 否则收集器可能在 db.close() 后才取连接，偶发 connection pool has been closed，
        // 且被 kotlinx-coroutines-test 记到当时在跑的 runTest 头上（曾两次 flake 本类）。
        graph.shutdownForTest()
        db.close()
        Dispatchers.resetMain()
    }

    /** 最小 fake：相册三写方法可配置失败，createGallery 返回可配置服务端 id；其余空实现。 */
    private class FakeWriteApi : WriteApi {
        var nextGalleryId = 42L
        var failCreate: ApiException? = null
        var failRename: ApiException? = null
        var failDelete: ApiException? = null

        override suspend fun deleteImage(imageId: Long) {}
        override suspend fun batchDeleteImages(imageIds: List<Long>): List<BatchDeleteItemDto> = emptyList()
        override suspend fun addImageTags(imageId: Long, names: List<String>) {}
        override suspend fun removeImageTags(imageId: Long, names: List<String>) {}
        override suspend fun createGallery(name: String): Long {
            failCreate?.let { throw it }
            return nextGalleryId
        }
        override suspend fun renameGallery(galleryId: Long, name: String) {
            failRename?.let { throw it }
        }
        override suspend fun deleteGallery(galleryId: Long) {
            failDelete?.let { throw it }
        }
        override suspend fun addImagesToGallery(galleryId: Long, imageIds: List<Long>): AddMembersDto =
            AddMembersDto(added = imageIds.size, missingImageIds = emptyList())
        override suspend fun removeImagesFromGallery(galleryId: Long, imageIds: List<Long>): Int = imageIds.size
        override suspend fun setGalleryCover(galleryId: Long, coverImageId: Long) {}
    }

    private fun TestScope.vm(api: FakeWriteApi): AlbumsViewModel {
        val monitor = ConnectionMonitor(activeServerName = flowOf<String?>("srv"), scope = backgroundScope)
        val repo = WriteRepository(api, db, monitor) { }
        return AlbumsViewModel(graph, writeRepository = repo)
    }

    @Test
    fun `新建相册成功——镜像 galleries 出现新行`() = runTest {
        val viewModel = vm(FakeWriteApi().apply { nextGalleryId = 7 })

        val result = viewModel.createGallery("旅行")

        assertEquals(WriteResult.Success, result)
        val row = db.galleryDao().byId(7)
        assertNotNull("新建后镜像应出现该相册行", row)
        assertEquals("旅行", row!!.name)
    }

    @Test
    fun `重命名相册成功——镜像该行名字更新`() = runTest {
        db.galleryDao().insertOne(GalleryEntity(3, "旧名", null, 0))
        val viewModel = vm(FakeWriteApi())

        val result = viewModel.renameGallery(3, "新名")

        assertEquals(WriteResult.Success, result)
        assertEquals("新名", db.galleryDao().byId(3)!!.name)
    }

    @Test
    fun `删除相册成功——镜像该行消失`() = runTest {
        db.galleryDao().insertOne(GalleryEntity(3, "待删", null, 0))
        val viewModel = vm(FakeWriteApi())

        val result = viewModel.deleteGallery(3)

        assertEquals(WriteResult.Success, result)
        assertNull("删除后镜像应无该相册行", db.galleryDao().byId(3))
    }

    @Test
    fun `新建相册失败——返回 Failed 且镜像不新增行`() = runTest {
        val viewModel = vm(FakeWriteApi().apply {
            nextGalleryId = 7
            failCreate = ApiException("INTERNAL_ERROR", "boom", 500)
        })

        val result = viewModel.createGallery("旅行")

        assertTrue(result is WriteResult.Failed)
        assertNull("失败时不应写入镜像", db.galleryDao().byId(7))
    }

    @Test
    fun `重命名失败——返回 Failed 且镜像名字回滚`() = runTest {
        db.galleryDao().insertOne(GalleryEntity(3, "旧名", null, 0))
        val viewModel = vm(FakeWriteApi().apply {
            failRename = ApiException("INTERNAL_ERROR", "boom", 500)
        })

        val result = viewModel.renameGallery(3, "新名")

        assertTrue(result is WriteResult.Failed)
        assertEquals("失败后应回滚为旧名", "旧名", db.galleryDao().byId(3)!!.name)
    }

    @Test
    fun `401 失败——Failed 携带 unauthorized 供重新配对提示`() = runTest {
        val viewModel = vm(FakeWriteApi().apply {
            failCreate = ApiException("UNAUTHORIZED", "unauthorized", 401)
        })

        val result = viewModel.createGallery("旅行")

        assertTrue(result is WriteResult.Failed)
        assertTrue((result as WriteResult.Failed).unauthorized)
    }

    // ---- 对话框冒烟（无状态可测组件，无 AsyncImage/graph 依赖）----

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `重命名对话框预填当前名`() {
        compose.setContent {
            AlbumNameDialog(
                title = "重命名相册",
                name = "旧名",
                onNameChange = {},
                confirmLabel = "保存",
                confirmTag = "album_rename_confirm",
                onConfirm = {},
                onDismiss = {},
            )
        }
        compose.onNodeWithText("旧名").assertIsDisplayed()   // 预填即对话框显示传入名
    }

    @Test
    fun `名字对话框空名时确认禁用`() {
        compose.setContent {
            AlbumNameDialog(
                title = "新建相册",
                name = "   ",
                onNameChange = {},
                confirmLabel = "创建",
                confirmTag = "album_new_confirm",
                onConfirm = {},
                onDismiss = {},
            )
        }
        compose.onNodeWithTag("album_new_confirm").assertIsNotEnabled()
    }

    @Test
    fun `删除确认说明不删图片文件`() {
        compose.setContent {
            DeleteAlbumConfirmDialog(albumName = "旅行", onConfirm = {}, onDismiss = {})
        }
        // brief 契约：二次确认须明示只删相册、不删图片文件
        compose.onNodeWithText("不删除其中的图片文件", substring = true).assertIsDisplayed()
    }

    @Test
    fun `离线点顶栏加号出 snackbar 且不弹新建对话框`() {
        graph.connectionMonitor.reportNetworkLost()   // 压离线（online=false）
        val vm = AlbumsViewModel(graph)
        compose.setContent {
            val nav = rememberNavController()
            AlbumsScreen(viewModel = vm, navController = nav)
        }
        compose.waitForIdle()

        compose.onNodeWithTag("albums_new").performClick()
        compose.waitForIdle()

        // D12A：离线点击给明确原因，不进入新建对话框（替换静默空转）
        compose.onNodeWithText("离线状态无法新建相册").assertIsDisplayed()
        compose.onNodeWithTag("album_new_confirm").assertDoesNotExist()
    }
}
