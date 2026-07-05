package com.bluskysoftware.yandegallery.ui.photos

import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import coil3.ImageLoader
import coil3.compose.AsyncImage
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest
import com.bluskysoftware.yandegallery.domain.sync.SyncPhase
import com.bluskysoftware.yandegallery.ui.common.ConnectionBanner

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
    val items = viewModel.pagingFlow.collectAsLazyPagingItems()

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

    val baseUrl = server.baseUrl
    val serverId = server.id
    val loader = viewModel.thumbnailLoader
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // 顶部连接横幅：offline / unauthorized（点击跳服务器页重新配对）
            ConnectionBanner(state = connState, onReconnectAuth = onAddServer)
            PullToRefreshBox(
                isRefreshing = syncPhase.showsRefreshSpinner(),
                onRefresh = viewModel::refresh,
                modifier = Modifier.fillMaxSize(),
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
                            AsyncImage(
                                model = thumbnailRequest(LocalContext.current, baseUrl, serverId, photo.image.id),
                                imageLoader = loader,
                                contentDescription = photo.image.filename,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier
                                    .aspectRatio(1f)
                                    .padding(1.dp)
                                    .clickable { onOpenViewer(photo.image.id) },
                            )
                        },
                    )
                }
            }
        }
        SnackbarHost(snackbarHostState, Modifier.align(Alignment.BottomCenter))
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
