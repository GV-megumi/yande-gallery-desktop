package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import com.bluskysoftware.yandegallery.ui.theme.MiuiTokens

/**
 * 相册卡片（v0.6 从 AlbumsScreen 抽出，主页/其他相册页/重排模式共用）：
 * 1:1 圆角封面 + 名称 + 「N 张」；长按弹菜单（[menuItems] 插槽，dismiss 由卡片收敛）；
 * [enableMenu]=false 供重排模式禁用长按菜单。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun AlbumCardItem(
    card: AlbumCard,
    baseUrl: String,
    serverId: Long,
    loader: ImageLoader,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enableMenu: Boolean = true,
    menuItems: @Composable ColumnScope.(dismiss: () -> Unit) -> Unit = {},
) {
    var menuOpen by remember { mutableStateOf(false) }
    Box(modifier) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(
                    onClick = onClick,
                    // enableMenu=false 必须传 null 而非空操作 lambda（评审修复链）：非 null onLongClick
                    // 让 detectTapGestures 在长按成立后 consumeUntilUp() 吃掉全部 move 事件，重排模式
                    // 外层的 detectDragGesturesAfterLongPress 会在首个 move 上被判消费而取消拖动。
                    onLongClick = if (enableMenu) {
                        { menuOpen = true }
                    } else {
                        null
                    },
                )
                .testTag("album_card_${card.gallery.id}"),
        ) {
            val coverId = card.coverImageId
            if (coverId != null) {
                RetryableAsyncImage(
                    model = thumbnailRequest(LocalContext.current, baseUrl, serverId, coverId),
                    imageLoader = loader,
                    contentDescription = card.gallery.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().aspectRatio(1f).clip(MiuiTokens.CoverShape),
                )
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(1f)
                        .clip(MiuiTokens.CoverShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
            }
            Text(
                card.gallery.name,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(top = 8.dp),
            )
            Text(
                "${card.gallery.imageCount} 张",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            menuItems { menuOpen = false }
        }
    }
}
