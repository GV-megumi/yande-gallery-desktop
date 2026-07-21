package com.bluskysoftware.yandegallery.ui.common

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
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import com.bluskysoftware.yandegallery.data.device.DeviceMediaGateway
import com.bluskysoftware.yandegallery.data.device.isWritableAlbumPath
import com.bluskysoftware.yandegallery.data.device.pendingAlbumPath
import com.bluskysoftware.yandegallery.data.device.validateNewAlbumName
import com.bluskysoftware.yandegallery.data.prefs.PrefsStore
import com.bluskysoftware.yandegallery.ui.device.buildTargetAlbums
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** 目标选择器模式（spec §6.1/§6.2）：Copy 双节（桌面相册 + 手机相册）；Move 仅桌面相册节。 */
enum class PickerMode { Copy, Move }

/**
 * 复制/移动目标选择器（Task 11，spec §6.1/§6.2，替代原「加入相册」单节选择对话框）：
 * 桌面相册节恒在；手机相册节仅 mode=Copy 且 [deviceEnabled]（canCopy && online）时渲染——
 * **Move 模式永不渲染手机相册节**（spec D5 硬编码非参数：移动含删除语义，跨域移动等于删
 * 服务器原件，风险面不同，不给参数开口）。
 *
 * - 桌面相册节（吸收原「加入相册」选择对话框全部行为）：[excludeIds] 滤自指（相册详情传本相册 id，
 *   D12A），过滤后为空复用既有空态文案；点选回调 [onPickGallery]（galleryId）。
 * - 手机相册节（镜像 DeviceAlbumPicker 行语义）：只列可写路径（[isWritableAlbumPath]，DCIM 与
 *   Pictures 之下）的真实相册 + 待落地占位——聚合卡（relativePath=null）与三方目录天然滤除；
 *   点选回调 [onPickDeviceAlbum]（relativePath）。[canCreateDeviceAlbum] 时首行「新建相册」
 *   展开内联输入：[onCreateDeviceAlbum] 返回错误文案就地显示（null=成功），成功后顺带以
 *   `Pictures/<名>/` 回调 onPickDeviceAlbum——新建即选中。
 *   （MiuiTextField 的 modifier 施加在其内部 TextField 上，布局须上下堆叠而非 Row+weight，
 *   踩坑记录见 DeviceAlbumPicker。）
 * - 点选/新建成功后**不自关**：收尾（关弹窗、发请求、清选择、提示）由调用方编排。
 */
