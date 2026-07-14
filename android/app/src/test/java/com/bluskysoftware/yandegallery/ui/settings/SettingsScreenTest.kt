package com.bluskysoftware.yandegallery.ui.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * SettingsScreen Robolectric 冒烟（Task 9 扩）：hub 既有三行为不变——「服务器管理」入口回调、
 * 「版本」行显示传入版本号、「开源协议」弹窗含许可证文案；新增「图片同步」分组——保存方式默认
 * 高质量（用 MiuiChoiceRow 的 `_check` 标签惯例断言选中态，不用 onNodeWithText 找"高质量"，
 * 该文案在摘要行与选项行各出现一次，onNodeWithText 要求唯一匹配会直接报错）、切原图弹确认框
 * （真实 estimateOriginalBytes() 经 Dispatchers.IO 计算，用 compose.waitUntil 轮询确认框
 * testTag 出现——仓内 SearchScreenTest/PhotosScreenTest/AlbumsReorderTest 等处理"点击触发真实
 * IO/Room 工作"场景的既定写法，waitForIdle 不追踪独立 scope 上的真实后台协程）、确认后写偏好
 * +REPLACE 重新入队/取消则保存方式原样不变；移动网络同步开关默认关、切换后写偏好+重新入队。
 * real AppGraph + in-memory db + 临时文件 PrefsStore + requestMirrorSyncOverride fake（同
 * CacheViewModelTest 先例：Robolectric 下真 WorkManager 未初始化，直接调用会抛异常）。
 *
 * qualifiers 拉高窗口：Robolectric 默认 320x470 视口装不下新增的「图片同步」分组后的整页
 * （同 DetailPanelTest 先例）——「版本」「开源协议」等后置行会溢出可见区被 assertIsDisplayed
 * 判为未显示，点选方式/移动网络开关等行也会因落在裁剪区外而点击不生效。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w480dp-h1000dp")
class SettingsScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var db: AppDatabase
    private lateinit var graph: AppGraph
    private lateinit var vm: SettingsViewModel
    private val resyncRequests = mutableListOf<Triple<Long, Boolean, Boolean>>()

    private val prefsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefsTmp = File.createTempFile("settings-screen-prefs", ".preferences_pb").also { it.delete() }

    @Before
    fun setup() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        graph = AppGraph(
            ApplicationProvider.getApplicationContext(),
            dbOverride = db,
            autoSyncOnActiveChange = false,
            prefsStoreOverride = PrefsStore(PreferenceDataStoreFactory.create(scope = prefsScope) { prefsTmp }),
            requestMirrorSyncOverride = { serverId, cellular, replace -> resyncRequests.add(Triple(serverId, cellular, replace)) },
        )
        vm = SettingsViewModel(graph)
        // requestMirrorSync() 内部 serverRepository.activeServer() 取不到就静默 return@launch（AppGraph
        // 既定行为，非 bug）——不激活服务器则 override 永远不会被调用；同 PhotosScreenTest 先例。
        runBlocking { graph.serverRepository.addAndActivate("t9set", "http://127.0.0.1:1", "k") }
    }

    @After
    fun teardown() {
        graph.shutdownForTest()
        db.close()
        prefsScope.cancel()
        prefsTmp.delete()
        Dispatchers.resetMain()
    }

    @Test
    fun `服务器管理项点击触发 onOpenServers`() {
        var opened = false
        compose.setContent {
            SettingsScreen(vm = vm, onBack = {}, onOpenServers = { opened = true }, versionName = "9.9.9")
        }
        compose.onNodeWithTag("settings_servers").assertIsDisplayed()
        compose.onNodeWithTag("settings_servers").performClick()
        assertTrue(opened)
    }

    @Test
    fun `版本行显示传入版本号`() {
        compose.setContent {
            SettingsScreen(vm = vm, onBack = {}, onOpenServers = {}, versionName = "1.2.3-test")
        }
        compose.onNodeWithTag("settings_version").assertIsDisplayed()
        compose.onNodeWithText("1.2.3-test").assertIsDisplayed()
    }

    @Test
    fun `点开源协议弹窗含 Apache 文案`() {
        compose.setContent {
            SettingsScreen(vm = vm, onBack = {}, onOpenServers = {}, versionName = "1.0")
        }
        compose.onNodeWithTag("settings_licenses").performClick()
        compose.onNodeWithText("Apache", substring = true).assertIsDisplayed()
    }

    @Test
    fun `图片同步分组——保存方式默认高质量、移动网络开关默认关`() {
        compose.setContent {
            SettingsScreen(vm = vm, onBack = {}, onOpenServers = {}, versionName = "t")
        }
        compose.onNodeWithTag("settings_save_mode").assertIsDisplayed()
        // MiuiChoiceRow 的 check 图标是被其可点击父 Row 合并进语义树的子节点——同 AlbumDetailMoreMenuTest/
        // MiuiMoreMenuTest 对同一 MiuiChoiceRow `_check` 标签的既定用法，需 useUnmergedTree 才能单独查到。
        compose.onNodeWithTag("settings_save_mode_hq_check", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("settings_cellular_switch").assertIsOff()
        compose.onNodeWithTag("settings_sync_state").assertIsDisplayed()
    }

    @Test
    fun `切原图弹确认框展示预估、取消不写偏好不入队`() {
        compose.setContent {
            SettingsScreen(vm = vm, onBack = {}, onOpenServers = {}, versionName = "t")
        }
        compose.onNodeWithTag("settings_save_mode_original").performClick()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("save_mode_confirm_dialog").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("save_mode_confirm_dialog").assertIsDisplayed()
        compose.onNodeWithTag("miui_dialog_dismiss").performClick()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("save_mode_confirm_dialog").fetchSemanticsNodes().isEmpty()
        }
        assertEquals(MirrorTier.HQ, vm.saveMode.value)
        assertTrue(resyncRequests.isEmpty())
    }

    @Test
    fun `确认切原图后写偏好并 REPLACE 重新入队`() {
        compose.setContent {
            SettingsScreen(vm = vm, onBack = {}, onOpenServers = {}, versionName = "t")
        }
        compose.onNodeWithTag("settings_save_mode_original").performClick()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithTag("save_mode_confirm_dialog").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("miui_dialog_confirm").performClick()
        compose.waitUntil(timeoutMillis = 5_000) { vm.saveMode.value == MirrorTier.ORIGINAL }
        assertEquals(MirrorTier.ORIGINAL, vm.saveMode.value)
        compose.waitUntil(timeoutMillis = 5_000) { resyncRequests.any { it.third } }
        assertTrue("切换保存方式应以 replace=true 重新入队同步", resyncRequests.any { it.third })
    }

    @Test
    fun `移动网络开关点击后写偏好并重新入队`() {
        compose.setContent {
            SettingsScreen(vm = vm, onBack = {}, onOpenServers = {}, versionName = "t")
        }
        compose.onNodeWithTag("settings_cellular_switch").performClick()
        compose.waitUntil(timeoutMillis = 5_000) { vm.cellular.value }
        assertTrue(vm.cellular.value)
        compose.waitUntil(timeoutMillis = 5_000) { resyncRequests.isNotEmpty() }
        assertTrue("开关应传入更新后的 cellular 值重新入队", resyncRequests.any { it.second })
    }
}
