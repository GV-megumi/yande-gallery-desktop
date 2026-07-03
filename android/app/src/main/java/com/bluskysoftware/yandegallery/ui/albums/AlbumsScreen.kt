package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import coil3.ImageLoader
import coil3.compose.AsyncImage
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest
import com.bluskysoftware.yandegallery.ui.Routes

/**
 * 相册 tab：两列图集卡片网格。点击卡片跳图集详情；无图集时展示空态文案
 * （无论是"从未同步"还是"当前无激活服务器"都归为同一空态——图集列表为空即空态，
 * 不额外区分引导态，保持与 brief 的单一"空态文案"描述一致）。
 */
@Composable
fun AlbumsScreen(
    viewModel: AlbumsViewModel,
    navController: NavHostController,
) {
    val activeServer by viewModel.activeServer.collectAsStateWithLifecycle()
    val albums by viewModel.albums.collectAsStateWithLifecycle(initialValue = emptyList())

    if (albums.isEmpty()) {
        AlbumsEmpty()
        return
    }

    val baseUrl = activeServer?.baseUrl.orEmpty()
    val serverId = activeServer?.id ?: 0L
    val loader = viewModel.thumbnailLoader
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        modifier = Modifier.fillMaxSize().testTag("albums_grid"),
    ) {
        items(albums, key = { it.gallery.id }) { card ->
            AlbumCardItem(
                card = card,
                baseUrl = baseUrl,
                serverId = serverId,
                loader = loader,
                onClick = { navController.navigate(Routes.albumDetail(card.gallery.id)) },
            )
        }
    }
}

@Composable
private fun AlbumCardItem(
    card: AlbumCard,
    baseUrl: String,
    serverId: Long,
    loader: ImageLoader,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(8.dp)
            .clickable(onClick = onClick)
            .testTag("album_card_${card.gallery.id}"),
    ) {
        val coverId = card.coverImageId
        if (coverId != null) {
            AsyncImage(
                model = thumbnailRequest(LocalContext.current, baseUrl, serverId, coverId),
                imageLoader = loader,
                contentDescription = card.gallery.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().aspectRatio(1f),
            )
        } else {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
            )
        }
        Text(
            card.gallery.name,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 4.dp),
        )
        Text(
            "${card.gallery.imageCount} 张",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun AlbumsEmpty() {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp).testTag("albums_empty"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "还没有图集",
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            "连接服务器并同步后，图集会显示在这里",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}
