package com.bluskysoftware.yandegallery.ui.common

import com.bluskysoftware.yandegallery.domain.write.WriteResult

/**
 * 文件扩展名 → MIME（分享用）；未知回退通配。镜像层 Task 8 起入参口径为**实际文件扩展名**
 * （`file.extension`）——HQ 档把 png 源转成 .jpg，按 image.format 会错报 MIME。映射表本身不变。
 */
internal fun mimeOf(format: String): String = when (format.lowercase()) {
    "jpg", "jpeg" -> "image/jpeg"
    "png" -> "image/png"
    "gif" -> "image/gif"
    "webp" -> "image/webp"
    "bmp" -> "image/bmp"
    else -> "image/*"
}

/** 写失败 → 提示文案：401 统一引导重新配对（原 SelectionBars.writeFailText 与 ViewerScreen.failText 逐字同逻辑，合一）。 */
internal fun writeFailText(prefix: String, result: WriteResult.Failed): String =
    if (result.unauthorized) "密钥失效，请重新配对" else "$prefix：${result.message}"
