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
 * 相册列表排序（spec §4.3）：相机（DCIM/Camera）→ 截图（* /Screenshots）置顶，
 * 其余按张数降序（同数按名称稳定），待落地相册垫底。
 */
fun sortDeviceAlbums(albums: List<DeviceAlbum>): List<DeviceAlbum> {
    fun rank(a: DeviceAlbum): Int = when {
        a.isPending -> 3
        a.relativePath?.startsWith("DCIM/Camera") == true -> 0
        a.relativePath?.trimEnd('/')?.endsWith("Screenshots") == true -> 1
        else -> 2
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

/** 视频时长角标文案：m:ss，≥1h 为 h:mm:ss。 */
fun formatDurationMs(ms: Long): String {
    val totalSec = ms / 1000
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
