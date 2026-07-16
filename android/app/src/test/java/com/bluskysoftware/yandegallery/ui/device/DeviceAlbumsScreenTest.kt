package com.bluskysoftware.yandegallery.ui.device

import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import coil3.ImageLoader
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
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * [DeviceAlbumsScreen] compose 契约（Task 5，spec §2/§3/§2.3）：DENIED 权限引导页、PARTIAL
 * 常驻横幅、卡片点击回调携带正确 BucketKey、26–28 隐藏「+」新建入口。装置绕开真
 * AppGraph/Room——VM 直接喂 FakeDeviceGateway + 临时文件 PrefsStore，比 PhotosScreenTest
 * 的真图/真库装置更轻、启动更快（本页不依赖服务器/Room 任何东西）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class DeviceAlbumsScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("device-albums-screen-prefs", ".preferences_pb").also { it.delete() }
    private lateinit var prefsStore: PrefsStore
    private lateinit var gateway: FakeDeviceGateway

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        prefsStore = PrefsStore(PreferenceDataStoreFactory.create(scope = prefsScope) { prefsTmp })
        gateway = FakeDeviceGateway()
    }

    @After
    fun teardown() {
        prefsScope.cancel()
        prefsTmp.delete()
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

    /** 挂真 DeviceAlbumsScreen：loader 内联建（Robolectric 不联网，ViewerScreenTest 同款）。 */
    private fun setScreen(
        level: DeviceAccessLevel,
        onOpenAlbum: (BucketKey) -> Unit = {},
        onRequestPermission: () -> Unit = {},
        onManagePartial: () -> Unit = {},
    ) {
        val vm = DeviceAlbumsViewModel(gateway, prefsStore, MutableStateFlow(level))
        compose.setContent {
            val context = LocalContext.current
            DeviceAlbumsScreen(
                viewModel = vm,
                loader = ImageLoader.Builder(context).build(),
                onOpenAlbum = onOpenAlbum,
                onRequestPermission = onRequestPermission,
                onManagePartial = onManagePartial,
            )
        }
    }

    @Test
    fun `DENIED展示权限引导页`() {
        setScreen(DeviceAccessLevel.DENIED)
        compose.onNodeWithTag("device_permission_gate").assertIsDisplayed()
        compose.onNodeWithTag("device_albums_grid").assertDoesNotExist()
    }

    @Test
    fun `PARTIAL展示部分授权横幅`() {
        gateway.albums = listOf(realAlbum(1, "Camera", 3))
        setScreen(DeviceAccessLevel.PARTIAL)
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("device_partial_banner").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("device_partial_banner").assertIsDisplayed()
    }

    @Test
    fun `点击卡片回调携带正确BucketKey`() {
        gateway.albums = listOf(realAlbum(7, "Camera", 3))
        var opened: BucketKey? = null
        setScreen(DeviceAccessLevel.FULL, onOpenAlbum = { opened = it })
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("device_album_card_b7").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("device_album_card_b7").performClick()
        assertEquals(BucketKey.Bucket(7), opened)
    }

    @Test
    @Config(sdk = [28])
    fun `sdk28不展示新建入口`() {
        gateway.albums = listOf(realAlbum(1, "Camera", 3))
        setScreen(DeviceAccessLevel.FULL)
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("device_albums_grid").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("device_albums_new").assertDoesNotExist()
    }
}
