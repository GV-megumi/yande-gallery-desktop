package com.bluskysoftware.yandegallery.ui

import android.net.Uri
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.PhotoAlbum
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.PhotoAlbum
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument
import com.bluskysoftware.yandegallery.ui.common.PhotosSelectionBars
import com.bluskysoftware.yandegallery.ui.common.SelectionBottomBar
import com.bluskysoftware.yandegallery.ui.photos.PhotosPinnedTopBar

object Routes {
    const val Photos = "photos"
    const val Albums = "albums"
    const val AlbumDetail = "albums/{galleryId}"
    // 不能用 "albums/other"——会被 albums/{galleryId} 模式吞掉（v0.6 T7 定名，T8 注册路由）
    const val OtherAlbums = "albums_other"
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

private data class BottomTab(val route: String, val label: String, val filled: ImageVector, val outlined: ImageVector)

private val bottomTabs = listOf(
    BottomTab(Routes.Photos, "照片", Icons.Filled.Photo, Icons.Outlined.Photo),
    BottomTab(Routes.Albums, "相册", Icons.Filled.PhotoAlbum, Icons.Outlined.PhotoAlbum),
)

/** MIUI 式底部导航（spec §2.4）：surface 底 + 顶发丝线，无胶囊指示器、无水波；选中实心主色/未选线框灰。 */
@Composable
private fun MiuiNavBar(currentRoute: String?, onSelect: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)) {
        HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
        Row(Modifier.fillMaxWidth().navigationBarsPadding().height(56.dp)) {
            bottomTabs.forEach { tab ->
                val selected = currentRoute == tab.route
                val tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { onSelect(tab.route) }
                        .testTag("tab_${tab.route}"),
                ) {
                    Icon(if (selected) tab.filled else tab.outlined, contentDescription = tab.label, tint = tint, modifier = Modifier.size(24.dp))
                    Text(tab.label, style = MaterialTheme.typography.labelSmall, color = tint, modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
    }
}

@Composable
fun AppScaffold(
    navController: NavHostController,
    photosSelectionBars: PhotosSelectionBars,
    photosContent: @Composable () -> Unit,
    albumsContent: @Composable () -> Unit,
    otherAlbumsContent: @Composable () -> Unit,
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
        bottomBar = {
            // 多选激活：底部选择动作栏替换导航栏（顶部选择栏已在 PhotosScreen 内自渲染）
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
                MiuiNavBar(currentRoute) { route ->
                    navController.navigate(route) {
                        popUpTo(navController.graph.startDestinationId) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
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
            composable(Routes.OtherAlbums) { otherAlbumsContent() }
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

/**
 * 测试与占位用：内容为占位 Text 的导航壳。[photosSelectionBars] 缺省自建桥（既有零参调用不动）。
 * 照片占位额外挂生产真件 [PhotosPinnedTopBar]（回调镜像 MainActivity 接线）——顶栏下放页面后，
 * photos_search → 路由落点的端到端覆盖仍走真 NavHost（AppNavTest，spec §10 归属适配）；
 * 设置入口 v0.6 迁入「⋯」面板（onOpenMore 此处空接，面板跳转覆盖在 PhotosScreenTest）。
 */
@Composable
fun AppNavForTest(photosSelectionBars: PhotosSelectionBars? = null) {
    val nav = rememberNavController()
    com.bluskysoftware.yandegallery.ui.theme.YandeGalleryTheme {
        AppScaffold(
            navController = nav,
            photosSelectionBars = photosSelectionBars ?: remember { PhotosSelectionBars() },
            photosContent = {
                Column {
                    PhotosPinnedTopBar(
                        scrolled = false,
                        onOpenSearch = { nav.navigate(Routes.search()) },
                        onOpenMore = {},
                    )
                    Text("照片页占位")
                }
            },
            albumsContent = {
                Column {
                    Text("相册页占位")
                    // 测试触发按钮（v0.6 T8）：经真 NavHost 覆盖 OtherAlbums 路由注册与模式优先级
                    // （独立字面量 "albums_other" 不被 albums/{galleryId} 吞掉）
                    Button(
                        onClick = { nav.navigate(Routes.OtherAlbums) },
                        modifier = Modifier.testTag("test_open_other_albums"),
                    ) { Text("打开其他相册") }
                }
            },
            otherAlbumsContent = { Text("其他相册占位") },
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
