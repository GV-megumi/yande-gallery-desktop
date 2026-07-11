package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.data.db.GalleryEntity

/**
 * 相册选择对话框（「加入相册」）：列出 Room 镜像相册，点选回调 galleryId；空库显提示。
 * T11 建于 ui/viewer，T13 起大图页与两处多选共用，迁至 ui/common；MIUI 重塑换 MiuiDialog 壳（spec §8.3）。
 *
 * [excludeIds] 过滤掉不该出现的相册（D12A：相册详情传本相册 id，避免「加入当前所在相册」自指）；
 * 过滤后为空复用既有空态文案。Photos/大图页不传（默认空集）。
 */
@Composable
fun GalleryPickerDialog(
    galleries: List<GalleryEntity>,
    onPick: (Long) -> Unit,
    onDismiss: () -> Unit,
    excludeIds: Set<Long> = emptySet(),
) {
    val visible = galleries.filterNot { it.id in excludeIds }
    MiuiDialog(title = "加入相册", onDismiss = onDismiss, confirmText = null, dismissText = "取消", content = {
        if (visible.isEmpty()) {
            Text("暂无相册，可先在相册 tab 新建", style = MaterialTheme.typography.bodyMedium)
        } else {
            LazyColumn(Modifier.heightIn(max = 320.dp)) {
                items(visible, key = { it.id }) { gallery ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { onPick(gallery.id) }
                            .padding(horizontal = 8.dp, vertical = 12.dp)
                            .testTag("gallery_pick_${gallery.id}"),
                    ) {
                        Text(gallery.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                        Text("${gallery.imageCount} 张", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    })
}
