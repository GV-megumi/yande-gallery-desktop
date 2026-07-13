package com.bluskysoftware.yandegallery.data.mirror

import java.io.File

/** 镜像档位（spec §3.2）：HQ 高质量图 / ORIGINAL 原图；Room image_files.tier 存 enum name。 */
enum class MirrorTier { HQ, ORIGINAL }

/** tier 字符串解析（DataStore/DB 读侧共用）：非法/null 收敛 HQ（对齐仓内 enum name 存法惯例）。 */
fun mirrorTierOf(name: String?): MirrorTier =
    runCatching { MirrorTier.valueOf(name ?: "") }.getOrDefault(MirrorTier.HQ)

/** 本地镜像查询结果：档位 + 落盘文件（存在性已由查询方校验）。 */
data class LocalImage(val tier: MirrorTier, val file: File)

/** 存储页统计（spec §5.2）：高质量/原图分列张数与字节。 */
data class MirrorStats(
    val hqCount: Long = 0,
    val hqBytes: Long = 0,
    val originalCount: Long = 0,
    val originalBytes: Long = 0,
)

/** 安卓文件名非法字符清洗（spec §3.1）：`\ / : * ? " < > |` → `_`。 */
fun sanitizeFilename(name: String): String = name.replace(Regex("""[\\/:*?"<>|]"""), "_")

/** Content-Type → 扩展名；未知/缺失回退 fallbackExt（体积保护回退原图时 Content-Type 即原格式）。 */
private fun extensionForContentType(contentType: String?, fallbackExt: String): String = when {
    contentType == null -> fallbackExt
    contentType.startsWith("image/jpeg") -> "jpg"
    contentType.startsWith("image/webp") -> "webp"
    contentType.startsWith("image/png") -> "png"
    contentType.startsWith("image/gif") -> "gif"
    contentType.startsWith("image/bmp") -> "bmp"
    contentType.startsWith("image/avif") -> "avif"
    else -> fallbackExt
}

/**
 * HQ 档落盘文件名（spec §3.1）：原主文件名 + 实际格式扩展名（foo.png + image/jpeg → foo.jpg）。
 * 无扩展名的原名回退 "bin" 再由 Content-Type 覆盖。
 */
fun hqFilename(originalFilename: String, contentType: String?): String {
    val main = originalFilename.substringBeforeLast('.', originalFilename)
    val fallbackExt = originalFilename.substringAfterLast('.', "bin")
    return sanitizeFilename("$main.${extensionForContentType(contentType, fallbackExt)}")
}
