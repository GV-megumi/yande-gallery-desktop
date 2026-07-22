package com.bluskysoftware.yandegallery.data.device

import android.net.Uri

/** 本机媒体（spec §4.2）：MediaStore 一行的内存态投影，非 Room Entity。 */
data class DeviceMedia(
    val mediaId: Long,
    val uri: Uri,
    val isVideo: Boolean,
    val displayName: String,
    val relativePath: String,
    val width: Int,
    val height: Int,
    val sizeBytes: Long,
    val takenAtMs: Long,          // DATE_TAKEN ?: DATE_MODIFIED*1000（网关侧收敛）
    val durationMs: Long?,        // 仅视频
)

/** 手机相册（spec 术语「手机相册」；isPending = 待落地相册，relativePath 恒非 null）。 */
data class DeviceAlbum(
    val key: BucketKey,
    val name: String,
    val relativePath: String?,    // 真实 bucket 取自成员行；待落地 = Pictures/<名称>/
    val count: Int,
    val coverUri: Uri?,
    val isPending: Boolean,
)

/**
 * 相册网格页上下文三态（spec §2.2）：路由字符串编码 `all` / `b<BUCKET_ID>` / `p<名称>`。
 * encode/decode 是 raw 往返（名称不做 URL 编解码）：URI 层转义收敛在 Routes 构造函数的
 * `Uri.encode`（对照 Routes.search 先例），Navigation 收参自动解码一次——这里再编解码会双重解码。
 */
sealed interface BucketKey {
    data object All : BucketKey
    data class Bucket(val bucketId: Long) : BucketKey
    data class Pending(val name: String) : BucketKey

    fun encode(): String = when (this) {
        All -> "all"
        is Bucket -> "b$bucketId"
        is Pending -> "p$name"
    }

    companion object {
        fun decode(raw: String): BucketKey? = when {
            raw == "all" -> All
            raw.startsWith("b") -> raw.drop(1).toLongOrNull()?.let { Bucket(it) }
            raw.startsWith("p") -> Pending(raw.drop(1))
            else -> null
        }
    }
}

/**
 * 相册列表排序（spec §4.3）：相机（DCIM/Camera）→ 截图（段名恰为 Screenshots）置顶，
 * 其余按张数降序（同数按名称稳定），待落地相册垫底。
 */
fun sortDeviceAlbums(albums: List<DeviceAlbum>): List<DeviceAlbum> {
    fun rank(a: DeviceAlbum): Int {
        if (a.isPending) return 3
        val p = a.relativePath?.trimEnd('/') ?: return 2
        return when {
            p == "DCIM/Camera" -> 0
            p == "Screenshots" || p.endsWith("/Screenshots") -> 1
            else -> 2
        }
    }
    return albums.sortedWith(compareBy({ rank(it) }, { -it.count }, { it.name }))
}

/** 复制/移动目标目录约束（spec §5.3）：三方写入限 DCIM/ 与 Pictures/ 下。 */
fun isWritableAlbumPath(relativePath: String): Boolean =
    relativePath.startsWith("DCIM/") || relativePath.startsWith("Pictures/")

/** 新建相册名校验（spec §5.5）：空白/路径与文件系统保留字符/重名拒绝；返回错误文案，null=合法。 */
fun validateNewAlbumName(name: String, existingNames: Set<String>): String? {
    val trimmed = name.trim()
    if (trimmed.isEmpty()) return "名称不能为空"
    if (trimmed.any { it in "\\/:*?\"<>|" }) return "名称含有非法字符"
    if (trimmed in existingNames) return "已存在同名相册"
    return null
}

/**
 * 文件扩展名 → MIME（分享/导出用）；未知回退图片通配。入参口径为**实际文件扩展名**
 * （`file.extension`）——HQ 档把 png 源转成 .jpg，按 image.format 会错报 MIME。
 * Task 10 迁自 ui/common/UiText.kt（原处保留转发引用）：导出 worker（domain/export）也要用，
 * 不该反向依赖 ui 包；手机域模型层是两侧公共下游。
 */
fun mimeOf(format: String): String = when (format.lowercase()) {
    "jpg", "jpeg" -> "image/jpeg"
    "png" -> "image/png"
    "gif" -> "image/gif"
    "webp" -> "image/webp"
    "bmp" -> "image/bmp"
    else -> "image/*"
}

/** 视频时长角标文案：m:ss，≥1h 为 h:mm:ss。 */
fun formatDurationMs(ms: Long): String {
    val totalSec = ms / 1000
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/** 待落地相册的固定落盘路径（六处构造点收敛，v0.8.1 A3）：`Pictures/<名>/`，名先 trim。 */
fun pendingAlbumPath(name: String): String = "Pictures/${name.trim()}/"

/**
 * 单批 WorkManager Data id 上限（导出/复制双域共用，v0.8.1 B 类抽到公共下游）：`KEY_*_IDS` 走
 * WorkManager Data 有 10KB 硬上限（约 1200+ id 即崩 enqueue）——超限切多批，唯一工作名
 * APPEND_OR_REPLACE 保证按提交顺序排队。消费方：桌面→手机导出 `PhotosViewModel.exportSelectedToDevice`
 * 与手机→手机复制 `DeviceCopyManager.enqueue`；`ui.common.DeviceCopyTargets.EXPORT_BATCH` 为兼容
 * ui 调用面保留的别名。domain 层（DeviceCopyManager）取此处，不反向依赖 ui 包（同 mimeOf 迁址理由）。
 */
const val EXPORT_BATCH = 500

/** 分享用 mime（原 DeviceAlbumDetailScreen internal 件迁址，v0.8.1 A4）：视频通配，图片按扩展名。 */
fun DeviceMedia.mime(): String =
    if (isVideo) "video/*" else mimeOf(displayName.substringAfterLast('.', ""))
