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
    fun `运行中到达的第二次请求在首次完成后补跑一次（合并式 pending）`() = runTest(UnconfinedTestDispatcher()) {
        val gate1 = CompletableDeferred<Unit>()
        val runs = AtomicInteger(0)
        val syncRun: suspend () -> SyncOutcome = {
            val n = runs.incrementAndGet()
            if (n == 1) gate1.await()   // 首轮挂在门上；补跑的第二轮直接返回
            SyncOutcome(fullRebuild = false, upserted = 0, deleted = 0)
        }
        val mon = monitor(backgroundScope)
        val scheduler = SyncScheduler(syncRun, mon, backgroundScope, hadMirrorBefore = { false })

        scheduler.requestSync("a")   // 即时执行到 gate1.await() 挂起，runs=1
        scheduler.requestSync("b")   // 运行中 → 记 pending，尚未第二次执行
        assertEquals(1, runs.get())

        gate1.complete(Unit)         // 放行首轮 → 收尾发现 pending → 补跑第二轮
        assertEquals(2, runs.get())  // 不再被丢弃：恰好补跑一次
        assertTrue(mon.state.value.online)
    }

    @Test
    fun `运行中的多次请求也只合并成一轮补跑`() = runTest(UnconfinedTestDispatcher()) {
        val gate1 = CompletableDeferred<Unit>()
        val runs = AtomicInteger(0)
        val syncRun: suspend () -> SyncOutcome = {
            val n = runs.incrementAndGet()
            if (n == 1) gate1.await()
            SyncOutcome(fullRebuild = false, upserted = 0, deleted = 0)
        }
        val mon = monitor(backgroundScope)
        val scheduler = SyncScheduler(syncRun, mon, backgroundScope, hadMirrorBefore = { false })

        scheduler.requestSync("a")   // runs=1，挂起
        scheduler.requestSync("b")   // pending
        scheduler.requestSync("c")   // pending（已置位，幂等）
        scheduler.requestSync("d")   // pending
        assertEquals(1, runs.get())

        gate1.complete(Unit)         // 首轮完成 → 补跑一轮即清 pending
        assertEquals(2, runs.get())  // 运行期多次请求合并为单轮补跑，不逐个排队
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
