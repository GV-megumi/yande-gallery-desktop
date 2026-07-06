package com.bluskysoftware.yandegallery.domain

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowNetworkCapabilities

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

    @Test fun `冷启动断网——start 即快照触发一次 onLost（横幅立即离线）`() {
        // Android 对「既缺网络」不投递 onLost：registerNetworkCallback 只对存活网络重放
        // onAvailable，冷启动无网时什么都不会来。start() 必须主动快照当前连接态补发 onLost。
        shadowOf(cm).setDefaultNetworkActive(false)   // activeNetwork → null（无活动网络）
        var lost = 0
        var available = 0
        val monitor = NetworkMonitor(context, onAvailable = { available++ }, onLost = { lost++ })

        monitor.start()

        assertEquals("冷启动断网时 start 应立即触发一次 onLost", 1, lost)
        assertEquals("快照不得手动补 onAvailable", 0, available)
    }

    @Test fun `冷启动有网——start 快照不触发 onLost`() {
        // 默认 shadow 有活动网络；显式给它 INTERNET 能力，保证快照判定确定性。
        val network = cm.activeNetwork!!
        val caps = ShadowNetworkCapabilities.newInstance()
        shadowOf(caps).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        shadowOf(cm).setNetworkCapabilities(network, caps)
        var lost = 0
        val monitor = NetworkMonitor(context, onAvailable = {}, onLost = { lost++ })

        monitor.start()

        assertEquals("有网时快照不得误报 onLost", 0, lost)
        // 限制说明：ShadowConnectivityManager 注册时不重放 onAvailable（真机会对存活网络重放），
        // 故此处只守卫 onLost 不误触，onAvailable 重放语义留实机验证。
    }
}
