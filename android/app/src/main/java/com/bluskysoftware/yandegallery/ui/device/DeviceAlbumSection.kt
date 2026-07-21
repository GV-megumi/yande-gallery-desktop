package com.bluskysoftware.yandegallery.ui.device

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.pendingAlbumPath
import com.bluskysoftware.yandegallery.ui.common.MiuiTextField

/*
 * 手机相册节三件行组件（v0.8.1 A2）：DeviceAlbumPicker（手机域入口）与 CopyTargetPicker
 * 手机节（桌面域「复制到」）此前各自内联同一套 ~80 行行实现——抽三件共享，宿主结构
 * （前者 MiuiDialog Column + 嵌套 LazyColumn，后者单 LazyColumn item{} 块）各自保留，
 * **不抽整节**；testTag 经参数传入，两侧既有命名（device_pick_* / copy_picker_*）零变化。
 */

/** 手机相册行（真实/待落地通用）：名称 + 待落地徽标 + 张数；tag 由调用方传入保留两侧既有命名。 */
@Composable
fun DeviceAlbumRow(album: DeviceAlbum, tag: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable { onClick() }
            .padding(horizontal = 8.dp, vertical = 12.dp)
            .testTag(tag),
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

/** 「新建相册」入口行。 */
@Composable
fun DeviceCreateRow(tag: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable { onClick() }
            .padding(horizontal = 8.dp, vertical = 12.dp)
            .testTag(tag),
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

/**
 * 内联新建输入区（对照 DeviceAlbumsScreen 新建对话框语义）：错误文案原地 supportingText，
 * 不关弹窗；确认回调 [onCreate] 返回错误文案（null=成功），成功即以 [pendingAlbumPath] 的
 * `Pictures/<名>/` 回调 [onPicked] 并复位输入态（路径构造与待落地占位同式）。
 * 布局上下堆叠而非 Row+weight：MiuiTextField 的 modifier 施加在其内部 TextField
 * （宿主是它自带的 Column）上，RowScope.weight 传进去会变成 Column 的高度权重——
 * supportingText 被挤成零高、确认键溢出行外（实测两条 picker 用例双红的根因）。
 */
@Composable
fun DeviceCreateInline(nameTag: String, confirmTag: String, onCreate: (String) -> String?, onPicked: (String) -> Unit) {
    var newName by rememberSaveable { mutableStateOf("") }
    var newError by rememberSaveable { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxWidth()) {
        MiuiTextField(
            value = newName,
            onValueChange = { newName = it; newError = null },
            placeholder = "相册名",
            isError = newError != null,
            supportingText = newError,
            modifier = Modifier.fillMaxWidth().testTag(nameTag),
        )
        Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
            TextButton(
                onClick = {
                    val error = onCreate(newName)
                    if (error != null) {
                        newError = error
                    } else {
                        // 先取路径再复位：newName 清空后 pendingAlbumPath 会算成 "Pictures//"
                        val picked = pendingAlbumPath(newName)
                        newName = ""
                        newError = null
                        onPicked(picked)
                    }
                },
                modifier = Modifier.testTag(confirmTag),
            ) { Text("创建") }
        }
    }
}
