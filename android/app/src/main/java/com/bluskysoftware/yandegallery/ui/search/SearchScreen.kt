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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
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
import com.bluskysoftware.yandegallery.ui.theme.MiuiTokens

/**
 * 搜索页（Task 12）：顶部即时搜索框 + 无输入显历史 chips（点回填/可清空）+ 有输入显结果网格。
 *
 * 结果网格复用时间轴的 thumbnailRequest 缩略图管线与格子样式，点击进大图页（galleryId=null，翻页限时间轴）。
 * IME 搜索键写历史；从大图页标签跳入时 [initialQuery] 预填并即时触发搜索。
 *
 * @param initialQuery 从大图页标签 chip 跳入的初始词（预填输入框，触发即时搜索）；普通入口为空串。
 */
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
    val activeServerResolved by viewModel.activeServerResolved.collectAsStateWithLifecycle()
    val items = viewModel.pagingFlow.collectAsLazyPagingItems()

    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }

    // 标签跳入：预填初始词（onQueryChange 即触发 debounce 搜索）。仅首次消费——旋转/进程重建后
    // prefillConsumed 经 rememberSaveable 存活，不再用 initialQuery 回冲用户已改的词（D12A）。
    var prefillConsumed by rememberSaveable(initialQuery) { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (!prefillConsumed && initialQuery.isNotBlank()) {
            viewModel.onQueryChange(initialQuery)
            prefillConsumed = true
        }
        focusRequester.requestFocus()   // 焦点请求不受守卫影响
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 8.dp),
            ) {
                IconButton(onClick = onBack, modifier = Modifier.testTag("search_back")) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                }
                MiuiSearchField(
                    value = query,
                    onValueChange = viewModel::onQueryChange,
                    placeholder = "搜索标签或文件名",
                    onSearch = {
                        viewModel.commitSearch()
                        keyboard?.hide()
                    },
                    onClear = { viewModel.onQueryChange("") },
                    focusRequester = focusRequester,
                    modifier = Modifier.weight(1f),
                )
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            val server = activeServer
            when {
                query.isBlank() -> SearchHistory(
                    history = history,
                    onPick = { viewModel.onQueryChange(it) },
                    onClear = viewModel::clearHistory,
                )
                // 三态门（照片页 A7 同款，审查 minor）：activeServer 初值 null，DB 首发射未到时
                // 不能当「无服务器」——标签跳入（query 预填非空）会闪现错误引导文案再跳成结果
                !activeServerResolved -> Box(Modifier.fillMaxSize())
                // 无激活服务器门控（BUG-16）：镜像残留行用 serverId=0/baseUrl="" 兜底只会整屏破图
                // 且点重试不恢复——与时间轴引导态同口径给文案，不渲染注定失败的网格
                server == null -> Box(
                    modifier = Modifier.fillMaxSize().padding(32.dp).testTag("search_no_server"),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "还没有连接任何服务器，请先在设置中添加并激活服务器",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.outline,
                        textAlign = TextAlign.Center,
                    )
                }
                else -> SearchResultGrid(
                    items = items,
                    baseUrl = server.baseUrl,
                    serverId = server.id,
                    loader = viewModel.thumbnailLoader,
                    onOpenViewer = onOpenViewer,
                )
            }
        }
    }
}

/** 灰底胶囊搜索框（spec §7）：40dp 高、无下划线；testTag search_field/search_clear_query 契约保留。 */
@Composable
private fun MiuiSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    onSearch: () -> Unit,
    onClear: () -> Unit,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = modifier.height(40.dp),
    ) {
        // 放大镜/占位词/清除钮必须走 decorationBox 而非 BasicTextField 的兄弟节点（审查修复）：
        // 兄弟布局时文本框命中区只有中间约 20dp 高的文本条带，胶囊上下边带与放大镜区全是死区
        // （Surface 内建的空 pointerInput 会拦截落点）——用户收起键盘后点胶囊边缘无法重新唤起 IME。
        // decorationBox 让整个 40dp 胶囊都是文本框命中区：点任意处聚焦并呼出键盘（已聚焦再点也会重新 show）。
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { onSearch() }),
            modifier = Modifier
                .fillMaxSize()
                .focusRequester(focusRequester)
                .testTag("search_field"),
            decorationBox = { innerTextField ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                ) {
                    Icon(
                        Icons.Filled.Search, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                    Box(Modifier.weight(1f).padding(horizontal = 8.dp), contentAlignment = Alignment.CenterStart) {
                        if (value.isEmpty()) {
                            Text(placeholder, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        innerTextField()
                    }
                    if (value.isNotEmpty()) {
                        // 清除按钮必须是 IconButton（审查修复）：裸 Icon.clickable 不套 minimumInteractiveComponentSize，
                        // 命中区只剩 20dp 且丢 Role.Button 语义；tag 落按钮上与旧契约一致（performClick 兼容）。
                        // 置于 decorationBox 内与 Material TextField trailing icon 同构：按钮消费掉点击后不会触发聚焦。
                        IconButton(onClick = onClear, modifier = Modifier.testTag("search_clear_query")) {
                            Icon(
                                Icons.Filled.Close, contentDescription = "清除",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
            },
        )
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
            Text("搜索历史", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            IconButton(onClick = onClear, modifier = Modifier.testTag("search_clear_history")) {
                Icon(Icons.Outlined.Delete, contentDescription = "清空搜索历史", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            history.forEach { q ->
                // 历史胶囊换皮为 Surface+clickable 后 Role.Button 必须显式补上（审查修复）：
                // 裸 clickable 无 Role，TalkBack 不再播报为按钮，与同文件清除按钮的修复标准一致。
                // 布局高约 34dp（<48dp）是 MIUI 密排刻意取舍：spec §7 要求 8dp 紧凑流式胶囊，
                // 套 minimumInteractiveComponentSize 会把 FlowRow 每行撑到 48dp 破坏密度；
                // 实际触摸命中由 Compose 指针命中区最小触控目标扩展兜底（间隙落点归最近胶囊）。
                Surface(
                    shape = RoundedCornerShape(50),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .clickable(role = Role.Button) { onPick(q) }
                        .testTag("search_history_$q"),
                ) {
                    Text(q, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp))
                }
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
        horizontalArrangement = Arrangement.spacedBy(MiuiTokens.GridGap),
        verticalArrangement = Arrangement.spacedBy(MiuiTokens.GridGap),
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
                        .clip(MiuiTokens.CellShape)
                        .clickable { onOpenViewer(image.id) },
                )
            }
        }
    }
}
