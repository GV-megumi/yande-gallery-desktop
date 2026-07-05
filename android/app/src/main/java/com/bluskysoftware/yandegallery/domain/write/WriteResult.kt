package com.bluskysoftware.yandegallery.domain.write

/**
 * 写操作结果。乐观镜像已在本地生效，此结果只驱动 UI 提示（失败横幅 / 重新配对）。
 * 权威 code block 只有 Success/Failed（batchDeleteImages 部分失败也返回 Failed），
 * 不引入 PartialSuccess（brief Interfaces 提到的变体为陈旧文本，见任务报告）。
 */
sealed interface WriteResult {
    data object Success : WriteResult
    data class Failed(val message: String, val unauthorized: Boolean = false) : WriteResult
}
