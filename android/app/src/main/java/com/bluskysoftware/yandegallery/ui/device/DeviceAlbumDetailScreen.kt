package com.bluskysoftware.yandegallery.ui.device

import android.app.Activity
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.DeviceCapabilities
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import com.bluskysoftware.yandegallery.data.device.formatDurationMs
import com.bluskysoftware.yandegallery.data.device.mime
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar
import com.bluskysoftware.yandegallery.ui.common.PinchStepState
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import com.bluskysoftware.yandegallery.ui.common.SelectableCell
import com.bluskysoftware.yandegallery.ui.common.SelectionTopBar
import com.bluskysoftware.yandegallery.ui.common.detectPinchStep
import com.bluskysoftware.yandegallery.ui.theme.MiuiTokens
import kotlinx.coroutines.launch

/** 目标选择器当前意图：复制 / 移动共用一个 DeviceAlbumPicker，onPick 收尾编排不同。 */
private enum class DevicePickerMode { COPY, MOVE }

/**
 * 相册网格页（Task 6/7，spec §2.2/§5.3/§5.4）：分页网格 + 捏合切列数 + 视频时长角标 + 批量操作。
 * 多选长按进入后顶栏换 SelectionTopBar；底部多选动作栏经 [selectionBars] 桥回填给壳级 swap
 * （SideEffect 写 model、离开清 null，PhotosScreen 同款惯例）。删除/移动走系统授权弹窗
 * （StartIntentSenderForResult，uris 批量一次全量传入），RESULT_OK 才继续、取消无操作；
 * 复制/移动目标经 [DeviceAlbumPicker] 选定（excludeKey=当前 Bucket 上下文防自指，All 聚合
 * 上下文不排除任何目标且移动同样可用，spec §5.4 不对称点）。
 */
