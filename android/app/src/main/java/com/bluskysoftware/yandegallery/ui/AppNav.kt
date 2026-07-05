package com.bluskysoftware.yandegallery.ui

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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument

object Routes {
    const val Photos = "photos"
    const val Albums = "albums"
    const val AlbumDetail = "albums/{galleryId}"
    const val Settings = "settings"
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
    photosContent: @Composable () -> Unit,
    albumsContent: @Composable () -> Unit,
    settingsContent: @Composable () -> Unit,
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
        topBar = {
            if (showBottomBar) {
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
            if (showBottomBar) {
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

/** 测试与占位用：全部内容为占位 Text 的导航壳。 */
@Composable
fun AppNavForTest() {
    val nav = rememberNavController()
    com.bluskysoftware.yandegallery.ui.theme.YandeGalleryTheme {
        AppScaffold(
            navController = nav,
            photosContent = { Text("照片页占位") },
            albumsContent = { Text("相册页占位") },
            settingsContent = { Text("设置页占位") },
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
