package com.bluskysoftware.yandegallery.domain

import app.cash.turbine.test
import com.bluskysoftware.yandegallery.data.api.ApiException
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 连接监视器状态机（M4-T6）：验两源汇流——
 * ① 同步结果推断（reportSuccess/reportFailure，含 401 unauthorized 位）；
 * ② 系统网络事件直驱（reportNetworkLost/Restored，D6b）。
 * 后到者覆盖 online 位；网络事件不动 unauthorized（密钥失效与网络无关）。
 */
class ConnectionMonitorTest {
    @Test fun `状态机 成功-失败-401-网络事件`() = runTest {
        val monitor = ConnectionMonitor(activeServerName = flowOf("桌面"), scope = backgroundScope)
        monitor.state.test {
            awaitItem()   // 初始（online=true）
            assertEquals("桌面", awaitItem().serverName)   // 服务器名注入

            monitor.reportFailure(RuntimeException("boom"))
            val failed = awaitItem()
            assertEquals(false, failed.online)
            assertEquals(false, failed.unauthorized)

            monitor.reportNetworkRestored()               // 网络恢复直驱横幅收起
            assertEquals(true, awaitItem().online)

            monitor.reportNetworkLost()                    // 断网直驱横幅（不等同步失败）
            assertEquals(false, awaitItem().online)

            // 401：服务器已应答 → online 翻回 true + unauthorized 置位（BUG-02 分类；横幅按 unauthorized 优先）
            monitor.reportFailure(ApiException("UNAUTHORIZED", "401", 401))
            val unauth = awaitItem()
            assertEquals(true, unauth.unauthorized)
            assertEquals(true, unauth.online)

            monitor.reportSuccess()
            val ok = awaitItem()
            assertEquals(true, ok.online); assertEquals(false, ok.unauthorized)
        }
    }

    @Test fun `应用级错误不误判离线——403-422-500 均不翻 online（BUG-02）`() = runTest {
        val monitor = ConnectionMonitor(activeServerName = flowOf("桌面"), scope = backgroundScope)
        monitor.state.test {
            awaitItem()   // 初始
            assertEquals("桌面", awaitItem().serverName)

            // 写权限未开（README 头号联调坑）：403 只应由调用方弹失败提示，横幅不得报「未连接」；
            // 422/500 同理——服务器已应答即连接是通的
            monitor.reportFailure(ApiException("PERMISSION_DENIED", "imageWrite 未开", 403))
            monitor.reportFailure(ApiException("VALIDATION_ERROR", "empty imageIds", 422))
            monitor.reportFailure(ApiException("INTERNAL_ERROR", "boom", 500))
            expectNoEvents()   // online=true/unauthorized=false 全程无翻转
            assertEquals(true, monitor.state.value.online)
            assertEquals(false, monitor.state.value.unauthorized)
        }
    }

    @Test fun `网络翻动不清 unauthorized——密钥失效与网络无关`() = runTest {
        val monitor = ConnectionMonitor(activeServerName = flowOf(null), scope = backgroundScope)
        monitor.state.test {
            awaitItem()   // 初始

            monitor.reportFailure(ApiException("UNAUTHORIZED", "401", 401))
            assertEquals(true, awaitItem().unauthorized)

            // 断网/恢复只翻 online 位，unauthorized 必须存活（横幅仍应显示密钥失效）。
            // 401 后 online=true（BUG-02 分类），断网翻 false 先有一次发射。
            monitor.reportNetworkLost()
            assertEquals(false, awaitItem().online)
            monitor.reportNetworkRestored()
            val restored = awaitItem()
            assertEquals(true, restored.online)
            assertEquals(true, restored.unauthorized)
        }
    }
}
