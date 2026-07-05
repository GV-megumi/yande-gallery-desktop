package com.bluskysoftware.yandegallery.data.media

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.OutputStream

/**
 * [MediaStoreGateway] 的真实 ContentResolver 实现，按 API 版本分支：
 * - 29+（scoped storage）：RELATIVE_PATH=Pictures/YandeGallery + IS_PENDING=1 挂起写入，写完清 0。
 * - 26-28（legacy）：直接 insert 到 EXTERNAL_CONTENT_URI，写完手动触发 MediaScannerConnection 扫描。
 *
 * 仅经 Robolectric 冒烟测试覆盖（29+ 分支基本不崩），真机语义留待实机验证
 * （沿用项目对 Coil DiskCache 的既有政策）。
 */
class AndroidMediaStoreGateway(private val context: Context) : MediaStoreGateway {
    private val resolver get() = context.contentResolver
    private val collection: Uri
        get() = if (Build.VERSION.SDK_INT >= 29)
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        else MediaStore.Images.Media.EXTERNAL_CONTENT_URI

    override fun createPending(displayName: String, mime: String): Uri? {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
            put(MediaStore.Images.Media.MIME_TYPE, mime)
            if (Build.VERSION.SDK_INT >= 29) {
                put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/YandeGallery")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        }
        return resolver.insert(collection, values)
    }

    override fun openOutput(uri: Uri): OutputStream? = resolver.openOutputStream(uri)

    override fun finalize(uri: Uri) {
        if (Build.VERSION.SDK_INT >= 29) {
            resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
        } else {
            // 26-28：无 pending 列，写完直接触发媒体扫描
            android.media.MediaScannerConnection.scanFile(context, arrayOf(uri.path), null, null)
        }
    }

    override fun discard(uri: Uri) { runCatching { resolver.delete(uri, null, null) } }

    override fun exists(uri: Uri): Boolean =
        runCatching { resolver.openFileDescriptor(uri, "r")?.use { true } ?: false }.getOrDefault(false)

    override fun buildDeleteRequest(uris: List<Uri>): android.app.PendingIntent? =
        if (Build.VERSION.SDK_INT >= 30) MediaStore.createDeleteRequest(resolver, uris) else null
}
