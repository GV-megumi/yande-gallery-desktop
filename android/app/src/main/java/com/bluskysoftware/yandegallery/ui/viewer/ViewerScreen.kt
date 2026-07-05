package com.bluskysoftware.yandegallery.ui.viewer

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.work.WorkInfo
import coil3.ImageLoader
import coil3.request.ImageRequest
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.media.DeleteOwnedResult
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.GalleryPickerDialog
import kotlinx.coroutines.launch

/** 高倍缩放提示阈值（spec §7.3：scale 超约 2.5x 且未下载时提示 1600 档像素不足）。 */
private const val HIGH_ZOOM_THRESHOLD = 2.5f

/**
 * 全屏大图页（M3 Task 10/11）：装配层——收集 VM 流，把分页数据与三档模型选择喂给 [ViewerPager]，
 * 并装配底部操作栏（分享/查看原图/删除级联/详情/更多）与详情面板（标签编辑、跳图集）。
 * 共享元素转场按计划后置 M4，本页走普通导航进入。
 *
 * @param onOpenGallery 详情面板「所属图集」点击 → 图集详情页（MainActivity 接 Routes.albumDetail）
 * @param onOpenSearch 详情面板标签 chip 点击 → 搜索页并以该标签名预填触发搜索（MainActivity 接 Routes.search）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ViewerScreen(
    viewModel: ViewerViewModel,
    onBack: () -> Unit,
    onOpenGallery: (Long) -> Unit = {},
    onOpenSearch: (String) -> Unit = {},
) {
    val activeServer by viewModel.activeServer.collectAsStateWithLifecycle()
    val downloadedUris by viewModel.downloadedUris.collectAsStateWithLifecycle()
    val connState by viewModel.connState.collectAsStateWithLifecycle()
    val galleries by viewModel.galleries.collectAsStateWithLifecycle(initialValue = emptyList())
    val items = viewModel.pagingFlow.collectAsLazyPagingItems()
    val server = activeServer
    val baseUrl = server?.baseUrl.orEmpty()

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    var detail by remember { mutableStateOf<ImageDetail?>(null) }
    var showTagEditor by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<ImageEntity?>(null) }
    var pickGalleryFor by remember { mutableStateOf<Long?>(null) }
    var cascadeImageId by remember { mutableStateOf<Long?>(null) }

    // 30+ 级联删系统相册副本的确认结果：同意 → 系统已删文件；拒绝 → 文件保留（用户自主选择）。
    // 两种结果都只清 downloads 映射行（spec §8），随后返回上一页（镜像行已删，图已不在）。
    val cascadeLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) {
        val id = cascadeImageId
        cascadeImageId = null
        scope.launch {
            if (id != null) viewModel.clearDownloadRow(id)
            onBack()
        }
    }

    /** detailOf 对同步中途被删的行抛 IllegalArgumentException（T9 KDoc 契约）——捕获降级：关面板 + 提示。 */
    fun openDetail(imageId: Long) {
        scope.launch {
            detail = try {
                viewModel.detailOf(imageId)
            } catch (e: IllegalArgumentException) {
                showTagEditor = false
                snackbar.showSnackbar("图片已不存在")
                null
            }
        }
    }

    fun editTag(imageId: Long, name: String, add: Boolean) {
        scope.launch {
            val result = if (add) viewModel.addTags(imageId, listOf(name))
            else viewModel.removeTags(imageId, listOf(name))
            when (result) {
                WriteResult.Success -> openDetail(imageId) // 重查 detailOf 刷新面板与编辑对话框
                is WriteResult.Failed -> snackbar.showSnackbar(failText("标签编辑失败", result))
            }
        }
    }

    fun performDelete(image: ImageEntity) {
        scope.launch {
            val localUri = viewModel.downloadedUris.value[image.id]  // 先取快照（删镜像行不影响 downloads 表）
            when (val result = viewModel.deleteImage(image.id)) {
                is WriteResult.Failed -> snackbar.showSnackbar(failText("删除失败", result))
                WriteResult.Success -> {
                    if (localUri == null) {
                        onBack()
                        return@launch
                    }
                    val uri = localUri.toUri()
                    val pending = viewModel.buildDeleteRequest(uri)
                    if (pending != null) {
                        // 30+：先记 imageId 再拉系统确认；清映射与返回收敛到 launcher 回调
                        cascadeImageId = image.id
                        cascadeLauncher.launch(IntentSenderRequest.Builder(pending.intentSender).build())
                    } else {
                        // <30：直删本地副本；API 29 失去所有权时系统抛 RecoverableSecurityException，
                        // gateway 转成 NeedsConsent(intentSender)——走与 30+ 同一个 cascadeLauncher（spec §8）
                        when (val r = viewModel.deleteLocalCopy(uri)) {
                            is DeleteOwnedResult.NeedsConsent -> {
                                cascadeImageId = image.id
                                cascadeLauncher.launch(IntentSenderRequest.Builder(r.intentSender).build())
                            }
                            is DeleteOwnedResult.Failed -> {
                                snackbar.showSnackbar("本地副本删除失败：${r.message ?: "未知错误"}")   // spec §8 明确报错不静默
                                viewModel.clearDownloadRow(image.id)
                                onBack()
                            }
                            DeleteOwnedResult.Deleted -> {
                                viewModel.clearDownloadRow(image.id)
                                onBack()
                            }
                        }
                    }
                }
            }
        }
    }

    /** 分享简化版（计划允许）：已下载 → ACTION_SEND 其 MediaStore Uri；未下载提示先下载（「下载后自动分享」后置 M4）。 */
    fun share(image: ImageEntity) {
        val localUri = viewModel.downloadedUris.value[image.id]
        if (localUri == null) {
            scope.launch { snackbar.showSnackbar("请先下载原图（点「查看原图」）") }
            return
        }
        val send = Intent(Intent.ACTION_SEND).apply {
            type = mimeOf(image.format)
            putExtra(Intent.EXTRA_STREAM, localUri.toUri())
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, "分享图片"))
    }

    Box(Modifier.fillMaxSize()) {
        ViewerPager(
            items = items,
            initialImageId = viewModel.initialImageId,
            imageLoader = viewModel.previewLoader,
            // 模型记忆化（审查修复）：modelFor 对已下载图做主线程 gateway.exists()，不能随缩放帧重组
            // 每帧重调。key 含「该图当前下载映射 + baseUrl」——下载完成/失效或切服时 key 变化，
            // 档位升降级仍即时生效（downloadedUris 以 Compose 状态订阅，变化会触发重组）。
            modelFor = { image ->
                remember(image.id, downloadedUris[image.id], baseUrl) {
                    viewModel.modelFor(image, baseUrl)
                }
            },
            onPrefetch = { image ->
                // 相邻预取（spec §6.4/§9）：已下载的图 modelFor 返回 Uri（本地即读，无需预取）；
                // 仅对走 1600 档网络请求的图 enqueue，复用与页面完全一致的缓存键。
                if (server != null) {
                    val model = viewModel.modelFor(image, baseUrl)
                    if (model is ImageRequest) viewModel.previewLoader.enqueue(model)
                }
            },
            actionBar = { image, zoomedIn ->
                val workState by remember(image.id) { viewModel.downloadState(image.id) }
                    .collectAsStateWithLifecycle(initialValue = null)
                val isDownloaded = downloadedUris.containsKey(image.id)
                // 下载失败提示：只在观察到「进行中 → FAILED」翻转时提示一次（历史 FAILED 不随翻页重复骚扰）。
                // T8 约定 MediaStore 写失败也表现为 WorkInfo FAILED（spec §8 明确报错不静默）。
                var prevWorkState by remember(image.id) { mutableStateOf<WorkInfo.State?>(null) }
                LaunchedEffect(workState) {
                    if (workState == WorkInfo.State.FAILED && prevWorkState?.isFinished == false) {
                        snackbar.showSnackbar("下载失败：网络中断或保存到系统相册失败")
                    }
                    prevWorkState = workState
                }
                ViewerActionBar(
                    image = image,
                    isDownloaded = isDownloaded,
                    downloading = workState == WorkInfo.State.ENQUEUED || workState == WorkInfo.State.RUNNING,
                    online = connState.online,
                    highZoom = zoomedIn && !isDownloaded,
                    onShare = { share(image) },
                    onViewOriginal = { viewModel.enqueueDownload(image) },
                    onDelete = { confirmDelete = image },
                    onDetail = {
                        showTagEditor = false
                        openDetail(image.id)
                    },
                    onAddToGallery = { pickGalleryFor = image.id },
                    onRemoveFromGallery = viewModel.contextGalleryId?.let { galleryId ->
                        {
                            scope.launch {
                                when (val r = viewModel.removeFromGallery(galleryId, image.id)) {
                                    WriteResult.Success -> snackbar.showSnackbar("已移出当前图集")
                                    is WriteResult.Failed -> snackbar.showSnackbar(failText("移出图集失败", r))
                                }
                            }
                        }
                    },
                )
            },
            onBack = onBack,
        )
        SnackbarHost(
            snackbar,
            Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 88.dp),
        )
    }

    // 删除二次确认：明示服务器删除 + 本地副本级联（spec §7.3 D10 / §8）
    confirmDelete?.let { image ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("删除图片") },
            text = { Text("确定删除「${image.filename}」？将从服务器删除；本机已保存的原图副本也会一并删除。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmDelete = null
                        performDelete(image)
                    },
                    modifier = Modifier.testTag("viewer_delete_confirm"),
                ) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = null }) { Text("取消") }
            },
        )
    }

    // 「加入图集」选择器（更多菜单）
    pickGalleryFor?.let { imageId ->
        GalleryPickerDialog(
            galleries = galleries,
            onPick = { galleryId ->
                pickGalleryFor = null
                scope.launch {
                    when (val r = viewModel.addToGallery(galleryId, imageId)) {
                        WriteResult.Success -> snackbar.showSnackbar("已加入图集")
                        is WriteResult.Failed -> snackbar.showSnackbar(failText("加入图集失败", r))
                    }
                }
            },
            onDismiss = { pickGalleryFor = null },
        )
    }

    // 详情底部面板（点详情弹出）+ 标签编辑对话框
    detail?.let { d ->
        ModalBottomSheet(
            onDismissRequest = {
                detail = null
                showTagEditor = false
            },
        ) {
            DetailPanel(
                detail = d,
                online = connState.online,
                onEditTags = { showTagEditor = true },
                onTagClick = { tag ->
                    // 标签 chip → 搜索页（以标签名预填触发搜索）；先关面板再离开本页
                    detail = null
                    showTagEditor = false
                    onOpenSearch(tag)
                },
                onGalleryClick = { galleryId ->
                    detail = null
                    onOpenGallery(galleryId)
                },
                galleryNames = galleries.associate { it.id to it.name },
            )
        }
        if (showTagEditor) {
            TagEditDialog(
                tagNames = d.tagNames,
                onAdd = { name -> editTag(d.entity.id, name, add = true) },
                onRemove = { name -> editTag(d.entity.id, name, add = false) },
                onDismiss = { showTagEditor = false },
            )
        }
    }
}

