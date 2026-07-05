package com.bluskysoftware.yandegallery.ui.common

import com.bluskysoftware.yandegallery.domain.write.WriteResult

/** 图片 format → MIME（下载入队/分享共用）；未知格式回退通配。原 ui.viewer 版迁此（D12A 归拢）。 */
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
