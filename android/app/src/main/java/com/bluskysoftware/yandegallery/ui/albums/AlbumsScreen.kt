package com.bluskysoftware.yandegallery.ui.albums

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.bluskysoftware.yandegallery.data.prefs.AlbumSort
import com.bluskysoftware.yandegallery.data.prefs.AlbumSortField
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.Routes
import com.bluskysoftware.yandegallery.ui.common.MiuiChoiceRow
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import com.bluskysoftware.yandegallery.ui.common.MiuiLargeTitle
import com.bluskysoftware.yandegallery.ui.common.MiuiMenuDivider
import com.bluskysoftware.yandegallery.ui.common.MiuiMenuGroupRow
import com.bluskysoftware.yandegallery.ui.common.MiuiMenuNavRow
import com.bluskysoftware.yandegallery.ui.common.MiuiMoreMenu
import com.bluskysoftware.yandegallery.ui.common.MiuiPinnedTopBar
import com.bluskysoftware.yandegallery.ui.common.MiuiSortRow
import com.bluskysoftware.yandegallery.ui.common.albumSortPreview
import com.bluskysoftware.yandegallery.ui.common.MiuiTextField
import com.bluskysoftware.yandegallery.ui.common.rememberMiuiHeaderState
import com.bluskysoftware.yandegallery.ui.common.writeFailText
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * 相册 tab：折叠大标题 + 三分区自适应卡片网格（v0.6 spec §4.1/§4.2：置顶/全部相册/其他相册）。
 * 点击卡片跳相册详情；卡片长按弹「置顶/移入其他相册/重命名/删除」菜单（组织项纯本机离线可用）；
 * 顶栏右上「+」新建相册、「⋯」多级排序菜单（spec §4.4，面板改版为右上角锚定弹出）。无相册时展示空态文案，但「+」仍在，
 * 可创建首个相册。写入口离线（connState.online=false）置灰。
 */
