package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.data.db.GalleryEntity

/**
 * 图集选择对话框（「加入图集」）：列出 Room 镜像图集，点选回调 galleryId；空库显提示。
 * T11 建于 ui/viewer，T13 起大图页与两处多选共用，迁至 ui/common。
 */
@Composable
fun GalleryPickerDialog(
    galleries: List<GalleryEntity>,
    onPick: (Long) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("加入图集") },
        text = {
            if (galleries.isEmpty()) {
                Text("暂无图集，可先在相册 tab 新建")
            } else {
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(galleries, key = { it.id }) { gallery ->
                        ListItem(
                            headlineContent = { Text(gallery.name) },
                            supportingContent = { Text("${gallery.imageCount} 张") },
                            modifier = Modifier
                                .clickable { onPick(gallery.id) }
                                .testTag("gallery_pick_${gallery.id}"),
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
