package com.bluskysoftware.yandegallery.domain.download

import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class DownloadNotifierTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test fun `节流函数 时间或百分比越阈值才更新`() {
        assertFalse(shouldUpdateNotification(lastMs = 0, nowMs = 500, lastPct = 10, pct = 12))
        assertTrue(shouldUpdateNotification(lastMs = 0, nowMs = 1_000, lastPct = 10, pct = 12))   // ≥1s
        assertTrue(shouldUpdateNotification(lastMs = 0, nowMs = 500, lastPct = 10, pct = 15))     // ≥5%
        assertFalse(shouldUpdateNotification(lastMs = 0, nowMs = 500, lastPct = -1, pct = -1))    // 未知长度且未到时间
    }

    @Test @Config(sdk = [33]) fun `ensureChannel 幂等建通道`() {
        val notifier = AndroidDownloadNotifier(context)
        notifier.ensureChannel(); notifier.ensureChannel()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        assertNotNull(nm.getNotificationChannel("download_progress"))
    }

    @Test @Config(sdk = [34]) fun `foregroundInfo 带 dataSync 类型与进度`() {
        val info = AndroidDownloadNotifier(context).foregroundInfo(7L, "a.jpg", 50, 100)
        assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC, info.foregroundServiceType)
    }
}
