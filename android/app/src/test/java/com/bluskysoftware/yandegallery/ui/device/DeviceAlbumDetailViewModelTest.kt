package com.bluskysoftware.yandegallery.ui.device

import android.net.Uri
import androidx.paging.testing.asSnapshot
import com.bluskysoftware.yandegallery.awaitValue
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
 * 驱动 Pager 首次落地 PagingSource 即可，不需要真的滚动分页）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class DeviceAlbumDetailViewModelTest {
    private val gateway = FakeDeviceGateway()

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
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
        val vm = DeviceAlbumDetailViewModel(gateway, BucketKey.Bucket(5).encode())
        assertEquals(BucketKey.Bucket(5), vm.bucketKey)
        assertEquals("Camera", awaitValue({ vm.title.value }) { it == "Camera" })
        assertEquals(3, awaitValue({ vm.count.value }) { it == 3 })
    }

    @Test
    fun `decode失败回退All`() = runTest {
        val vm = DeviceAlbumDetailViewModel(gateway, "garbage-raw-key")
        assertEquals(BucketKey.All, vm.bucketKey)
        assertEquals("全部照片", vm.title.value)
    }

    @Test
    fun `observeChanges脉冲触发invalidate`() = runTest {
        gateway.media = listOf(media(1), media(2))
        val vm = DeviceAlbumDetailViewModel(gateway, BucketKey.All.encode())

        // 驱动 Pager 首次调用 pagingSourceFactory，落地第一代 PagingSource
        vm.media.asSnapshot { }
        val firstSource = gateway.createdPagingSources.last()
        assertTrue(!firstSource.invalid)

        gateway.changes.tryEmit(Unit)

        assertTrue(awaitValue({ firstSource.invalid }) { it })
    }
}
