package com.bluskysoftware.yandegallery.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.PhotoAlbum
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.navigation.NavHostController
import androidx.navigation.compose.*

object Routes {
    const val Photos = "photos"
    const val Albums = "albums"
    const val AlbumDetail = "albums/{galleryId}"
    const val Servers = "servers"
    const val AddServer = "servers/add"
    const val Scan = "servers/scan"

    fun albumDetail(galleryId: Long) = "albums/$galleryId"
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
    serversContent: @Composable () -> Unit,
    addServerContent: @Composable () -> Unit,
    scanContent: @Composable () -> Unit,
    albumDetailContent: @Composable (Long) -> Unit,
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
                        IconButton(onClick = { navController.navigate(Routes.Servers) }) {
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
            composable(Routes.Servers) { serversContent() }
            composable(Routes.AddServer) { addServerContent() }
            composable(Routes.Scan) { scanContent() }
            composable(Routes.AlbumDetail) { entry ->
                albumDetailContent(entry.arguments?.getString("galleryId")?.toLongOrNull() ?: -1L)
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
            serversContent = { Text("服务器页占位") },
            addServerContent = { Text("添加服务器占位") },
            scanContent = { Text("扫码占位") },
            albumDetailContent = { Text("图集详情占位") },
        )
    }
}