/** 写失败 → 提示文案：401 统一引导重新配对，其余带上下文前缀。 */
private fun failText(prefix: String, result: WriteResult.Failed): String =
    if (result.unauthorized) "密钥失效，请重新配对" else "$prefix：${result.message}"

/**
 * 大图 Pager 骨架（无 VM 依赖，Robolectric 冒烟可注入 fake PagingData）：
 * - 初始页按 id 在已加载快照中匹配定位（T9 契约：不预算绝对下标）；未命中且分页未到底时
 *   主动触达快照末项驱动 append，随 loadState 变化重试直到命中或放弃；定位前盖黑色占位层防错图闪现。
 * - 页面 settle 后或数据到达（itemCount 变化）时：重置其余页缩放（回看回到适配大小，对齐米家相册）
 *   + 预取相邻 page±1（数据到达也触发，覆盖第 0 页打开/定位后相邻页迟到的场景）。
 * - 单击切沉浸（WindowInsetsControllerCompat 隐/显系统栏，同时隐/显返回键与底部操作栏）。
 * - Pager 横滑由当前页 [ZoomableImageState.consumesHorizontalDrag] 门控（放大态不翻页）。
 *
 * @param actionBar 底部操作栏槽（Task 11 装配层填 [ViewerActionBar]）：入参为当前页图片 +
 *   是否高倍缩放（scale>2.5x，spec §7.3 提示门槛的缩放半边；「未下载」半边由装配层结合下载映射判定）。
 */
