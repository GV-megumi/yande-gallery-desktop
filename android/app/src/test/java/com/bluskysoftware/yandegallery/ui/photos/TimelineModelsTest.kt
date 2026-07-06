package com.bluskysoftware.yandegallery.ui.photos

import com.bluskysoftware.yandegallery.data.db.ImageEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
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

    @Test
    fun `展示文案为中文年月日`() {
        assertEquals("2026年7月3日", dayDisplayOf("2026-07-03"))
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
