package com.bluskysoftware.yandegallery.ui.albums

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.GalleryPickerDialog
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import com.bluskysoftware.yandegallery.ui.common.SelectableCell
import com.bluskysoftware.yandegallery.ui.common.SelectionBottomBar
import com.bluskysoftware.yandegallery.ui.common.SelectionTopBar
import com.bluskysoftware.yandegallery.ui.common.writeFailText
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** 图集详情：4 列网格 + 顶栏返回；T13 加多选（长按进入，批量下载/分享/删除/加入/移出图集）。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AlbumDetailScreen(
    viewModel: AlbumDetailViewModel,
    onBack: () -> Unit,
    onOpenViewer: (imageId: Long) -> Unit,
) {
    val title by viewModel.title.collectAsStateWithLifecycle(initialValue = "")
    val activeServer by viewModel.activeServer.collectAsStateWithLifecycle()
    val connState by viewModel.connState.collectAsStateWithLifecycle()
    val selected by viewModel.selection.selectedFlow.collectAsStateWithLifecycle()
    val galleries by viewModel.galleries.collectAsStateWithLifecycle(initialValue = emptyList())
    val items = viewModel.pagingFlow.collectAsLazyPagingItems()
    val baseUrl = activeServer?.baseUrl.orEmpty()
    val serverId = activeServer?.id ?: 0L
    val loader = viewModel.thumbnailLoader
    val selectionActive = selected.isNotEmpty()

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    var confirmBatchDelete by remember { mutableStateOf(false) }
    // 确认文案分支依据（M4-T9）：选中项里是否有已下载副本——点删除时快照一次，随对话框生命周期使用
    var batchHasLocalCopies by remember { mutableStateOf(false) }
    var showGalleryPicker by remember { mutableStateOf(false) }

    // 30+ 批量副本级联的系统确认：结果无需处理——downloads 行已在 batchDelete 清掉，
    // 同意/拒绝只影响系统相册文件去留（拒绝即保留文件，spec §8）。
    val batchCascadeLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { }

    // 多选激活时系统返回键只退出多选，不返回上一页（brief 裁定）。
    BackHandler(enabled = selectionActive) { viewModel.selection.clear() }

    // 放弃等待（D9 取消语义）：退出多选/清选择即取消分享等待协程；底层下载不取消（KEEP 队列继续，产物仍落库）。
    var shareJob by remember { mutableStateOf<Job?>(null) }
    LaunchedEffect(selectionActive) {
        if (!selectionActive) {
            shareJob?.cancel()
            shareJob = null
        }
    }

    /** 批量分享完整流（M4-T11/D9）：缺失项先入队原图下载，等全部终态后自动分享；部分失败仍分享成功子集。 */
    fun shareSelected() {
        val ids = viewModel.selection.selected.toList()
        shareJob = scope.launch {
            val missing = ids.size - viewModel.downloadedUrisFor(ids).size
            if (!connState.online && missing > 0) {
                snackbarHostState.showSnackbar("离线状态无法下载缺失原图，请连接后重试")
                return@launch
            }
            if (missing > 0) {
                snackbarHostState.showSnackbar("正在下载缺失原图，完成后自动分享…")
            }
            val outcome = viewModel.ensureShareUris(ids)
            if (outcome.uris.isEmpty()) {
                snackbarHostState.showSnackbar("分享取消：原图下载失败")
                return@launch
            }
            val send = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = "image/*"
                putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(outcome.uris.map { it.toUri() }))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(send, "分享图片"))
            shareJob = null   // 分享已发出：随后的清选择不应再取消收尾提示
            viewModel.selection.clear()
            if (outcome.failedIds.isNotEmpty()) {
                snackbarHostState.showSnackbar("${outcome.failedIds.size} 张下载失败，已分享成功的 ${outcome.uris.size} 张")
            }
        }
    }

    Scaffold(
        topBar = {
            if (selectionActive) {
                // 替换常规顶栏；Scaffold topBar 槽内自补状态栏 inset（TopAppBar 自带，Surface 需手动）
                SelectionTopBar(
                    count = selected.size,
                    // 「全选」= 当前已加载进分页快照的图片（分页语义；继续滚动加载后可再点全选并入）
                    onSelectAll = {
                        viewModel.selection.selectAll(
                            (0 until items.itemCount).mapNotNull { items.peek(it)?.id },
                        )
                    },
                    onCancel = { viewModel.selection.clear() },
                    modifier = Modifier.statusBarsPadding(),
                )
            } else {
                TopAppBar(
                    title = { Text(title) },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                        }
                    },
                )
            }
        },
        bottomBar = {
            if (selectionActive) {
                SelectionBottomBar(
                    online = connState.online,
                    inGallery = true,
                    onDownload = {
                        val ids = viewModel.selection.selected.toList()
                        viewModel.downloadSelected(ids)
                        viewModel.selection.clear()
                        scope.launch { snackbarHostState.showSnackbar("已加入下载队列（${ids.size} 张）") }
                    },
                    onShare = { shareSelected() },
                    onDelete = {
                        val ids = viewModel.selection.selected.toList()
                        scope.launch {
                            // 先探一次是否含已下载副本，确认文案据此分支（M4-T9）
                            batchHasLocalCopies = viewModel.downloadedUrisFor(ids).isNotEmpty()
                            confirmBatchDelete = true
                        }
                    },
                    onAddToGallery = { showGalleryPicker = true },
                    onRemoveFromGallery = {
                        val ids = viewModel.selection.selected.toList()
                        scope.launch {
                            // 成功时 VM 已清空选择（brief 裁定）；失败保留选择供重试
                            when (val r = viewModel.removeSelectedFromGallery(ids)) {
                                WriteResult.Success -> snackbarHostState.showSnackbar("已移出当前图集（${ids.size} 张）")
                                is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("移出图集失败", r))
                            }
                        }
                    },
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        AlbumDetailGrid(
            items = items,
            modifier = Modifier.padding(padding),
            imageCell = { image ->
                SelectableCell(
                    selected = image.id in selected,
                    selectionActive = selectionActive,
                    onOpen = { onOpenViewer(image.id) },
                    onToggle = { viewModel.selection.toggle(image.id) },
                    modifier = Modifier
                        .aspectRatio(1f)
                        .padding(1.dp),
                ) {
                    RetryableAsyncImage(
                        model = thumbnailRequest(LocalContext.current, baseUrl, serverId, image.id),
                        imageLoader = loader,
                        contentDescription = image.filename,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            },
        )
    }

    // 批量删除二次确认：明示数量（brief 契约）；选中含已下载副本时明示本机副本一并级联（spec §8，M4-T9）
    if (confirmBatchDelete) {
        val count = selected.size
        AlertDialog(
            onDismissRequest = { confirmBatchDelete = false },
            title = { Text("批量删除") },
            text = {
                Text(
                    if (batchHasLocalCopies) {
                        "确定删除选中的 $count 张图片？将从服务器删除；本机已保存的原图副本也会一并删除。"
                    } else {
                        "确定删除选中的 $count 张图片？将从服务器删除。"
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmBatchDelete = false
                        val ids = viewModel.selection.selected.toList()
                        scope.launch {
                            val localUris = viewModel.downloadedUrisFor(ids).map { it.toUri() }   // 删行前快照
                            when (val r = viewModel.batchDeleteSelected(ids)) {
                                WriteResult.Success -> {
                                    snackbarHostState.showSnackbar("已删除 ${ids.size} 张")
                                    if (localUris.isNotEmpty()) {
                                        val pending = viewModel.buildBatchDeleteRequest(localUris)
                                        if (pending != null) {
                                            // 30+：一次系统批量确认；拒绝仅保留文件（行已清）
                                            batchCascadeLauncher.launch(
                                                IntentSenderRequest.Builder(pending.intentSender).build(),
                                            )
                                        } else {
                                            val (deleted, kept) = viewModel.deleteLocalCopies(localUris)
                                            if (kept > 0) {
                                                snackbarHostState.showSnackbar("本机副本已删除 $deleted 张、保留 $kept 张（无删除权限）")
                                            }
                                        }
                                    }
                                }
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

    // 「加入图集」选择器（复用 T11 GalleryPickerDialog，已迁至 ui/common）：图集内也可加入其它图集
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

/**
 * 图集详情网格骨架（无状态，便于测试注入 imageCell）：4 列固定网格，items 直接是 ImageEntity，
 * 无日期分组（分组头是照片时间轴 Task 10 的特性，图集详情按 spec 不需要）。
 */
@Composable
fun AlbumDetailGrid(
    items: LazyPagingItems<ImageEntity>,
    imageCell: @Composable (ImageEntity) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(4),
        modifier = modifier.fillMaxSize(),
    ) {
        items(
            count = items.itemCount,
            key = { index -> items.peek(index)?.let { "i:${it.id}" } ?: "null:$index" },
        ) { index ->
            val item = items[index]
            if (item != null) {
                imageCell(item)
            } else {
                Box(Modifier.aspectRatio(1f))
            }
        }
    }
}
