package com.bluskysoftware.yandegallery.ui.albums

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
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
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.DeviceCapabilities
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import com.bluskysoftware.yandegallery.data.prefs.PhotoSortField
import com.bluskysoftware.yandegallery.data.prefs.ViewPrefs
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.CopyTargetPicker
import com.bluskysoftware.yandegallery.ui.common.MiuiChoiceRow
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import com.bluskysoftware.yandegallery.ui.common.MiuiMenuGroupRow
import com.bluskysoftware.yandegallery.ui.common.MiuiMoreMenu
import com.bluskysoftware.yandegallery.ui.common.MiuiSortRow
import com.bluskysoftware.yandegallery.ui.common.photoSortPreview
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar
import com.bluskysoftware.yandegallery.ui.common.PickerMode
import com.bluskysoftware.yandegallery.ui.common.PinchStepState
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import com.bluskysoftware.yandegallery.ui.common.SelectableCell
import com.bluskysoftware.yandegallery.ui.common.SelectionBottomBar
import com.bluskysoftware.yandegallery.ui.common.awaitPagingRefreshSettled
import com.bluskysoftware.yandegallery.ui.common.SelectionTopBar
import com.bluskysoftware.yandegallery.ui.common.detectPinchStep
import com.bluskysoftware.yandegallery.ui.common.writeFailText
import com.bluskysoftware.yandegallery.ui.theme.MiuiTokens
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** 相册详情：4 列网格 + 居中双行顶栏（标题+数量副标题，spec §4.2）；T13 加多选（长按进入，批量下载/分享/删除/复制到/移动到/移出相册）。 */
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

    // v0.6 排序/列数（spec §5.1）：共享 ViewPrefs 一档全相册通用；捏合放大 = 列数减（格子变大）
    val detailSort by viewModel.detailSort.collectAsStateWithLifecycle()
    val columns by viewModel.detailColumns.collectAsStateWithLifecycle()
    var showOptions by rememberSaveable { mutableStateOf(false) }
    val pinchState = remember {
        PinchStepState<Int>(
            larger = { if (it > ViewPrefs.MIN_DETAIL_COLUMNS) it - 1 else null },   // 放大 → 列数减
            smaller = { if (it < ViewPrefs.MAX_DETAIL_COLUMNS) it + 1 else null },
        )
    }
    // 排序切换回顶（终审 Minor#3，照片页同款）：Pager 重建后网格不自动回顶，深滚后切排序会
    // 钳在任意位置；lastAppliedDetailSort 经 rememberSaveable 抗返回恢复，仅真实切换时回顶
    val detailGridState = rememberLazyGridState()
    var lastAppliedDetailSort by rememberSaveable { mutableStateOf(detailSort.name) }
    LaunchedEffect(detailSort) {
        if (detailSort.name != lastAppliedDetailSort) {
            lastAppliedDetailSort = detailSort.name
            detailGridState.scrollToItem(0)
            // 第二针（审查 minor，照片页同款）：新世代落地时按 key 维持滚动位置会抵消上句回顶
            awaitPagingRefreshSettled(items)
            detailGridState.scrollToItem(0)
        }
    }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    // 对话框/文案分支状态用 rememberSaveable 抗旋转（选择态存活于 VM，重建后对话框与文案随之复原）
    var confirmBatchDelete by rememberSaveable { mutableStateOf(false) }
    // 确认文案分支依据（M4-T9）：选中项里是否有已下载副本——点删除时快照一次，随对话框生命周期使用
    var batchHasLocalCopies by rememberSaveable { mutableStateOf(false) }
    // 目标选择器模式（Task 11）：null=关闭；Copy=「复制到」两节；Move=「移动到」仅桌面相册节
    var pickerMode by rememberSaveable { mutableStateOf<PickerMode?>(null) }
    // 手机相册节候选：仅 Copy 模式需要，打开时 suspend 取一次快照（对话框生命周期内不追新脉冲）
    var deviceAlbums by remember { mutableStateOf<List<DeviceAlbum>>(emptyList()) }
    LaunchedEffect(pickerMode) {
        if (pickerMode == PickerMode.Copy) deviceAlbums = viewModel.deviceAlbumTargets()
    }

    // 多选激活时系统返回键只退出多选，不返回上一页（brief 裁定）。
    BackHandler(enabled = selectionActive) { viewModel.selection.clear() }

    // 放弃等待（D9 取消语义）：退出多选/清选择即取消分享等待协程；底层拉取不取消（镜像产物仍落库）。
    var shareJob by remember { mutableStateOf<Job?>(null) }
    LaunchedEffect(selectionActive) {
        if (!selectionActive) {
            shareJob?.cancel()
            shareJob = null
        }
    }

    /** 批量分享（spec §4.4 四级规则）：本地镜像直取；缺失项在线临时 ensure 入镜像后分享；
     *  部分失败仍分享成功子集。文件经 FileProvider 转 content:// 授权。 */
    fun shareSelected() {
        if (shareJob?.isActive == true) return   // 等待中：忽略重复点按（照大图页 share 同款防重入，D12A 一致性）
        val ids = viewModel.selection.selected.toList()
        shareJob = scope.launch {
            if (connState.online) {
                // fire-and-forget 子协程：提示不阻塞拉取（showSnackbar 挂起到消失，串行会推迟约 4s）；
                // 子协程随 shareJob 取消——放弃等待时提示同步消失。离线不显（不会有在线拉取动作）。
                launch { snackbarHostState.showSnackbar("正在获取缺失图片，完成后自动分享…") }
            }
            val outcome = viewModel.ensureShareFiles(ids)
            if (outcome.files.isEmpty()) {
                snackbarHostState.showSnackbar(
                    if (connState.online) "分享取消：图片获取失败" else "分享取消：所选图片未同步且当前离线",
                )
                return@launch
            }
            val uris = outcome.files.map {
                FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", it)
            }
            val send = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = "image/*"
                putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(send, "分享图片"))
            shareJob = null   // 分享已发出：随后的清选择不应再取消收尾提示
            viewModel.selection.clear()
            if (outcome.failedIds.isNotEmpty()) {
                snackbarHostState.showSnackbar("${outcome.failedIds.size} 张获取失败，已分享成功的 ${outcome.files.size} 张")
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
                // 居中标题 + 数量副标题（spec §4.2）；数量取镜像相册行的 imageCount（galleries 流已在收集）
                val count = galleries.firstOrNull { it.id == viewModel.currentGalleryId }?.imageCount
                MiuiSubPageTopBar(
                    title = title,
                    subtitle = count?.let { "$it 张" },
                    onBack = onBack,
                    actions = {
                        Box {
                            IconButton(onClick = { showOptions = true }, modifier = Modifier.testTag("detail_more")) {
                                Icon(Icons.Filled.MoreHoriz, contentDescription = "更多选项")
                            }
                            // 「⋯」多级菜单（面板改版）：锚定本按钮右上角弹出；排序/列数分类进二级，选择即生效即收
                            AlbumDetailMoreMenu(
                                expanded = showOptions,
                                sort = detailSort,
                                columns = columns,
                                onDismiss = { showOptions = false },
                                onSortField = { field -> viewModel.setDetailSort(field.next(detailSort)); showOptions = false },
                                onColumns = { viewModel.setDetailColumns(it); showOptions = false },
                            )
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
                        // 镜像写私有目录不需要 WRITE 权限——storageGate 包装移除（Task 10 删门卫本体）
                        val ids = viewModel.selection.selected.toList()
                        viewModel.downloadSelected(ids)
                        viewModel.selection.clear()
                        scope.launch { snackbarHostState.showSnackbar("已加入下载队列（${ids.size} 张）") }
                    },
                    onShare = { shareSelected() },
                    onDelete = {
                        val ids = viewModel.selection.selected.toList()
                        scope.launch {
                            // 先探一次是否含已下载副本，确认文案据此分支（M4-T9；D12A 改用短路 anyDownloaded）
                            batchHasLocalCopies = viewModel.anyDownloaded(ids)
                            confirmBatchDelete = true
                        }
                    },
                    onCopyTo = { pickerMode = PickerMode.Copy },
                    // 「移动到」仅相册详情有（spec §6.2：需要「当前相册」语义作移出端）
                    onMoveTo = { pickerMode = PickerMode.Move },
                    // 设为封面（v0.6 spec §5.3）：恰选 1 张才出现；先服务端后本地，失败零残留
                    onSetCover = if (selected.size == 1) {
                        {
                            val imageId = selected.first()
                            scope.launch {
                                when (val r = viewModel.setCover(imageId)) {
                                    WriteResult.Success -> {
                                        // 先退多选再提示：showSnackbar 挂起到消失(~4s)，后清会让
                                        // 选择栏残留 4 秒（移出/下载路径均为即清，审查 minor 对齐）
                                        viewModel.selection.clear()
                                        snackbarHostState.showSnackbar("已设为封面")
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
                                WriteResult.Success -> snackbarHostState.showSnackbar("已移出当前相册（${ids.size} 张）")
                                is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("移出相册失败", r))
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
                state = detailGridState,
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
                    // 本机镜像副本由 WriteRepository 删除成功后主动级联清（image_files 行+磁盘目录），
                    // 对账/sweepOrphans 兜底异常退出场景（spec §4.4 删除跟随），不再有 MediaStore 级联段
                    when (val r = viewModel.batchDeleteSelected(ids)) {
                        WriteResult.Success -> snackbarHostState.showSnackbar("已删除 ${ids.size} 张")
                        is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("批量删除失败", r))
                    }
                    // 成败都清选择：成功项已从网格消失，失败信息已提示，避免残留失效 id
                    viewModel.selection.clear()
                }
            },
        )
    }

    // 「复制到」/「移动到」目标选择器（Task 11，spec §6.1/§6.2）：Copy 双节；Move 仅桌面相册节
    // （组件内硬编码）。两模式都 excludeIds 排除当前所在相册防自指（D12A）。
    pickerMode?.let { mode ->
        CopyTargetPicker(
            mode = mode,
            galleries = galleries,
            deviceAlbums = deviceAlbums,
            deviceEnabled = DeviceCapabilities.canCopy() && connState.online,
            canCreateDeviceAlbum = DeviceCapabilities.canCreateAlbum(),
            excludeIds = setOf(viewModel.currentGalleryId),
            onPickGallery = { galleryId ->
                pickerMode = null
                val ids = viewModel.selection.selected.toList()
                scope.launch {
                    if (mode == PickerMode.Copy) {
                        when (val r = viewModel.addSelectedToGallery(galleryId, ids)) {
                            WriteResult.Success -> {
                                snackbarHostState.showSnackbar("已加入相册（${ids.size} 张）")
                                viewModel.selection.clear()
                            }
                            is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("加入相册失败", r))
                        }
                    } else {
                        val targetName = galleries.firstOrNull { it.id == galleryId }?.name.orEmpty()
                        when (val r = viewModel.moveTo(galleryId, ids)) {
                            WriteResult.Success -> {
                                viewModel.selection.clear()
                                snackbarHostState.showSnackbar("已移动到「$targetName」")
                            }
                            is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("移动失败", r))
                        }
                    }
                }
            },
            onPickDeviceAlbum = { path ->
                pickerMode = null
                val ids = viewModel.selection.selected.toList()
                viewModel.exportSelectedToDevice(ids, path)
                viewModel.selection.clear()
                scope.launch { snackbarHostState.showSnackbar("已开始复制到手机相册") }
            },
            onCreateDeviceAlbum = viewModel::createDeviceAlbum,
            onDismiss = { pickerMode = null },
        )
    }
}

