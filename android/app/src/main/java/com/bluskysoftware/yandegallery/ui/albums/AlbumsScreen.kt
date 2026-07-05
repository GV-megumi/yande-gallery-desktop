package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.Routes
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import com.bluskysoftware.yandegallery.ui.common.writeFailText
import kotlinx.coroutines.launch

/**
 * 相册 tab：两列图集卡片网格。点击卡片跳图集详情；卡片长按弹「重命名/删除」菜单；
 * 右下 FAB 新建图集（选它而非 AppScaffold 顶栏「+」——顶栏是无 VM 引用的无状态壳，
 * 把对话框/快照/结果提示都留在本屏更内聚，不必把 albums 专属状态穿透进共享脚手架）。
 * 无图集时展示空态文案，但 FAB 仍在，可创建首个图集。写入口离线（connState.online=false）置灰。
 */
@Composable
fun AlbumsScreen(
    viewModel: AlbumsViewModel,
    navController: NavHostController,
) {
    val activeServer by viewModel.activeServer.collectAsStateWithLifecycle()
    // 三态：null=加载中（DB 未首发射）/ 空列表=确无图集 / 非空=有图集（M4-T15，A7 消空态闪帧）
    val albums by viewModel.albums.collectAsStateWithLifecycle()
    val connState by viewModel.connState.collectAsStateWithLifecycle()
    val online = connState.online

    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    // 对话框状态用 rememberSaveable 抗旋转（新代码从简；id 用可空 Long 哨兵，null=未打开）
    var showNew by rememberSaveable { mutableStateOf(false) }
    var newName by rememberSaveable { mutableStateOf("") }
    var renameId by rememberSaveable { mutableStateOf<Long?>(null) }
    var renameName by rememberSaveable { mutableStateOf("") }
    var deleteId by rememberSaveable { mutableStateOf<Long?>(null) }
    var deleteName by rememberSaveable { mutableStateOf("") }

    val baseUrl = activeServer?.baseUrl.orEmpty()
    val serverId = activeServer?.id ?: 0L
    val loader = viewModel.thumbnailLoader

    Scaffold(
        floatingActionButton = {
            // 离线置灰：disabled 配色 + 无障碍语义 disabled()；离线点击给 snackbar 明确原因（替换静默空转，spec §8）
            FloatingActionButton(
                onClick = {
                    if (online) {
                        newName = ""; showNew = true
                    } else {
                        scope.launch { snackbarHostState.showSnackbar("离线状态无法新建图集") }
                    }
                },
                containerColor = if (online) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.surfaceVariant
                },
                contentColor = if (online) {
                    MaterialTheme.colorScheme.onPrimaryContainer
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.38f)
                },
                modifier = Modifier
                    .semantics { if (!online) disabled() }
                    .testTag("albums_new_fab"),
            ) {
                Icon(Icons.Filled.Add, contentDescription = "新建图集")
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        // 外层 AppScaffold 已为相册路由消费系统栏 inset（顶栏+底部导航），内层不重复施加避免双 inset
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { padding ->
        val cards = albums
        if (cards == null) {
            // 加载中（DB 首发射前）：空白 Box 不显 AlbumsEmpty，避免已有图集用户冷启动空态闪帧（A7）
            Box(Modifier.fillMaxSize().padding(padding))
        } else if (cards.isEmpty()) {
            AlbumsEmpty(Modifier.padding(padding))
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                // 末行卡片给 FAB 让位（不被右下悬浮按钮遮挡）
                contentPadding = PaddingValues(bottom = 88.dp),
                modifier = Modifier.fillMaxSize().padding(padding).testTag("albums_grid"),
            ) {
                items(cards, key = { it.gallery.id }) { card ->
                    AlbumCardItem(
                        card = card,
                        baseUrl = baseUrl,
                        serverId = serverId,
                        loader = loader,
                        online = online,
                        onClick = { navController.navigate(Routes.albumDetail(card.gallery.id)) },
                        onRename = { renameId = card.gallery.id; renameName = card.gallery.name },
                        onDelete = { deleteId = card.gallery.id; deleteName = card.gallery.name },
                    )
                }
            }
        }
    }

    // 新建图集：输入名 → createGallery（名字去空白；空名不可提交）
    if (showNew) {
        AlbumNameDialog(
            title = "新建图集",
            name = newName,
            onNameChange = { newName = it },
            confirmLabel = "创建",
            confirmTag = "album_new_confirm",
            onConfirm = {
                val name = newName.trim()
                showNew = false
                scope.launch {
                    when (val r = viewModel.createGallery(name)) {
                        WriteResult.Success -> snackbarHostState.showSnackbar("已新建图集「$name」")
                        is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("新建图集失败", r))
                    }
                }
            },
            onDismiss = { showNew = false },
        )
    }

    // 重命名：对话框预填当前名（renameName 打开时已置为 card.gallery.name）→ renameGallery
    renameId?.let { id ->
        AlbumNameDialog(
            title = "重命名图集",
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

    // 删除：二次确认，明示只删图集不删图片文件（brief 契约）→ deleteGallery
    deleteId?.let { id ->
        DeleteAlbumConfirmDialog(
            albumName = deleteName,
            onConfirm = {
                // 先捕获局部再清状态：协程内的 snackbar 只用局部 name（原实现读已被后续清空/覆盖的 state）
                val name = deleteName
                deleteId = null
                scope.launch {
                    when (val r = viewModel.deleteGallery(id)) {
                        WriteResult.Success -> snackbarHostState.showSnackbar("已删除图集「$name」")
                        is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("删除图集失败", r))
                    }
                }
            },
            onDismiss = { deleteId = null },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AlbumCardItem(
    card: AlbumCard,
    baseUrl: String,
    serverId: Long,
    loader: ImageLoader,
    online: Boolean,
    onClick: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    Box {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp)
                .combinedClickable(
                    onClick = onClick,                    // 单击照旧进图集详情，不被长按菜单破坏
                    onLongClick = { menuOpen = true },
                )
                .testTag("album_card_${card.gallery.id}"),
        ) {
            val coverId = card.coverImageId
            if (coverId != null) {
                RetryableAsyncImage(
                    model = thumbnailRequest(LocalContext.current, baseUrl, serverId, coverId),
                    imageLoader = loader,
                    contentDescription = card.gallery.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().aspectRatio(1f),
                )
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(1f)
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
            }
            Text(
                card.gallery.name,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 4.dp),
            )
            Text(
                "${card.gallery.imageCount} 张",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        // 长按菜单：离线时两项 enabled=false 原生置灰（写入口离线不可用，spec §8）
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(
                text = { Text("重命名") },
                enabled = online,
                onClick = { menuOpen = false; onRename() },
                modifier = Modifier.testTag("album_menu_rename_${card.gallery.id}"),
            )
            DropdownMenuItem(
                text = { Text("删除") },
                enabled = online,
                onClick = { menuOpen = false; onDelete() },
                modifier = Modifier.testTag("album_menu_delete_${card.gallery.id}"),
            )
        }
    }
}

/** 新建/重命名共用的名字输入对话框：单行输入，空名不可提交。 */
@Composable
internal fun AlbumNameDialog(
    title: String,
    name: String,
    onNameChange: (String) -> Unit,
    confirmLabel: String,
    confirmTag: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = onNameChange,
                label = { Text("图集名") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("album_name_field"),
            )
        },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                enabled = name.isNotBlank(),
                modifier = Modifier.testTag(confirmTag),
            ) { Text(confirmLabel) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

/** 删除图集二次确认：明示只删图集、不删图片文件（brief 契约）。 */
@Composable
internal fun DeleteAlbumConfirmDialog(
    albumName: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("删除图集") },
        text = { Text("确定删除图集「$albumName」？只删除图集本身，不删除其中的图片文件。") },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                modifier = Modifier.testTag("album_delete_confirm"),
            ) { Text("删除") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun AlbumsEmpty(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(32.dp).testTag("albums_empty"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "还没有图集",
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            "点右下「+」新建，或连接服务器同步后在此查看",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}
