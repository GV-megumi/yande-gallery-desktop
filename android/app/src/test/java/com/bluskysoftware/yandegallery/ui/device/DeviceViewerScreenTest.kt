package com.bluskysoftware.yandegallery.ui.device

import android.content.Context
import android.net.Uri
import android.text.format.Formatter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * [DeviceViewerScreen] compose 契约（Task 8，spec §2.3/§5.6/§7）：图片页渲染缩放件、视频页
 * 渲染播放键+时长角标（且不实例化缩放件——外抛系统播放器，app 内不做视频渲染）、操作栏
 * sdk28 门控只余分享/详情、详情面板字段齐全只读。装置沿用 DeviceAlbumDetailScreenTest
 * （临时文件 PrefsStore + FakeDeviceGateway + [AlwaysSucceedFetcherFactory] 假 Coil 管线）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class DeviceViewerScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("device_viewer_screen_test", ".preferences_pb").also { it.delete() }
    private val prefsStore = PrefsStore(PreferenceDataStoreFactory.create(scope = prefsScope) { prefsTmp })
    private lateinit var gateway: FakeDeviceGateway

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        gateway = FakeDeviceGateway()
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
        prefsScope.cancel()
        prefsTmp.delete()
    }

    private fun media(id: Long, isVideo: Boolean = false, durationMs: Long? = null) = DeviceMedia(
        mediaId = id,
        uri = Uri.parse("content://media/external/images/media/$id"),
        isVideo = isVideo,
        displayName = "img$id.jpg",
        relativePath = "DCIM/Camera/",
        width = 100,
        height = 100,
        sizeBytes = 1_000,
        takenAtMs = id,
        durationMs = durationMs,
    )

    /** 挂真 DeviceViewerScreen：loader 装置与 DeviceAlbumDetailScreenTest 同款（假 Fetcher + Unconfined）。 */
    private fun setScreen(initialId: Long, onBack: () -> Unit = {}): DeviceViewerViewModel {
        val vm = DeviceViewerViewModel(gateway, prefsStore, initialId, BucketKey.All.encode())
        compose.setContent {
            val context = LocalContext.current
            DeviceViewerScreen(
                viewModel = vm,
                loader = ImageLoader.Builder(context)
                    .components { add(AlwaysSucceedFetcherFactory()) }
                    .coroutineContext(Dispatchers.Unconfined)
                    .build(),
                onBack = onBack,
            )
        }
        return vm
    }

    @Test
    fun `图片页渲染缩放件_无播放键`() {
        gateway.media = listOf(media(1), media(2, isVideo = true, durationMs = 5_000))
        setScreen(initialId = 1)
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("device_viewer_zoomable").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("device_viewer_zoomable").assertExists()
        compose.onNodeWithTag("device_viewer_play").assertDoesNotExist()
    }

    @Test
    fun `视频页渲染播放键与时长角标_不实例化缩放件`() {
        gateway.media = listOf(media(1), media(2, isVideo = true, durationMs = 5_000))
        setScreen(initialId = 2)
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("device_viewer_play").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("device_viewer_play").assertIsDisplayed()
        compose.onNodeWithTag("device_viewer_duration", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("0:05", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("device_viewer_zoomable").assertDoesNotExist()
    }

    @Test
    @Config(sdk = [28])
    fun `sdk28操作栏只余分享与详情`() {
        compose.setContent {
            DeviceViewerActionBar(
                isVideo = false,
                onShare = {},
                onDelete = {},
                onCopyTo = {},
                onMoveTo = {},
                onDetail = {},
            )
        }
        compose.onNodeWithTag("device_viewer_action_share").assertIsDisplayed()
        compose.onNodeWithTag("device_viewer_action_detail").assertIsDisplayed()
        compose.onNodeWithTag("device_viewer_action_delete").assertDoesNotExist()
        compose.onNodeWithTag("device_viewer_action_copy_to").assertDoesNotExist()
        compose.onNodeWithTag("device_viewer_action_move_to").assertDoesNotExist()
    }

    @Test
    fun `默认sdk操作栏五项齐全`() {
        compose.setContent {
            DeviceViewerActionBar(
                isVideo = true,
                onShare = {},
                onDelete = {},
                onCopyTo = {},
                onMoveTo = {},
                onDetail = {},
            )
        }
        compose.onNodeWithTag("device_viewer_action_share").assertIsDisplayed()
        compose.onNodeWithTag("device_viewer_action_delete").assertIsDisplayed()
        compose.onNodeWithTag("device_viewer_action_copy_to").assertIsDisplayed()
        compose.onNodeWithTag("device_viewer_action_move_to").assertIsDisplayed()
        compose.onNodeWithTag("device_viewer_action_detail").assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "w480dp-h1000dp")
    fun `详情面板字段文案齐全`() {
        val takenAtMs = 1_720_000_000_000L
        val m = DeviceMedia(
            mediaId = 9,
            uri = Uri.parse("content://media/external/video/media/9"),
            isVideo = true,
            displayName = "movie.mp4",
            relativePath = "DCIM/Camera/",
            width = 1920,
            height = 1080,
            sizeBytes = 2_500_000,
            takenAtMs = takenAtMs,
            durationMs = 65_000,
        )
        compose.setContent { DeviceMediaDetailPanel(media = m) }

        val context = ApplicationProvider.getApplicationContext<Context>()
        compose.onNodeWithTag("device_viewer_detail_sheet").assertExists()
        compose.onNodeWithText("movie.mp4").assertIsDisplayed()
        compose.onNodeWithText("DCIM/Camera/").assertIsDisplayed()
        compose.onNodeWithText(Formatter.formatFileSize(context, 2_500_000)).assertIsDisplayed()
        compose.onNodeWithText("1920 × 1080").assertIsDisplayed()
        compose.onNodeWithText(
            SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(takenAtMs)),
        ).assertIsDisplayed()
        compose.onNodeWithText("1:05").assertIsDisplayed()
    }
}