@Composable
fun AlbumsScreen(
    viewModel: AlbumsViewModel,
    navController: NavHostController,
) {
    val activeServer by viewModel.activeServer.collectAsStateWithLifecycle()
    // 三态：null=加载中（DB 未首发射）/ isEmpty=确无相册 / 非空=有相册（M4-T15，A7 消空态闪帧）
    val sections by viewModel.sections.collectAsStateWithLifecycle()
    val sort by viewModel.albumsSort.collectAsStateWithLifecycle()
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
    var showOptions by rememberSaveable { mutableStateOf(false) }

    // 重排模式（spec §4.5）：非 null 即进重排。remember 非 saveable——旋转丢弃进行中的重排
    // （进行中改动本就未落盘，记录性取舍）；返回键等价「取消」。
    var reorderState by remember { mutableStateOf<AlbumReorderState?>(null) }
    BackHandler(enabled = reorderState != null) { reorderState = null }

    val baseUrl = activeServer?.baseUrl.orEmpty()
    val serverId = activeServer?.id ?: 0L
    val loader = viewModel.thumbnailLoader

    // 局部装配（闭包捕获 viewModel/baseUrl/serverId/loader/online 与对话框状态）：
    // 共用 AlbumCardItem + 本页菜单（组织项 + 在线门控的重命名/删除）
    @Composable
    fun OrganizableAlbumCard(card: AlbumCard, pinned: Boolean) {
        AlbumCardItem(
            card = card,
            baseUrl = baseUrl,
            serverId = serverId,
            loader = loader,
            onClick = { navController.navigate(Routes.albumDetail(card.gallery.id)) },
            menuItems = { dismiss ->
                val id = card.gallery.id
                // 组织项纯本机、离线可用（spec §4.3）；重命名/删除维持在线门控
                DropdownMenuItem(
                    text = { Text(if (pinned) "取消置顶" else "置顶") },
                    onClick = { dismiss(); viewModel.setPinned(id, !pinned) },
                    modifier = Modifier.testTag(if (pinned) "album_menu_unpin_$id" else "album_menu_pin_$id"),
                )
                DropdownMenuItem(
                    text = { Text("移入其他相册") },
                    onClick = { dismiss(); viewModel.setInOther(id, true) },
                    modifier = Modifier.testTag("album_menu_to_other_$id"),
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
    val reorder = reorderState
    Box(Modifier.fillMaxSize()) {
        // 重排分支不渲染折叠头，也不挂其 nestedScroll（评审修复）：幽灵 onPreScroll 会先无反馈地
        // 吃掉首段上滑（收满 64dp 的死区），且退出重排后 header 停在收起态、与主网格顶部错位。
        Column(
            Modifier
                .fillMaxSize()
                .then(if (reorder == null) Modifier.nestedScroll(header.connection) else Modifier),
        ) {
            if (reorder != null) {
                ReorderTopBar(
                    onCancel = { reorderState = null },
                    onDone = {
                        scope.launch {
                            // 落盘协程挂 viewModelScope（评审修复）：点完成后立刻切 tab/旋转会弃组合并
                            // 取消本 scope——join 只保「落盘完成才退重排」的时序，写库本体不随组合陪葬。
                            val pinned = reorder.pinnedOrder.toList()
                            val normal = reorder.normalOrder.toList()
                            viewModel.commitManualOrder(pinned, normal).join()
                            // 等 sections 反映新手动序再退重排（审查 minor）：join 只等 Room 事务提交，
                            // combine 的 albumPrefs 源要等失效追踪重查询才发射——先退主网格会闪回旧序
                            // 1~N 帧再跳新序。超时兜底：并发同步增删相册时集合不再逐项相等，不无限等。
                            withTimeoutOrNull(3_000) {
                                viewModel.sections.first { s ->
                                    s != null &&
                                        s.pinned.map { it.gallery.id } == pinned &&
                                        s.normal.map { it.gallery.id } == normal
                                }
                            }
                            reorderState = null
                        }
                    },
                )
                val cardById = remember(sections) {
                    val s = sections
                    (s?.pinned.orEmpty() + s?.normal.orEmpty() + s?.other.orEmpty()).associateBy { it.gallery.id }
                }
                val reorderGridState = rememberLazyGridState()
                val controller = remember(reorder) {
                    GridReorderController(
                        gridState = reorderGridState,
                        // 分区头的 key 是字符串（"hdr_*"）——必须先类型闸再比较分区，否则强转崩溃
                        canSwap = { from, to ->
                            from is Long && to is Long &&
                                reorder.sectionOf(from) != null &&
                                reorder.sectionOf(from) == reorder.sectionOf(to)
                        },
                        onMove = { from, to -> reorder.move(from as Long, to as Long) },
                    )
                }
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 104.dp),
                    state = reorderGridState,
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize().testTag("albums_reorder_grid"),
                ) {
                    if (reorder.pinnedOrder.isNotEmpty()) {
                        item(key = "hdr_pinned", span = { GridItemSpan(maxLineSpan) }) { AlbumSectionHeader("置顶") }
                        items(reorder.pinnedOrder, key = { it }) { id ->
                            // 跨 item 绘制顺序只看 item 根 placeable 的 zIndex，挂内层节点是空操作（评审修复）；
                            // 拖动中的 item 不挂 animateItem：placement 动画会把 move 后的基准位从旧槽位渐变到
                            // 新槽位，与控制器「旧基准位−新基准位」的即时补偿叠加成反向跳一格。标准 reorderable
                            // 模式——被拖项置顶 zIndex、只跟随 graphicsLayer 平移，让位动画留给邻居。
                            Box(if (controller.draggingKey == id) Modifier.zIndex(1f) else Modifier.animateItem()) {
                                ReorderCell(id, cardById, controller, baseUrl, serverId, loader)
                            }
                        }
                    }
                    item(key = "hdr_all", span = { GridItemSpan(maxLineSpan) }) { AlbumSectionHeader("全部相册") }
                    items(reorder.normalOrder, key = { it }) { id ->
                        // 同置顶区：zIndex 挂 item 根 + 被拖项不挂 animateItem
                        Box(if (controller.draggingKey == id) Modifier.zIndex(1f) else Modifier.animateItem()) {
                            ReorderCell(id, cardById, controller, baseUrl, serverId, loader)
                        }
                    }
                    // 其他相册折叠行在重排模式隐藏（spec §4.5）
                }
            } else {
                MiuiPinnedTopBar(title = "相册", scrolled = header.scrolled, actions = {
                    // 离线可点但给明确原因（原 FAB 语义平移）；置灰观感 + 无障碍 disabled
                    val tint = if (online) MaterialTheme.colorScheme.onSurface
                    else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                    IconButton(
                        onClick = {
                            if (online) {
                                newName = ""; showNew = true
                            } else {
                                scope.launch { snackbarHostState.showSnackbar("离线状态无法新建相册") }
                            }
                        },
                        modifier = Modifier
                            .semantics { if (!online) disabled() }
                            .testTag("albums_new"),
                    ) { Icon(Icons.Filled.Add, contentDescription = "新建相册", tint = tint) }
                    Box {
                        IconButton(onClick = { showOptions = true }, modifier = Modifier.testTag("albums_more")) {
                            Icon(Icons.Filled.MoreHoriz, contentDescription = "更多选项", tint = MaterialTheme.colorScheme.onSurface)
                        }
                        // 「⋯」多级菜单（面板改版）：锚定本按钮右上角弹出；排序分类进二级，选择即生效即收
                        AlbumsMoreMenu(
                            expanded = showOptions,
                            sort = sort,
                            onDismiss = { showOptions = false },
                            onManual = { viewModel.setAlbumsSort(AlbumSort.MANUAL); showOptions = false },
                            onSortField = { field -> viewModel.setAlbumsSort(field.next(sort)); showOptions = false },
                            onReorder = {
                                showOptions = false
                                val s = sections
                                if (s != null && !s.isEmpty) {
                                    reorderState = AlbumReorderState(
                                        pinned = s.pinned.map { it.gallery.id },
                                        normal = s.normal.map { it.gallery.id },
                                    )
                                }
                            },
                            // 设置直达（照片页同款全局出口）：先收菜单再跳转，返回相册时菜单不残留
                            onOpenSettings = { showOptions = false; navController.navigate(Routes.Settings) },
                        )
                    }
                })
                MiuiLargeTitle("相册", header)
                val current = sections
                when {
                    // 加载中（DB 首发射前）：空白 Box 不显 AlbumsEmpty，避免已有相册用户冷启动空态闪帧（A7）
                    current == null -> Box(Modifier.fillMaxSize())
                    current.isEmpty -> AlbumsEmpty()
                    else -> LazyVerticalGrid(
                        columns = GridCells.Adaptive(minSize = 104.dp),
                        state = gridState,
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.fillMaxSize().testTag("albums_grid"),
                    ) {
                        if (current.pinned.isNotEmpty()) {
                            item(key = "hdr_pinned", span = { GridItemSpan(maxLineSpan) }) {
                                AlbumSectionHeader("置顶", Modifier.testTag("albums_section_pinned"))
                            }
                            items(current.pinned, key = { it.gallery.id }) { card ->
                                OrganizableAlbumCard(card, pinned = true)
                            }
                        }
                        item(key = "hdr_all", span = { GridItemSpan(maxLineSpan) }) {
                            AlbumSectionHeader("全部相册", Modifier.testTag("albums_section_all"))
                        }
                        items(current.normal, key = { it.gallery.id }) { card ->
                            OrganizableAlbumCard(card, pinned = false)
                        }
                        if (current.other.isNotEmpty()) {
                            item(key = "other_row", span = { GridItemSpan(maxLineSpan) }) {
                                OtherAlbumsRow(count = current.other.size) {
                                    navController.navigate(Routes.OtherAlbums)
                                }
                            }
                        }
                    }
                }
            }
        }
        SnackbarHost(
            snackbarHostState,
            Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp),
        )
    }

    // 新建相册：输入名 → createGallery（名字去空白；空名不可提交）
    if (showNew) {
        AlbumNameDialog(
            title = "新建相册",
            name = newName,
            onNameChange = { newName = it },
            confirmLabel = "创建",
            confirmTag = "album_new_confirm",
            onConfirm = {
                val name = newName.trim()
                showNew = false
                scope.launch {
                    when (val r = viewModel.createGallery(name)) {
                        WriteResult.Success -> snackbarHostState.showSnackbar("已新建相册「$name」")
                        is WriteResult.Failed -> snackbarHostState.showSnackbar(writeFailText("新建相册失败", r))
                    }
                }
            },
            onDismiss = { showNew = false },
        )
    }

    // 重命名：对话框预填当前名（renameName 打开时已置为 card.gallery.name）→ renameGallery
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

    // 删除：二次确认，明示只删相册不删图片文件（brief 契约）→ deleteGallery
    deleteId?.let { id ->
        DeleteAlbumConfirmDialog(
            albumName = deleteName,
            onConfirm = {
                // 先捕获局部再清状态：协程内的 snackbar 只用局部 name（原实现读已被后续清空/覆盖的 state）
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

/** 分区头：span 整行的小节标题。 */
@Composable
private fun AlbumSectionHeader(title: String, modifier: Modifier = Modifier) {
    Text(
        title,
        style = MaterialTheme.typography.titleMedium,
        modifier = modifier.padding(top = 8.dp, bottom = 2.dp),
    )
}

/** 「▸ 其他相册 (N)」折叠行（spec §4.2）：span 整行，点击进二级页。 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun OtherAlbumsRow(count: Int, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .combinedClickable(onClick = onClick, onLongClick = null)
            .padding(horizontal = 4.dp, vertical = 12.dp)
            .testTag("other_albums_row"),
    ) {
        Text("其他相册", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Text("$count", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        )
    }
}

/** 重排模式顶栏（spec §4.5）：取消 / 标题 / 完成。 */
@Composable
private fun ReorderTopBar(onCancel: () -> Unit, onDone: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .height(48.dp),
    ) {
        TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.CenterStart).testTag("reorder_cancel")) {
            Text("取消", color = MaterialTheme.colorScheme.onSurface)
        }
        Text("拖动调整顺序", style = MaterialTheme.typography.titleLarge, modifier = Modifier.align(Alignment.Center))
        TextButton(onClick = onDone, modifier = Modifier.align(Alignment.CenterEnd).testTag("reorder_done")) {
            Text("完成", color = MaterialTheme.colorScheme.primary)
        }
    }
}

/** 重排格子：长按拖动换位；拖动中 graphicsLayer 跟手平移（置顶 zIndex 由 items 侧挂 item 根）；菜单/点击禁用。 */
@Composable
private fun ReorderCell(
    id: Long,
    cardById: Map<Long, AlbumCard>,
    controller: GridReorderController,
    baseUrl: String,
    serverId: Long,
    loader: coil3.ImageLoader,
) {
    val card = cardById[id] ?: return
    val dragging = controller.draggingKey == id
    AlbumCardItem(
        card = card,
        baseUrl = baseUrl,
        serverId = serverId,
        loader = loader,
        onClick = {},
        enableMenu = false,
        modifier = Modifier
            .graphicsLayer {
                if (dragging) {
                    translationX = controller.dragOffset.x
                    translationY = controller.dragOffset.y
                }
            }
            .pointerInput(id) {
                detectDragGesturesAfterLongPress(
                    onDragStart = { controller.onDragStart(id) },
                    onDrag = { change, delta ->
                        change.consume()
                        controller.onDrag(delta)
                    },
                    onDragEnd = { controller.onDragEnd() },
                    onDragCancel = { controller.onDragEnd() },
                )
            },
    )
}

/**
 * 相册页「⋯」多级菜单（面板改版）：一级「排序方式」分类（手动/名称/张数/创建时间进二级）
 * + 「拖拽排序」「设置」直达（设置垫底，与照片页同款全局出口）。选择即生效即收菜单。
 */
@Composable
internal fun AlbumsMoreMenu(
    expanded: Boolean,
    sort: AlbumSort,
    onDismiss: () -> Unit,
    onManual: () -> Unit,
    onSortField: (AlbumSortField) -> Unit,
    onReorder: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    MiuiMoreMenu(
        expanded = expanded,
        onDismiss = onDismiss,
        root = { openPage ->
            MiuiMenuGroupRow("排序方式", albumSortPreview(sort), tag = "menu_group_sort") { openPage("sort", "排序方式") }
            MiuiMenuDivider()
            MiuiMenuNavRow("拖拽排序", tag = "albums_reorder_enter", onClick = onReorder)
            MiuiMenuNavRow("设置", tag = "sheet_settings_row", onClick = onOpenSettings)
        },
        page = { key ->
            if (key == "sort") {
                MiuiChoiceRow("手动", sort == AlbumSort.MANUAL, "album_sort_option_manual", onManual)
                AlbumSortField.entries.forEach { field ->
                    MiuiSortRow(
                        label = field.label,
                        selected = field.contains(sort),
                        ascending = sort.ascending,
                        tag = "album_sort_option_${field.name.lowercase()}",
                    ) { onSortField(field) }
                }
            }
        },
    )
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
                label = "相册名",
                modifier = Modifier.fillMaxWidth().testTag("album_name_field"),
            )
        },
    )
}

/** 删除相册二次确认：明示只删相册、不删图片文件（brief 契约）。 */
@Composable
internal fun DeleteAlbumConfirmDialog(
    albumName: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    MiuiDialog(
        title = "删除相册",
        text = "确定删除相册「$albumName」？只删除相册本身，不删除其中的图片文件。",
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
            "还没有相册",
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
