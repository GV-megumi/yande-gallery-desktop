package com.bluskysoftware.yandegallery

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Text
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.flow.MutableStateFlow
import com.bluskysoftware.yandegallery.data.device.DeviceAccessLevel
import com.bluskysoftware.yandegallery.data.device.DeviceCapabilities
import com.bluskysoftware.yandegallery.ui.AppScaffold
import com.bluskysoftware.yandegallery.ui.Routes
import com.bluskysoftware.yandegallery.ui.common.NotificationPermissionEffect
import com.bluskysoftware.yandegallery.ui.common.PhotosSelectionBars
import com.bluskysoftware.yandegallery.ui.device.DeviceAlbumsScreen
import com.bluskysoftware.yandegallery.ui.device.DeviceAlbumsViewModel
import com.bluskysoftware.yandegallery.ui.albums.AlbumDetailScreen
import com.bluskysoftware.yandegallery.ui.albums.AlbumDetailViewModel
import com.bluskysoftware.yandegallery.ui.albums.AlbumsScreen
import com.bluskysoftware.yandegallery.ui.albums.AlbumsViewModel
import com.bluskysoftware.yandegallery.ui.albums.OtherAlbumsScreen
import com.bluskysoftware.yandegallery.ui.photos.PhotosScreen
import com.bluskysoftware.yandegallery.ui.photos.PhotosViewModel
import com.bluskysoftware.yandegallery.ui.search.SearchScreen
import com.bluskysoftware.yandegallery.ui.search.SearchViewModel
import com.bluskysoftware.yandegallery.ui.servers.AddServerScreen
import com.bluskysoftware.yandegallery.ui.servers.EditServerScreen
import com.bluskysoftware.yandegallery.ui.servers.ScanScreen
import com.bluskysoftware.yandegallery.ui.servers.ServersScreen
import com.bluskysoftware.yandegallery.ui.servers.ServersViewModel
import com.bluskysoftware.yandegallery.ui.settings.CacheScreen
import com.bluskysoftware.yandegallery.ui.settings.CacheViewModel
import com.bluskysoftware.yandegallery.ui.settings.SettingsScreen
import com.bluskysoftware.yandegallery.ui.settings.SettingsViewModel
import com.bluskysoftware.yandegallery.ui.theme.YandeGalleryTheme
import com.bluskysoftware.yandegallery.ui.viewer.ViewerScreen
import com.bluskysoftware.yandegallery.ui.viewer.ViewerViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val graph = (applicationContext as YandeGalleryApp).graph
        setContent {
            YandeGalleryTheme {
                // 下载前台通知的 33+ 运行时权限（M4-D8）：未授权首帧静默申请一次，拒绝纯后台降级
                NotificationPermissionEffect()
                val nav = rememberNavController()
                val serversVm: ServersViewModel = viewModel(factory = ServersViewModel.factory(graph))
                // 照片 tab 多选栏桥（M4-T12）：单实例连通 PhotosScreen（SideEffect 回填）与壳（条件 swap）
                val photosBars = remember { PhotosSelectionBars() }
                // 手机相册 tab 多选栏桥（T4）：同一套桥类型，Task 7 接真回调前先占位保证壳可编译可测
                val deviceBars = remember { PhotosSelectionBars() }
                // 手机相册权限桥（T5，spec §3）：初始态现读 checkSelfPermission 算一次 accessLevel；
                // remember 必须挂在这一层（不能下沉进 deviceAlbumsContent lambda 内部）——NavHost
                // 切目的地会整体丢弃目的地内部的组合状态，但 viewModel() 工厂只在 ViewModelStore
                // 首次创建时调用一次；若 accessLevel 挂在 lambda 内部，导航去 detail 再回来后 VM
                // 手里存的还是第一次那份 flow 实例，新 remember 出来的这份写不进 VM 在观察的那份，
                // 会出现权限授予后画面不刷新的失联。
                val deviceContext = LocalContext.current
                val deviceAccessLevel = remember { MutableStateFlow(currentDeviceAccessLevel(deviceContext)) }
                val devicePermissionLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestMultiplePermissions(),
                ) { deviceAccessLevel.value = currentDeviceAccessLevel(deviceContext) }
                AppScaffold(
                    navController = nav,
                    photosSelectionBars = photosBars,
                    deviceSelectionBars = deviceBars,
                    photosContent = {
                        val photosVm: PhotosViewModel = viewModel(factory = PhotosViewModel.factory(graph))
                        PhotosScreen(
                            viewModel = photosVm,
                            barsState = photosBars,
                            onAddServer = { nav.navigate(Routes.Servers) },
                            onOpenViewer = { imageId -> nav.navigate(Routes.viewer(imageId)) },
                            onOpenSearch = { nav.navigate(Routes.search()) },
                            onOpenSettings = { nav.navigate(Routes.Settings) },
                        )
                    },
                    albumsContent = {
                        val albumsVm: AlbumsViewModel = viewModel(factory = AlbumsViewModel.factory(graph))
                        AlbumsScreen(
                            viewModel = albumsVm,
                            navController = nav,
                        )
                    },
                    otherAlbumsContent = {
                        val albumsVm: AlbumsViewModel = viewModel(factory = AlbumsViewModel.factory(graph))
                        OtherAlbumsScreen(
                            viewModel = albumsVm,
                            navController = nav,
                            // 防重入（对齐 Viewer M4-T14）：清空收纳区的自动返回与用户返回可能双触发，
                            // 第二次会把下层 Albums 也 pop 掉落到照片页——仅当栈顶仍是本路由才 pop
                            onBack = {
                                if (nav.currentBackStackEntry?.destination?.route == Routes.OtherAlbums) {
                                    nav.popBackStack()
                                }
                            },
                        )
                    },
                    albumDetailContent = { galleryId ->
                        val detailVm: AlbumDetailViewModel =
                            viewModel(factory = AlbumDetailViewModel.factory(graph, galleryId))
                        AlbumDetailScreen(
                            viewModel = detailVm,
                            onBack = { nav.popBackStack() },
                            // 相册内点开：把 galleryId 一并传给 viewer，翻页上下文限定在本相册
                            onOpenViewer = { imageId -> nav.navigate(Routes.viewer(imageId, galleryId)) },
                        )
                    },
                    viewerContent = { imageId, galleryId ->
                        val viewerVm: ViewerViewModel =
                            viewModel(factory = ViewerViewModel.factory(graph, imageId, galleryId))
                        ViewerScreen(
                            viewModel = viewerVm,
                            // 防重入（M4-T14）：删除流成功回调与用户返回可能双触发，第二次会把下层屏也 pop
                            // 掉——仅当栈顶仍是 Viewer 才 pop（否则本次为 no-op）
                            onBack = {
                                if (nav.currentBackStackEntry?.destination?.route == Routes.Viewer) {
                                    nav.popBackStack()
                                }
                            },
                            // 详情面板「所属相册」→ 相册详情页
                            onOpenGallery = { gid -> nav.navigate(Routes.albumDetail(gid)) },
                            // 详情面板标签 chip → 搜索页（预填该标签名触发搜索）
                            onOpenSearch = { tag -> nav.navigate(Routes.search(tag)) },
                        )
                    },
                    searchContent = { initialQuery ->
                        val searchVm: SearchViewModel = viewModel(factory = SearchViewModel.factory(graph))
                        SearchScreen(
                            viewModel = searchVm,
                            onOpenViewer = { imageId -> nav.navigate(Routes.viewer(imageId)) },
                            onBack = { nav.popBackStack() },
                            initialQuery = initialQuery,
                        )
                    },
                    settingsContent = {
                        val versionName = remember {
                            runCatching { packageManager.getPackageInfo(packageName, 0).versionName }
                                .getOrNull() ?: "unknown"
                        }
                        val settingsVm: SettingsViewModel = viewModel(factory = SettingsViewModel.factory(graph))
                        SettingsScreen(
                            vm = settingsVm,
                            onBack = { nav.popBackStack() },
                            onOpenServers = { nav.navigate(Routes.Servers) },
                            versionName = versionName,
                            onOpenCache = { nav.navigate(Routes.CacheManage) },
                        )
                    },
                    cacheContent = {
                        val cacheVm: CacheViewModel = viewModel(factory = CacheViewModel.factory(graph))
                        CacheScreen(vm = cacheVm, onBack = { nav.popBackStack() })
                    },
                    serversContent = {
                        ServersScreen(
                            vm = serversVm,
                            onAddManual = { nav.navigate(Routes.AddServer) },
                            onScan = { nav.navigate(Routes.Scan) },
                            onEdit = { id -> nav.navigate(Routes.editServer(id)) },
                            onBack = { nav.popBackStack() },
                        )
                    },
                    addServerContent = {
                        AddServerScreen(
                            vm = serversVm,
                            navController = nav,
                            onSaved = { nav.popBackStack(Routes.Servers, inclusive = false) },
                            onBack = { nav.popBackStack() },
                        )
                    },
                    editServerContent = { serverId ->
                        EditServerScreen(
                            vm = serversVm,
                            serverId = serverId,
                            onSaved = { nav.popBackStack() },
                            onBack = { nav.popBackStack() },
                        )
                    },
                    scanContent = {
                        ScanScreen(
                            onPayload = { payload ->
                                // 弹出扫码页后进入添加页，并把三字段写入目标条目 savedStateHandle 预填
                                nav.navigate(Routes.AddServer) {
                                    popUpTo(Routes.Scan) { inclusive = true }
                                    launchSingleTop = true
                                }
                                nav.getBackStackEntry(Routes.AddServer).savedStateHandle.also { handle ->
                                    handle["prefill_name"] = payload.name
                                    handle["prefill_baseUrl"] = payload.baseUrl
                                    handle["prefill_apiKey"] = payload.apiKey
                                }
                            },
                            onBack = { nav.popBackStack() },
                        )
                    },
                    // 手机相册三页占位（T4→T5）：本任务只换 deviceAlbumsContent 真件，detail/viewer
                    // 仍是占位——Task 6/8 逐个接
                    deviceAlbumsContent = {
                        val deviceAlbumsVm: DeviceAlbumsViewModel =
                            viewModel(factory = DeviceAlbumsViewModel.factory(graph, deviceAccessLevel))
                        DeviceAlbumsScreen(
                            viewModel = deviceAlbumsVm,
                            loader = graph.deviceLoader,
                            onOpenAlbum = { key -> nav.navigate(Routes.deviceAlbumDetail(key)) },
                            onRequestPermission = {
                                devicePermissionLauncher.launch(DeviceCapabilities.readPermissions().toTypedArray())
                            },
                            // 34+ 对已是 PARTIAL 的应用重新申请同一批权限，系统会重新弹出部分照片选择
                            // 器供用户补选或升级为完整授权（brief 契约）；<34 不会展示横幅，不会走到这里
                            onManagePartial = {
                                devicePermissionLauncher.launch(DeviceCapabilities.readPermissions().toTypedArray())
                            },
                        )
                    },
                    deviceAlbumDetailContent = { Text("手机相册") },
                    deviceViewerContent = { _, _ -> Text("手机相册") },
                )
            }
        }
    }
}

/** 手机相册权限桥现算：以 [DeviceCapabilities.readPermissions] 清单逐项 checkSelfPermission。 */
private fun currentDeviceAccessLevel(context: Context): DeviceAccessLevel {
    val granted = DeviceCapabilities.readPermissions().filter {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }.toSet()
    return DeviceCapabilities.accessLevelOf(Build.VERSION.SDK_INT, granted)
}