/**
 * 详情页「⋯」多级菜单（面板改版，spec §5.1）：一级「排序方式 / 列数」分类，
 * 二级明细（时间/大小/文件名；3/4/5 列）。选择即生效即收菜单。
 */
@Composable
internal fun AlbumDetailMoreMenu(
    expanded: Boolean,
    sort: PhotoSort,
    columns: Int,
    onDismiss: () -> Unit,
    onSortField: (PhotoSortField) -> Unit,
    onColumns: (Int) -> Unit,
) {
    MiuiMoreMenu(
        expanded = expanded,
        onDismiss = onDismiss,
        root = { openPage ->
            MiuiMenuGroupRow("排序方式", photoSortPreview(sort), tag = "menu_group_sort") { openPage("sort", "排序方式") }
            MiuiMenuGroupRow("列数", "$columns 列", tag = "menu_group_columns") { openPage("columns", "列数") }
        },
        page = { key ->
            when (key) {
                "sort" -> PhotoSortField.entries.forEach { field ->
                    MiuiSortRow(
                        label = field.label,
                        selected = field.contains(sort),
                        ascending = sort.ascending,
                        tag = "detail_sort_option_${field.name.lowercase()}",
                    ) { onSortField(field) }
                }
                "columns" -> (ViewPrefs.MIN_DETAIL_COLUMNS..ViewPrefs.MAX_DETAIL_COLUMNS).forEach { n ->
                    MiuiChoiceRow("$n 列", columns == n, "detail_columns_$n") { onColumns(n) }
                }
            }
        },
    )
}

/**
 * 相册详情网格骨架（无状态，便于测试注入 imageCell）：[columns] 列固定网格（v0.6 3/4/5 档），
 * items 直接是 ImageEntity，无日期分组（分组头是照片时间轴的特性，相册详情按 spec 不需要）。
 */
@Composable
fun AlbumDetailGrid(
    items: LazyPagingItems<ImageEntity>,
    columns: Int,
    imageCell: @Composable (ImageEntity) -> Unit,
    modifier: Modifier = Modifier,
    state: LazyGridState = rememberLazyGridState(),   // v0.6 终审 Minor#3：宿主可控滚动位（排序回顶）
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(columns),
        state = state,
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
