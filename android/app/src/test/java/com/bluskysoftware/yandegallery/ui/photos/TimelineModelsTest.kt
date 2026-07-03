package com.bluskysoftware.yandegallery.ui.photos

import org.junit.Assert.assertEquals
import org.junit.Test
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
}
