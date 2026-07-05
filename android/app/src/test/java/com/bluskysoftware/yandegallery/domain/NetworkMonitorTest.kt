package com.bluskysoftware.yandegallery.domain

import android.content.Context
import android.net.ConnectivityManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * NetworkMonitor 冒烟（Robolectric，ShadowConnectivityManager）：验注册/注销 NetworkCallback，
 * 幂等 stop 不崩。回调实际触发时的下游接线（requestSync/restart）在 AppGraph 层组装，本类只测注册生命周期。
 */
@RunWith(RobolectricTestRunner::class)
class NetworkMonitorTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    @Test fun `start 注册回调，stop 注销`() {
        val monitor = NetworkMonitor(context, onAvailable = {}, onLost = {})

        monitor.start()
        assertTrue("start 后应有已注册的 NetworkCallback", shadowOf(cm).networkCallbacks.isNotEmpty())

        monitor.stop()
        assertTrue("stop 后回调应清空", shadowOf(cm).networkCallbacks.isEmpty())
    }

    @Test fun `重复 start 幂等——只注册一次`() {
        val monitor = NetworkMonitor(context, onAvailable = {}, onLost = {})
        monitor.start()
        monitor.start()
        assertEqualsOne(shadowOf(cm).networkCallbacks.size)
    }

    @Test fun `重复 stop 不崩且未 start 直接 stop 安全`() {
        val monitor = NetworkMonitor(context, onAvailable = {}, onLost = {})
        monitor.stop()               // 未 start 直接 stop
        monitor.start()
        monitor.stop()
        monitor.stop()               // 重复 stop
        assertFalse(shadowOf(cm).networkCallbacks.isNotEmpty())
    }

    private fun assertEqualsOne(actual: Int) =
        assertTrue("重复 start 应只注册一个回调，实际 $actual", actual == 1)
}
