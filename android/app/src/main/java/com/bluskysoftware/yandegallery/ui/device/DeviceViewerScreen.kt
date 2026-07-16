package com.bluskysoftware.yandegallery.ui.device

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.DeviceCapabilities
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import com.bluskysoftware.yandegallery.data.device.formatDurationMs
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import com.bluskysoftware.yandegallery.ui.photos.weekdayCn
import com.bluskysoftware.yandegallery.ui.viewer.ZoomableImage
import com.bluskysoftware.yandegallery.ui.viewer.ZoomableImageState
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

/** 目标选择器当前意图（DeviceAlbumDetailScreen 同款二态，单张上下文额外携带操作对象）。 */
private enum class DeviceViewerPickerMode { COPY, MOVE }

/**
 * 本机大图页（Task 8，spec §2.3/§5.6）：黑底 HorizontalPager + 首屏按 [DeviceViewerViewModel.initialMediaId]
 * 定位（ViewerPager 的 located + rememberSaveable 模式裁剪——peek indexOfFirst → scrollToPage，
 * 旋转后 located 存活不重定位）。图片格子 = [ZoomableImage]（单击沉浸切换、下滑关闭、放大态
 * Pager 禁横滑）；视频格子 = 海报帧 + 中央播放键外抛系统播放器（app 内不做视频渲染，spec F4），
 * 不实例化缩放件。
 *
 * 删除翻页语义（brief 契约）：系统弹窗 RESULT_OK → MediaStore observer 脉冲 → VM invalidate →
 * Pager 自然收缩落到相邻页（Paging 默认行为，不手工跳页）；列表清空且已定位 → [onBack]。
 * 移动两段式与复制的 picker 编排对照 DeviceAlbumDetailScreen（Task 7），但单张上下文的操作对象
 * 与移动中继用 plain remember——DeviceMedia 非 Saveable，系统授权弹窗期间进程重建会丢本次移动
 * （安全降级：授权后静默不动作，用户可重发起；对照 ViewerScreen detail 面板 D12A 记录性裁定）。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceViewerScreen(
    viewModel: DeviceViewerViewModel,
    loader: ImageLoader,
    onBack: () -> Unit,
) {
    val items = viewModel.media.collectAsLazyPagingItems()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    val pagerState = rememberPagerState { items.itemCount }
    val zoomStates = remember { mutableStateMapOf<Int, ZoomableImageState>() }
    // rememberSaveable（ViewerPager 同款）：旋转后 located 存活，不再触发定位循环拉回初始页
    var located by rememberSaveable { mutableStateOf(false) }
    var immersive by remember { mutableStateOf(false) }

    // 目标选择器：mode+操作对象 与候选列表都是内存态（含 Uri 不可 saveable，重建后一起消失重开，
    // DeviceAlbumDetailScreen 同款取舍）；移动两段式中继同理 plain remember（见类 KDoc 记录性裁定）。
    var picker by remember { mutableStateOf<Pair<DeviceViewerPickerMode, DeviceMedia>?>(null) }
    var targetAlbums by remember { mutableStateOf<List<DeviceAlbum>>(emptyList()) }
    var pendingMove by remember { mutableStateOf<Pair<DeviceMedia, String>?>(null) }
    var detailMedia by remember { mutableStateOf<DeviceMedia?>(null) }

    // 删除：RESULT_OK 后无需手动动作——删除本身系统已完成，MediaStore observer 脉冲（VM init
    // 已订阅）→ invalidate → Pager 自然收缩；取消（RESULT_CANCELED）无操作。
    val deleteLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { }
    // 移动：系统写授权 RESULT_OK 后才真正 moveTo（spec §5.3 两段式）；取消则丢中继、无操作。
    val moveLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { result ->
        val pending = pendingMove
        pendingMove = null
        if (result.resultCode == Activity.RESULT_OK && pending != null) {
            scope.launch {
                val ok = viewModel.moveTo(pending.first, pending.second)
                snackbar.showSnackbar(if (ok) "已移动" else "移动失败")
            }
        }
    }

    /** 单张分享（Task 7 同款 mime 规则）：视频 video 通配、图片按扩展名；uri 直接用 content uri。 */
    fun share(media: DeviceMedia) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = media.mime()
            putExtra(Intent.EXTRA_STREAM, media.uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, null))
    }

    /** 视频外抛系统播放器（brief 契约 Intent 原文）；无可处理应用时提示而非崩溃。 */
    fun playVideo(media: DeviceMedia) {
        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(media.uri, "video/*")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                },
            )
        } catch (e: ActivityNotFoundException) {
            scope.launch { snackbar.showSnackbar("未找到可播放视频的应用") }
        }
    }

    /** 打开目标选择器：先查一轮候选再弹（避免弹出瞬间列表空白闪动，Task 7 同款）。 */
    fun openPicker(mode: DeviceViewerPickerMode, media: DeviceMedia) {
        scope.launch {
            targetAlbums = viewModel.albumTargets()
            picker = mode to media
        }
    }

    // 初始页定位（ViewerPager 同款循环）：按 id 重查快照直到命中；id 在深处时驱动 append；
    // 到底未命中（该媒体已被删除）或出错 → 放弃定位，留在已加载首部兜底。
    LaunchedEffect(items.itemCount, items.loadState.append, viewModel.initialMediaId) {
        if (located || items.itemCount == 0) return@LaunchedEffect
        val index = (0 until items.itemCount).indexOfFirst { items.peek(it)?.mediaId == viewModel.initialMediaId }
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

    // 页面 settle：其余页缩放重置（回看回到适配大小，ViewerPager 同款；本页无相邻预取需求——
    // 手机域 content uri 由 Coil 按需加载，无镜像 ensure 类前置动作）。
    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.settledPage }.collect { settled ->
            zoomStates.keys.filter { it != settled }.forEach { zoomStates.remove(it) }
        }
    }

    // 列表清空且已定位 → 返回（brief 契约）：refresh 落定 NotLoading 才判空——invalidate 重拉
    // 期间 itemCount 会瞬时归零，不加落定门控会在每次 MediaStore 脉冲时误触返回。
    val emptied = located && items.itemCount == 0 && items.loadState.refresh is LoadState.NotLoading
    LaunchedEffect(emptied) { if (emptied) onBack() }

    // 沉浸模式 + 系统栏图标强制白色（ViewerPager 同款页级覆盖，理由见其注释；本页同为常黑全屏页）
    val view = LocalView.current
    val activity = remember(view) { view.context.findActivity() }
    LaunchedEffect(immersive) { applySystemBars(activity, view, hide = immersive) }
    val darkTheme by rememberUpdatedState(isSystemInDarkTheme())
    SideEffect { setSystemBarAppearanceLight(activity, view, light = false) }
    DisposableEffect(Unit) {
        onDispose {
            applySystemBars(activity, view, hide = false)
            setSystemBarAppearanceLight(activity, view, light = !darkTheme)
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .testTag("device_viewer_pager"),
    ) {
        // derivedStateOf（ViewerPager 同款）：scale 每帧变化，门控只关心布尔翻转，避免逐帧重组
        val pagerScrollEnabled by remember {
            derivedStateOf { zoomStates[pagerState.currentPage]?.consumesHorizontalDrag != true }
        }
        HorizontalPager(
            state = pagerState,
            userScrollEnabled = pagerScrollEnabled,
            key = { index -> items.peek(index)?.mediaId ?: index },
            modifier = Modifier.fillMaxSize(),
        ) { page ->
            val media = items[page]
            when {
                media == null -> Box(Modifier.fillMaxSize())
                media.isVideo -> DeviceVideoPage(
                    media = media,
                    loader = loader,
                    onPlay = { playVideo(media) },
                    onTap = { immersive = !immersive },
                )
                else -> ZoomableImage(
                    model = media.uri,
                    imageLoader = loader,
                    state = zoomStates.getOrPut(page) { ZoomableImageState() },
                    contentDescription = media.displayName,
                    onSingleTap = { immersive = !immersive },
                    onDismiss = onBack,
                    modifier = Modifier.testTag("device_viewer_zoomable"),
                )
            }
        }

        // 初始页定位完成前的占位层：防止第 0 页错图闪现（ViewerPager 同款）
        if (!located) {
            Box(
                Modifier
                    .matchParentSize()
                    .background(Color.Black),
            )
        }

        // 分页 refresh 出错（权限中途被撤销等）：显式错误态 + 重试，不留纯黑屏
        (items.loadState.refresh as? LoadState.Error)?.let { err ->
            Column(
                Modifier
                    .align(Alignment.Center)
                    .testTag("device_viewer_load_error"),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("加载失败：${err.error.message ?: "未知错误"}", color = Color.White)
                TextButton(onClick = { items.retry() }) { Text("重试", color = Color.White) }
            }
        }

        val currentMedia = if (items.itemCount == 0) null
        else items.peek(pagerState.currentPage.coerceIn(0, items.itemCount - 1))

        // 顶部 chrome：渐变遮罩 + 返回 + 居中日期/时间双行（ViewerPager 同款，数据源换 takenAtMs）
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
                        .testTag("device_viewer_back"),
                ) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = Color.White)
                }
                // 定位完成前无「当前张」语义：与操作栏同门控，只显返回（BUG-06 同口径）
                if (located && currentMedia != null) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .statusBarsPadding()
                            .padding(top = 6.dp, bottom = 20.dp)
                            .testTag("device_viewer_title_date"),
                    ) {
                        Text(
                            deviceViewerDateLabel(currentMedia.takenAtMs, LocalDate.now()),
                            color = Color.White,
                            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
                        )
                        Text(
                            deviceViewerTimeLabel(currentMedia.takenAtMs),
                            color = Color.White.copy(alpha = 0.7f),
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                } else {
                    Spacer(Modifier.statusBarsPadding().height(48.dp))   // 维持遮罩高度稳定
                }
            }
        }

        // 底部 chrome：渐变遮罩 + 操作栏（located 门控同 ViewerPager）
        AnimatedVisibility(
            visible = !immersive,
            enter = fadeIn(tween(150)),
            exit = fadeOut(tween(150)),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            if (located) {
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
                            .testTag("device_viewer_bottom_bar"),
                    ) {
                        if (currentMedia != null) {
                            DeviceViewerActionBar(
                                isVideo = currentMedia.isVideo,
                                onShare = { share(currentMedia) },
                                onDelete = {
                                    deleteLauncher.launch(
                                        IntentSenderRequest.Builder(viewModel.deleteRequest(currentMedia).intentSender).build(),
                                    )
                                },
                                onCopyTo = { openPicker(DeviceViewerPickerMode.COPY, currentMedia) },
                                onMoveTo = { openPicker(DeviceViewerPickerMode.MOVE, currentMedia) },
                                onDetail = { detailMedia = currentMedia },
                            )
                        }
                    }
                }
            }
        }

        SnackbarHost(
            snackbar,
            Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 88.dp),
        )
    }

    // 复制/移动目标选择器（Task 7 picker 复用；excludeKey=当前上下文防自指）
    picker?.let { (mode, media) ->
        DeviceAlbumPicker(
            albums = targetAlbums,
            canCreate = DeviceCapabilities.canCreateAlbum(),
            excludeKey = viewModel.bucketKey,
            onPick = { path ->
                picker = null
                when (mode) {
                    DeviceViewerPickerMode.COPY -> scope.launch {
                        val ok = viewModel.copyTo(media, path)
                        snackbar.showSnackbar(if (ok) "已复制" else "复制失败")
                    }
                    DeviceViewerPickerMode.MOVE -> {
                        // 两段式：先记操作对象+目标路径，系统写授权 RESULT_OK 回调里才真正 moveTo
                        pendingMove = media to path
                        moveLauncher.launch(
                            IntentSenderRequest.Builder(viewModel.moveWriteRequest(media).intentSender).build(),
                        )
                    }
                }
            },
            onCreate = viewModel::createTargetAlbum,
            onDismiss = { picker = null },
        )
    }

    // 详情底部弹层（spec §5.6 只读）；旋转丢面板可接受（DeviceMedia 非 Saveable，D12A 同款裁定）
    detailMedia?.let { m ->
        ModalBottomSheet(
            onDismissRequest = { detailMedia = null },
            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        ) {
            DeviceMediaDetailPanel(media = m)
        }
    }
}

