package com.bluskysoftware.yandegallery.ui.photos

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import coil3.compose.AsyncImage
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest
import com.bluskysoftware.yandegallery.domain.sync.SyncPhase
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.ConnectionBanner
import com.bluskysoftware.yandegallery.ui.common.GalleryPickerDialog
import com.bluskysoftware.yandegallery.ui.common.SelectableCell
import com.bluskysoftware.yandegallery.ui.common.SelectionBottomBar
import com.bluskysoftware.yandegallery.ui.common.SelectionTopBar
import com.bluskysoftware.yandegallery.ui.common.writeFailText
import kotlinx.coroutines.launch

/**
 * 下拉刷新转圈的时机：增量/对账阶段（这两者无数字进度）。
 * 首同步 FullSync 另有顶部 LinearProgressIndicator 显示 done/total，不再叠加转圈避免双指示器。
 */
private fun SyncPhase.showsRefreshSpinner(): Boolean =
    this is SyncPhase.Incremental || this is SyncPhase.Reconciling

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PhotosScreen(
    viewModel: PhotosViewModel,
    onAddServer: () -> Unit,
    onOpenViewer: (imageId: Long) -> Unit,
) {
    val activeServer by viewModel.activeServer.collectAsStateWithLifecycle()
    val syncPhase by viewModel.syncPhase.collectAsStateWithLifecycle()
    val connState by viewModel.connState.collectAsStateWithLifecycle()
    val selected by viewModel.selection.selectedFlow.collectAsStateWithLifecycle()
    val galleries by viewModel.galleries.collectAsStateWithLifecycle(initialValue = emptyList())
    val items = viewModel.pagingFlow.collectAsLazyPagingItems()
    val selectionActive = selected.isNotEmpty()

    // dataVersion/serverId 变化触发的全量重建 → Snackbar 提示（spec §8）
    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(Unit) {
        viewModel.rebuildNotices.collect {
            snackbarHostState.showSnackbar("服务器数据已变化，已全量重建本地镜像")
        }
    }

    // 无激活服务器：不进网格分支，直接渲染引导态。
    val server = activeServer
    if (server == null) {
        PhotosGuide(onAddServer = onAddServer)
        return
    }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var confirmBatchDelete by remember { mutableStateOf(false) }
    var showGalleryPicker by remember { mutableStateOf(false) }

    // 多选激活时系统返回键只退出多选，不返回上一页（brief 裁定）。
    BackHandler(enabled = selectionActive) { viewModel.selection.clear() }

    /** 批量分享：全部已下载 → ACTION_SEND_MULTIPLE 其 MediaStore uri；含未下载 → 提示（简化版，完整流后置 M4）。 */
    fun shareSelected() {
        val ids = viewModel.selection.selected.toList()
        scope.launch {
            val uris = viewModel.shareUrisFor(ids)
            if (uris == null) {
                snackbarHostState.showSnackbar("所选包含未下载原图的项，请先批量下载")
            } else {
                val send = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                    type = "image/*"
                    putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris.map { it.toUri() }))
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                context.startActivity(Intent.createChooser(send, "分享图片"))
                viewModel.selection.clear()
            }
        }
    }

    val baseUrl = server.baseUrl
    val serverId = server.id
    val loader = viewModel.thumbnailLoader
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // 多选顶部选择栏：激活时盖在内容区顶部（AppScaffold 的 TopAppBar 仍在其上，不动导航壳）
            if (selectionActive) {
                SelectionTopBar(
                    count = selected.size,
                    // 「全选」= 当前已加载进分页快照的照片（分页语义；继续滚动加载后可再点全选并入）
                    onSelectAll = {
                        viewModel.selection.selectAll(
                            (0 until items.itemCount).mapNotNull {
                                (items.peek(it) as? TimelineItem.Photo)?.image?.id
                            },
                        )
                    },
                    onCancel = { viewModel.selection.clear() },
                )
            }
            // 顶部连接横幅：offline / unauthorized（点击跳服务器页重新配对）
            ConnectionBanner(state = connState, onReconnectAuth = onAddServer)
            PullToRefreshBox(
                isRefreshing = syncPhase.showsRefreshSpinner(),
                onRefresh = viewModel::refresh,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
            ) {
                Column(Modifier.fillMaxSize()) {
                    (syncPhase as? SyncPhase.FullSync)?.let { phase ->
                        val fraction = if (phase.total > 0) phase.done.toFloat() / phase.total else 0f
                        LinearProgressIndicator(
                            progress = { fraction },
                            modifier = Modifier.fillMaxWidth().testTag("sync_progress"),
                        )
                    }
                    PhotosGrid(
                        items = items,
                        photoCell = { photo ->
                            val id = photo.image.id
                            SelectableCell(
                                selected = id in selected,
                                selectionActive = selectionActive,
                                onOpen = { onOpenViewer(id) },
                                onToggle = { viewModel.selection.toggle(id) },
                                modifier = Modifier
                                    .aspectRatio(1f)
                                    .padding(1.dp),
                            ) {
                                AsyncImage(
                                    model = thumbnailRequest(LocalContext.current, baseUrl, serverId, id),
                                    imageLoader = loader,
                                    contentDescription = photo.image.filename,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize(),
                                )
                            }
                        },
                    )
                }
            }
            // 多选底部动作栏：写动作离线置灰；时间轴无图集上下文（inGallery=false，无「移出」）
            if (selectionActive) {
                SelectionBottomBar(
                    online = connState.online,
                    inGallery = false,
                    onDownload = {
                        val ids = viewModel.selection.selected.toList()
                        viewModel.downloadSelected(ids)
                        viewModel.selection.clear()
                        scope.launch { snackbarHostState.showSnackbar("已加入下载队列（${ids.size} 张）") }
                    },
                    onShare = { shareSelected() },
                    onDelete = { confirmBatchDelete = true },
                    onAddToGallery = { showGalleryPicker = true },
                )
            }
        }
        SnackbarHost(snackbarHostState, Modifier.align(Alignment.BottomCenter))
    }

    // 批量删除二次确认：明示数量（brief 契约）；本机已保存副本不级联（controller 裁定，M4 再议）
    if (confirmBatchDelete) {
        val count = selected.size
        AlertDialog(
            onDismissRequest = { confirmBatchDelete = false },
            title = { Text("批量删除") },
            text = { Text("确定删除选中的 $count 张图片？将从服务器删除；本机已保存的原图副本不受影响。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmBatchDelete = false
                        val ids = viewModel.selection.selected.toList()
                        scope.launch {
                            when (val r = viewModel.batchDeleteSelected(ids)) {
                                WriteResult.Success -> snackbarHostState.showSnackbar("已删除 ${ids.size} 张")
                                is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("批量删除失败", r))
                            }
                            // 成败都清选择：成功项已从网格消失，失败信息已提示，避免残留失效 id
                            viewModel.selection.clear()
                        }
                    },
                    modifier = Modifier.testTag("batch_delete_confirm"),
                ) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { confirmBatchDelete = false }) { Text("取消") }
            },
        )
    }

    // 「加入图集」选择器（复用 T11 GalleryPickerDialog，已迁至 ui/common）
    if (showGalleryPicker) {
        GalleryPickerDialog(
            galleries = galleries,
            onPick = { galleryId ->
                showGalleryPicker = false
                val ids = viewModel.selection.selected.toList()
                scope.launch {
                    when (val r = viewModel.addSelectedToGallery(galleryId, ids)) {
                        WriteResult.Success -> {
                            snackbarHostState.showSnackbar("已加入图集（${ids.size} 张）")
                            viewModel.selection.clear()
                        }
                        is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("加入图集失败", r))
                    }
                }
            },
            onDismiss = { showGalleryPicker = false },
        )
    }
}

