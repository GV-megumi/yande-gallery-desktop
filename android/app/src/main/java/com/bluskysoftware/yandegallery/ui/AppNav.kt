package com.bluskysoftware.yandegallery.ui

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import android.net.Uri
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.PhotoAlbum
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument
import com.bluskysoftware.yandegallery.ui.common.PhotosSelectionBars
import com.bluskysoftware.yandegallery.ui.common.SelectionBottomBar
import com.bluskysoftware.yandegallery.ui.common.SelectionTopBar

object Routes {
    const val Photos = "photos"
    const val Albums = "albums"
    const val AlbumDetail = "albums/{galleryId}"
    const val Settings = "settings"
    const val CacheManage = "settings/cache"
    const val Servers = "servers"
    const val AddServer = "servers/add"
    const val EditServer = "servers/{serverId}/edit"
    const val Scan = "servers/scan"
    const val Viewer = "viewer/{imageId}?galleryId={galleryId}"
    const val Search = "search?initialQuery={initialQuery}"

    fun albumDetail(galleryId: Long) = "albums/$galleryId"

    fun editServer(serverId: Long) = "servers/$serverId/edit"

    /** 大图页：galleryId 非 null → 图集上下文翻页；null → 时间轴上下文。 */
    fun viewer(imageId: Long, galleryId: Long? = null) =
        if (galleryId != null) "viewer/$imageId?galleryId=$galleryId" else "viewer/$imageId"

    /** 搜索页：query 非空（如大图页标签 chip 跳入）→ 预填并即时搜索；空 → 空白搜索页。 */
    fun search(query: String? = null) =
        if (query.isNullOrBlank()) "search" else "search?initialQuery=${Uri.encode(query)}"
}

private data class BottomTab(val route: String, val label: String)

