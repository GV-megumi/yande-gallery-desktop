package com.bluskysoftware.yandegallery.ui.device

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.ImageLoader
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceAccessLevel
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.DeviceCapabilities
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import com.bluskysoftware.yandegallery.ui.common.MiuiLargeTitle
import com.bluskysoftware.yandegallery.ui.common.MiuiPinnedTopBar
import com.bluskysoftware.yandegallery.ui.common.MiuiTextField
import com.bluskysoftware.yandegallery.ui.common.RetryableAsyncImage
import com.bluskysoftware.yandegallery.ui.common.rememberMiuiHeaderState
import com.bluskysoftware.yandegallery.ui.theme.MiuiTokens

/**
 * 手机相册 tab（Task 5，spec §2/§3/§5.5）：权限三态门控收敛在此页——DENIED 整页替换成引导页
 * （只留一个出口按钮，不露出任何卡片；未永久拒绝显「授权」，永久拒绝显「去设置」，见
 * [DevicePermissionGate] 与 [permanentlyDenied]，review Finding 4）；PARTIAL 在网格上方挂常驻
 * 横幅（「管理」重新拉起系统部分照片选择器）；FULL/PARTIAL 均正常展示网格——「全部照片」聚合卡
 * 恒首位 + 真实相册 + 待落地占位相册（灰底封面 + 长按「删除」）。顶栏「+」新建相册按
 * [DeviceCapabilities.canCreateAlbum] 门控（26–28 建了也永远落不了地，直接不露入口，spec §2.3）。
 */
@Composable
fun DeviceAlbumsScreen(
    viewModel: DeviceAlbumsViewModel,
    loader: ImageLoader,
    onOpenAlbum: (BucketKey) -> Unit,
    onRequestPermission: () -> Unit,
    onManagePartial: () -> Unit,
    // 永久拒绝标记（spec §3，review Finding 4）：由 MainActivity 权限桥判定并喂入，本页只管展示；
    // 默认 false 保持既有调用方（旧测试/占位）零改动可编译。
    permanentlyDenied: Boolean = false,
) {
    val accessLevel by viewModel.accessLevel.collectAsStateWithLifecycle()

    if (accessLevel == DeviceAccessLevel.DENIED) {
        DevicePermissionGate(onRequestPermission = onRequestPermission, permanentlyDenied = permanentlyDenied)
        return
    }

    val albums by viewModel.albums.collectAsStateWithLifecycle()

    // 新建对话框：confirmEnabled 只看非空；重名等语义错误由 createPendingAlbum 返回后原地
    // 显示在输入框 supportingText，不关闭对话框（brief 契约：失败态内联文案）。
    var showNew by rememberSaveable { mutableStateOf(false) }
    var newName by rememberSaveable { mutableStateOf("") }
    var newError by rememberSaveable { mutableStateOf<String?>(null) }
    // 待落地卡片长按菜单「删除」二次确认（仅清 DataStore 占位记录，不涉及任何文件）。
    var pendingToDelete by rememberSaveable { mutableStateOf<String?>(null) }

    val header = rememberMiuiHeaderState()
    Column(Modifier.fillMaxSize().nestedScroll(header.connection)) {
        MiuiPinnedTopBar(title = "手机相册", scrolled = header.scrolled, actions = {
            if (DeviceCapabilities.canCreateAlbum()) {
                IconButton(
                    onClick = { newName = ""; newError = null; showNew = true },
                    modifier = Modifier.testTag("device_albums_new"),
                ) { Icon(Icons.Filled.Add, contentDescription = "新建相册") }
            }
        })
        MiuiLargeTitle("手机相册", header)
        if (accessLevel == DeviceAccessLevel.PARTIAL) {
            DevicePartialBanner(onManagePartial = onManagePartial)
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 104.dp),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize().testTag("device_albums_grid"),
        ) {
            items(albums, key = { it.key.encode() }) { album ->
                DeviceAlbumCard(
                    album = album,
                    loader = loader,
                    onClick = { onOpenAlbum(album.key) },
                    onDelete = { pendingToDelete = album.name },
                )
            }
        }
    }

    if (showNew) {
        MiuiDialog(
            title = "新建相册",
            onDismiss = { showNew = false },
            confirmText = "创建",
            confirmEnabled = newName.isNotBlank(),
            confirmTag = "device_album_new_confirm",
            onConfirm = {
                val error = viewModel.createPendingAlbum(newName)
                if (error != null) newError = error else showNew = false
            },
            content = {
                MiuiTextField(
                    value = newName,
                    onValueChange = { newName = it; newError = null },
                    label = "相册名",
                    isError = newError != null,
                    supportingText = newError,
                    modifier = Modifier.fillMaxWidth().testTag("device_album_name_field"),
                )
            },
        )
    }

    pendingToDelete?.let { name ->
        MiuiDialog(
            title = "删除相册",
            text = "确定删除待落地相册「$name」？",
            onDismiss = { pendingToDelete = null },
            confirmText = "删除",
            destructive = true,
            confirmTag = "device_album_delete_confirm",
            onConfirm = {
                viewModel.deletePendingAlbum(name)
                pendingToDelete = null
            },
        )
    }
}

