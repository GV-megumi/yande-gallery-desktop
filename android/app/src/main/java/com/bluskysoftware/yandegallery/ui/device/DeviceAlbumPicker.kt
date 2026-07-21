package com.bluskysoftware.yandegallery.ui.device

import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.isWritableAlbumPath
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog

/**
 * 复制/移动目标相册选择器（Task 7，spec §5.3/§5.5）：只列可写路径（[isWritableAlbumPath]，
 * 即 DCIM/ 与 Pictures/ 下）的真实相册 + 待落地相册——「全部照片」聚合卡（relativePath=null）与
 * Download/ 等三方不可写目录天然滤除；[excludeKey] 滤当前相册防「复制到自己」自指
 * （All 聚合上下文传 [BucketKey.All]，不命中任何目标卡，等效不排除，spec §5.4）。
 *
 * [canCreate]（= [com.bluskysoftware.yandegallery.data.device.DeviceCapabilities.canCreateAlbum]，
 * 26–28 隐藏）时首行「新建相册」展开内联输入：确认回调 [onCreate]（校验/落库由调用方做，返回
 * 错误文案就地显示；null=成功），成功后顺带以 `Pictures/<名>/` 调 [onPick]——新建即选中，
 * 用户不必在列表里再点一次刚建的名字。
 *
 * 行/入口/内联新建三件共享组件见 DeviceAlbumSection.kt（v0.8.1 A2，与 CopyTargetPicker 手机节
 * 同源）；本组件保留宿主结构（MiuiDialog Column + 嵌套 LazyColumn）与 device_pick_* tag 命名。
 *
 * 点选/新建成功后**不自关**：onPick 之后的收尾（关弹窗、发复制/移动）由调用方编排——
 * 移动流还要先过系统授权，弹窗去留时机两条链路不同，收在组件内会写死一种。
 */
@Composable
fun DeviceAlbumPicker(
    albums: List<DeviceAlbum>,
    canCreate: Boolean,
    excludeKey: BucketKey?,
    onPick: (relativePath: String) -> Unit,
    onCreate: (name: String) -> String?,
    onDismiss: () -> Unit,
) {
    // 真实相册限可写路径；待落地相册路径恒 Pictures/<名>/（构造保证）直接放行；聚合卡 path=null 滤除
    val visible = albums.filter { album ->
        val path = album.relativePath
        album.key != excludeKey && path != null && (album.isPending || isWritableAlbumPath(path))
    }
    var creating by rememberSaveable { mutableStateOf(false) }

    MiuiDialog(
        title = "选择目标相册",
        onDismiss = onDismiss,
        confirmText = null,
        dismissText = "取消",
        dialogTag = "device_album_picker",
        content = {
            if (canCreate) {
                if (creating) {
                    DeviceCreateInline(
                        nameTag = "device_pick_create_name",
                        confirmTag = "device_pick_create_confirm",
                        onCreate = onCreate,
                        onPicked = onPick,
                    )
                } else {
                    DeviceCreateRow(tag = "device_pick_create", onClick = { creating = true })
                }
            }
            if (visible.isEmpty() && !canCreate) {
                Text("暂无可选相册", style = MaterialTheme.typography.bodyMedium)
            } else {
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(visible, key = { it.key.encode() }) { album ->
                        DeviceAlbumRow(
                            album = album,
                            tag = "device_pick_${album.key.encode()}",
                            // visible 过滤保证 relativePath 非 null，此处 !! 安全（filter 谓词收口）
                            onClick = { onPick(album.relativePath!!) },
                        )
                    }
                }
            }
        },
    )
}
