package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.Routes
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar
import com.bluskysoftware.yandegallery.ui.common.writeFailText
import kotlinx.coroutines.launch

/**
 * 「其他相册」二级页（spec §4.6）：收纳区查看/移出。沿用全局 albumsSort（sections.other 已排好序），
 * 无「⋯」面板、无拖拽（v1 排除项）；清空自动返回主页。菜单无置顶项——先移出再置顶（互斥语义）。
 */
@Composable
fun OtherAlbumsScreen(
    viewModel: AlbumsViewModel,
    navController: NavHostController,
    onBack: () -> Unit,
) {
    val sections by viewModel.sections.collectAsStateWithLifecycle()
    val activeServer by viewModel.activeServer.collectAsStateWithLifecycle()
    val connState by viewModel.connState.collectAsStateWithLifecycle()
    val online = connState.online
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    var renameId by rememberSaveable { mutableStateOf<Long?>(null) }
    var renameName by rememberSaveable { mutableStateOf("") }
    var deleteId by rememberSaveable { mutableStateOf<Long?>(null) }
    var deleteName by rememberSaveable { mutableStateOf("") }
    val baseUrl = activeServer?.baseUrl.orEmpty()
    val serverId = activeServer?.id ?: 0L
    val loader = viewModel.thumbnailLoader

    val other = sections?.other
    // 清空自动返回（spec §4.6）：sections 加载完成（非 null）且收纳区已空
    LaunchedEffect(other) {
        if (other != null && other.isEmpty()) onBack()
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            MiuiSubPageTopBar(title = "其他相册", onBack = onBack)
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 104.dp),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize().testTag("other_albums_grid"),
            ) {
                items(other.orEmpty(), key = { it.gallery.id }) { card ->
                    AlbumCardItem(
                        card = card,
                        baseUrl = baseUrl,
                        serverId = serverId,
                        loader = loader,
                        onClick = { navController.navigate(Routes.albumDetail(card.gallery.id)) },
                        menuItems = { dismiss ->
                            val id = card.gallery.id
                            DropdownMenuItem(
                                text = { Text("移出其他相册") },
                                onClick = { dismiss(); viewModel.setInOther(id, false) },
                                modifier = Modifier.testTag("album_menu_from_other_$id"),
                            )
                            DropdownMenuItem(
                                text = { Text("重命名") },
                                enabled = online,
                                onClick = { dismiss(); renameId = id; renameName = card.gallery.name },
                                modifier = Modifier.testTag("album_menu_rename_$id"),
                            )
                            DropdownMenuItem(
                                text = { Text("删除") },
                                enabled = online,
                                onClick = { dismiss(); deleteId = id; deleteName = card.gallery.name },
                                modifier = Modifier.testTag("album_menu_delete_$id"),
                            )
                        },
                    )
                }
            }
        }
        // navigationBarsPadding：本路由无底栏、内容延伸到屏幕底缘，不加会被三键导航栏遮住（同 PhotosScreen）
        SnackbarHost(
            snackbarHostState,
            Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 8.dp),
        )
    }

    renameId?.let { id ->
        AlbumNameDialog(
            title = "重命名相册",
            name = renameName,
            onNameChange = { renameName = it },
            confirmLabel = "保存",
            confirmTag = "album_rename_confirm",
            onConfirm = {
                val name = renameName.trim()
                renameId = null
                scope.launch {
                    when (val r = viewModel.renameGallery(id, name)) {
                        WriteResult.Success -> snackbarHostState.showSnackbar("已重命名为「$name」")
                        is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("重命名失败", r))
                    }
                }
            },
            onDismiss = { renameId = null },
        )
    }
    deleteId?.let { id ->
        DeleteAlbumConfirmDialog(
            albumName = deleteName,
            onConfirm = {
                val name = deleteName
                deleteId = null
                scope.launch {
                    when (val r = viewModel.deleteGallery(id)) {
                        WriteResult.Success -> snackbarHostState.showSnackbar("已删除相册「$name」")
                        is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("删除相册失败", r))
                    }
                }
            },
            onDismiss = { deleteId = null },
        )
    }
}
