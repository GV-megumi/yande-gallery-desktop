package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.nestedscroll.nestedScroll
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
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import com.bluskysoftware.yandegallery.ui.common.MiuiLargeTitle
import com.bluskysoftware.yandegallery.ui.common.MiuiPinnedTopBar
import com.bluskysoftware.yandegallery.ui.common.MiuiTextField
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import com.bluskysoftware.yandegallery.ui.common.rememberMiuiHeaderState
import com.bluskysoftware.yandegallery.ui.common.writeFailText
import com.bluskysoftware.yandegallery.ui.theme.MiuiTokens
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * 相册 tab：折叠大标题 + 两列图集卡片网格（spec §4.1）。点击卡片跳图集详情；卡片长按弹
 * 「重命名/删除」菜单；顶栏右上「+」新建图集（v0.5 去 FAB，原 FAB 语义平移至顶栏动作——
 * 对话框/快照/结果提示仍留在本屏更内聚，不必把 albums 专属状态穿透进共享脚手架）。
 * 无图集时展示空态文案，但「+」仍在，可创建首个图集。写入口离线（connState.online=false）置灰。
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

    // 折叠大标题（照片页同款 exitUntilCollapsed 结构）：本页无 PullToRefreshBox，connection 直挂
    // 内容 Column；松手 settle 贴齐全收/全展，collectLatest 让贴齐动画可被新手势立即取消（Task 5 评审同款）。
    val header = rememberMiuiHeaderState()
    val gridState = rememberLazyGridState()
    LaunchedEffect(gridState) {
        // 深处判定一并入流（终审 Minor#2，照片页同款）：程序化跳位落深处后空闲直接收起
        snapshotFlow { gridState.isScrollInProgress to (gridState.firstVisibleItemIndex > 0) }
            .collectLatest { (scrolling, deep) ->
                if (!scrolling) {
                    if (deep) header.collapse() else header.settle()
                }
            }
    }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().nestedScroll(header.connection)) {
            MiuiPinnedTopBar(title = "相册", scrolled = header.scrolled, actions = {
                // 离线可点但给明确原因（原 FAB 语义平移）；置灰观感 + 无障碍 disabled
                val tint = if (online) MaterialTheme.colorScheme.onSurface
                else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                IconButton(
                    onClick = {
                        if (online) {
                            newName = ""; showNew = true
                        } else {
                            scope.launch { snackbarHostState.showSnackbar("离线状态无法新建图集") }
                        }
                    },
                    modifier = Modifier
                        .semantics { if (!online) disabled() }
                        .testTag("albums_new"),
                ) { Icon(Icons.Filled.Add, contentDescription = "新建图集", tint = tint) }
            })
            MiuiLargeTitle("相册", header)
            val cards = albums
            when {
                // 加载中（DB 首发射前）：空白 Box 不显 AlbumsEmpty，避免已有图集用户冷启动空态闪帧（A7）
                cards == null -> Box(Modifier.fillMaxSize())
                cards.isEmpty() -> AlbumsEmpty()
                else -> LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    state = gridState,
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    modifier = Modifier.fillMaxSize().testTag("albums_grid"),
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
        SnackbarHost(
            snackbarHostState,
            Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp),
        )
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
                .combinedClickable(
                    onClick = onClick,                    // 单击照旧进图集详情，不被长按菜单破坏
                    onLongClick = { menuOpen = true },
                )
                .testTag("album_card_${card.gallery.id}"),
        ) {
            val coverId = card.coverImageId
            // 封面 MIUI 卡片化（spec §4.1）：1:1 圆角封面 + 底下左对齐名称/数量两行
            if (coverId != null) {
                RetryableAsyncImage(
                    model = thumbnailRequest(LocalContext.current, baseUrl, serverId, coverId),
                    imageLoader = loader,
                    contentDescription = card.gallery.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().aspectRatio(1f).clip(MiuiTokens.CoverShape),
                )
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(1f)
                        .clip(MiuiTokens.CoverShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
            }
            Text(
                card.gallery.name,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(top = 8.dp),
            )
            Text(
                "${card.gallery.imageCount} 张",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
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
    MiuiDialog(
        title = title,
        onDismiss = onDismiss,
        confirmText = confirmLabel,
        confirmEnabled = name.isNotBlank(),
        confirmTag = confirmTag,
        onConfirm = onConfirm,
        content = {
            MiuiTextField(
                value = name,
                onValueChange = onNameChange,
                label = "图集名",
                modifier = Modifier.fillMaxWidth().testTag("album_name_field"),
            )
        },
    )
}

/** 删除图集二次确认：明示只删图集、不删图片文件（brief 契约）。 */
@Composable
internal fun DeleteAlbumConfirmDialog(
    albumName: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    MiuiDialog(
        title = "删除图集",
        text = "确定删除图集「$albumName」？只删除图集本身，不删除其中的图片文件。",
        confirmText = "删除",
        destructive = true,
        confirmTag = "album_delete_confirm",
        onConfirm = onConfirm,
        onDismiss = onDismiss,
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
            "点右上「+」新建，或连接服务器同步后在此查看",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}