/**
 * 视频格子（spec F4）：海报帧铺满 + 中央播放键外抛 + 右下时长角标；**不实例化 ZoomableImage**
 * （视频不在 app 内渲染/缩放，捏合无语义）。背景单击与图片页同语义切沉浸（无水波，纯手势区）。
 */
@Composable
private fun DeviceVideoPage(
    media: DeviceMedia,
    loader: ImageLoader,
    onPlay: () -> Unit,
    onTap: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onTap,
            ),
    ) {
        RetryableAsyncImage(
            model = media.uri,
            imageLoader = loader,
            contentDescription = media.displayName,
            contentScale = ContentScale.Fit,
            dark = true,
            modifier = Modifier.fillMaxSize(),
        )
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .align(Alignment.Center)
                .size(64.dp)
                .clip(CircleShape)
                .background(Color.Black.copy(alpha = 0.45f))
                .clickable(onClick = onPlay)
                .testTag("device_viewer_play"),
        ) {
            Icon(Icons.Filled.PlayArrow, contentDescription = "播放", tint = Color.White, modifier = Modifier.size(40.dp))
        }
        Text(
            formatDurationMs(media.durationMs ?: 0),
            color = Color.White,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp)
                .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(4.dp))
                .padding(horizontal = 6.dp, vertical = 2.dp)
                .testTag("device_viewer_duration"),
        )
    }
}

