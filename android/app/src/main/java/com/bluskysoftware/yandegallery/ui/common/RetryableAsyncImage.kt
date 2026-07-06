package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.compose.AsyncImagePainter

/**
 * 加载失败占位 + 点按重试（spec §8 / D6a）：onState 捕获 Error 态；点按自增 retryEpoch，
 * key(retryEpoch) 重挂 AsyncImage 重新发请求（Coil 不缓存失败结果，重挂即重试；
 * 成功结果仍走盘/内存缓存直出，离线已缓存图不受影响）。
 * remember(model) 让重试/失败态随底图切换复位——LazyGrid 格子回收给不同图时不残留旧态。
 */
@Composable
fun RetryableAsyncImage(
    model: Any?,
    imageLoader: ImageLoader,
    contentDescription: String?,
    contentScale: ContentScale,
    modifier: Modifier = Modifier,
    imageModifier: Modifier? = null,   // null → matchParentSize（BoxScope 内解析，故不能作默认参数值）
    dark: Boolean = false,
) {
    var retryEpoch by remember(model) { mutableStateOf(0) }
    var failed by remember(model) { mutableStateOf(false) }
    Box(modifier, contentAlignment = Alignment.Center) {
        key(retryEpoch) {
            AsyncImage(
                model = model,
                imageLoader = imageLoader,
                contentDescription = contentDescription,
                contentScale = contentScale,
                onState = { state -> failed = state is AsyncImagePainter.State.Error },
                // 默认撑满外层 Box：Crop 语义正确、加载期占位尺寸稳定（网格四处调用不传即得）
                modifier = imageModifier ?: Modifier.matchParentSize(),
            )
        }
        if (failed) {
            ImageErrorPlaceholder(
                dark = dark,
                onRetry = { failed = false; retryEpoch++ },
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}

/** 失败占位视觉（独立可测）：灰底/黑底 + 图标 + 中文提示，整块可点重试。 */
@Composable
fun ImageErrorPlaceholder(dark: Boolean, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    val bg = if (dark) Color.Black else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (dark) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
    Column(
        modifier = modifier
            .background(bg)
            .clickable(onClick = onRetry)
            .padding(8.dp)
            .testTag("image_error_placeholder"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Filled.BrokenImage, contentDescription = null, tint = fg)
        Text("加载失败，点按重试", style = MaterialTheme.typography.labelSmall, color = fg)
    }
}
