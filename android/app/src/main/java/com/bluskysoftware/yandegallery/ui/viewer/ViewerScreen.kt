package com.bluskysoftware.yandegallery.ui.viewer

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import com.bluskysoftware.yandegallery.ui.common.LEGACY_STORAGE_DENIED_TEXT
import com.bluskysoftware.yandegallery.ui.common.mimeOf
import com.bluskysoftware.yandegallery.ui.common.rememberLegacyStorageGate
import com.bluskysoftware.yandegallery.ui.common.writeFailText
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** 高倍缩放提示阈值（spec §7.3：scale 超约 2.5x 且未下载时提示 1600 档像素不足）。 */
private const val HIGH_ZOOM_THRESHOLD = 2.5f

/**
 * 全屏大图页（M3 Task 10/11）：装配层——收集 VM 流，把分页数据与三档模型选择喂给 [ViewerPager]，
 * 并装配底部操作栏（分享/查看原图/删除级联/详情/更多）与详情面板（标签编辑、跳图集）。
 * 进入/返回走 NavHost fade+scale 转场（M4 方案 B）；共享元素方案 A（hero 层）留联调后可选增强，
 * 见联调计划 J 节。
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

    // detail/showTagEditor 维持 plain remember：ImageDetail 非 Saveable，旋转丢面板可接受（D12A 记录性裁定）。
    var detail by remember { mutableStateOf<ImageDetail?>(null) }
    var showTagEditor by remember { mutableStateOf(false) }
    // 删除确认拆为可存 id/名/有无本地副本三态（ImageEntity 非 Saveable）：旋转不丢确认框，文案分支据 hasLocal。
    var confirmDeleteId by rememberSaveable { mutableStateOf<Long?>(null) }
    var confirmDeleteName by rememberSaveable { mutableStateOf("") }
    var confirmDeleteHasLocal by rememberSaveable { mutableStateOf(false) }
    var pickGalleryFor by rememberSaveable { mutableStateOf<Long?>(null) }
    var cascadeImageId by rememberSaveable { mutableStateOf<Long?>(null) }

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

    fun performDelete(imageId: Long) {
        scope.launch {
            val localUri = viewModel.downloadedUris.value[imageId]  // 先取快照（删镜像行不影响 downloads 表）
            when (val result = viewModel.deleteImage(imageId)) {
                is WriteResult.Failed -> snackbar.showSnackbar(writeFailText("删除失败", result))
                WriteResult.Success -> {
                    if (localUri == null) {
                        onBack()
                        return@launch
                    }
                    val uri = localUri.toUri()
                    val pending = viewModel.buildDeleteRequest(uri)
                    if (pending != null) {
                        // 30+：先记 imageId 再拉系统确认；清映射与返回收敛到 launcher 回调
                        cascadeImageId = imageId
                        cascadeLauncher.launch(IntentSenderRequest.Builder(pending.intentSender).build())
                    } else {
                        // <30：直删本地副本；API 29 失去所有权时系统抛 RecoverableSecurityException，
                        // gateway 转成 NeedsConsent(intentSender)——走与 30+ 同一个 cascadeLauncher（spec §8）
                        when (val r = viewModel.deleteLocalCopy(uri)) {
                            is DeleteOwnedResult.NeedsConsent -> {
                                cascadeImageId = imageId
                                cascadeLauncher.launch(IntentSenderRequest.Builder(r.intentSender).build())
                            }
                            is DeleteOwnedResult.Failed -> {
                                snackbar.showSnackbar("本地副本删除失败：${r.message ?: "未知错误"}")   // spec §8 明确报错不静默
                                viewModel.clearDownloadRow(imageId)
                                onBack()
                            }
                            DeleteOwnedResult.Deleted -> {
                                viewModel.clearDownloadRow(imageId)
                                onBack()
                            }
                        }
                    }
                }
            }
        }
    }

    // 分享等待防重入（M4-T11 审查修复）：等待窗口内重复点分享会起两个协程、各拉一次 chooser——
    // 进行中一律忽略后续点按；离开页面 scope 亡即随之取消，无需额外清理。
    var shareJob by remember { mutableStateOf<Job?>(null) }

    // legacy 存储权限门卫（BUG-07）：26-28 查看原图/带下载分享须先持 WRITE_EXTERNAL_STORAGE，29+ 直通
    val storageGate = rememberLegacyStorageGate(onDenied = {
        scope.launch { snackbar.showSnackbar(LEGACY_STORAGE_DENIED_TEXT) }
    })

    /** 分享完整流（M4-T11/D9）：未下载先入队原图下载（带前台通知），等终态后自动 ACTION_SEND；
     *  离线且缺原图直接提示不入队；下载失败提示取消。离开页面即取消等待（scope 随 composition 亡），
     *  底层下载不取消（KEEP 队列继续，产物仍落库——D9 取消语义）。 */
    fun share(image: ImageEntity) {
        if (shareJob?.isActive == true) return   // 等待中：忽略重复点按
        if (!connState.online && viewModel.downloadedUris.value[image.id] == null) {
            scope.launch { snackbar.showSnackbar("离线状态无法下载缺失原图，请连接后重试") }
            return
        }
        shareJob = scope.launch {
            if (viewModel.downloadedUris.value[image.id] == null) {
                // fire-and-forget：提示不阻塞入队（showSnackbar 挂起到消失，串行会推迟下载约 4s）
                launch { snackbar.showSnackbar("正在下载原图，完成后自动分享…") }
            }
            viewModel.ensureDownloadedThenUri(image)
                .onSuccess { uri ->
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = mimeOf(image.format)
                        putExtra(Intent.EXTRA_STREAM, uri.toUri())
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    context.startActivity(Intent.createChooser(send, "分享图片"))
                }
                .onFailure { snackbar.showSnackbar("分享取消：原图下载失败") }
        }
    }

    Box(Modifier.fillMaxSize()) {
        ViewerPager(
            items = items,
            initialImageId = viewModel.initialImageId,
            imageLoader = viewModel.previewLoader,
            // 模型记忆化（M4-T15：modelFor 已零 IPC 纯读 map，但仍避免每缩放帧重建 ImageRequest 对象）。
            // key 含「该图当前下载映射 + baseUrl」——下载完成/失效或切服时 key 变化，
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
                    // 已下载副本直接分享无需写权限；缺原图的分享会先入队下载，与查看原图同过存储门卫（BUG-07）
                    onShare = { if (isDownloaded) share(image) else storageGate { share(image) } },
                    onViewOriginal = { storageGate { viewModel.enqueueDownload(image) } },
                    onDelete = {
                        // 打开确认框时快照：id/文件名（旋转不丢）+ 是否有本地副本（决定文案分支）
                        confirmDeleteId = image.id
                        confirmDeleteName = image.filename
                        confirmDeleteHasLocal = downloadedUris[image.id] != null
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
                                    WriteResult.Success -> snackbar.showSnackbar("已移出当前图集")
                                    is WriteResult.Failed -> snackbar.showSnackbar(writeFailText("移出图集失败", r))
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

    // 删除二次确认：文案按有无本地副本分支（spec §7.3 D10 / §8）——有副本明示级联删除，无副本明示本机无副本
    confirmDeleteId?.let { imageId ->
        AlertDialog(
            onDismissRequest = { confirmDeleteId = null },
            title = { Text("删除图片") },
            text = {
                Text(
                    if (confirmDeleteHasLocal) {
                        "确定删除「$confirmDeleteName」？将从服务器删除；本机已保存的原图副本也会一并删除。"
                    } else {
                        "确定删除「$confirmDeleteName」？将从服务器删除（本机无已保存副本）。"
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmDeleteId = null
                        performDelete(imageId)
                    },
                    modifier = Modifier.testTag("viewer_delete_confirm"),
                ) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { confirmDeleteId = null }) { Text("取消") }
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
                        is WriteResult.Failed -> snackbar.showSnackbar(writeFailText("加入图集失败", r))
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
            // 与 located 同门控（BUG-06）：定位驱动 append 期间 currentPage 恒为 0（时间轴最新一张），
            // 黑色占位层只盖画面不盖操作栏——此窗口内分享/下载/删除会静默作用在「错图」上
            //（删除确认框显示的也是最新图文件名，误确认即删错图）。返回键保持可用，让用户能中途退出。
            // derivedStateOf：scale 逐帧变化，但槽只关心「是否越过阈值」的布尔翻转，避免捏合中整栏逐帧重组。
            if (located) {
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
