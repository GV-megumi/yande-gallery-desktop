package com.bluskysoftware.yandegallery.ui.viewer

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import coil3.ImageLoader
import coil3.request.ImageRequest
import com.bluskysoftware.yandegallery.data.db.ImageEntity

/**
 * 全屏大图页（M3 Task 10）：装配层——收集 VM 流，把分页数据与三档模型选择喂给 [ViewerPager]。
 * 共享元素转场按计划后置 M4，本页走普通导航进入。
 */
@Composable
fun ViewerScreen(
    viewModel: ViewerViewModel,
    onBack: () -> Unit,
) {
    val activeServer by viewModel.activeServer.collectAsStateWithLifecycle()
    val items = viewModel.pagingFlow.collectAsLazyPagingItems()
    val server = activeServer
    val baseUrl = server?.baseUrl.orEmpty()

    ViewerPager(
        items = items,
        initialImageId = viewModel.initialImageId,
        imageLoader = viewModel.previewLoader,
        modelFor = { image -> viewModel.modelFor(image, baseUrl) },
        onPrefetch = { image ->
            // 相邻预取（spec §6.4/§9）：已下载的图 modelFor 返回 Uri（本地即读，无需预取）；
            // 仅对走 1600 档网络请求的图 enqueue，复用与页面完全一致的缓存键。
            if (server != null) {
                val model = viewModel.modelFor(image, baseUrl)
                if (model is ImageRequest) viewModel.previewLoader.enqueue(model)
            }
        },
        onBack = onBack,
    )
}

/**
 * 大图 Pager 骨架（无 VM 依赖，Robolectric 冒烟可注入 fake PagingData）：
 * - 初始页按 id 在已加载快照中匹配定位（T9 契约：不预算绝对下标）；未命中且分页未到底时
 *   主动触达快照末项驱动 append，随 loadState 变化重试直到命中或放弃；定位前盖黑色占位层防错图闪现。
 * - 页面 settle 后：重置其余页缩放（回看回到适配大小，对齐米家相册）+ 预取相邻 page±1。
 * - 单击切沉浸（WindowInsetsControllerCompat 隐/显系统栏，同时隐/显返回键与底部操作栏）。
 * - Pager 横滑由当前页 [ZoomableImageState.consumesHorizontalDrag] 门控（放大态不翻页）。
 */
@Composable
fun ViewerPager(
    items: LazyPagingItems<ImageEntity>,
    initialImageId: Long,
    imageLoader: ImageLoader,
    modelFor: (ImageEntity) -> Any,
    onPrefetch: (ImageEntity) -> Unit,
    onBack: () -> Unit,
) {
    val pagerState = rememberPagerState { items.itemCount }
    val zoomStates = remember { mutableStateMapOf<Int, ZoomableImageState>() }
    var located by remember { mutableStateOf(false) }
    var immersive by remember { mutableStateOf(false) }
    val currentOnPrefetch by rememberUpdatedState(onPrefetch)

    // 初始页定位：按 id 重查快照直到命中；id 在深处时须驱动 append（触达末项触发下一页加载）。
    // 到底仍未命中（图片已被同步删除）或 append 出错 → 放弃定位，留在已加载首部兜底。
    LaunchedEffect(items.itemCount, items.loadState.append, initialImageId) {
        if (located || items.itemCount == 0) return@LaunchedEffect
        val index = (0 until items.itemCount).indexOfFirst { items.peek(it)?.id == initialImageId }
        val append = items.loadState.append
        when {
            index >= 0 -> {
                pagerState.scrollToPage(index)
                located = true
            }
            append is LoadState.NotLoading && !append.endOfPaginationReached ->
                items[items.itemCount - 1] // 驱动下一页 append；完成后本 effect 因 loadState 变化重跑

            append is LoadState.NotLoading && append.endOfPaginationReached -> located = true
            append is LoadState.Error -> located = true
            // append Loading → 等 loadState 变化后重跑
        }
    }

    // 页面 settle：其余页缩放重置 + 相邻页预取
    LaunchedEffect(pagerState, items) {
        snapshotFlow { pagerState.settledPage }.collect { settled ->
            zoomStates.keys.filter { it != settled }.forEach { zoomStates.remove(it) }
            for (neighbor in intArrayOf(settled - 1, settled + 1)) {
                if (neighbor in 0 until items.itemCount) {
                    items.peek(neighbor)?.let { currentOnPrefetch(it) }
                }
            }
        }
    }

    // 沉浸模式：隐/显系统栏；离开本页时无条件恢复显示
    val view = LocalView.current
    val activity = remember(view) { view.context.findActivity() }
    LaunchedEffect(immersive) { applySystemBars(activity, view, hide = immersive) }
    DisposableEffect(Unit) {
        onDispose { applySystemBars(activity, view, hide = false) }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .testTag("viewer_pager"),
    ) {
        HorizontalPager(
            state = pagerState,
            userScrollEnabled = zoomStates[pagerState.currentPage]?.consumesHorizontalDrag != true,
            key = { index -> items.peek(index)?.id ?: index },
            modifier = Modifier.fillMaxSize(),
        ) { page ->
            val image = items[page]
            if (image == null) {
                Box(Modifier.fillMaxSize())
            } else {
                ZoomableImage(
                    model = modelFor(image),
                    imageLoader = imageLoader,
                    state = zoomStates.getOrPut(page) { ZoomableImageState() },
                    contentDescription = image.filename,
                    onSingleTap = { immersive = !immersive },
                    onDismiss = onBack,
                )
            }
        }

        // 初始页定位完成前的占位层：防止第 0 页错图闪现
        if (!located) {
            Box(
                Modifier
                    .matchParentSize()
                    .background(Color.Black),
            )
        }

        if (!immersive) {
            IconButton(
                onClick = onBack,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .statusBarsPadding()
                    .testTag("viewer_back"),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "返回",
                    tint = Color.White,
                )
            }

            // 底部操作栏占位槽：内容（下载/收藏/删除/详情等）由 Task 11 填充
            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.4f))
                    .navigationBarsPadding()
                    .padding(8.dp)
                    .testTag("viewer_bottom_bar"),
                horizontalArrangement = Arrangement.Center,
            ) {
                // Task 11：操作按钮在此填充
            }
        }
    }
}

/** 隐/显系统栏（沉浸模式）；window 取不到（非 Activity 宿主）时静默跳过。 */
private fun applySystemBars(activity: Activity?, view: android.view.View, hide: Boolean) {
    val window = activity?.window ?: return
    val controller = WindowCompat.getInsetsController(window, view)
    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    if (hide) controller.hide(WindowInsetsCompat.Type.systemBars())
    else controller.show(WindowInsetsCompat.Type.systemBars())
}

/** 从 Compose 视图上下文向上剥 ContextWrapper 找宿主 Activity（拿 window 用）。 */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