/** 无激活服务器时的引导态：文案 + 跳转服务器管理按钮。 */
@Composable
fun PhotosGuide(onAddServer: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp).testTag("photos_guide"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "还没有连接任何服务器",
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            "先添加服务器后即可浏览照片时间轴",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
        )
        Button(onClick = onAddServer) { Text("先添加服务器") }
    }
}

/**
 * 时间轴网格骨架（无状态，便于测试注入 photoCell）：4 列固定网格，Header 满行跨列。
 * span/key 用 peek 读取快照避免触发加载；photoCell 由调用方提供（生产用 AsyncImage，测试注入替身）。
 */
@Composable
fun PhotosGrid(
    items: LazyPagingItems<TimelineItem>,
    photoCell: @Composable (TimelineItem.Photo) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(4),
        modifier = modifier.fillMaxSize(),
    ) {
        items(
            count = items.itemCount,
            span = { index ->
                if (items.peek(index) is TimelineItem.Header) GridItemSpan(maxLineSpan) else GridItemSpan(1)
            },
            key = { index ->
                when (val item = items.peek(index)) {
                    is TimelineItem.Header -> "h:${item.dayKey}"
                    is TimelineItem.Photo -> "p:${item.image.id}"
                    null -> "null:$index"
                }
            },
        ) { index ->
            when (val item = items[index]) {
                is TimelineItem.Header -> Text(
                    item.display,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
                is TimelineItem.Photo -> photoCell(item)
                null -> Box(Modifier.aspectRatio(1f))
            }
        }
    }
}
