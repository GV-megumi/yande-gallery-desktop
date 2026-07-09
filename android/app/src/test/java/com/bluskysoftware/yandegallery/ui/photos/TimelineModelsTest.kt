package com.bluskysoftware.yandegallery.ui.photos

import com.bluskysoftware.yandegallery.data.db.ImageEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.TimeZone

class TimelineModelsTest {
    @Test
    fun `ISO 时间按本地时区归日`() {
        val prev = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"))
            // UTC 2026-07-02 23:00 = 上海 2026-07-03 07:00
            assertEquals("2026-07-03", dayKeyOf("2026-07-02T23:00:00.000Z"))
        } finally {
            TimeZone.setDefault(prev)
        }
    }

    @Test
    fun `非法时间戳回退前 10 字符`() {
        assertEquals("2026-07-03", dayKeyOf("2026-07-03 12:00:00"))
    }

    // 固定 today 注入保证跨年/跨日运行稳定（formatter 不内取 LocalDate.now()）
    @Test
    fun `dayHeaderDisplayOf 今天昨天同年周X跨年（MIUI 文案）`() {
        val today = LocalDate.of(2026, 7, 8)   // 周三
        assertEquals("今天", dayHeaderDisplayOf("2026-07-08", today))
        assertEquals("昨天", dayHeaderDisplayOf("2026-07-07", today))
        assertEquals("7月3日 周五", dayHeaderDisplayOf("2026-07-03", today))
        assertEquals("2025年12月31日 周三", dayHeaderDisplayOf("2025-12-31", today))
        assertEquals("bad-key", dayHeaderDisplayOf("bad-key", today))   // 解析失败回退原 key
    }

    @Test
    fun `monthHeaderDisplayOf 同年只显月跨年带年`() {
        val today = LocalDate.of(2026, 7, 8)
        assertEquals("7月", monthHeaderDisplayOf("2026-07", today))
        assertEquals("2025年12月", monthHeaderDisplayOf("2025-12", today))
        assertEquals("oops", monthHeaderDisplayOf("oops", today))
    }

    @Test
    fun `viewer 日期时间标签（本地时区换算构造期望，防时区脆断言）`() {
        val iso = "2026-07-03T04:05:00.000Z"
        val local = Instant.parse(iso).atZone(ZoneId.systemDefault())
        val expectDate = "${local.monthValue}月${local.dayOfMonth}日 ${weekdayCn(local.toLocalDate())}"
        assertEquals(expectDate, viewerDateLabel(iso, local.toLocalDate()))
        // 跨年（today 推后一年）→ 带年不带周；期望同用 local 拼（时区可能把 07-03 换算成 07-02/07-04）
        assertEquals(
            "${local.year}年${local.monthValue}月${local.dayOfMonth}日",
            viewerDateLabel(iso, local.toLocalDate().plusYears(1)),
        )
        val expectTime = local.format(DateTimeFormatter.ofPattern("HH:mm"))
        assertEquals(expectTime, viewerTimeLabel(iso))
        assertEquals("", viewerDateLabel("garbage", local.toLocalDate()))
    }

    @Test
    fun `monthKeyOf 本地时区月键与解析容错`() {
        // 取月中正午时刻：任意时区（±14h 内）本地月都不变，测试与机器 TZ 解耦
        assertEquals("2026-07", monthKeyOf("2026-07-15T12:00:00Z"))
        assertEquals("2026-01", monthKeyOf("2026-01-15T12:00:00Z"))
        assertEquals("garbage", monthKeyOf("garbage"))   // 解析失败回退前 7 字符
    }

    @Test
    fun `monthKeyOf 本地数字 Locale 下键仍为 ASCII`() {
        // 月键与 dayKeyOf（LocalDate.toString 恒 ASCII）同族比较（T3/T4 日期锚定）：
        // ar 等 CLDR 默认阿拉伯-印度数字的 Locale 下，未钉 Locale 的 %d 会产出本地数字、分叉键族。
        // 与 TimeZone 用例同款 try/finally 翻默认值（同 fork 内测试串行，无并行污染）。
        val prev = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("ar"))
            assertEquals("2026-07", monthKeyOf("2026-07-15T12:00:00Z"))
        } finally {
            Locale.setDefault(prev)
        }
    }

    @Test
    fun `monthDisplayOf 中文年月`() = assertEquals("2026年6月", monthDisplayOf("2026-06"))

    @Test
    fun `dayBubbleDisplayOf 月日气泡文案`() = assertEquals("6月15日", dayBubbleDisplayOf("2026-06-15"))

    @Test
    fun `timelineItemDateLabel 双档位双条目类型`() {
        // Photo 分支经 dayKeyOf 走本地时区归日，钉死 TZ 与机器解耦（同首个用例范式）
        val prev = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"))
            val photo = TimelineItem.Photo(
                ImageEntity(1, "a.jpg", 1, 1, 1L, "jpg", "2026-06-15T12:00:00Z", "2026"),
            )
            assertEquals("6月15日", timelineItemDateLabel(photo, monthly = false))
            assertEquals("2026年6月", timelineItemDateLabel(photo, monthly = true))
            // 月模式 Header 的 dayKey 字段承载 monthKey（T2 约定）
            assertEquals("6月15日", timelineItemDateLabel(TimelineItem.Header("2026-06-15", "x"), monthly = false))
            assertEquals("2026年6月", timelineItemDateLabel(TimelineItem.Header("2026-06", "x"), monthly = true))
            assertNull(timelineItemDateLabel(null, monthly = false))
        } finally {
            TimeZone.setDefault(prev)
        }
    }

    // ---- v0.6 T6：分组头纯函数（PhotosViewModel.insertSeparators 委托，平铺模式不调用）----

    /** 构造指定 createdAt 的照片项（本文件此前无 ImageEntity 构造 helper，按 T6 计划新建）。 */
    private fun imageAt(createdAt: String) = ImageEntity(1, "a.jpg", 1, 1, 1L, "jpg", createdAt, createdAt)

    @Test
    fun `timelineSeparatorBetween 跨日插头_同日不插_首项必插`() {
        // dayKeyOf 走本地时区归日：钉死 TZ 与机器解耦（本文件既有装置范式）
        val prev = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"))
            val today = LocalDate.of(2026, 7, 9)
            val p1 = TimelineItem.Photo(imageAt("2026-07-08T10:00:00.000Z"))
            val p2 = TimelineItem.Photo(imageAt("2026-07-08T09:00:00.000Z"))
            val p3 = TimelineItem.Photo(imageAt("2026-07-07T09:00:00.000Z"))
            assertNotNull(timelineSeparatorBetween(null, p1, monthly = false, today))          // 首项
            assertNull(timelineSeparatorBetween(p1, p2, monthly = false, today))               // 同日
            val header = timelineSeparatorBetween(p2, p3, monthly = false, today)              // 跨日
            assertEquals("2026-07-07", header!!.dayKey)
        } finally {
            TimeZone.setDefault(prev)
        }
    }

    @Test
    fun `timelineSeparatorBetween 月粒度按月键分组`() {
        val prev = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"))
            val today = LocalDate.of(2026, 7, 9)
            val jun = TimelineItem.Photo(imageAt("2026-06-30T10:00:00.000Z"))
            val jul = TimelineItem.Photo(imageAt("2026-07-01T10:00:00.000Z"))
            assertNull(timelineSeparatorBetween(jul, TimelineItem.Photo(imageAt("2026-07-02T10:00:00.000Z")).let { it }, monthly = true, today).let { if (it?.dayKey == "2026-07") null else it })
            assertEquals("2026-06", timelineSeparatorBetween(jul, jun, monthly = true, today)!!.dayKey)
        } finally {
            TimeZone.setDefault(prev)
        }
    }

    @Test
    fun `DensityTier 四档序与边界`() {
        assertEquals(DensityTier.DAY_5, DensityTier.MONTH.larger())
        assertEquals(DensityTier.DAY_3, DensityTier.DAY_4.larger())
        assertNull(DensityTier.DAY_3.larger())
        assertEquals(DensityTier.MONTH, DensityTier.DAY_5.smaller())
        assertNull(DensityTier.MONTH.smaller())
        assertEquals(DensityTier.DAY_4, DensityTier.fromName(null))
        assertEquals(DensityTier.MONTH, DensityTier.fromName("MONTH"))
        assertEquals(DensityTier.DAY_4, DensityTier.fromName("bogus"))
    }
}
