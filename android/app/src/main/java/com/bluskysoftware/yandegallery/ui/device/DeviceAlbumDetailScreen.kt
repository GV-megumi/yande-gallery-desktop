package com.bluskysoftware.yandegallery.ui.device

import androidx.activity.compose.BackHandler
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import com.bluskysoftware.yandegallery.data.device.formatDurationMs
import com.bluskysoftware.yandegallery.ui.common.MiuiSubPageTopBar
import com.bluskysoftware.yandegallery.ui.common.PhotosSelectionBars
import com.bluskysoftware.yandegallery.ui.common.PinchStepState
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import com.bluskysoftware.yandegallery.ui.common.SelectableCell
import com.bluskysoftware.yandegallery.ui.common.SelectionTopBar
import com.bluskysoftware.yandegallery.ui.common.detectPinchStep
import com.bluskysoftware.yandegallery.ui.theme.MiuiTokens

/**
 * 相册网格页（Task 6，spec §2.2）：分页网格 + 捏合切列数 + 视频时长角标。多选长按进入后顶栏换
 * SelectionTopBar；底部多选动作栏本任务不渲染（brief：批量动作回填 Task 7 接真回调前先占位），
 * [selectionBars] 参数先接住占位（AppScaffold 侧顶/底栏 swap 条件已就绪），本屏暂不写入其 model。
 */
@Composable
fun DeviceAlbumDetailScreen(
    viewModel: DeviceAlbumDetailViewModel,
    loader: ImageLoader,
    onOpenViewer: (mediaId: Long) -> Unit,
    onBack: () -> Unit,
    selectionBars: PhotosSelectionBars,
) {
    val title by viewModel.title.collectAsStateWithLifecycle()
    val count by viewModel.count.collectAsStateWithLifecycle()
    val columns by viewModel.columns.collectAsStateWithLifecycle()
    val selected by viewModel.selection.selectedFlow.collectAsStateWithLifecycle()
    val items = viewModel.media.collectAsLazyPagingItems()
    val selectionActive = selected.isNotEmpty()

    val pinchState = remember {
        PinchStepState<Int>(
            larger = { if (it > DeviceAlbumDetailViewModel.MIN_COLUMNS) it - 1 else null }, // 放大 → 列数减
            smaller = { if (it < DeviceAlbumDetailViewModel.MAX_COLUMNS) it + 1 else null },
        )
    }

    // 多选激活时系统返回键只退出多选、不返回上一页（AlbumDetailScreen 同款既有约定）。
    BackHandler(enabled = selectionActive) { viewModel.selection.clear() }

    Scaffold(
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
