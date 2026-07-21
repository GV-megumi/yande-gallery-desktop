package com.bluskysoftware.yandegallery.ui.common

import com.bluskysoftware.yandegallery.domain.write.WriteResult

/**
 * 文件扩展名 → MIME（分享用）；未知回退通配。本体 Task 10 移入 data/device/DeviceModels.kt
 * （导出 worker 不该依赖 ui 包），此处保留同签名转发——既有 ui 侧调用与测试零迁移。
 */
internal fun mimeOf(format: String): String = com.bluskysoftware.yandegallery.data.device.mimeOf(format)

/** 写失败 → 提示文案：401 统一引导重新配对（原 SelectionBars.writeFailText 与 ViewerScreen.failText 逐字同逻辑，合一）。 */
internal fun writeFailText(prefix: String, result: WriteResult.Failed): String =
    if (result.unauthorized) "密钥失效，请重新配对" else "$prefix：${result.message}"
