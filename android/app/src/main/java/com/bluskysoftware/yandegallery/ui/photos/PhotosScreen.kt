package com.bluskysoftware.yandegallery.ui.photos

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.derivedStateOf
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
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import com.bluskysoftware.yandegallery.data.prefs.PhotoSortField
import com.bluskysoftware.yandegallery.domain.sync.SyncPhase
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.ConnectionBanner
import com.bluskysoftware.yandegallery.ui.common.FastScrollbar
import com.bluskysoftware.yandegallery.ui.common.GalleryPickerDialog
import com.bluskysoftware.yandegallery.ui.common.LEGACY_STORAGE_DENIED_TEXT
import com.bluskysoftware.yandegallery.ui.common.MiuiChoiceRow
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import com.bluskysoftware.yandegallery.ui.common.MiuiLargeTitle
import com.bluskysoftware.yandegallery.ui.common.MiuiOptionsSheet
import com.bluskysoftware.yandegallery.ui.common.MiuiPinnedTopBar
import com.bluskysoftware.yandegallery.ui.common.MiuiSheetCard
import com.bluskysoftware.yandegallery.ui.common.MiuiSheetNavRow
import com.bluskysoftware.yandegallery.ui.common.MiuiSortRow
import com.bluskysoftware.yandegallery.ui.common.PhotosSelectionBars
import com.bluskysoftware.yandegallery.ui.common.PinchStepState
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import com.bluskysoftware.yandegallery.ui.common.SelectableCell
import com.bluskysoftware.yandegallery.ui.common.SelectionTopBar
import com.bluskysoftware.yandegallery.ui.common.detectPinchStep
import com.bluskysoftware.yandegallery.ui.common.rememberLegacyStorageGate
import com.bluskysoftware.yandegallery.ui.common.rememberMiuiHeaderState
import com.bluskysoftware.yandegallery.ui.common.writeFailText
import com.bluskysoftware.yandegallery.ui.theme.MiuiTokens
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PhotosScreen(
    viewModel: PhotosViewModel,
    barsState: PhotosSelectionBars,
    onAddServer: () -> Unit,
    onOpenViewer: (imageId: Long) -> Unit,
    onOpenSearch: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val activeServer by viewModel.activeServer.collectAsStateWithLifecycle()
    val activeServerResolved by viewModel.activeServerResolved.collectAsStateWithLifecycle()
    // 顶层只收下拉转圈布尔（A8 隔离）：FullSync 每 tick 的重组隔离进 SyncProgressBar，不再扰动全屏
    val refreshing by viewModel.refreshing.collectAsStateWithLifecycle()
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

    // 首帧引导态门控（A7）：DB 首发射前（resolved=false）渲染空白，不显引导——避免已配对用户冷启动闪帧。
    if (!activeServerResolved) {
        Box(Modifier.fillMaxSize())
        return
    }
    // 无激活服务器：不进网格分支，直接渲染引导态（仍带常驻顶栏——无服务器也可进设置）。
    val server = activeServer
    if (server == null) {
        Column(Modifier.fillMaxSize()) {
            MiuiPinnedTopBar(title = "照片", scrolled = false, actions = {
                IconButton(onClick = onOpenSettings) { Icon(Icons.Filled.Settings, contentDescription = "设置") }
            })
            PhotosGuide(onAddServer = onAddServer)
        }
        return
    }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
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

    // legacy 存储权限门卫（BUG-07）：26-28 批量下载/带下载分享须先持 WRITE_EXTERNAL_STORAGE，29+ 直通
    val storageGate = rememberLegacyStorageGate(onDenied = {
        scope.launch { snackbarHostState.showSnackbar(LEGACY_STORAGE_DENIED_TEXT) }
    })
    LaunchedEffect(selectionActive) {
        if (!selectionActive) {
            shareJob?.cancel()
            shareJob = null
        }
    }

    /** 批量分享完整流（M4-T11/D9）：缺失项先入队原图下载，等全部终态后自动分享；部分失败仍分享成功子集。 */
    fun shareSelected() {
        if (shareJob?.isActive == true) return   // 等待中：忽略重复点按（照大图页 share 同款防重入，T12 审查移交）
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

    // 多选底栏桥回填（M4-T12/D11→v0.5 瘦身）：顶部选择栏已随顶栏下放本屏自渲染，桥只管
    // 壳级底栏 swap（NavigationBar ↔ SelectionBottomBar）。回调闭包捕获屏内状态，须每次重组
    // 回填最新值；SideEffect 在 composition 成功落定后写桥（避免组合期写状态警告/回滚脏写）。
    SideEffect {
        barsState.model = if (selectionActive) {
            PhotosSelectionBars.Model(
                online = connState.online,
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
            )
        } else {
            null
        }
    }
    // 离开照片路由（含切服后回引导态的早退分支）清桥，壳恢复 MiuiNavBar
    DisposableEffect(Unit) {
        onDispose { barsState.model = null }
    }

    val baseUrl = server.baseUrl
    val serverId = server.id
    val loader = viewModel.thumbnailLoader

    // ---- 捏合切档（M4-T3）：离散档位状态 + 月↔日跨越锚定 ----
    val tier by viewModel.densityTier.collectAsStateWithLifecycle()
    // v0.6 排序 + 「⋯」面板开关（spec §3.1）：排序共享 ViewPrefs，Viewer 同源同序
    val sort by viewModel.photoSort.collectAsStateWithLifecycle()
    var showOptions by rememberSaveable { mutableStateOf(false) }
    val gridState = rememberLazyGridState()
    val pinchState = remember { PinchStepState<DensityTier>(larger = { it.larger() }, smaller = { it.smaller() }) }
    // 月↔日跨越锚定：跨越前记视口顶部照片在「新分组粒度」下的 key + 目标粒度，重建后按 Header 定位。
    // 冷启动闪档（持久 MONTH、首帧 DEFAULT 后翻转）不经 changeTier——pendingAnchor 保持 null，
    // 锚定 effect 直接早退，重建后停留顶部，不会误锚/崩溃。
    var pendingAnchor by remember { mutableStateOf<PendingAnchor?>(null) }
    // 跨越判定基准（评审 Minor#2）：collected tier 是 Compose 状态，重组落定前有一帧滞后，同一手势内
    // 快速连切（如 DAY_5→MONTH→DAY_5）用旧档会误判月↔日跨越方向；改记「最近一次已请求档」，未请求过回退 tier。
    //（VM 侧档位已是内存态即时更新（BUG-18），此处滞后仅剩重组一帧，本基准继续兜底。）
    var lastRequestedTier by remember { mutableStateOf<DensityTier?>(null) }

    fun changeTier(new: DensityTier) {
        val current = lastRequestedTier ?: tier
        // 平铺门控（v0.6 spec §3.2）：非时间排序无分组头，月↔日锚定无意义且必失败弃锚——不置锚
        if (new.monthGrouping != current.monthGrouping && sort.isTime) {
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
    // 折叠大标题（spec §2.3 exitUntilCollapsed 裁定）：不进 LazyGrid（避免索引数学 +1 波及
    // 锚定/快滚/sticky），connection 挂 PullToRefreshBox 内层与网格滚动联动（位置理由见 PTR 处）。
    // 松手后 settle 贴齐全收/全展；collectLatest 让贴齐动画可被新手势立即取消——用 collect 时
    // 发射在 settle 挂起期间排队，贴齐中再拖动会出现 animate 与 nested scroll 每帧竞写 offsetPx。
    val header = rememberMiuiHeaderState()
    LaunchedEffect(gridState) {
        // 深处判定一并入流（终审 Minor#2）：快滚滑块 scrollToItem 不经 nestedScroll，跳到深处后
        // 头部仍全展——空闲且首项已滚出视口时直接收起，与手指滚动后的收起态观感一致；顶部照旧 settle。
        snapshotFlow { gridState.isScrollInProgress to (gridState.firstVisibleItemIndex > 0) }
            .collectLatest { (scrolling, deep) ->
                if (!scrolling) {
                    if (deep) header.collapse() else header.settle()
                }
            }
    }
    // 排序切换回顶（spec §3.3；跳过首帧——导航返回恢复组合时不得重置滚动位置）：
    // lastAppliedSort 经 rememberSaveable 抗重组/返回恢复，仅真实切换时回顶
    var lastAppliedSort by rememberSaveable { mutableStateOf(sort.name) }
    LaunchedEffect(sort) {
        if (sort.name != lastAppliedSort) {
            lastAppliedSort = sort.name
            // 未消费的月↔日切档锚一并作废（评审修复）：排序一变，旧粒度锚定语义即失效。切到平铺后
            // 快照无 Header，锚定 effect 只早退不 onDone，陈锚会存活到切回时间排序时被消费——驱动
            // append 滚到数分钟前的旧月份，压过本回顶（两个 scrollToItem 竞写，锚定随 append 后发赢）。
            pendingAnchor = null
            gridState.scrollToItem(0)
        }
    }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // 顶部区域页面自持（v0.5 壳重构）：多选中换选择顶栏（底栏仍经桥走壳级 swap），常态为常驻顶栏
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
                    insetStatusBar = true,
                )
            } else {
                PhotosPinnedTopBar(
                    scrolled = header.scrolled,
                    onOpenSearch = onOpenSearch,
                    onOpenMore = { showOptions = true },
                )
            }
            // 顶部连接横幅：offline / unauthorized（点击跳服务器页重新配对）
            ConnectionBanner(state = connState, onReconnectAuth = onAddServer)
            MiuiLargeTitle("照片", header)
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = viewModel::refresh,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
            ) {
                // 折叠联动挂 PTR 内层（评审修复）：post 阶段内层连接先分发——顶部下拉余量先展开
                // 大标题、展满后才轮到 PTR 攒刷新指示器；挂 PTR 外层会被其全额截胡（UserInput），
                // 收起态大标题无法拖拽展开（仅 fling 可展）且拉标题误触发刷新。
                Column(Modifier.fillMaxSize().nestedScroll(header.connection)) {
                    // 进度条独立收集 syncPhase：每页 tick 的重组隔离在组件内，不再重组网格子树（D13/A8）
                    SyncProgressBar(viewModel.syncPhase)
                    // 捏合手势挂网格外围父层（Initial pass 判定/消费，遍序理由见 detectPinchStep）。
                    // currentValue 直读 StateFlow.value：pointerInput(Unit) 不重启，避免闭包捕获过期档位。
                    // fillMaxSize：给 sticky 日期条/快速滚动滑块两个 overlay 提供对齐范围（T4）。
                    Box(
                        Modifier
                            .fillMaxSize()
                            .pointerInput(Unit) {
                                detectPinchStep(
                                    state = pinchState,
                                    currentValue = { viewModel.densityTier.value },
                                    onChange = ::changeTier,
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
                                        .clip(MiuiTokens.CellShape),
                                ) {
                                    RetryableAsyncImage(
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
                        val topDateLabel by remember(items, tier, sort) {
                            derivedStateOf {
                                if (!sort.isTime) return@derivedStateOf null   // 平铺：sticky 胶囊不显示
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
                        // 仅滚动中浮现（spec §3 修重叠）：显隐门抽为 ScrollAwareStickyDate，
                        // 供 Robolectric 直测滚动态显隐与取消语义（Task7 审查回补）
                        ScrollAwareStickyDate(
                            gridState = gridState,
                            label = topDateLabel,
                            modifier = Modifier.align(Alignment.TopStart),
                        )
                        // 快速滚动滑块（D4）：映射已加载窗口，拖到底持续 append 延展
                        FastScrollbar(
                            gridState = gridState,
                            itemCount = items.itemCount,
                            labelFor = { index ->
                                if (!sort.isTime) {
                                    null   // 平铺：日期气泡整体隐藏（spec §3.2）
                                } else if (index in 0 until items.itemCount) {
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
        }
        // T12 后底栏在壳 Scaffold 槽（内容 padding 之外），此处补 inset/边距使提示不贴屏底
        SnackbarHost(
            snackbarHostState,
            Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 8.dp),
        )
    }

    // 「⋯」选项面板（v0.6 spec §3.1）：排序/密度/设置，选择即生效即收
    if (showOptions) {
        PhotosOptionsSheet(
            sort = sort,
            tier = tier,
            onDismiss = { showOptions = false },
            onSortField = { field -> viewModel.setPhotoSort(field.next(sort)); showOptions = false },
            onTier = { changeTier(it); showOptions = false },   // 走 changeTier 复用月↔日锚定
            onOpenSettings = { showOptions = false; onOpenSettings() },
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

/**
 * FullSync 进度条：独立收集 syncPhase，把每页 tick 的重组隔离在本组件内（D13/A8）。
 * 顶层 PhotosScreen 不再 collect syncPhase，故 FullSync done/total 每 tick 只重组这一条，不波及网格子树。
 */
@Composable
private fun SyncProgressBar(syncPhaseFlow: StateFlow<SyncPhase>) {
    val syncPhase by syncPhaseFlow.collectAsStateWithLifecycle()
    (syncPhase as? SyncPhase.FullSync)?.let { phase ->
        val fraction = if (phase.total > 0) phase.done.toFloat() / phase.total else 0f
        LinearProgressIndicator(
            progress = { fraction },
            modifier = Modifier.fillMaxWidth().testTag("sync_progress"),
        )
    }
}

/**
 * 照片 tab 常态顶栏（v0.6 spec §3.1）：[搜索][⋯]。设置入口迁入「⋯」面板（MIUI 同款层级）。
 * internal 供 AppNavForTest 挂真件覆盖搜索路由跳转。
 */
@Composable
internal fun PhotosPinnedTopBar(
    scrolled: Boolean,
    onOpenSearch: () -> Unit,
    onOpenMore: () -> Unit,
) {
    MiuiPinnedTopBar(title = "照片", scrolled = scrolled, actions = {
        IconButton(onClick = onOpenSearch, modifier = Modifier.testTag("photos_search")) {
            Icon(Icons.Filled.Search, contentDescription = "搜索")
        }
        IconButton(onClick = onOpenMore, modifier = Modifier.testTag("photos_more")) {
            Icon(Icons.Filled.MoreHoriz, contentDescription = "更多选项")
        }
    })
}

/** 照片页「⋯」选项面板（spec §3.1）：排序 + 网格密度 + 设置。选择即生效即收。 */
@Composable
internal fun PhotosOptionsSheet(
    sort: PhotoSort,
    tier: DensityTier,
    onDismiss: () -> Unit,
    onSortField: (PhotoSortField) -> Unit,
    onTier: (DensityTier) -> Unit,
    onOpenSettings: () -> Unit,
) {
    MiuiOptionsSheet(onDismiss = onDismiss) {
        MiuiSheetCard("排序方式") {
            PhotoSortField.entries.forEach { field ->
                MiuiSortRow(
                    label = field.label,
                    selected = field.contains(sort),
                    ascending = sort.ascending,
                    tag = "sort_option_${field.name.lowercase()}",
                ) { onSortField(field) }
            }
        }
        MiuiSheetCard("网格密度") {
            MiuiChoiceRow("月视图（6 列）", tier == DensityTier.MONTH, "density_option_month") { onTier(DensityTier.MONTH) }
            MiuiChoiceRow("大图（3 列）", tier == DensityTier.DAY_3, "density_option_day3") { onTier(DensityTier.DAY_3) }
            MiuiChoiceRow("标准（4 列）", tier == DensityTier.DAY_4, "density_option_day4") { onTier(DensityTier.DAY_4) }
            MiuiChoiceRow("紧凑（5 列）", tier == DensityTier.DAY_5, "density_option_day5") { onTier(DensityTier.DAY_5) }
        }
        MiuiSheetCard("更多") {
            MiuiSheetNavRow("设置", tag = "sheet_settings_row", onClick = onOpenSettings)
        }
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
        shape = RoundedCornerShape(50),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
        tonalElevation = 2.dp,
        border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = modifier.padding(8.dp).testTag("sticky_date"),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

/**
 * sticky 日期条滚动显隐门（spec §3 修重叠）：仅滚动中浮现，停止滚动 500ms 后淡出。
 * collectLatest 保证重新滚动会取消挂起中的隐藏计时——误改 collect 时计时不可取消，且计时
 * 挂起期间的重滚动会被整段吞掉（snapshotFlow producer 只在收集体返回后重读终值），停后
 * 500ms 必然淡出一次不再回显（Task5 settle 同族缺陷，c5050e1）。从 PhotosScreen 装配处
 * 抽出为 internal，供 Robolectric 用 mainClock 驱动滚动态直测（PhotosScreenTest）。
 */
@Composable
internal fun ScrollAwareStickyDate(
    gridState: LazyGridState,
    label: String?,
    modifier: Modifier = Modifier,
) {
    var stickyVisible by remember { mutableStateOf(false) }
    LaunchedEffect(gridState) {
        snapshotFlow { gridState.isScrollInProgress }.collectLatest { scrolling ->
            if (scrolling) {
                stickyVisible = true
            } else {
                delay(500)
                stickyVisible = false
            }
        }
    }
    AnimatedVisibility(
        visible = stickyVisible && label != null,
        enter = fadeIn(tween(120)),
        exit = fadeOut(tween(200)),
        modifier = modifier,
    ) {
        StickyDateOverlay(label = label)
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
        horizontalArrangement = Arrangement.spacedBy(MiuiTokens.GridGap),
        verticalArrangement = Arrangement.spacedBy(MiuiTokens.GridGap),
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
                    modifier = Modifier.animateItem().padding(horizontal = 16.dp, vertical = 10.dp),
                )
                is TimelineItem.Photo -> Box(Modifier.animateItem()) { photoCell(item) }
                null -> Box(Modifier.aspectRatio(1f))
            }
        }
    }
}
