package com.bluskysoftware.yandegallery.ui.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AssistChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.image.thumbnailRequest
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage

/**
 * 搜索页（Task 12）：顶部即时搜索框 + 无输入显历史 chips（点回填/可清空）+ 有输入显结果网格。
 *
 * 结果网格复用时间轴的 thumbnailRequest 缩略图管线与格子样式，点击进大图页（galleryId=null，翻页限时间轴）。
 * IME 搜索键写历史；从大图页标签跳入时 [initialQuery] 预填并即时触发搜索。
 *
 * @param initialQuery 从大图页标签 chip 跳入的初始词（预填输入框，触发即时搜索）；普通入口为空串。
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
@Composable
fun SearchScreen(
    viewModel: SearchViewModel,
    onOpenViewer: (imageId: Long) -> Unit,
    onBack: () -> Unit,
    initialQuery: String = "",
) {
    val query by viewModel.query.collectAsStateWithLifecycle()
    val history by viewModel.history.collectAsStateWithLifecycle(initialValue = emptyList())
    val activeServer by viewModel.activeServer.collectAsStateWithLifecycle()
    val items = viewModel.pagingFlow.collectAsLazyPagingItems()

    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }

    // 标签跳入：预填初始词（onQueryChange 即触发 debounce 搜索）。仅首次进入生效。
    LaunchedEffect(Unit) {
        if (initialQuery.isNotBlank()) viewModel.onQueryChange(initialQuery)
        focusRequester.requestFocus()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack, modifier = Modifier.testTag("search_back")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                title = {
                    TextField(
                        value = query,
                        onValueChange = viewModel::onQueryChange,
                        placeholder = { Text("搜索标签或文件名") },
                        singleLine = true,
                        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                        trailingIcon = {
                            if (query.isNotEmpty()) {
                                IconButton(
                                    onClick = { viewModel.onQueryChange("") },
                                    modifier = Modifier.testTag("search_clear_query"),
                                ) { Icon(Icons.Filled.Close, contentDescription = "清除") }
                            }
                        },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(
                            onSearch = {
                                viewModel.commitSearch()
                                keyboard?.hide()
                            },
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(focusRequester)
                            .testTag("search_field"),
                    )
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (query.isBlank()) {
                SearchHistory(
                    history = history,
                    onPick = { viewModel.onQueryChange(it) },
                    onClear = viewModel::clearHistory,
                )
            } else {
                SearchResultGrid(
                    items = items,
                    baseUrl = activeServer?.baseUrl.orEmpty(),
                    serverId = activeServer?.id ?: 0L,
                    loader = viewModel.thumbnailLoader,
                    onOpenViewer = onOpenViewer,
                )
            }
        }
    }
}

/** 无输入态：搜索历史 chips（点击回填并触发搜索）+ 清空入口；无历史时给一句提示。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SearchHistory(
    history: List<String>,
    onPick: (String) -> Unit,
    onClear: () -> Unit,
) {
    if (history.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize().padding(32.dp).testTag("search_empty_hint"),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "输入关键词，按标签名前缀或文件名搜索",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.outline,
                textAlign = TextAlign.Center,
            )
        }
        return
    }
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("搜索历史", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            TextButton(onClick = onClear, modifier = Modifier.testTag("search_clear_history")) {
                Text("清空")
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            history.forEach { q ->
                AssistChip(
                    onClick = { onPick(q) },
                    label = { Text(q) },
                    modifier = Modifier.testTag("search_history_$q"),
                )
            }
        }
    }
}

/** 结果网格：4 列固定，复用时间轴 thumbnailRequest 管线与格子样式，点击进大图页（时间轴上下文）。 */
@Composable
fun SearchResultGrid(
    items: LazyPagingItems<ImageEntity>,
    baseUrl: String,
    serverId: Long,
    loader: ImageLoader,
    onOpenViewer: (imageId: Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(4),
        modifier = modifier.fillMaxSize().testTag("search_grid"),
    ) {
        items(
            count = items.itemCount,
            key = { index -> items.peek(index)?.let { "img:${it.id}" } ?: "null:$index" },
        ) { index ->
            val image = items[index]
            if (image == null) {
                Box(Modifier.aspectRatio(1f))
            } else {
                RetryableAsyncImage(
                    model = thumbnailRequest(LocalContext.current, baseUrl, serverId, image.id),
                    imageLoader = loader,
                    contentDescription = image.filename,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .aspectRatio(1f)
                        .padding(1.dp)
                        .clickable { onOpenViewer(image.id) },
                )
            }
        }
    }
}