@Composable
fun DeviceAlbumDetailScreen(
    viewModel: DeviceAlbumDetailViewModel,
    loader: ImageLoader,
    onOpenViewer: (mediaId: Long) -> Unit,
    onBack: () -> Unit,
    selectionBars: DeviceSelectionBars,
) {
    val title by viewModel.title.collectAsStateWithLifecycle()
    val count by viewModel.count.collectAsStateWithLifecycle()
    val columns by viewModel.columns.collectAsStateWithLifecycle()
    val selected by viewModel.selection.selectedFlow.collectAsStateWithLifecycle()
    val items = viewModel.media.collectAsLazyPagingItems()
    val selectionActive = selected.isNotEmpty()

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    // 目标选择器状态：mode 非 null 即弹出；候选列表随开随查。二者都是内存态——列表含 Uri 不可
    // saveable，只 saveable mode 会出现「弹窗还在、列表空白」的半恢复态，索性重建后一起消失重开。
    var pickerMode by remember { mutableStateOf<DevicePickerMode?>(null) }
    var targetAlbums by remember { mutableStateOf<List<DeviceAlbum>>(emptyList()) }
    // 移动两段式的中继：picker 选定路径 → 系统写授权弹窗期间暂存（String 可 saveable，授权弹窗
    // 悬在本 Activity 上方时进程重建不丢目标路径）。
    var pendingMovePath by rememberSaveable { mutableStateOf<String?>(null) }

    // 删除：系统弹窗 RESULT_OK 后只清选择——删除本身系统已完成，列表刷新靠 MediaStore observer
    // 脉冲（VM init 已订阅），不手动重查；取消（RESULT_CANCELED）无操作、保留选择。
    val deleteLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            viewModel.selection.clear()
        }
    }
    // 移动：系统写授权 RESULT_OK 后才真正 moveTo（spec §5.3 两段式）；取消则无操作、保留选择。
    val moveLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { result ->
        val path = pendingMovePath
        pendingMovePath = null
        if (result.resultCode == Activity.RESULT_OK && path != null) {
            scope.launch {
                val totalCount = viewModel.selection.count
                val moved = viewModel.moveSelectedTo(path).getOrDefault(0)
                viewModel.selection.clear()
                snackbarHostState.showSnackbar(
                    if (moved >= totalCount) "已移动 $moved 张" else "已移动 $moved 张，${totalCount - moved} 张失败",
                )
            }
        }
    }

    /** 分享（brief 契约）：单张实 mime、多张混合通配；uri 直接用 MediaStore content uri。 */
    fun shareSelected() {
        scope.launch {
            val medias = viewModel.shareSelected()
            if (medias.isEmpty()) return@launch
            val intent = if (medias.size == 1) {
                Intent(Intent.ACTION_SEND).apply {
                    type = medias[0].mime()
                    putExtra(Intent.EXTRA_STREAM, medias[0].uri)
                }
            } else {
                Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                    type = "*/*"
                    putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(medias.map { it.uri }))
                }
            }
            context.startActivity(Intent.createChooser(intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), null))
        }
    }

    /** 打开目标选择器：先查一轮候选（真实+待落地）再弹，避免弹出瞬间列表空白闪动。 */
    fun openPicker(mode: DevicePickerMode) {
        scope.launch {
            targetAlbums = viewModel.targetAlbums()
            pickerMode = mode
        }
    }

    // 多选底栏桥回填（PhotosScreen 同款 SideEffect 惯例）：门控三布尔来自 DeviceCapabilities
    // （spec §7，false 项由 DeviceSelectionBottomBar 直接不渲染）；回调闭包捕获屏内状态，须每次
    // 重组回填最新值；SideEffect 在 composition 成功落定后写桥（避免组合期写状态警告/回滚脏写）。
    SideEffect {
        selectionBars.model = if (selectionActive) {
            DeviceSelectionBars.Model(
                canDelete = DeviceCapabilities.canDelete(),
                canCopy = DeviceCapabilities.canCopy(),
                canMove = DeviceCapabilities.canMove(),
                onShare = { shareSelected() },
                onDelete = {
                    scope.launch {
                        viewModel.deleteSelected()?.let {
                            deleteLauncher.launch(IntentSenderRequest.Builder(it.intentSender).build())
                        }
                    }
                },
                onCopyTo = { openPicker(DevicePickerMode.COPY) },
                onMoveTo = { openPicker(DevicePickerMode.MOVE) },
            )
        } else {
            null
        }
    }
    // 离开本路由清桥，壳恢复 MiuiNavBar（PhotosScreen 同款收口）
    DisposableEffect(Unit) {
        onDispose { selectionBars.model = null }
    }

    val pinchState = remember {
        PinchStepState<Int>(
            larger = { if (it > DeviceAlbumDetailViewModel.MIN_COLUMNS) it - 1 else null }, // 放大 → 列数减
            smaller = { if (it < DeviceAlbumDetailViewModel.MAX_COLUMNS) it + 1 else null },
        )
    }

    // 多选激活时系统返回键只退出多选、不返回上一页（AlbumDetailScreen 同款既有约定）。
    BackHandler(enabled = selectionActive) { viewModel.selection.clear() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            if (selectionActive) {
                // 替换常规顶栏；Scaffold topBar 槽内自补状态栏 inset（MiuiSubPageTopBar 自带，本组件需手动）
                SelectionTopBar(
                    count = selected.size,
                    // 「全选」= 当前已加载进分页快照的媒体（分页语义；继续滚动加载后可再点全选并入）
                    onSelectAll = {
                        viewModel.selection.selectAll(
                            (0 until items.itemCount).mapNotNull { items.peek(it)?.mediaId },
                        )
                    },
                    onCancel = { viewModel.selection.clear() },
                    insetStatusBar = true,
                )
            } else {
                MiuiSubPageTopBar(title = title, subtitle = "$count 张", onBack = onBack)
            }
        },
    ) { padding ->
        // 捏合切列数：手势挂网格外围父层（Initial pass 判定/消费，遍序理由见 detectPinchStep 自身注释）。
        // currentValue 直读 StateFlow.value：pointerInput(Unit) 不因列数变化重启，避免闭包捕获过期档。
        Box(
            Modifier
                .padding(padding)
                .pointerInput(Unit) {
                    detectPinchStep(
                        state = pinchState,
                        currentValue = { viewModel.columns.value },
                        onChange = { viewModel.columns.value = it },
                    )
                },
        ) {
            LazyVerticalGrid(
                columns = GridCells.Fixed(columns),
                horizontalArrangement = Arrangement.spacedBy(MiuiTokens.GridGap),
                verticalArrangement = Arrangement.spacedBy(MiuiTokens.GridGap),
                modifier = Modifier.fillMaxSize().testTag("device_grid"),
            ) {
                items(
                    count = items.itemCount,
                    key = { index -> items.peek(index)?.let { "m:${it.mediaId}" } ?: "null:$index" },
                ) { index ->
                    val media = items[index]
                    if (media != null) {
                        DeviceMediaCell(
                            media = media,
                            loader = loader,
                            selected = media.mediaId in selected,
                            selectionActive = selectionActive,
                            onOpen = { onOpenViewer(media.mediaId) },
                            onToggle = { viewModel.selection.toggle(media.mediaId) },
                        )
                    } else {
                        Box(Modifier.aspectRatio(1f))
                    }
                }
            }
            // 空态（Pending 相册恒空；All/Bucket 首次刷新完成后确无内容）：叠在网格上层居中，不用
            // if/else 互斥掉网格本身——device_grid 测试 tag 恒在，真实滚动位置/懒加载状态也不受影响。
            if (items.itemCount == 0 && items.loadState.refresh is LoadState.NotLoading) {
                Text(
                    "相册还没有照片\n通过「复制到」把图片放进来",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.align(Alignment.Center).padding(32.dp).testTag("device_empty"),
                )
            }
        }
    }

    pickerMode?.let { mode ->
        DeviceAlbumPicker(
            albums = targetAlbums,
            canCreate = DeviceCapabilities.canCreateAlbum(),
            // 自指防护 = 当前 Bucket 上下文（spec §5.4）：All/Pending 的 key 不会命中任何目标卡
            //（Pending 卡若已收编则不在候选里），等效不排除——All 聚合上下文全量目标可选。
            excludeKey = viewModel.bucketKey,
            onPick = { path ->
                pickerMode = null
                when (mode) {
                    DevicePickerMode.COPY -> scope.launch {
                        val totalCount = viewModel.selection.count
                        val ok = viewModel.copySelectedTo(path)
                        viewModel.selection.clear()
                        snackbarHostState.showSnackbar(
                            if (ok >= totalCount) "已复制 $ok 张" else "已复制 $ok 张，${totalCount - ok} 张失败",
                        )
                    }
                    DevicePickerMode.MOVE -> scope.launch {
                        // 两段式：先记目标路径，系统写授权 RESULT_OK 回调里才真正 moveTo
                        viewModel.moveWriteRequest()?.let {
                            pendingMovePath = path
                            moveLauncher.launch(IntentSenderRequest.Builder(it.intentSender).build())
                        }
                    }
                }
            },
            onCreate = viewModel::createTargetAlbum,
            onDismiss = { pickerMode = null },
        )
    }
}