private val bottomTabs = listOf(
    BottomTab(Routes.Photos, "照片"),
    BottomTab(Routes.Albums, "相册"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppScaffold(
    navController: NavHostController,
    photosSelectionBars: PhotosSelectionBars,
    photosContent: @Composable () -> Unit,
    albumsContent: @Composable () -> Unit,
    settingsContent: @Composable () -> Unit,
    cacheContent: @Composable () -> Unit,
    serversContent: @Composable () -> Unit,
    addServerContent: @Composable () -> Unit,
    editServerContent: @Composable (Long) -> Unit,
    scanContent: @Composable () -> Unit,
    albumDetailContent: @Composable (Long) -> Unit,
    viewerContent: @Composable (imageId: Long, galleryId: Long?) -> Unit,
    searchContent: @Composable (initialQuery: String) -> Unit,
) {
    val backStack by navController.currentBackStackEntryAsState()
    val currentRoute = backStack?.destination?.route
    val showBottomBar = currentRoute == Routes.Photos || currentRoute == Routes.Albums

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            // 照片 tab 多选激活（桥 model 非空）：壳级 swap 为选择顶栏，替换常规 TopAppBar（M4-T12/D11 消双顶栏）
            val bars = photosSelectionBars.model
            if (currentRoute == Routes.Photos && bars != null) {
                SelectionTopBar(
                    count = bars.count,
                    onSelectAll = bars.onSelectAll,
                    onCancel = bars.onCancel,
                    insetStatusBar = true,   // Surface 内补状态栏 inset（背景连带着色状态栏区，对齐 AlbumDetail 用法）
                )
            } else if (showBottomBar) {
                TopAppBar(
                    title = { Text(if (currentRoute == Routes.Photos) "照片" else "相册") },
                    actions = {
                        // 搜索入口仅在照片 tab 呈现（相册 tab 无全库搜索语义）
                        if (currentRoute == Routes.Photos) {
                            IconButton(
                                onClick = { navController.navigate(Routes.search()) },
                                modifier = Modifier.testTag("photos_search"),
                            ) {
                                Icon(Icons.Filled.Search, contentDescription = "搜索")
                            }
                        }
                        IconButton(onClick = { navController.navigate(Routes.Settings) }) {
                            Icon(Icons.Filled.Settings, contentDescription = "设置")
                        }
                    },
                )
            }
        },
        bottomBar = {
            // 多选激活同步 swap 底栏：选择动作栏替换 NavigationBar（时间轴无图集上下文，inGallery=false）
            val bars = photosSelectionBars.model
            if (currentRoute == Routes.Photos && bars != null) {
                SelectionBottomBar(
                    online = bars.online,
                    inGallery = false,
                    onDownload = bars.onDownload,
                    onShare = bars.onShare,
                    onDelete = bars.onDelete,
                    onAddToGallery = bars.onAddToGallery,
                )
            } else if (showBottomBar) {
                NavigationBar {
                    bottomTabs.forEach { tab ->
                        NavigationBarItem(
                            modifier = Modifier.testTag("tab_${tab.route}"),
                            selected = currentRoute == tab.route,
                            onClick = {
                                navController.navigate(tab.route) {
                                    popUpTo(navController.graph.startDestinationId) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = {
                                Icon(
                                    if (tab.route == Routes.Photos) Icons.Filled.Photo else Icons.Filled.PhotoAlbum,
                                    contentDescription = tab.label,
                                )
                            },
                            label = { Text(tab.label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Routes.Photos,
            modifier = Modifier.padding(padding),
        ) {
            composable(Routes.Photos) { photosContent() }
            composable(Routes.Albums) { albumsContent() }
            composable(Routes.Settings) { settingsContent() }
            composable(Routes.CacheManage) { cacheContent() }
            composable(Routes.Servers) { serversContent() }
            composable(Routes.AddServer) { addServerContent() }
            composable(
                Routes.EditServer,
                arguments = listOf(navArgument("serverId") { type = NavType.LongType }),
            ) { entry ->
                editServerContent(entry.arguments?.getLong("serverId") ?: -1L)
            }
            composable(Routes.Scan) { scanContent() }
            composable(Routes.AlbumDetail) { entry ->
                albumDetailContent(entry.arguments?.getString("galleryId")?.toLongOrNull() ?: -1L)
            }
            composable(
                Routes.Viewer,
                arguments = listOf(
                    navArgument("imageId") { type = NavType.LongType },
                    navArgument("galleryId") {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                ),
                // 方案 B（M4-D5）：fade+scale 近似「从网格放大展开」，不动 Pager 定位/黑色占位层，
                // 零时序风险；共享元素方案 A（hero 层）留联调后可选增强（联调计划 J.6）。
                enterTransition = { fadeIn(animationSpec = tween(220)) + scaleIn(initialScale = 0.92f, animationSpec = tween(220)) },
                exitTransition = { fadeOut(animationSpec = tween(160)) },
                popEnterTransition = { fadeIn(animationSpec = tween(160)) },
                popExitTransition = { fadeOut(animationSpec = tween(160)) + scaleOut(targetScale = 0.92f, animationSpec = tween(160)) },
            ) { entry ->
                viewerContent(
                    entry.arguments?.getLong("imageId") ?: -1L,
                    entry.arguments?.getString("galleryId")?.toLongOrNull(),
                )
            }
            composable(
                Routes.Search,
                arguments = listOf(
                    navArgument("initialQuery") {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                ),
            ) { entry ->
                searchContent(entry.arguments?.getString("initialQuery").orEmpty())
            }
        }
    }
}

/** 测试与占位用：全部内容为占位 Text 的导航壳。[photosSelectionBars] 缺省自建桥（既有零参调用不动）。 */
@Composable
fun AppNavForTest(photosSelectionBars: PhotosSelectionBars? = null) {
    val nav = rememberNavController()
    com.bluskysoftware.yandegallery.ui.theme.YandeGalleryTheme {
        AppScaffold(
            navController = nav,
            photosSelectionBars = photosSelectionBars ?: remember { PhotosSelectionBars() },
            photosContent = { Text("照片页占位") },
            albumsContent = { Text("相册页占位") },
            settingsContent = { Text("设置页占位") },
            cacheContent = { Text("缓存管理占位") },
            serversContent = { Text("服务器页占位") },
            addServerContent = { Text("添加服务器占位") },
            editServerContent = { Text("编辑服务器占位") },
            scanContent = { Text("扫码占位") },
            albumDetailContent = { Text("图集详情占位") },
            viewerContent = { _, _ -> Text("大图页占位") },
            searchContent = { Text("搜索页占位") },
        )
    }
}
