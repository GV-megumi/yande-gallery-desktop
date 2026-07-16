package com.bluskysoftware.yandegallery.ui.device

import android.net.Uri
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.paging.testing.asSnapshot
import com.bluskysoftware.yandegallery.awaitValue
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
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
 * [DeviceAlbumDetailViewModel] 契约测试（Task 6，spec §2.2/§4.2）：bucketKey 解码回退、Bucket
 * 上下文标题/张数取值、observeChanges 脉冲触发当前 PagingSource 失效。分页断言走官方
 * paging-testing 的 asSnapshot（AlbumDetailViewModel 同类分页测试暂无先例可仿，直接用测试库
 * 驱动 Pager 首次落地 PagingSource 即可，不需要真的滚动分页）。批量操作契约在
 * DeviceActionsTest（Task 7），本文件维持 Task 6 覆盖面；prefsStore 随 VM 构造参数新增入装置
 * （临时文件真实读写，DeviceAlbumsViewModelTest 同款）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class DeviceAlbumDetailViewModelTest {
    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("device_detail_vm_test", ".preferences_pb").also { it.delete() }
    private val prefsStore = PrefsStore(PreferenceDataStoreFactory.create(scope = prefsScope) { prefsTmp })
    private val gateway = FakeDeviceGateway()

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
        prefsScope.cancel()
        prefsTmp.delete()
    }

    private fun realAlbum(id: Long, name: String, count: Int) = DeviceAlbum(
        key = BucketKey.Bucket(id),
        name = name,
        relativePath = "DCIM/$name/",
        count = count,
        coverUri = null,
        isPending = false,
    )

    private fun media(id: Long) = DeviceMedia(
        mediaId = id,
        uri = Uri.parse("content://media/external/images/media/$id"),
        isVideo = false,
        displayName = "img$id.jpg",
        relativePath = "DCIM/Camera/",
        width = 100,
        height = 100,
        sizeBytes = 1_000,
        takenAtMs = id,
        durationMs = null,
    )

    @Test
    fun `bucketKey解码_Bucket上下文标题取相册名`() = runTest {
        gateway.albums = listOf(realAlbum(5, "Camera", 3))
        val vm = DeviceAlbumDetailViewModel(gateway, prefsStore, BucketKey.Bucket(5).encode())
        assertEquals(BucketKey.Bucket(5), vm.bucketKey)
        assertEquals("Camera", awaitValue({ vm.title.value }) { it == "Camera" })
        assertEquals(3, awaitValue({ vm.count.value }) { it == 3 })
    }

    @Test
    fun `decode失败回退All`() = runTest {
        val vm = DeviceAlbumDetailViewModel(gateway, prefsStore, "garbage-raw-key")
        assertEquals(BucketKey.All, vm.bucketKey)
        assertEquals("全部照片", vm.title.value)
    }

    @Test
    fun `observeChanges脉冲触发invalidate`() = runTest {
        gateway.media = listOf(media(1), media(2))
        val vm = DeviceAlbumDetailViewModel(gateway, prefsStore, BucketKey.All.encode())

        // 驱动 Pager 首次调用 pagingSourceFactory，落地第一代 PagingSource
        vm.media.asSnapshot { }
        val firstSource = gateway.createdPagingSources.last()
        assertTrue(!firstSource.invalid)

        gateway.changes.tryEmit(Unit)

        assertTrue(awaitValue({ firstSource.invalid }) { it })
    }
}
