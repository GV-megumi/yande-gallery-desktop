package com.bluskysoftware.yandegallery.ui.device

import java.time.LocalDate
import java.util.Calendar
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * deviceViewerDateLabel/deviceViewerTimeLabel 纯函数直测（加固轮 F7，DeviceViewerScreen.kt
 * 尾部 internal 函数）：同年/跨年分支 + HH:mm。epochOf 用本地时区构造、10 点整不跨日界，
 * 期望的月/日/周X 对固定日期确定（照 TimelineModelsTest「dayHeaderDisplayOf」硬编码固定日期
 * 周X 的既有惯例）；today 显式注入（生产签名第二参），不依赖运行日年份。注意与桌面域
 * viewerDateLabel 的差异是现状行为：本函数**同年带周X、跨年不带周X**。
 */
class DeviceViewerLabelsTest {
    private fun epochOf(y: Int, mo: Int, d: Int, h: Int, mi: Int): Long =
        Calendar.getInstance().apply { clear(); set(y, mo - 1, d, h, mi) }.timeInMillis

    @Test
    fun `日期标签_同年不带年份_跨年带年份`() {
        val ms = epochOf(2024, 6, 9, 10, 0)   // 2024-06-09 为周日
        // 同年（today 与拍摄同年）：M月d日 周X（brief 示例无周X，以代码为准补上）
        assertEquals("6月9日 周日", deviceViewerDateLabel(ms, LocalDate.of(2024, 1, 1)))
        // 跨年（today 推后一年）：yyyy年M月d日，无周X
        assertEquals("2024年6月9日", deviceViewerDateLabel(ms, LocalDate.of(2025, 1, 1)))
    }

    @Test
    fun `时间标签_HH_mm`() {
        // epochOf 与生产同用系统默认时区，往返自洽：本地 09:05 恒格式化为 "09:05"（补零钉板）
        assertEquals("09:05", deviceViewerTimeLabel(epochOf(2025, 1, 1, 9, 5)))
    }
}
