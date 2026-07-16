package com.bluskysoftware.yandegallery.ui.device

import android.net.Uri
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import app.cash.turbine.test
import com.bluskysoftware.yandegallery.awaitValue
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceAccessLevel
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
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
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * [DeviceAlbumsViewModel] 契约测试（Task 5，spec §4.3/§5.5）：全部照片聚合卡置首位、
 * 待落地相册的新建/收编、DENIED 清空列表、重名拒绝。DataStore 用临时文件真实读写（非
 * mock），沿用 PrefsStoreDeviceTest 装置；`.test{}` 全程单一订阅者，不触发 TestAwait.kt
 * 文档记载的“新订阅者错过已发通知”竞态，仅收尾处对 DataStore 落盘的最终态用 awaitValue
 * 兜底（真 first() 新订阅）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class DeviceAlbumsViewModelTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val file = File.createTempFile("device_albums_vm_test", ".preferences_pb").also { it.delete() }
    private val prefsStore = PrefsStore(PreferenceDataStoreFactory.create(scope = scope) { file })
    private val gateway = FakeDeviceGateway()

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
        scope.cancel()
        file.delete()
    }

    private fun realAlbum(id: Long, name: String, count: Int, cover: Uri? = null) = DeviceAlbum(
        key = BucketKey.Bucket(id),
        name = name,
        relativePath = "DCIM/$name/",
        count = count,
        coverUri = cover,
        isPending = false,
    )

    @Test
    fun `全部照片聚合卡置首位_计数为总和`() = runTest {
        gateway.albums = listOf(
            realAlbum(1, "Camera", 5, Uri.parse("content://a/1")),
            realAlbum(2, "WeChat", 3),
        )
        val vm = DeviceAlbumsViewModel(gateway, prefsStore, MutableStateFlow(DeviceAccessLevel.FULL))
        vm.albums.test {
            var list = awaitItem()
            while (list.isEmpty()) list = awaitItem()
            assertEquals(BucketKey.All, list.first().key)
            assertEquals(8, list.first().count)
            assertEquals(Uri.parse("content://a/1"), list.first().coverUri)
        }
    }

    @Test
    fun `待落地相册合并显示_真实bucket出现同名即收编删记录`() = runTest {
        val vm = DeviceAlbumsViewModel(gateway, prefsStore, MutableStateFlow(DeviceAccessLevel.FULL))
        vm.albums.test {
            var list = awaitItem()
            while (list.size != 1) list = awaitItem()

            val error = vm.createPendingAlbum("旅行")
            assertNull(error)
            while (list.none { it.key == BucketKey.Pending("旅行") }) list = awaitItem()
            assertTrue(list.first { it.key == BucketKey.Pending("旅行") }.isPending)

            gateway.albums = listOf(realAlbum(9, "旅行", 4))
            gateway.changes.tryEmit(Unit)
            while (list.any { it.key == BucketKey.Pending("旅行") }) list = awaitItem()
            assertTrue(list.any { it.key == BucketKey.Bucket(9) && it.name == "旅行" })
        }
        // review Finding 3：awaitValue 超时也不抛，只返回末次读值——不包一层断言的话，DataStore
        // 键真被清掉这件事完全没人验证。改用同库既有 assertEquals(期望, awaitValue(...){...}) 惯例
        // （对照 M4DensityPrefsE2ETest/PhotosViewModelTest/AlbumDetailViewModelTest）。
        assertEquals(emptySet<String>(), awaitValue({ prefsStore.devicePendingAlbums.first() }) { it == emptySet<String>() })
    }

    @Test
    fun `queryAlbums抛异常时真实相册降级为空_仅剩聚合卡_不崩溃`() = runTest {
        // 权限收回竞态（review Finding 1）：MediaStoreDeviceGateway.queryAlbums 在权限会话中途被
        // 撤销时会抛 SecurityException——VM 必须接住降级（真实相册视为空），不能让异常穿透杀死
        // 整条 flow 链。buildAlbums 无条件补一张「全部照片」聚合卡（count=真实相册计数总和），
        // 因此降级后的落点不是空列表，而是仅剩这张 count=0 的聚合卡——不能照搬 DENIED 分支
        // 那种真空列表的断言（那条走的是 level 门控的另一条 return@mapLatest emptyList() 分支）。
        gateway.albums = listOf(realAlbum(1, "Camera", 5))
        val vm = DeviceAlbumsViewModel(gateway, prefsStore, MutableStateFlow(DeviceAccessLevel.FULL))
        vm.albums.test {
            var list = awaitItem()
            while (list.none { it.key == BucketKey.Bucket(1) }) list = awaitItem()
            assertTrue(list.any { it.key == BucketKey.Bucket(1) })

            gateway.queryError = SecurityException("permission revoked mid-session")
            gateway.changes.tryEmit(Unit)
            list = awaitItem()
            while (list.any { it.key == BucketKey.Bucket(1) }) list = awaitItem()
            assertEquals(listOf(BucketKey.All), list.map { it.key })
            assertEquals(0, list.first().count)
        }
    }

    @Test
    fun `DENIED时列表为空`() = runTest {
        gateway.albums = listOf(realAlbum(1, "Camera", 5))
        val level = MutableStateFlow(DeviceAccessLevel.FULL)
        val vm = DeviceAlbumsViewModel(gateway, prefsStore, level)
        vm.albums.test {
            var list = awaitItem()
            while (list.isEmpty()) list = awaitItem()
            assertTrue(list.isNotEmpty())

            level.value = DeviceAccessLevel.DENIED
            list = awaitItem()
            while (list.isNotEmpty()) list = awaitItem()
            assertEquals(emptyList<DeviceAlbum>(), list)
        }
    }

    @Test
    fun `新建重名拒绝返回文案`() = runTest {
        gateway.albums = listOf(realAlbum(1, "Camera", 5))
        val vm = DeviceAlbumsViewModel(gateway, prefsStore, MutableStateFlow(DeviceAccessLevel.FULL))
        vm.albums.test {
            var list = awaitItem()
            while (list.none { it.name == "Camera" }) list = awaitItem()
        }

        assertNotNull(vm.createPendingAlbum("Camera"))
        assertNull(vm.createPendingAlbum("旅行"))
    }
}
