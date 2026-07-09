package com.bluskysoftware.yandegallery.ui.albums

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
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
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import com.bluskysoftware.yandegallery.data.prefs.PhotoSortField
import com.bluskysoftware.yandegallery.data.prefs.ViewPrefs
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.GalleryPickerDialog
import com.bluskysoftware.yandegallery.ui.common.LEGACY_STORAGE_DENIED_TEXT
import com.bluskysoftware.yandegallery.ui.common.MiuiChoiceRow
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import com.bluskysoftware.yandegallery.ui.common.MiuiOptionsSheet
import com.bluskysoftware.yandegallery.ui.common.MiuiSheetCard
import com.bluskysoftware.yandegallery.ui.common.MiuiSortRow
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar
import com.bluskysoftware.yandegallery.ui.common.PinchStepState
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import com.bluskysoftware.yandegallery.ui.common.SelectableCell
import com.bluskysoftware.yandegallery.ui.common.SelectionBottomBar
import com.bluskysoftware.yandegallery.ui.common.SelectionTopBar
import com.bluskysoftware.yandegallery.ui.common.detectPinchStep
import com.bluskysoftware.yandegallery.ui.common.rememberLegacyStorageGate
import com.bluskysoftware.yandegallery.ui.common.writeFailText
import com.bluskysoftware.yandegallery.ui.theme.MiuiTokens
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** 图集详情：4 列网格 + 居中双行顶栏（标题+数量副标题，spec §4.2）；T13 加多选（长按进入，批量下载/分享/删除/加入/移出图集）。 */
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

    // v0.6 排序/列数（spec §5.1）：共享 ViewPrefs 一档全图集通用；捏合放大 = 列数减（格子变大）
    val detailSort by viewModel.detailSort.collectAsStateWithLifecycle()
    val columns by viewModel.detailColumns.collectAsStateWithLifecycle()
    var showOptions by rememberSaveable { mutableStateOf(false) }
    val pinchState = remember {
        PinchStepState<Int>(
            larger = { if (it > ViewPrefs.MIN_DETAIL_COLUMNS) it - 1 else null },   // 放大 → 列数减
            smaller = { if (it < ViewPrefs.MAX_DETAIL_COLUMNS) it + 1 else null },
        )
    }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    // 对话框/文案分支状态用 rememberSaveable 抗旋转（选择态存活于 VM，重建后对话框与文案随之复原）
    var confirmBatchDelete by rememberSaveable { mutableStateOf(false) }
    // 确认文案分支依据（M4-T9）：选中项里是否有已下载副本——点删除时快照一次，随对话框生命周期使用
    var batchHasLocalCopies by rememberSaveable { mutableStateOf(false) }
    var showGalleryPicker by rememberSaveable { mutableStateOf(false) }

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

    // legacy 存储权限门卫（BUG-07）：26-28 批量下载/带下载分享须先持 WRITE_EXTERNAL_STORAGE，29+ 直通
    val storageGate = rememberLegacyStorageGate(onDenied = {
        scope.launch { snackbarHostState.showSnackbar(LEGACY_STORAGE_DENIED_TEXT) }
    })

    /** 批量分享完整流（M4-T11/D9）：缺失项先入队原图下载，等全部终态后自动分享；部分失败仍分享成功子集。 */
    fun shareSelected() {
        if (shareJob?.isActive == true) return   // 等待中：忽略重复点按（照大图页 share 同款防重入，D12A 一致性）
        val ids = viewModel.selection.selected.toList()
        shareJob = scope.launch {
            val missing = ids.size - viewModel.downloadedUrisFor(ids).size
            if (!connState.online && missing > 0) {
                snackbarHostState.showSnackbar("离线状态无法下载缺失原图，请连接后重试")
                return@launch
            }
            if (missing > 0) {
                // fire-and-forget 子协程：提示不阻塞入队（showSnackbar 挂起到消失，串行会推迟下载约 4s）；
                // 子协程随 shareJob 取消——放弃等待时提示同步消失
                launch { snackbarHostState.showSnackbar("正在下载缺失原图，完成后自动分享…") }
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
                // 替换常规顶栏；Scaffold topBar 槽内自补状态栏 inset（MiuiSubPageTopBar 自带，Surface 需手动）
                SelectionTopBar(
                    count = selected.size,
                    // 「全选」= 当前已加载进分页快照的图片（分页语义；继续滚动加载后可再点全选并入）
                    onSelectAll = {
                        viewModel.selection.selectAll(
                            (0 until items.itemCount).mapNotNull { items.peek(it)?.id },
                        )
                    },
                    onCancel = { viewModel.selection.clear() },
                    // Scaffold topBar 槽内状态栏 inset 施于 Surface 内的 Row（背景连带着色状态栏区，D12A）
                    insetStatusBar = true,
                )
            } else {
                // 居中标题 + 数量副标题（spec §4.2）；数量取镜像图集行的 imageCount（galleries 流已在收集）
                val count = galleries.firstOrNull { it.id == viewModel.currentGalleryId }?.imageCount
                MiuiSubPageTopBar(
                    title = title,
                    subtitle = count?.let { "$it 张" },
                    onBack = onBack,
                    actions = {
                        IconButton(onClick = { showOptions = true }, modifier = Modifier.testTag("detail_more")) {
                            Icon(Icons.Filled.MoreHoriz, contentDescription = "更多选项")
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
                        storageGate {
                            val ids = viewModel.selection.selected.toList()
                            viewModel.downloadSelected(ids)
                            viewModel.selection.clear()
                            scope.launch { snackbarHostState.showSnackbar("已加入下载队列（${ids.size} 张）") }
                        }
                    },
                    // 批量分享可能给缺失项入队下载，一并过存储门卫（26-28 已全下载时多问一次权限，可接受）
                    onShare = { storageGate { shareSelected() } },
                    onDelete = {
                        val ids = viewModel.selection.selected.toList()
                        scope.launch {
                            // 先探一次是否含已下载副本，确认文案据此分支（M4-T9；D12A 改用短路 anyDownloaded）
                            batchHasLocalCopies = viewModel.anyDownloaded(ids)
                            confirmBatchDelete = true
                        }
                    },
                    onAddToGallery = { showGalleryPicker = true },
                    // 设为封面（v0.6 spec §5.3）：恰选 1 张才出现；先服务端后本地，失败零残留
                    onSetCover = if (selected.size == 1) {
                        {
                            val imageId = selected.first()
                            scope.launch {
                                when (val r = viewModel.setCover(imageId)) {
                                    WriteResult.Success -> {
                                        snackbarHostState.showSnackbar("已设为封面")
                                        viewModel.selection.clear()
                                    }
                                    is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("设为封面失败", r))
                                }
                            }
                        }
                    } else {
                        null
                    },
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
        // 捏合切列数（v0.6 spec §5.1）：手势挂网格外围父层（Initial pass 判定/消费，遍序理由见
        // detectPinchStep）。currentValue 直读 StateFlow.value：pointerInput(Unit) 不重启，避免闭包捕获过期档。
        Box(
            Modifier
                .padding(padding)
                .pointerInput(Unit) {
                    detectPinchStep(
                        state = pinchState,
                        currentValue = { viewModel.detailColumns.value },
                        onChange = viewModel::setDetailColumns,
                    )
                },
        ) {
            AlbumDetailGrid(
                items = items,
                columns = columns,
                imageCell = { image ->
                    SelectableCell(
                        selected = image.id in selected,
                        selectionActive = selectionActive,
                        onOpen = { onOpenViewer(image.id) },
                        onToggle = { viewModel.selection.toggle(image.id) },
                        modifier = Modifier
                            .aspectRatio(1f)
                            .clip(MiuiTokens.CellShape),
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
    }

    // 「⋯」选项面板（v0.6 spec §5.1）：排序/列数，选择即生效即收
    if (showOptions) {
        AlbumDetailOptionsSheet(
            sort = detailSort,
            columns = columns,
            onDismiss = { showOptions = false },
            onSortField = { field -> viewModel.setDetailSort(field.next(detailSort)); showOptions = false },
            onColumns = { viewModel.setDetailColumns(it); showOptions = false },
        )
    }

    // 批量删除二次确认：明示数量（brief 契约）；选中含已下载副本时明示本机副本一并级联（spec §8，M4-T9）
    if (confirmBatchDelete) {
        val count = selected.size
        MiuiDialog(
            title = "批量删除",
            text = if (batchHasLocalCopies) {
                "确定删除选中的 $count 张图片？将从服务器删除；本机已保存的原图副本也会一并删除。"
            } else {
                "确定删除选中的 $count 张图片？将从服务器删除。"
            },
            onDismiss = { confirmBatchDelete = false },
            confirmText = "删除",
            destructive = true,
            confirmTag = "batch_delete_confirm",
            onConfirm = {
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
        )
    }

    // 「加入图集」选择器（复用 T11 GalleryPickerDialog，已迁至 ui/common）：图集内也可加入其它图集
    if (showGalleryPicker) {
        GalleryPickerDialog(
            galleries = galleries,
            excludeIds = setOf(viewModel.currentGalleryId),   // 排除当前所在图集，避免「加入自身」自指（D12A）
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

/** 详情页「⋯」面板（spec §5.1）：排序（时间/大小/文件名）+ 列数（3/4/5）。 */
@Composable
internal fun AlbumDetailOptionsSheet(
    sort: PhotoSort,
    columns: Int,
    onDismiss: () -> Unit,
    onSortField: (PhotoSortField) -> Unit,
    onColumns: (Int) -> Unit,
) {
    MiuiOptionsSheet(onDismiss = onDismiss) {
        MiuiSheetCard("排序方式") {
            PhotoSortField.entries.forEach { field ->
                MiuiSortRow(
                    label = field.label,
                    selected = field.contains(sort),
                    ascending = sort.ascending,
                    tag = "detail_sort_option_${field.name.lowercase()}",
                ) { onSortField(field) }
            }
        }
        MiuiSheetCard("列数") {
            (ViewPrefs.MIN_DETAIL_COLUMNS..ViewPrefs.MAX_DETAIL_COLUMNS).forEach { n ->
                MiuiChoiceRow("$n 列", columns == n, "detail_columns_$n") { onColumns(n) }
            }
        }
    }
}

/**
 * 图集详情网格骨架（无状态，便于测试注入 imageCell）：[columns] 列固定网格（v0.6 3/4/5 档），
 * items 直接是 ImageEntity，无日期分组（分组头是照片时间轴的特性，图集详情按 spec 不需要）。
 */
@Composable
fun AlbumDetailGrid(
    items: LazyPagingItems<ImageEntity>,
    columns: Int,
    imageCell: @Composable (ImageEntity) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(columns),
        horizontalArrangement = Arrangement.spacedBy(MiuiTokens.GridGap),
        verticalArrangement = Arrangement.spacedBy(MiuiTokens.GridGap),
        contentPadding = PaddingValues(top = 2.dp),
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
