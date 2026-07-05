package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import coil3.compose.AsyncImage
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest

/** 图集详情：4 列网格 + 顶栏返回。M2 只读——新建/重命名/删除是 M3 写操作 UI。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AlbumDetailScreen(
    viewModel: AlbumDetailViewModel,
    onBack: () -> Unit,
    onOpenViewer: (imageId: Long) -> Unit,
) {
    val title by viewModel.title.collectAsStateWithLifecycle(initialValue = "")
    val activeServer by viewModel.activeServer.collectAsStateWithLifecycle()
    val items = viewModel.pagingFlow.collectAsLazyPagingItems()
    val baseUrl = activeServer?.baseUrl.orEmpty()
    val serverId = activeServer?.id ?: 0L
    val loader = viewModel.thumbnailLoader

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        AlbumDetailGrid(
            items = items,
            modifier = Modifier.padding(padding),
            imageCell = { image ->
                AsyncImage(
                    model = thumbnailRequest(LocalContext.current, baseUrl, serverId, image.id),
                    imageLoader = loader,
                    contentDescription = image.filename,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .aspectRatio(1f)
                        .padding(1.dp)
                        .clickable { onOpenViewer(image.id) },
                )
            },
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