@Composable
fun CopyTargetPicker(
    mode: PickerMode,
    galleries: List<GalleryEntity>,
    deviceAlbums: List<DeviceAlbum>,
    deviceEnabled: Boolean,
    canCreateDeviceAlbum: Boolean,
    onPickGallery: (Long) -> Unit,
    onPickDeviceAlbum: (relativePath: String) -> Unit,
    onCreateDeviceAlbum: (name: String) -> String?,
    onDismiss: () -> Unit,
    excludeIds: Set<Long> = emptySet(),
) {
    val visibleGalleries = galleries.filterNot { it.id in excludeIds }
    // Move 模式硬编码不渲染手机节（spec D5）；Copy 模式再看 deviceEnabled（canCopy && online）
    val showDeviceSection = mode == PickerMode.Copy && deviceEnabled
    // 手机节防御过滤（DeviceAlbumPicker 同款谓词）：聚合卡 path=null 与不可写路径滤除；
    // 待落地路径恒 Pictures/<名>/（构造保证）直接放行
    val visibleDevice = if (showDeviceSection) {
        deviceAlbums.filter { album ->
            val path = album.relativePath
            path != null && (album.isPending || isWritableAlbumPath(path))
        }
    } else {
        emptyList()
    }
    var creating by rememberSaveable { mutableStateOf(false) }
    var newName by rememberSaveable { mutableStateOf("") }
    var newError by rememberSaveable { mutableStateOf<String?>(null) }

    MiuiDialog(
        title = if (mode == PickerMode.Copy) "复制到" else "移动到",
        onDismiss = onDismiss,
        confirmText = null,
        dismissText = "取消",
        dialogTag = "copy_target_picker",
        content = {
            LazyColumn(Modifier.heightIn(max = 400.dp)) {
                item(key = "section_gallery") { PickerSectionHeader("相册", "copy_picker_section_gallery") }
                if (visibleGalleries.isEmpty()) {
                    item(key = "gallery_empty") {
                        Text(
                            "暂无相册，可先在相册 tab 新建",
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                        )
                    }
                } else {
                    items(visibleGalleries, key = { "g${it.id}" }) { gallery ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { onPickGallery(gallery.id) }
                                .padding(horizontal = 8.dp, vertical = 12.dp)
                                .testTag("copy_picker_gallery_${gallery.id}"),
                        ) {
                            Text(gallery.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                            Text(
                                "${gallery.imageCount} 张",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                if (showDeviceSection) {
                    item(key = "section_device") { PickerSectionHeader("手机相册", "copy_picker_section_device") }
                    if (canCreateDeviceAlbum) {
                        item(key = "create_device") {
                            if (creating) {
                                // 内联新建（DeviceAlbumPicker 同款语义）：错误文案原地 supportingText 不关弹窗；
                                // 成功即以 Pictures/<名>/ 回调（路径构造与待落地占位同式）
                                Column(Modifier.fillMaxWidth()) {
                                    MiuiTextField(
                                        value = newName,
                                        onValueChange = { newName = it; newError = null },
                                        placeholder = "相册名",
                                        isError = newError != null,
                                        supportingText = newError,
                                        modifier = Modifier.fillMaxWidth().testTag("copy_picker_create_name"),
                                    )
                                    Row(
                                        horizontalArrangement = Arrangement.End,
                                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                                    ) {
                                        TextButton(
                                            onClick = {
                                                val error = onCreateDeviceAlbum(newName)
                                                if (error != null) newError = error else onPickDeviceAlbum(pendingAlbumPath(newName))
                                            },
                                            modifier = Modifier.testTag("copy_picker_create_confirm"),
                                        ) { Text("创建") }
                                    }
                                }
                            } else {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .clickable { creating = true }
                                        .padding(horizontal = 8.dp, vertical = 12.dp)
                                        .testTag("copy_picker_create_device"),
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
                    }
                    items(visibleDevice, key = { "d${it.key.encode()}" }) { album ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                // visibleDevice 过滤保证 relativePath 非 null，此处 !! 安全（filter 谓词收口）
                                .clickable { onPickDeviceAlbum(album.relativePath!!) }
                                .padding(horizontal = 8.dp, vertical = 12.dp)
                                .testTag("copy_picker_device_${album.key.encode()}"),
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

/** 小节头：「相册」/「手机相册」（spec §6.1 两节结构）。 */
@Composable
private fun PickerSectionHeader(label: String, tag: String) {
    Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 6.dp)
            .testTag(tag),
    )
}

/**
 * 手机相册节数据源（Task 11，Photos/AlbumDetail/Viewer 三 VM 共用载体）：[targets] 查一轮
 * `queryAlbums` + `devicePendingAlbums` 合成（复用 [buildTargetAlbums] 的收编去重/排序，无聚合卡），
 * 查询异常兜底空列表（对照 DeviceAlbumDetailViewModel.targetAlbums——CancellationException 原样
 * 重抛，结构化并发要求）。[create] 对最近一次候选快照做重名校验（picker 打开前必先走一遍
 * targets，快照必然新鲜），通过即写入待落地占位并返回 null，错误文案由 picker 就地显示。
 */
class DeviceCopyTargets(
    private val gateway: DeviceMediaGateway,
    private val prefsStore: PrefsStore,
    private val scope: CoroutineScope,
) {
    private var lastTargets: List<DeviceAlbum> = emptyList()

    suspend fun targets(): List<DeviceAlbum> {
        val real = runCatching { gateway.queryAlbums() }
            .onFailure { if (it is CancellationException) throw it }
            .getOrElse { emptyList() }
        val pending = prefsStore.devicePendingAlbums.first()
        return buildTargetAlbums(real, pending).also { lastTargets = it }
    }

    fun create(name: String): String? {
        val trimmed = name.trim()
        val error = validateNewAlbumName(trimmed, lastTargets.map { it.name }.toSet())
        if (error != null) return error
        scope.launch { prefsStore.addPendingAlbum(trimmed) }
        return null
    }

    companion object {
        /**
         * 导出单批 id 上限（Task 10 审查移交）：KEY_IMAGE_IDS 走 WorkManager Data，有 10KB 硬上限
         * （约 1200+ id 即崩 enqueue）——超限切多批，APPEND_OR_REPLACE 唯一工作名保证按提交顺序排队。
         */
        const val EXPORT_BATCH = 500
    }
}
