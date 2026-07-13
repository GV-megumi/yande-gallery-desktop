package com.bluskysoftware.yandegallery.ui.viewer

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.work.WorkInfo
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.domain.write.WriteResult
import com.bluskysoftware.yandegallery.ui.common.GalleryPickerDialog
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import com.bluskysoftware.yandegallery.ui.common.mimeOf
import com.bluskysoftware.yandegallery.ui.common.writeFailText
import com.bluskysoftware.yandegallery.ui.photos.viewerDateLabel
import com.bluskysoftware.yandegallery.ui.photos.viewerTimeLabel
import java.time.LocalDate
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** 高倍缩放提示阈值（spec §7.3：scale 超约 2.5x 且无本机原图时提示清晰度不足，可查看原图）。 */
private const val HIGH_ZOOM_THRESHOLD = 2.5f

/**
 * 全屏大图页（M3 Task 10/11）：装配层——收集 VM 流，把分页数据与三档模型选择喂给 [ViewerPager]，
 * 并装配底部操作栏（分享/查看原图/删除级联/详情/更多）与详情面板（标签编辑、跳相册）。
 * 进入/返回走 NavHost fade+scale 转场（M4 方案 B）；共享元素方案 A（hero 层）留联调后可选增强，
 * 见联调计划 J 节。
 *
 * @param onOpenGallery 详情面板「所属相册」点击 → 相册详情页（MainActivity 接 Routes.albumDetail）
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
    val localImages by viewModel.localImages.collectAsStateWithLifecycle()
    val downloadedIds by viewModel.downloadedIds.collectAsStateWithLifecycle()
    val connState by viewModel.connState.collectAsStateWithLifecycle()
    val galleries by viewModel.galleries.collectAsStateWithLifecycle(initialValue = emptyList())
    val items = viewModel.pagingFlow.collectAsLazyPagingItems()
    val server = activeServer
    val baseUrl = server?.baseUrl.orEmpty()

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    // detail/showTagEditor 维持 plain remember：ImageDetail 非 Saveable，旋转丢面板可接受（D12A 记录性裁定）。
    var detail by remember { mutableStateOf<ImageDetail?>(null) }
    var showTagEditor by remember { mutableStateOf(false) }
    // 删除确认拆为可存 id/名/有无本地副本三态（ImageEntity 非 Saveable）：旋转不丢确认框，文案分支据 hasLocal。
    var confirmDeleteId by rememberSaveable { mutableStateOf<Long?>(null) }
    var confirmDeleteName by rememberSaveable { mutableStateOf("") }
    var confirmDeleteHasLocal by rememberSaveable { mutableStateOf(false) }
    var pickGalleryFor by rememberSaveable { mutableStateOf<Long?>(null) }

    /** detailOf 对同步中途被删的行抛 IllegalArgumentException（T9 KDoc 契约）——捕获降级：关面板 + 提示。 */
    fun openDetail(imageId: Long) {
        scope.launch {
            try {
                detail = viewModel.detailOf(imageId)
            } catch (e: IllegalArgumentException) {
                detail = null            // 先收面板/编辑框，再挂起提示（snackbar 挂起期间不残留旧面板）
                showTagEditor = false
                snackbar.showSnackbar("图片已不存在")
            }
        }
    }

    fun editTag(imageId: Long, name: String, add: Boolean) {
        scope.launch {
            val result = if (add) viewModel.addTags(imageId, listOf(name))
            else viewModel.removeTags(imageId, listOf(name))
            when (result) {
                WriteResult.Success -> openDetail(imageId) // 重查 detailOf 刷新面板与编辑对话框
                is WriteResult.Failed -> snackbar.showSnackbar(writeFailText("标签编辑失败", result))
            }
        }
    }

    /** 删除（镜像层改造）：服务器删除成功即返回——镜像文件/image_files 行由对账级联自动清，
     *  不再有 MediaStore 副本级联段（spec §4.4 删除跟随语义）。 */
    fun performDelete(imageId: Long) {
        scope.launch {
            when (val result = viewModel.deleteImage(imageId)) {
                is WriteResult.Failed -> snackbar.showSnackbar(writeFailText("删除失败", result))
                WriteResult.Success -> onBack()
            }
        }
    }

    // 分享等待防重入（M4-T11 审查修复）：等待窗口内重复点分享会起两个协程、各拉一次 chooser——
    // 进行中一律忽略后续点按；离开页面 scope 亡即随之取消，无需额外清理。
    var shareJob by remember { mutableStateOf<Job?>(null) }

    /** 分享（spec §4.4 四级规则）：本地镜像（原图>HQ）直接分享；无本地且在线先 ensure 入镜像；
     *  离线且未同步直接提示。文件经 FileProvider 转 content:// 授权分享。 */
    fun share(image: ImageEntity) {
        if (shareJob?.isActive == true) return
        if (!connState.online && viewModel.localImages.value[image.id] == null) {
            scope.launch { snackbar.showSnackbar("该图未同步且当前离线，无法分享") }
            return
        }
        shareJob = scope.launch {
            if (viewModel.localImages.value[image.id] == null) {
                launch { snackbar.showSnackbar("正在获取图片，完成后自动分享…") }
            }
            viewModel.shareFileFor(image)
                .onSuccess { file ->
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                    val send = Intent(Intent.ACTION_SEND).apply {
                        // mimeOf 按实际文件扩展名（HQ 档 png 源转出的是 .jpg，image.format 会错报）
                        type = mimeOf(file.extension)
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    context.startActivity(Intent.createChooser(send, "分享图片"))
                }
                .onFailure { snackbar.showSnackbar("分享取消：${it.message}") }
        }
    }

    Box(Modifier.fillMaxSize()) {
        ViewerPager(
            items = items,
            initialImageId = viewModel.initialImageId,
            imageLoader = viewModel.imageLoader,
            // 模型记忆化（M4-T15：modelFor 零 IO 纯读 map，但仍避免每缩放帧重建模型对象）。
            // key 含「该图当前本地镜像 + baseUrl」——镜像补齐/失效或切服时 key 变化，
            // 清晰版切换即时生效（localImages 以 Compose 状态订阅，变化会触发重组）。
            modelFor = { image ->
                remember(image.id, localImages[image.id], baseUrl) {
                    viewModel.modelFor(image, baseUrl)
                }
            },
            onPrefetch = { image ->
                // 相邻预取（spec §4.2）：未镜像的邻图在线插队 ensure 入镜像（已镜像/离线时为空操作）；
                // 占位缩略图本就命中缩略图缓存，无需另行 enqueue。
                if (server != null) viewModel.ensureViewable(image)
            },
            actionBar = { image, zoomedIn ->
                val workState by remember(image.id) { viewModel.downloadState(image.id) }
                    .collectAsStateWithLifecycle(initialValue = null)
                val isDownloaded = downloadedIds.contains(image.id)
                // 下载失败提示：只在观察到「进行中 → FAILED」翻转时提示一次（历史 FAILED 不随翻页重复骚扰）。
                // T8 约定镜像写失败也表现为 WorkInfo FAILED（spec §8 明确报错不静默）。
                var prevWorkState by remember(image.id) { mutableStateOf<WorkInfo.State?>(null) }
                LaunchedEffect(workState) {
                    if (workState == WorkInfo.State.FAILED && prevWorkState?.isFinished == false) {
                        snackbar.showSnackbar("下载失败：网络中断或保存原图失败")
                    }
                    prevWorkState = workState
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    // 「未同步」提示条（spec §4.2）：无本地镜像且离线——当前只有缩略图可看，无法取清晰版
                    if (localImages[image.id] == null && !connState.online) {
                        Text(
                            "未同步：离线中仅可查看缩略图",
                            color = Color.White.copy(alpha = 0.85f),
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier
                                .padding(bottom = 6.dp)
                                .testTag("viewer_unsynced_badge"),
                        )
                    }
                    ViewerActionBar(
                        image = image,
                        isDownloaded = isDownloaded,
                        downloading = workState == WorkInfo.State.ENQUEUED || workState == WorkInfo.State.RUNNING,
                        online = connState.online,
                        highZoom = zoomedIn && !isDownloaded,
                        // 镜像写私有目录不需要 WRITE 权限——storageGate 包装移除（Task 10 删门卫本体）
                        onShare = { share(image) },
                        onViewOriginal = { viewModel.enqueueDownload(image) },
                        onDelete = {
                            // 打开确认框时快照：id/文件名（旋转不丢）+ 是否有本地镜像（决定文案分支）
                            confirmDeleteId = image.id
                            confirmDeleteName = image.filename
                            confirmDeleteHasLocal = localImages[image.id] != null
                        },
                        onDetail = {
                            showTagEditor = false
                            openDetail(image.id)
                        },
                        onAddToGallery = { pickGalleryFor = image.id },
                        onRemoveFromGallery = viewModel.contextGalleryId?.let { galleryId ->
                            {
                                scope.launch {
                                    when (val r = viewModel.removeFromGallery(galleryId, image.id)) {
                                        WriteResult.Success -> snackbar.showSnackbar("已移出当前相册")
                                        is WriteResult.Failed -> snackbar.showSnackbar(writeFailText("移出相册失败", r))
                                    }
                                }
                            }
                        },
                    )
                }
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

    // 删除二次确认：文案按有无本地副本分支（spec §7.3 D10 / §8）——有副本明示级联删除，无副本明示本机无副本
    confirmDeleteId?.let { imageId ->
        MiuiDialog(
            title = "删除图片",
            text = if (confirmDeleteHasLocal) {
                "确定删除「$confirmDeleteName」？将从服务器删除；本机已保存的原图副本也会一并删除。"
            } else {
                "确定删除「$confirmDeleteName」？将从服务器删除（本机无已保存副本）。"
            },
            onDismiss = { confirmDeleteId = null },
            confirmText = "删除",
            destructive = true,
            confirmTag = "viewer_delete_confirm",
            onConfirm = {
                confirmDeleteId = null
                performDelete(imageId)
            },
        )
    }

    // 「加入相册」选择器（更多菜单）
    pickGalleryFor?.let { imageId ->
        GalleryPickerDialog(
            galleries = galleries,
            onPick = { galleryId ->
                pickGalleryFor = null
                scope.launch {
                    when (val r = viewModel.addToGallery(galleryId, imageId)) {
                        WriteResult.Success -> snackbar.showSnackbar("已加入相册")
                        is WriteResult.Failed -> snackbar.showSnackbar(writeFailText("加入相册失败", r))
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
            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
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
    // rememberSaveable 修 M3-T10 记债「旋转回初始图」：rememberPagerState 自带 saveable 保当前页，
    // located=true 存活后旋转不再触发定位循环重定位回 initialImageId（否则 plain remember 复位为 false，
    // effect 重跑把 pager 拉回初始页，覆盖用户当前浏览位置）。
    var located by rememberSaveable { mutableStateOf(false) }
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
        snapshotFlow { Triple(pagerState.settledPage, items.itemCount, located) }
            .collect { (settled, count, isLocated) ->
                if (!isLocated) return@collect   // 定位驱动 append 期间不预取（0 页邻居是无谓取图）
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

    // 系统栏图标强制白色（Task1 审查修复）：本页常黑全屏（黑底垫进状态栏/导航栏下），Theme.kt 的
    // 全局跟随主题写入在浅色主题下给深色图标——压纯黑底后状态栏时间/电量完全不可读，必须页级覆盖。
    // 必须用 SideEffect 而非一次性 DisposableEffect 体写入：同一帧组合里 SideEffect 统一在
    // remember 观察者（含 DisposableEffect 体）之后、按组合顺序派发——活动重建（旋转/深浅色切换，
    // Manifest 未声明 configChanges）整树重组时，本效应晚于外层 Theme 的 SideEffect 执行、稳定压过；
    // 写进 DisposableEffect 体则重建帧会被 Theme 回写成主题色图标，缺陷在大图页内旋转后复现。
    val darkTheme by rememberUpdatedState(isSystemInDarkTheme())
    SideEffect { setSystemBarAppearanceLight(activity, view, light = false) }
    DisposableEffect(Unit) {
        onDispose {
            applySystemBars(activity, view, hide = false)
            // 离开时按当前系统深浅恢复（不硬编码恢复值）：Theme 的 SideEffect 不会因路由返回重跑；
            // rememberUpdatedState 保证浏览期间系统切换深浅后 dispose 仍取最新值（而非进入时快照）。
            setSystemBarAppearanceLight(activity, view, light = !darkTheme)
        }
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

        // 分页 refresh 出错（原为纯黑屏）：显式错误态 + 重试
        (items.loadState.refresh as? LoadState.Error)?.let { err ->
            Column(
                Modifier
                    .align(Alignment.Center)
                    .testTag("viewer_load_error"),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("加载失败：${err.error.message ?: "未知错误"}", color = Color.White)
                TextButton(onClick = { items.retry() }) { Text("重试", color = Color.White) }
            }
        }

        val currentImage = if (items.itemCount == 0) null
        else items.peek(pagerState.currentPage.coerceIn(0, items.itemCount - 1))

        // 顶部 chrome：渐变遮罩 + 返回 + 居中日期/时间（spec §5）；chrome 隐显 150ms fade
        AnimatedVisibility(
            visible = !immersive,
            enter = fadeIn(tween(150)),
            exit = fadeOut(tween(150)),
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.45f), 1f to Color.Transparent)),
            ) {
                IconButton(
                    onClick = onBack,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .statusBarsPadding()
                        .testTag("viewer_back"),
                ) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = Color.White)
                }
                // 定位完成前无「当前图」语义：与操作栏同门控（BUG-06 同口径），只显返回
                if (located && currentImage != null) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .statusBarsPadding()
                            .padding(top = 6.dp, bottom = 20.dp)
                            .testTag("viewer_title_date"),
                    ) {
                        Text(
                            viewerDateLabel(currentImage.createdAt, LocalDate.now()),
                            color = Color.White,
                            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
                        )
                        Text(
                            viewerTimeLabel(currentImage.createdAt),
                            color = Color.White.copy(alpha = 0.7f),
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                } else {
                    Spacer(Modifier.statusBarsPadding().height(48.dp))   // 维持遮罩高度稳定
                }
            }
        }

        // 底部 chrome：渐变遮罩 + 操作栏（viewer_bottom_bar tag 与 located 门控原样）
        AnimatedVisibility(
            visible = !immersive,
            enter = fadeIn(tween(150)),
            exit = fadeOut(tween(150)),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            if (located) {
                val highZoom by remember {
                    derivedStateOf {
                        (zoomStates[pagerState.currentPage]?.scale ?: 1f) > HIGH_ZOOM_THRESHOLD
                    }
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(Brush.verticalGradient(0f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.55f))),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 28.dp)
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

/** 写系统栏（状态栏+导航栏）图标深浅：light=true 深色图标（浅底页用）；window 取不到时静默跳过。 */
private fun setSystemBarAppearanceLight(activity: Activity?, view: android.view.View, light: Boolean) {
    val window = activity?.window ?: return
    val controller = WindowCompat.getInsetsController(window, view)
    controller.isAppearanceLightStatusBars = light
    controller.isAppearanceLightNavigationBars = light
}

/** 从 Compose 视图上下文向上剥 ContextWrapper 找宿主 Activity（拿 window 用）。 */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
