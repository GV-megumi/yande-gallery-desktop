package com.bluskysoftware.yandegallery.ui.photos

import com.bluskysoftware.yandegallery.data.db.ImageEntity
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/** 时间轴列表项：日期分组头 or 单张照片。 */
sealed interface TimelineItem {
    data class Header(val dayKey: String, val display: String) : TimelineItem
    data class Photo(val image: ImageEntity) : TimelineItem
}

/** createdAt（ISO UTC 字符串）→ 本地时区日期 key（yyyy-MM-dd）。解析失败回退取前 10 字符。 */
fun dayKeyOf(createdAt: String): String = runCatching {
    Instant.parse(createdAt).atZone(ZoneId.systemDefault()).toLocalDate().toString()
}.getOrElse { createdAt.take(10) }

/** 日期 key（yyyy-MM-dd）→ 中文年月日展示文案（如 2026年7月3日）。 */
fun dayDisplayOf(dayKey: String): String = runCatching {
    val date = LocalDate.parse(dayKey)
    "${date.year}年${date.monthValue}月${date.dayOfMonth}日"
}.getOrElse { dayKey }

/**
 * 时间轴密度四档（spec §7.1 / D1）：月视图 6 列（本计划裁定，spec 未定列数）+ 日视图 3/4/5 列。
 * larger() = 捏合放大方向（格子变大）：MONTH → DAY_5 → DAY_4 → DAY_3。
 */
enum class DensityTier(val columns: Int, val monthGrouping: Boolean) {
    MONTH(6, true), DAY_5(5, false), DAY_4(4, false), DAY_3(3, false);

    fun larger(): DensityTier? = when (this) {
        MONTH -> DAY_5; DAY_5 -> DAY_4; DAY_4 -> DAY_3; DAY_3 -> null
    }

    fun smaller(): DensityTier? = when (this) {
        DAY_3 -> DAY_4; DAY_4 -> DAY_5; DAY_5 -> MONTH; MONTH -> null
    }

    companion object {
        val DEFAULT = DAY_4
        fun fromName(name: String?): DensityTier = entries.firstOrNull { it.name == name } ?: DEFAULT
    }
}

/** createdAt（ISO UTC）→ 本地时区月 key（yyyy-MM）。解析失败回退前 7 字符（镜像 dayKeyOf）。 */
fun monthKeyOf(createdAt: String): String = runCatching {
    val date = Instant.parse(createdAt).atZone(ZoneId.systemDefault()).toLocalDate()
    // 键族必须 ASCII 稳定（与 dayKeyOf 的 LocalDate.toString 一致，T3/T4 做月/日键比较锚定），
    // Locale.ROOT 防 ar/fa/bn 等本地数字 Locale 把 %d 渲染成非 ASCII、分叉键族。
    "%04d-%02d".format(Locale.ROOT, date.year, date.monthValue)
}.getOrElse { createdAt.take(7) }

/** 月 key（yyyy-MM）→「2026年6月」。 */
fun monthDisplayOf(monthKey: String): String = runCatching {
    val (y, m) = monthKey.split("-")
    "${y.toInt()}年${m.toInt()}月"
}.getOrElse { monthKey }

/** 日 key（yyyy-MM-dd）→「6月15日」（快速滚动气泡日视图档，D4）。 */
fun dayBubbleDisplayOf(dayKey: String): String = runCatching {
    val date = LocalDate.parse(dayKey)
    "${date.monthValue}月${date.dayOfMonth}日"
}.getOrElse { dayKey }

/**
 * 时间轴条目 → 当前档位日期文案（月视图「2026年6月」/ 日视图「6月15日」）。
 * sticky 顶部日期条与快速滚动滑块气泡共用此查找（同一 top-visible-index→date 语义，
 * 两处不许各写一份）。月模式 Header 的 dayKey 字段承载 monthKey（T2 约定）。
 */
fun timelineItemDateLabel(item: TimelineItem?, monthly: Boolean): String? = when (item) {
    is TimelineItem.Photo ->
        if (monthly) monthDisplayOf(monthKeyOf(item.image.createdAt))
        else dayBubbleDisplayOf(dayKeyOf(item.image.createdAt))
    is TimelineItem.Header ->
        if (monthly) monthDisplayOf(item.dayKey) else dayBubbleDisplayOf(item.dayKey)
    null -> null
}
