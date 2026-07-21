package com.bluskysoftware.yandegallery.ui.device

import android.net.Uri
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import coil3.ColorImage
import coil3.ImageLoader
import coil3.Uri as CoilUri
import coil3.decode.DataSource
import coil3.fetch.Fetcher
import coil3.fetch.ImageFetchResult
import coil3.request.Options
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.ui.common.PinchStepState
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
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

/**
 * [DeviceAlbumDetailScreen] compose 契约（Task 6，spec §2.2）：网格渲染、视频角标文案、单击/
 * 长按交互、多选顶栏 swap。捏合列数改用 [PinchStepState] 纯逻辑单测——手势驱动 Robolectric
 * 不可靠，AlbumDetailScreenTest 同款既有惯例（brief Step 1 明文要求）。Task 7 起 selectionBars
 * 换 DeviceSelectionBars 桥（prefsStore 同步入装置），批量动作契约在 DeviceActionsTest。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class DeviceAlbumDetailScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("device_detail_screen_test", ".preferences_pb").also { it.delete() }
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

    /**
     * 挂真 DeviceAlbumDetailScreen：loader 内联建、并挂 [AlwaysSucceedFetcherFactory]（regression
     * 修复，见该类 KDoc）——Robolectric 下 content:// 必解码失败会牵出 RetryableAsyncImage 的失败
     * 占位内嵌 clickable，和 SelectableCell 外层长按手势打架，与本屏代码无关，属已知共享组件问题。
     * fetcher/decoder 协程上下文强制切 Unconfined（Coil 默认 Dispatchers.IO，真实线程池派发，
     * 完成时机不受 compose.waitForIdle() 追踪——Coil 未注册为 Compose 测试 IdlingResource——与
     * 本类 UnconfinedTestDispatcher 驱动的手势/断言时序构成真实竞态）：本 Fetcher 内部纯内存操作
     * 不含真实 IO，Unconfined 下与调用方同线程同步跑完，请求在合成当帧内确定性落定，消除竞态。
     */
    private fun setScreen(onOpenViewer: (Long) -> Unit = {}): DeviceAlbumDetailViewModel {
        val vm = DeviceAlbumDetailViewModel(gateway, prefsStore, BucketKey.All.encode())
        compose.setContent {
            val context = LocalContext.current
            DeviceAlbumDetailScreen(
                viewModel = vm,
                loader = ImageLoader.Builder(context)
                    .components { add(AlwaysSucceedFetcherFactory()) }
                    .coroutineContext(Dispatchers.Unconfined)
                    .build(),
                onOpenViewer = onOpenViewer,
                onBack = {},
                selectionBars = DeviceSelectionBars(),
            )
        }
        return vm
    }

    @Test
    fun `网格渲染N格_视频格带时长角标`() {
        gateway.media = listOf(media(1), media(2, isVideo = true, durationMs = 5_000))
        setScreen()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("device_cell_1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("device_grid").assertIsDisplayed()
        compose.onNodeWithTag("device_cell_1").assertIsDisplayed()
        compose.onNodeWithTag("device_cell_2").assertIsDisplayed()
        // 视频角标是 SelectableCell combinedClickable 的合并语义子节点——同 selection_badge/
        // selection_ring 断言口径，须用未合并树查找（SelectionBarsTest 既有惯例，非本文件独创）
        compose.onNodeWithTag("device_video_badge_2", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("0:05", useUnmergedTree = true).assertExists()
    }

    @Test
    fun `单击格子回调mediaId`() {
        gateway.media = listOf(media(1))
        var opened: Long? = null
        setScreen(onOpenViewer = { opened = it })
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("device_cell_1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("device_cell_1").performClick()
        assertEquals(1L, opened)
    }

    @Test
    fun `长按进多选后顶栏变SelectionTopBar`() {
        gateway.media = listOf(media(1))
        setScreen()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("device_cell_1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("device_cell_1").performTouchInput { longClick() }
        compose.waitForIdle()
        compose.onNodeWithTag("selection_top_bar").assertIsDisplayed()
    }

    @Test
    fun `空相册显示空态文案`() {
        gateway.media = emptyList()
        setScreen()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("device_empty").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("device_empty").assertIsDisplayed()
        compose.onNodeWithText("相册还没有照片", substring = true).assertExists()
    }

    @Test
    fun `捏合状态机列数4到3`() {
        val state = PinchStepState<Int>(
            larger = { if (it > DeviceAlbumDetailViewModel.MIN_COLUMNS) it - 1 else null },
            smaller = { if (it < DeviceAlbumDetailViewModel.MAX_COLUMNS) it + 1 else null },
        )
        state.onGestureStart(4)
        val next = state.onZoom(1.3f)
        assertEquals(3, next)
    }
}

/**
 * 测试专用 Fetcher（regression 修复）：Robolectric 没有真实 ContentResolver/解码器后端，本屏格子
 * 用到的 content:// 图片请求在真实 Coil 管线下必然落 Error 态，牵出 RetryableAsyncImage 的
 * ImageErrorPlaceholder——它自带 `Modifier.clickable(onRetry)`、`matchParentSize()` 铺满整格，
 * 嵌套在 SelectableCell 外层 `combinedClickable` 内部。Compose 指针事件 Main pass 由内向外派发，
 * 内层这个 clickable 会先行消费手势；外层 combinedClickable 的单击/长按探测据此收不到完整事件
 * 序列——onOpen/onToggle 均不触发（单击回调与长按进多选两条链路一起被遮蔽）。
 *
 * 这不是本屏代码的缺陷：PhotosScreen、AlbumDetailScreen 用的是同一套 SelectableCell +
 * RetryableAsyncImage 组合，同样会中招，只是此前两处都没有点击/长按交互的 Compose 测试覆盖过，
 * 没被发现（细节见任务报告「已知发现」章节）。真正的修复点在 ui/common/ 两个共享组件，超出本
 * 任务（ui/device/ + MainActivity.kt）范围，不在此处改生产代码。
 *
 * 两个类型/管线细节（都是踩过的坑，别改回去）：
 * 1. 泛型必须锚定 [CoilUri]（coil3.Uri）而非 android.net.Uri——Coil 内建 AndroidUriMapper 在
 *    Fetcher 匹配**之前**就把 android.net.Uri 映射成 coil3.Uri，锚 android.net.Uri 的 Factory
 *    永远不会被选中（静默失配，请求继续走真实 content:// 管线，Error 态照旧）；
 * 2. 返回 [ImageFetchResult]（直接携带 [ColorImage] 成品）而非 SourceFetchResult 字节流——后者
 *    还要过解码器，Robolectric 下 BitmapFactory 后端行为不稳定，直接交成品图跳过解码环节，
 *    请求确定性落 Success，ImageErrorPlaceholder 不挂载，测到未被遮蔽的真实交互路径。
 * 用户自注册组件优先于内建组件参与匹配（Coil ComponentRegistry 语义），无需担心被真实 Fetcher 抢先。
 * Task 8 起 internal 共享给 DeviceViewerScreenTest（同款 content:// 遮蔽问题，装置不再各自复制）。
 */
internal class AlwaysSucceedFetcherFactory : Fetcher.Factory<CoilUri> {
    override fun create(data: CoilUri, options: Options, imageLoader: ImageLoader): Fetcher = Fetcher {
        ImageFetchResult(
            image = ColorImage(color = 0xFF808080.toInt(), width = 8, height = 8),
            isSampled = false,
            dataSource = DataSource.MEMORY,
        )
    }
}