@Composable
fun ViewerPager(
    items: LazyPagingItems<ImageEntity>,
    initialImageId: Long,
    imageLoader: ImageLoader,
    modelFor: @Composable (ImageEntity) -> Any,
    onPrefetch: (ImageEntity) -> Unit,
    onBack: () -> Unit,
    actionBar: @Composable (image: ImageEntity, highZoom: Boolean) -> Unit = { _, _ -> },
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

    // 页面 settle 或数据到达：其余页缩放重置 + 相邻页预取。
    // itemCount 必须进 snapshotFlow（审查修复）：收集器首发时分页多半未送达（count==0），而第 0 页
    // 打开（最常见入口——时间轴最新一张）settledPage 永不变化，只听 settledPage 会导致相邻预取
    // 直到手动翻页才首次触发；同理定位到第 N 页时 N+1 可能尚未进快照。数据到达重跑相邻循环即可——
    // Coil 按缓存键去重，重复 enqueue 是廉价空操作。
    LaunchedEffect(pagerState, items) {
        snapshotFlow { pagerState.settledPage to items.itemCount }.collect { (settled, count) ->
            zoomStates.keys.filter { it != settled }.forEach { zoomStates.remove(it) }
            for (neighbor in intArrayOf(settled - 1, settled + 1)) {
                if (neighbor in 0 until count) {
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
        // derivedStateOf（审查修复）：scale 每帧变化，但门控只关心「是否 >1f」的布尔翻转——
        // 直接在 composition 读 scale 会让整个 Pager 子树随捏合逐帧重组
        val pagerScrollEnabled by remember {
            derivedStateOf { zoomStates[pagerState.currentPage]?.consumesHorizontalDrag != true }
        }
        HorizontalPager(
            state = pagerState,
            userScrollEnabled = pagerScrollEnabled,
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

            // 底部操作栏（Task 11 填充）：当前页图片 + 高倍缩放标志交给装配层的 actionBar 槽。
            // derivedStateOf：scale 逐帧变化，但槽只关心「是否越过阈值」的布尔翻转，避免捏合中整栏逐帧重组。
            val highZoom by remember {
                derivedStateOf {
                    (zoomStates[pagerState.currentPage]?.scale ?: 1f) > HIGH_ZOOM_THRESHOLD
                }
            }
            val currentImage = if (items.itemCount == 0) null
            else items.peek(pagerState.currentPage.coerceIn(0, items.itemCount - 1))
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
                if (currentImage != null) actionBar(currentImage, highZoom)
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