/** 网格格子：SelectableCell 包图 + 选中态角标；视频额外叠右下角时长角标（黑 55% 圆角底白字）。 */
@Composable
private fun DeviceMediaCell(
    media: DeviceMedia,
    loader: ImageLoader,
    selected: Boolean,
    selectionActive: Boolean,
    onOpen: () -> Unit,
    onToggle: () -> Unit,
) {
    SelectableCell(
        selected = selected,
        selectionActive = selectionActive,
        onOpen = onOpen,
        onToggle = onToggle,
        modifier = Modifier
            .aspectRatio(1f)
            .clip(MiuiTokens.CellShape)
            .testTag("device_cell_${media.mediaId}"),
    ) {
        // content 非 BoxScope receiver（SelectableCell 自身内容契约），角标要 .align() 须自建 Box。
        Box(Modifier.fillMaxSize()) {
            RetryableAsyncImage(
                model = media.uri,
                imageLoader = loader,
                contentDescription = media.displayName,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            if (media.isVideo) {
                Text(
                    formatDurationMs(media.durationMs ?: 0),
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(4.dp)
                        .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(4.dp))
                        .padding(horizontal = 4.dp, vertical = 1.dp)
                        .testTag("device_video_badge_${media.mediaId}"),
                )
            }
        }
    }
}
