package com.bluskysoftware.yandegallery

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.rememberNavController
import com.bluskysoftware.yandegallery.ui.AppScaffold
import com.bluskysoftware.yandegallery.ui.Routes
import com.bluskysoftware.yandegallery.ui.common.NotificationPermissionEffect
import com.bluskysoftware.yandegallery.ui.common.PhotosSelectionBars
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
                AppScaffold(
                    navController = nav,
                    photosSelectionBars = photosBars,
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
                )
            }
        }
    }
}