/**
 * 权限引导页（spec §3）：DENIED 时整页替换，只留一个出口按钮。未永久拒绝时「授权」重新拉起
 * 系统权限弹窗；永久拒绝（用户勾了"不再询问"或系统直接判定）后文案变「去设置」——回调本身不变，
 * 具体是拉权限弹窗还是跳 app 详情页由 MainActivity 决定（本页不碰 Intent/Activity，纯展示分支）。
 */
@Composable
private fun DevicePermissionGate(onRequestPermission: () -> Unit, permanentlyDenied: Boolean = false) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp)
            .testTag("device_permission_gate"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "需要访问手机相册权限",
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            "授权后即可在此浏览和管理手机中的照片与视频",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp, bottom = 16.dp),
        )
        Button(onClick = onRequestPermission, modifier = Modifier.testTag("device_permission_action")) {
            Text(if (permanentlyDenied) "去设置" else "授权")
        }
    }
}

/** 部分授权横幅（spec §3）：常驻网格上方，「管理」重新拉起系统部分照片选择器补选。 */
@Composable
private fun DevicePartialBanner(onManagePartial: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag("device_partial_banner"),
    ) {
        Text(
            "仅可访问部分照片",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onManagePartial, modifier = Modifier.testTag("device_partial_banner_manage")) {
            Text("管理")
        }
    }
}

/**
 * 手机相册卡片（brief：仿 AlbumCardItem 视觉但自绘，非强制复用——手机域封面是 Uri 而非
 * 桌面镜像的 thumbnailRequest，字段形状不同不硬凑）。待落地卡固定灰底占位 + 长按删除菜单；
 * 真实卡/聚合卡走 RetryableAsyncImage，封面为空时同样退化灰底（呼应 AlbumCardItem 空封面处理）。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DeviceAlbumCard(
    album: DeviceAlbum,
    loader: ImageLoader,
    onClick: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val tag = when (val key = album.key) {
        BucketKey.All -> "device_album_card_all"
        is BucketKey.Bucket -> "device_album_card_b${key.bucketId}"
        is BucketKey.Pending -> "device_album_card_p${key.name}"
    }
    Box {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(
                    onClick = onClick,
                    onLongClick = if (album.isPending) {
                        { menuOpen = true }
                    } else {
                        null
                    },
                )
                .testTag(tag),
        ) {
            if (album.isPending || album.coverUri == null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(1f)
                        .clip(MiuiTokens.CoverShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
            } else {
                RetryableAsyncImage(
                    model = album.coverUri,
                    imageLoader = loader,
                    contentDescription = album.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().aspectRatio(1f).clip(MiuiTokens.CoverShape),
                )
            }
            Text(
                album.name,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(top = 8.dp),
            )
            Text(
                "${album.count} 张",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(
                text = { Text("删除") },
                onClick = { menuOpen = false; onDelete() },
                modifier = Modifier.testTag("device_album_menu_delete"),
            )
        }
    }
}
