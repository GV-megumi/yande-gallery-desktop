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
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import coil3.compose.AsyncImage
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest
import com.bluskysoftware.yandegallery.domain.sync.SyncPhase
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.ConnectionBanner
import com.bluskysoftware.yandegallery.ui.common.FastScrollbar
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

    // ---- 捏合切档（M4-T3）：离散档位状态 + 月↔日跨越锚定 ----
    val tier by viewModel.densityTier.collectAsStateWithLifecycle()
    val gridState = rememberLazyGridState()
    val pinchState = remember { PinchDensityState() }
    // 月↔日跨越锚定：跨越前记视口顶部照片在「新分组粒度」下的 key + 目标粒度，重建后按 Header 定位。
    // 冷启动闪档（持久 MONTH、首帧 DEFAULT 后翻转）不经 changeTier——pendingAnchor 保持 null，
    // 锚定 effect 直接早退，重建后停留顶部，不会误锚/崩溃。
    var pendingAnchor by remember { mutableStateOf<PendingAnchor?>(null) }
    // 跨越判定基准（评审 Minor#2）：collected tier 经 DataStore 回环有滞后，同一手势内快速连切
    //（如 DAY_5→MONTH→DAY_5）用旧档会误判月↔日跨越方向；改记「最近一次已请求档」，未请求过回退 tier。
    var lastRequestedTier by remember { mutableStateOf<DensityTier?>(null) }

    fun changeTier(new: DensityTier) {
        val current = lastRequestedTier ?: tier
        if (new.monthGrouping != current.monthGrouping) {
            val first = gridState.firstVisibleItemIndex
            val anchorCreatedAt = (first until items.itemCount).asSequence()
                .mapNotNull { items.peek(it) as? TimelineItem.Photo }
                .firstOrNull()?.image?.createdAt
            pendingAnchor = anchorCreatedAt?.let {
                PendingAnchor(
                    key = if (new.monthGrouping) monthKeyOf(it) else dayKeyOf(it),
                    monthly = new.monthGrouping,
                )
            }
        }
        lastRequestedTier = new
        viewModel.setDensityTier(new)
    }

    TimelineAnchorEffect(items, gridState, pendingAnchor, onDone = { pendingAnchor = null })
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
                    // 捏合手势挂网格外围父层（Initial pass 判定/消费，遍序理由见 detectPinchDensity）。
                    // currentTier 直读 StateFlow.value：pointerInput(Unit) 不重启，避免闭包捕获过期档位。
                    // fillMaxSize：给 sticky 日期条/快速滚动滑块两个 overlay 提供对齐范围（T4）。
                    Box(
                        Modifier
                            .fillMaxSize()
                            .pointerInput(Unit) {
                                detectPinchDensity(
                                    state = pinchState,
                                    currentTier = { viewModel.densityTier.value },
                                    onTierChange = ::changeTier,
                                )
                            },
                    ) {
                        PhotosGrid(
                            items = items,
                            columns = tier.columns,
                            state = gridState,
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
                        // 视口顶部日期：derivedStateOf 只在文案变化时重组（滚动逐帧不扰动整屏）；
                        // 与滑块气泡共用 timelineItemDateLabel，向前回退最多 30 项找最近非空
                        val topDateLabel by remember(items, tier) {
                            derivedStateOf {
                                val top = gridState.firstVisibleItemIndex
                                (top downTo maxOf(0, top - 30)).firstNotNullOfOrNull { i ->
                                    if (i in 0 until items.itemCount) {
                                        timelineItemDateLabel(items.peek(i), tier.monthGrouping)
                                    } else {
                                        null
                                    }
                                }
                            }
                        }
                        StickyDateOverlay(
                            label = topDateLabel,
                            modifier = Modifier.align(Alignment.TopStart),
                        )
                        // 快速滚动滑块（D4）：映射已加载窗口，拖到底持续 append 延展
                        FastScrollbar(
                            gridState = gridState,
                            itemCount = items.itemCount,
                            labelFor = { index ->
                                if (index in 0 until items.itemCount) {
                                    timelineItemDateLabel(items.peek(index), tier.monthGrouping)
                                } else {
                                    null
                                }
                            },
                            modifier = Modifier.align(Alignment.CenterEnd),
                        )
                    }
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
 * sticky 顶部日期条（spec §7.1，M2 后置项）：LazyVerticalGrid 无原生 stickyHeader，用 overlay
 * 浮动条显示视口顶部 item 所属日期；label null（空列表）不渲染。文案与滑块气泡共用
 * timelineItemDateLabel 查找。internal 供 Robolectric 直测。
 */
@Composable
internal fun StickyDateOverlay(label: String?, modifier: Modifier = Modifier) {
    if (label == null) return
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
        tonalElevation = 2.dp,
        modifier = modifier.padding(8.dp).testTag("sticky_date"),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

/** 月↔日切档锚定请求：目标粒度下的分组 Header key + 目标粒度（防旧快照提前弃锚的键族判据）。 */
data class PendingAnchor(val key: String, val monthly: Boolean)

/**
 * 月↔日重建后锚定（ViewerPager 定位循环同款，ViewerScreen.kt）：命中 Header key → scrollToItem
 * 并 onDone 清锚；未加载则触达末项驱动 append，loadState 变化后重跑；到底未命中/出错 → onDone
 * 放弃锚定留在顶部。从 PhotosScreen 抽出为独立 effect，便于 Robolectric 注入快照直测弃锚时序。
 *
 * 防旧快照提前弃锚（评审 Important）：置锚会立刻以「重建前旧快照」重跑本 effect——跨键族
 * (yyyy-MM vs yyyy-MM-dd) 必然不命中，且旧快照 endOfPaginationReached==true（小库全载常态、
 * 大库停底部）会在新 pager 诞生前误走弃锚分支，锚定静默 no-op；驱动分支也会白推注定作废的旧
 * pager append。故先判快照键族是否已翻到目标粒度，未翻转前一律只等待——不匹配、不驱动、不弃锚。
 */
@Composable
fun TimelineAnchorEffect(
    items: LazyPagingItems<TimelineItem>,
    gridState: LazyGridState,
    anchor: PendingAnchor?,
    onDone: () -> Unit,
) {
    // items 实例也入 key：生产中该实例随 VM 稳定、不增重跑；重建极端巧合（新旧快照 itemCount 与
    // append 状态恰好全等）或测试换流重建 LazyPagingItems 时仍能触发重跑。
    LaunchedEffect(items, items.itemCount, items.loadState.append, anchor) {
        if (anchor == null || items.itemCount == 0) return@LaunchedEffect
        // 键族判据：首个 Header key 的 '-' 段数——月键 yyyy-MM 恰 1 个、日键 yyyy-MM-dd 恰 2 个；
        // 解析失败的回退键同为原 createdAt 前缀截取（take(7)/take(10)），段数不变，判据稳定。
        val firstHeaderKey = (0 until items.itemCount).firstNotNullOfOrNull {
            (items.peek(it) as? TimelineItem.Header)?.dayKey
        } ?: return@LaunchedEffect
        val snapshotMonthly = firstHeaderKey.count { it == '-' } == 1
        if (snapshotMonthly != anchor.monthly) return@LaunchedEffect   // 旧粒度快照：等待重建
        val index = (0 until items.itemCount).indexOfFirst {
            (items.peek(it) as? TimelineItem.Header)?.dayKey == anchor.key
        }
        val append = items.loadState.append
        when {
            index >= 0 -> {
                gridState.scrollToItem(index)
                onDone()
            }
            append is LoadState.NotLoading && !append.endOfPaginationReached -> items[items.itemCount - 1]
            // 到底未命中 / append 出错：放弃锚定留在顶部（Loading 不在此列——等 loadState 变化重跑）
            append is LoadState.NotLoading && append.endOfPaginationReached -> onDone()
            append is LoadState.Error -> onDone()
        }
    }
}

/**
 * 时间轴网格骨架（无状态，便于测试注入 photoCell）：[columns] 列固定网格，Header 满行跨列
 * （span maxLineSpan 随列数自适应）。span/key 用 peek 读取快照避免触发加载；photoCell 由调用方
 * 提供（生产用 AsyncImage，测试注入替身）。Header/照片格子均包 animateItem 做切档位移/尺寸过渡。
 * jank 兜底预案（联调 J 节验证项）：若实机 animateItem 全网格弹簧掉帧，退化为「瞬时换列 + 整栏
 * 100ms crossfade」。
 */
@Composable
fun PhotosGrid(
    items: LazyPagingItems<TimelineItem>,
    columns: Int,
    photoCell: @Composable (TimelineItem.Photo) -> Unit,
    modifier: Modifier = Modifier,
    state: LazyGridState = rememberLazyGridState(),
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(columns),
        state = state,
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
                    modifier = Modifier.animateItem().padding(horizontal = 12.dp, vertical = 8.dp),
                )
                is TimelineItem.Photo -> Box(Modifier.animateItem()) { photoCell(item) }
                null -> Box(Modifier.aspectRatio(1f))
            }
        }
    }
}
