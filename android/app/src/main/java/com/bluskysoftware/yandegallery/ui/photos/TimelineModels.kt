package com.bluskysoftware.yandegallery.ui.photos

import com.bluskysoftware.yandegallery.data.db.ImageEntity
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

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
