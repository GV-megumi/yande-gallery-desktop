package com.bluskysoftware.yandegallery.ui.device

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.paging.testing.asSnapshot
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.awaitValue
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import com.bluskysoftware.yandegallery.data.device.DeviceSource
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
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
 * [DeviceViewerViewModel] 契约测试（Task 8，spec §2.3）：初始定位 id/bucketKey 透传与解码兜底、
 * copyTo 对网关的源/路径委托与待落地占位吸收、单张操作 uri 单项包装、albumTargets 只含可写
 * 路径目标、observeChanges 脉冲失效当前 PagingSource（删除后 Pager 自然收缩的根基）。
 * 装置沿用 DeviceAlbumDetailViewModelTest（临时文件 PrefsStore + FakeDeviceGateway）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class DeviceViewerViewModelTest {
    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("device_viewer_vm_test", ".preferences_pb").also { it.delete() }
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

    private fun realAlbum(id: Long, name: String, path: String) = DeviceAlbum(
        key = BucketKey.Bucket(id),
        name = name,
        relativePath = path,
        count = 3,
        coverUri = null,
        isPending = false,
    )

    private fun vm(initialId: Long = 1L, raw: String = BucketKey.All.encode()) =
        DeviceViewerViewModel(gateway, prefsStore, initialId, raw)

    /** Robolectric 下可构造的占位 PendingIntent（DeviceActionsTest 同款装置）。 */
    private fun placeholderPendingIntent(): PendingIntent = PendingIntent.getActivity(
        ApplicationProvider.getApplicationContext(),
        0,
        Intent(),
        PendingIntent.FLAG_IMMUTABLE,
    )

    @Test
    fun `初始定位id透传_解码失败回退All`() = runTest {
        val vm = DeviceViewerViewModel(gateway, prefsStore, 42L, BucketKey.Bucket(5).encode())
        assertEquals(42L, vm.initialMediaId)
        assertEquals(BucketKey.Bucket(5), vm.bucketKey)
        assertEquals(BucketKey.All, DeviceViewerViewModel(gateway, prefsStore, 7L, "garbage-raw").bucketKey)
    }

    @Test
    fun `copyTo委托网关_源与路径正确`() = runTest {
        val m = media(1)
        gateway.media = listOf(m)
        gateway.insertCopyHandler = { _, _ -> Result.success(Uri.parse("content://media/external/images/media/91")) }

        assertTrue(vm().copyTo(m, "Pictures/旅行/"))

        assertEquals(1, gateway.insertCopyCalls.size)
        assertEquals(DeviceSource.Media(m), gateway.insertCopyCalls.single().first)
        assertEquals("Pictures/旅行/", gateway.insertCopyCalls.single().second)
    }

    @Test
    fun `copyTo成功清待落地占位名`() = runTest {
        prefsStore.addPendingAlbum("旅行")
        val m = media(1)
        gateway.media = listOf(m)
        gateway.insertCopyHandler = { _, _ -> Result.success(Uri.parse("content://media/external/images/media/91")) }

        vm().copyTo(m, "Pictures/旅行/")

        // review Finding 3 同款口径：awaitValue 超时不抛，必须外包一层断言
        assertEquals(
            emptySet<String>(),
            awaitValue({ prefsStore.devicePendingAlbums.first() }) { it.isEmpty() },
        )
    }

    @Test
    fun `单张操作uri单项包装_moveTo路径透传`() = runTest {
        val m = media(1)
        gateway.deleteRequestResult = placeholderPendingIntent()
        gateway.writeRequestResult = placeholderPendingIntent()
        gateway.moveToResult = Result.success(1)
        val vm = vm()

        vm.deleteRequest(m)
        vm.moveWriteRequest(m)
        assertTrue(vm.moveTo(m, "DCIM/Camera/"))

        assertEquals(listOf(listOf(m.uri)), gateway.deleteRequestCalls.toList())
        assertEquals(listOf(listOf(m.uri)), gateway.writeRequestCalls.toList())
        assertEquals(listOf(m.uri) to "DCIM/Camera/", gateway.moveToCalls.single())
    }

    @Test
    fun `albumTargets只含可写路径相册与待落地`() = runTest {
        gateway.albums = listOf(
            realAlbum(1, "Camera", "DCIM/Camera/"),
            realAlbum(2, "Download", "Download/"),   // 三方写入限 DCIM/ 与 Pictures/（spec §5.3）
        )
        prefsStore.addPendingAlbum("旅行")

        val targets = vm().albumTargets()

        assertEquals(setOf("Camera", "旅行"), targets.map { it.name }.toSet())
        assertTrue(targets.none { it.relativePath == "Download/" })
    }

    @Test
    fun `observeChanges脉冲触发invalidate`() = runTest {
        gateway.media = listOf(media(1), media(2))
        val vm = vm()

        // 驱动 Pager 首次调用 pagingSourceFactory，落地第一代 PagingSource
        vm.media.asSnapshot { }
        val firstSource = gateway.createdPagingSources.last()
        assertTrue(!firstSource.invalid)

        gateway.changes.tryEmit(Unit)

        assertTrue(awaitValue({ firstSource.invalid }) { it })
    }
}
