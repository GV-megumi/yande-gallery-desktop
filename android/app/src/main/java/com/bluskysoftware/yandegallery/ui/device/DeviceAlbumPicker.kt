package com.bluskysoftware.yandegallery.ui.device

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.isWritableAlbumPath
import com.bluskysoftware.yandegallery.data.device.pendingAlbumPath
import com.bluskysoftware.yandegallery.ui.common.MiuiDialog
import com.bluskysoftware.yandegallery.ui.common.MiuiTextField

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
    var newName by rememberSaveable { mutableStateOf("") }
    var newError by rememberSaveable { mutableStateOf<String?>(null) }

    MiuiDialog(
        title = "选择目标相册",
        onDismiss = onDismiss,
        confirmText = null,
        dismissText = "取消",
        dialogTag = "device_album_picker",
        content = {
            if (canCreate) {
                if (creating) {
                    // 内联新建（对照 DeviceAlbumsScreen 新建对话框语义）：错误文案原地 supportingText，
                    // 不关弹窗；成功即以 Pictures/<名>/ 回调 onPick（路径构造与待落地占位同式）。
                    // 布局上下堆叠而非 Row+weight：MiuiTextField 的 modifier 施加在其内部 TextField
                    // （宿主是它自带的 Column）上，RowScope.weight 传进去会变成 Column 的高度权重——
                    // supportingText 被挤成零高、确认键溢出行外（实测两条 picker 用例双红的根因）。
                    MiuiTextField(
                        value = newName,
                        onValueChange = { newName = it; newError = null },
                        placeholder = "相册名",
                        isError = newError != null,
                        supportingText = newError,
                        modifier = Modifier.fillMaxWidth().testTag("device_pick_create_name"),
                    )
                    Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                        TextButton(
                            onClick = {
                                val error = onCreate(newName)
                                if (error != null) newError = error else onPick(pendingAlbumPath(newName))
                            },
                            modifier = Modifier.testTag("device_pick_create_confirm"),
                        ) { Text("创建") }
                    }
                } else {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { creating = true }
                            .padding(horizontal = 8.dp, vertical = 12.dp)
                            .testTag("device_pick_create"),
                    ) {
                        Icon(
                            Icons.Filled.Add,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp),
                        )
                        Text(
                            "新建相册",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(start = 8.dp),
                        )
                    }
                }
            }
            if (visible.isEmpty() && !canCreate) {
                Text("暂无可选相册", style = MaterialTheme.typography.bodyMedium)
            } else {
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(visible, key = { it.key.encode() }) { album ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                // visible 过滤保证 relativePath 非 null，此处 !! 安全（filter 谓词收口）
                                .clickable { onPick(album.relativePath!!) }
                                .padding(horizontal = 8.dp, vertical = 12.dp)
                                .testTag("device_pick_${album.key.encode()}"),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(album.name, style = MaterialTheme.typography.bodyLarge)
                                if (album.isPending) {
                                    Text(
                                        "待落地",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            if (!album.isPending) {
                                Text(
                                    "${album.count} 张",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        },
    )
}
