package com.bluskysoftware.yandegallery

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Text
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.flow.MutableStateFlow
import com.bluskysoftware.yandegallery.data.device.DeviceAccessLevel
import com.bluskysoftware.yandegallery.data.device.DeviceCapabilities
import com.bluskysoftware.yandegallery.ui.AppScaffold
import com.bluskysoftware.yandegallery.ui.Routes
import com.bluskysoftware.yandegallery.ui.common.NotificationPermissionEffect
import com.bluskysoftware.yandegallery.ui.common.PhotosSelectionBars
import com.bluskysoftware.yandegallery.ui.device.DeviceAlbumDetailScreen
import com.bluskysoftware.yandegallery.ui.device.DeviceAlbumDetailViewModel
import com.bluskysoftware.yandegallery.ui.device.DeviceAlbumsScreen
import com.bluskysoftware.yandegallery.ui.device.DeviceAlbumsViewModel
import com.bluskysoftware.yandegallery.ui.device.DeviceSelectionBars
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
                // 手机域多选栏桥（Task 7 修正 T4 临时接线）：换专属 DeviceSelectionBars——
                // DeviceAlbumDetailScreen SideEffect 回填、壳按路由 swap 成 DeviceSelectionBottomBar
                val deviceBars = remember { DeviceSelectionBars() }
                // 手机相册权限桥（T5，spec §3）：初始态现读 checkSelfPermission 算一次 accessLevel；
                // remember 必须挂在这一层（不能下沉进 deviceAlbumsContent lambda 内部）——NavHost
                // 切目的地会整体丢弃目的地内部的组合状态，但 viewModel() 工厂只在 ViewModelStore
                // 首次创建时调用一次；若 accessLevel 挂在 lambda 内部，导航去 detail 再回来后 VM
                // 手里存的还是第一次那份 flow 实例，新 remember 出来的这份写不进 VM 在观察的那份，
                // 会出现权限授予后画面不刷新的失联。
                val deviceContext = LocalContext.current
                val deviceAccessLevel = remember { MutableStateFlow(currentDeviceAccessLevel(deviceContext)) }
                // 永久拒绝标记（review Finding 4，spec §3）：申请回调里如果某项权限「未授予」且系统已经
                // 判定不该再展示理由说明（shouldShowRequestPermissionRationale=false，首次请求前也是
                // false，需配合本次确有一次 launch 发生才有意义），说明用户勾了「不再询问」——引导页
                // 按钮要从「授权」切换成「去设置」，跳系统应用详情页而不是再徒劳弹一次系统权限框。
                val devicePermanentlyDenied = remember { mutableStateOf(false) }
                val devicePermissionLauncher = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestMultiplePermissions(),
                ) { results ->
                    deviceAccessLevel.value = currentDeviceAccessLevel(deviceContext)
                    devicePermanentlyDenied.value = results.any { (perm, granted) ->
                        !granted && !ActivityCompat.shouldShowRequestPermissionRationale(this@MainActivity, perm)
                    }
                }
                // ON_RESUME 权限重检（review Finding 2）：用户授权后把应用切到后台、去系统设置里撤销
                // 权限、再切回前台——这条路径不会走 devicePermissionLauncher 回调（根本没发起系统请求），
                // accessLevel 会停留在撤销前的旧值。叠加 Finding 1 的查询异常兜底后，二者共同保证撤销
                // 权限这件事最终会被感知到并让页面收敛回引导页，而不是拿着过期 accessLevel 继续尝试
                // 查询已被收回的 MediaStore 权限、被动等下一次异常兜底触发。
                val deviceLifecycleOwner = LocalLifecycleOwner.current
                DisposableEffect(deviceLifecycleOwner) {
                    val observer = LifecycleEventObserver { _, event ->
                        if (event == Lifecycle.Event.ON_RESUME) {
                            deviceAccessLevel.value = currentDeviceAccessLevel(deviceContext)
                        }
                    }
                    deviceLifecycleOwner.lifecycle.addObserver(observer)
                    onDispose { deviceLifecycleOwner.lifecycle.removeObserver(observer) }
                }
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
                    // 手机相册三页占位（T4→T5→T6）：本任务再换 deviceAlbumDetailContent 真件，viewer
                    // 仍是占位——Task 8 接
                    deviceAlbumsContent = {
                        val deviceAlbumsVm: DeviceAlbumsViewModel =
                            viewModel(factory = DeviceAlbumsViewModel.factory(graph, deviceAccessLevel))
                        DeviceAlbumsScreen(
                            viewModel = deviceAlbumsVm,
                            loader = graph.deviceLoader,
                            onOpenAlbum = { key -> nav.navigate(Routes.deviceAlbumDetail(key)) },
                            onRequestPermission = {
                                // review Finding 4（spec §3）：永久拒绝后系统不会再弹权限对话框，
                                // 再次 launch 只会静默立即回调「未授予」——改跳应用详情页交给用户手动开。
                                if (devicePermanentlyDenied.value) {
                                    startActivity(
                                        Intent(
                                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                            Uri.fromParts("package", packageName, null),
                                        ),
                                    )
                                } else {
                                    devicePermissionLauncher.launch(DeviceCapabilities.readPermissions().toTypedArray())
                                }
                            },
                            // 34+ 对已是 PARTIAL 的应用重新申请同一批权限，系统会重新弹出部分照片选择
                            // 器供用户补选或升级为完整授权（brief 契约）；<34 不会展示横幅，不会走到这里
                            onManagePartial = {
                                devicePermissionLauncher.launch(DeviceCapabilities.readPermissions().toTypedArray())
                            },
                            permanentlyDenied = devicePermanentlyDenied.value,
                        )
                    },
                    deviceAlbumDetailContent = { raw ->
                        val deviceDetailVm: DeviceAlbumDetailViewModel =
                            viewModel(factory = DeviceAlbumDetailViewModel.factory(graph, raw))
                        DeviceAlbumDetailScreen(
                            viewModel = deviceDetailVm,
                            loader = graph.deviceLoader,
                            onOpenViewer = { mediaId ->
                                nav.navigate(Routes.deviceViewer(mediaId, deviceDetailVm.bucketKey))
                            },
                            onBack = { nav.popBackStack() },
                            selectionBars = deviceBars,
                        )
                    },
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
