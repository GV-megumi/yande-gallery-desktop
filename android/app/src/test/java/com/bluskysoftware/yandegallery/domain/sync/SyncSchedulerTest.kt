package com.bluskysoftware.yandegallery.domain.sync

import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.domain.ConnectionMonitor
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/**
 * 纯 JVM 调度测试：注入 fake suspend syncRun（final SyncEngine 不可 fake），
 * 用 CompletableDeferred 门控并发、AtomicInteger 计数，验证互斥合并 / 上报 / 全量提示。
 *
 * 用 UnconfinedTestDispatcher：scope.launch 的调度请求即时执行到首个挂起点，
 * launch-then-observe 模式无需精细推进虚拟时间。
 */
class SyncSchedulerTest {

    private fun monitor(scope: kotlinx.coroutines.CoroutineScope) =
        ConnectionMonitor(activeServerName = flowOf<String?>("srv"), scope = scope)

    @Test
    fun `并发两次 requestSync 只执行一次（互斥合并，忽略式）`() = runTest(UnconfinedTestDispatcher()) {
        val gate = CompletableDeferred<Unit>()
        val runs = AtomicInteger(0)
        val syncRun: suspend () -> SyncOutcome = {
            runs.incrementAndGet()
            gate.await()
            SyncOutcome(fullRebuild = false, upserted = 0, deleted = 0)
        }
        val mon = monitor(backgroundScope)
        val scheduler = SyncScheduler(syncRun, mon, backgroundScope, hadMirrorBefore = { false })

        scheduler.requestSync("a")   // 即时执行到 gate.await() 挂起，runs=1
        scheduler.requestSync("b")   // 进行中 → 直接忽略，不第二次执行
        assertEquals(1, runs.get())

        gate.complete(Unit)          // 放行第一个，走成功上报
        assertTrue(mon.state.value.online)
    }

    @Test
    fun `真实 401 的 ApiException UNAUTHORIZED 映射为 monitor unauthorized`() = runTest(UnconfinedTestDispatcher()) {
        val syncRun: suspend () -> SyncOutcome = {
            throw ApiException(code = "UNAUTHORIZED", message = "invalid key", httpStatus = 401)
        }
        val mon = monitor(backgroundScope)
        val scheduler = SyncScheduler(syncRun, mon, backgroundScope, hadMirrorBefore = { false })

        scheduler.requestSync("x")

        assertTrue(mon.state.value.unauthorized)
        assertFalse(mon.state.value.online)
    }

    @Test
    fun `同步成功后 monitor online`() = runTest(UnconfinedTestDispatcher()) {
        val syncRun: suspend () -> SyncOutcome = {
            SyncOutcome(fullRebuild = false, upserted = 3, deleted = 0)
        }
        val mon = monitor(backgroundScope)
        // 先制造一次失败态，再验证成功把它翻回 online
        mon.reportFailure(ApiException("INTERNAL_ERROR", "boom"))
        assertFalse(mon.state.value.online)

        val scheduler = SyncScheduler(syncRun, mon, backgroundScope, hadMirrorBefore = { false })
        scheduler.requestSync("x")

        assertTrue(mon.state.value.online)
        assertFalse(mon.state.value.unauthorized)
    }

    @Test
    fun `已有镜像时全量重建发一次 rebuildNotices`() = runTest(UnconfinedTestDispatcher()) {
        val syncRun: suspend () -> SyncOutcome = {
            SyncOutcome(fullRebuild = true, upserted = 5, deleted = 0)
        }
        val mon = monitor(backgroundScope)
        val scheduler = SyncScheduler(syncRun, mon, backgroundScope, hadMirrorBefore = { true })

        val notices = mutableListOf<Unit>()
        backgroundScope.launch { scheduler.rebuildNotices.collect { notices += it } }  // 先订阅（replay=0）

        scheduler.requestSync("x")

        assertEquals(1, notices.size)
    }

    @Test
    fun `首次全量（无本地镜像）不发 rebuildNotices`() = runTest(UnconfinedTestDispatcher()) {
        val syncRun: suspend () -> SyncOutcome = {
            SyncOutcome(fullRebuild = true, upserted = 5, deleted = 0)
        }
        val mon = monitor(backgroundScope)
        val scheduler = SyncScheduler(syncRun, mon, backgroundScope, hadMirrorBefore = { false })

        val notices = mutableListOf<Unit>()
        backgroundScope.launch { scheduler.rebuildNotices.collect { notices += it } }

        scheduler.requestSync("x")

        assertEquals(0, notices.size)
    }
}