/**
 * 详情面板内容（spec §5.6，无 VM 依赖 Robolectric 可直测）：文件名/相对路径/大小/分辨率/
 * 拍摄时间/（视频）时长——纯本机元数据只读，无标签、无所属相册区块（桌面域概念）。
 * tag 挂本组件根上（弹层容器 ModalBottomSheet 由调用方包，测试直挂本件即可命中）。
 */
@Composable
internal fun DeviceMediaDetailPanel(media: DeviceMedia, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp)
            .padding(bottom = 24.dp)
            .testTag("device_viewer_detail_sheet"),
    ) {
        Text("详情", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(12.dp))
        DeviceDetailRow("文件名", media.displayName)
        DeviceDetailRow("相对路径", media.relativePath)
        DeviceDetailRow("大小", Formatter.formatFileSize(context, media.sizeBytes))
        DeviceDetailRow("分辨率", "${media.width} × ${media.height}")
        DeviceDetailRow(
            "拍摄时间",
            SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(media.takenAtMs)),
        )
        if (media.isVideo) {
            DeviceDetailRow("时长", formatDurationMs(media.durationMs ?: 0))
        }
    }
}

/** 详情行：左标签右值（桌面域 DetailPanel.DetailRow 同款观感，该件 private 不跨域引用）。 */
@Composable
private fun DeviceDetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.width(80.dp),
        )
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

