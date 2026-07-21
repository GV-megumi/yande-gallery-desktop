package com.bluskysoftware.yandegallery.ui.device

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.awaitValue
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceCapabilities
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 手机域批量操作契约（Task 7，spec §5.3/§5.4/§7）：复制逐张 insert 计成功数与待落地收编、
 * 移动授权后目标路径透传、删除 uris 批量一次全量传入、26–28 门控三写操作全 false，以及
 * [DeviceSelectionBottomBar] 门控 false 项不渲染（隐藏而非置灰，spec §7）。装置沿用
 * DeviceAlbumsViewModelTest 的临时文件 PrefsStore + FakeDeviceGateway（写操作旋钮 Task 7 扩展）；
 * VM 测试与 compose 冒烟同类混排对照 AlbumsWriteTest 既有先例。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class DeviceActionsTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("device_actions_test", ".preferences_pb").also { it.delete() }
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

    private fun vm() = DeviceAlbumDetailViewModel(gateway, prefsStore, BucketKey.All.encode())

    /** Robolectric 下可构造的占位 PendingIntent（brief Step 1：fake 返回记录用）。 */
    private fun placeholderPendingIntent(): PendingIntent = PendingIntent.getActivity(
        ApplicationProvider.getApplicationContext(),
        0,
        Intent(),
        PendingIntent.FLAG_IMMUTABLE,
    )

    @Test
    fun `复制到_逐张insert_计数成功数`() = runTest {
        val m1 = media(1)
        val m2 = media(2)
        val m3 = media(3)
        gateway.media = listOf(m1, m2, m3)
        // 3 选 2 成功：第 2 张定向失败，其余成功
        gateway.insertCopyHandler = { source, _ ->
            val id = (source as DeviceSource.Media).media.mediaId
            if (id == 2L) Result.failure(IllegalStateException("boom"))
            else Result.success(Uri.parse("content://media/external/images/media/9$id"))
        }
        val vm = vm()
        vm.selection.selectAll(listOf(1, 2, 3))

        val ok = vm.copySelectedTo("Pictures/旅行/")

        assertEquals(2, ok)
        assertEquals(
            listOf<DeviceSource>(DeviceSource.Media(m1), DeviceSource.Media(m2), DeviceSource.Media(m3)),
            gateway.insertCopyCalls.map { it.first },
        )
        assertTrue(gateway.insertCopyCalls.all { it.second == "Pictures/旅行/" })
    }

    @Test
    fun `复制成功至少一张时清待落地占位名`() = runTest {
        prefsStore.addPendingAlbum("旅行")
        gateway.media = listOf(media(1))
        gateway.insertCopyHandler = { _, _ -> Result.success(Uri.parse("content://media/external/images/media/91")) }
        val vm = vm()
        vm.selection.selectAll(listOf(1))

        vm.copySelectedTo("Pictures/旅行/")

        // review Finding 3 同款口径：awaitValue 超时不抛，必须外包一层断言
        assertEquals(
            emptySet<String>(),
            awaitValue({ prefsStore.devicePendingAlbums.first() }) { it.isEmpty() },
        )
    }

    @Test
    fun `移动到_授权后moveTo_目标路径传递`() = runTest {
        val m1 = media(1)
        val m2 = media(2)
        gateway.media = listOf(m1, m2)
        gateway.writeRequestResult = placeholderPendingIntent()
        gateway.moveToResult = Result.success(2)
        val vm = vm()
        vm.selection.selectAll(listOf(1, 2))

        // 第一步：系统写授权意图——uris 批量一次全量传入
        val pi = vm.moveWriteRequest()
        assertNotNull(pi)
        assertEquals(listOf(listOf(m1.uri, m2.uri)), gateway.writeRequestCalls)

        // 第二步：模拟 RESULT_OK 后收口——目标路径原样透传 gateway.moveTo
        val moved = vm.moveSelectedTo("DCIM/Camera/")
        assertEquals(Result.success(2), moved)
        assertEquals(1, gateway.moveToCalls.size)
        assertEquals(listOf(m1.uri, m2.uri), gateway.moveToCalls.single().first)
        assertEquals("DCIM/Camera/", gateway.moveToCalls.single().second)
    }

    @Test
    fun `移动到_部分行未生效时成功数按rows-affected对账`() = runTest {
        // 网关 moveTo 计数 = resolver.update 返回行数之和；0 行的 uri 不计成败——
        // UI 侧以 successCount vs 选中数 对账提示（T3(c) 语义钉板，加固轮 F3）
        gateway.media = listOf(media(1), media(2), media(3))
        gateway.moveToResult = Result.success(2)   // 3 选 2 行生效
        val vm = vm()
        vm.selection.selectAll(listOf(1, 2, 3))

        val moved = vm.moveSelectedTo("Pictures/Target/").getOrDefault(0)

        assertEquals(2, moved)
        assertEquals(3, gateway.moveToCalls.single().first.size)   // 三 uri 全量传入
    }

    @Test
    fun `删除_uris正确传入deleteRequest`() = runTest {
        val m1 = media(1)
        val m3 = media(3)
        gateway.media = listOf(m1, media(2), m3)
        gateway.deleteRequestResult = placeholderPendingIntent()
        val vm = vm()
        vm.selection.selectAll(listOf(1, 3))

        val pi = vm.deleteSelected()

        assertNotNull(pi)
        // 批量一次：全量 uris 单次传入（mediaByIds 以库序还原，未选中的 2 不在列）
        assertEquals(listOf(listOf(m1.uri, m3.uri)), gateway.deleteRequestCalls)
    }

    @Test
    fun `空选中_删除与移动授权请求返回null不触网关`() = runTest {
        val vm = vm()

        assertNull(vm.deleteSelected())
        assertNull(vm.moveWriteRequest())
        assertTrue(gateway.deleteRequestCalls.isEmpty())
        assertTrue(gateway.writeRequestCalls.isEmpty())
    }

    @Test
    fun `分享_按选中还原完整媒体行`() = runTest {
        gateway.media = listOf(media(1), media(2))
        val vm = vm()
        vm.selection.selectAll(listOf(2))

        assertEquals(listOf(2L), vm.shareSelected().map { it.mediaId })
    }

    @Test
    @Config(sdk = [28])
    fun `sdk28_Model门控三写操作全false`() {
        // DeviceCapabilities 直接断言（spec §7：26–28 只看不动本机文件）
        assertFalse(DeviceCapabilities.canDelete())
        assertFalse(DeviceCapabilities.canCopy())
        assertFalse(DeviceCapabilities.canMove())
        // Model 构造走同一门控源
        val model = DeviceSelectionBars.Model(
            canDelete = DeviceCapabilities.canDelete(),
            canCopy = DeviceCapabilities.canCopy(),
            canMove = DeviceCapabilities.canMove(),
            onShare = {},
            onDelete = {},
            onCopyTo = {},
            onMoveTo = {},
        )
        assertFalse(model.canDelete)
        assertFalse(model.canCopy)
        assertFalse(model.canMove)
    }

    @Test
    fun `门控false的动作项不渲染`() {
        compose.setContent {
            DeviceSelectionBottomBar(
                DeviceSelectionBars.Model(
                    canDelete = false,
                    canCopy = true,
                    canMove = false,
                    onShare = {},
                    onDelete = {},
                    onCopyTo = {},
                    onMoveTo = {},
                ),
            )
        }
        // 分享不受门控恒在；隐藏语义 = 组合树中彻底不存在（不是置灰）
        compose.onNodeWithTag("device_action_share").assertIsDisplayed()
        compose.onNodeWithTag("device_action_copy_to").assertIsDisplayed()
        compose.onNodeWithTag("device_action_delete").assertDoesNotExist()
        compose.onNodeWithTag("device_action_move_to").assertDoesNotExist()
    }

    @Test
    fun `动作项点击触发对应回调`() {
        var shared = false
        var copied = false
        compose.setContent {
            DeviceSelectionBottomBar(
                DeviceSelectionBars.Model(
                    canDelete = true,
                    canCopy = true,
                    canMove = true,
                    onShare = { shared = true },
                    onDelete = {},
                    onCopyTo = { copied = true },
                    onMoveTo = {},
                ),
            )
        }
        compose.onNodeWithTag("device_action_share").performClick()
        compose.onNodeWithTag("device_action_copy_to").performClick()
        assertTrue(shared)
        assertTrue(copied)
    }
}