/** 大图页顶部日期行（takenAtMs 版）：同年「M月d日 周X」/跨年「yyyy年M月d日」（viewerDateLabel 同式）。 */
internal fun deviceViewerDateLabel(takenAtMs: Long, today: LocalDate): String {
    val date = Instant.ofEpochMilli(takenAtMs).atZone(ZoneId.systemDefault()).toLocalDate()
    return if (date.year == today.year) "${date.monthValue}月${date.dayOfMonth}日 ${weekdayCn(date)}"
    else "${date.year}年${date.monthValue}月${date.dayOfMonth}日"
}

/** 大图页顶部时间行（takenAtMs 版）：本地时区 HH:mm。 */
internal fun deviceViewerTimeLabel(takenAtMs: Long): String =
    Instant.ofEpochMilli(takenAtMs).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("HH:mm"))

/** 隐/显系统栏（沉浸模式，ViewerScreen 私有件同款复刻——跨包不可引用）；非 Activity 宿主静默跳过。 */
private fun applySystemBars(activity: Activity?, view: android.view.View, hide: Boolean) {
    val window = activity?.window ?: return
    val controller = WindowCompat.getInsetsController(window, view)
    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    if (hide) controller.hide(WindowInsetsCompat.Type.systemBars())
    else controller.show(WindowInsetsCompat.Type.systemBars())
}

/** 写系统栏图标深浅（ViewerScreen 私有件同款复刻）；window 取不到时静默跳过。 */
private fun setSystemBarAppearanceLight(activity: Activity?, view: android.view.View, light: Boolean) {
    val window = activity?.window ?: return
    val controller = WindowCompat.getInsetsController(window, view)
    controller.isAppearanceLightStatusBars = light
    controller.isAppearanceLightNavigationBars = light
}

/** 从 Compose 视图上下文向上剥 ContextWrapper 找宿主 Activity（ViewerScreen 私有件同款复刻）。 */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
