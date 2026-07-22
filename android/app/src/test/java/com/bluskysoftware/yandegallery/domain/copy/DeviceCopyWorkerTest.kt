package com.bluskysoftware.yandegallery.domain.copy

import android.content.Context
import android.net.Uri
import android.system.ErrnoException
import android.system.OsConstants
import androidx.test.core.app.ApplicationProvider
import androidx.work.ForegroundInfo
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import com.bluskysoftware.yandegallery.data.device.DeviceSource
import com.bluskysoftware.yandegallery.domain.export.DeviceExportNotifier
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.IOException

/**
 * DeviceCopyWorker（手机→手机批量复制，本机相册 spec §5.3，v0.8.1 B 类）：worker 只做「mediaByIds
 * 还原（查无计失败——源已删）→ 逐张 findCopy 查重 → 未落地才 insertCopy + 失败分流 → 尾部收编/汇总」。
 * insertCopy/findCopy 本体归 MediaStoreDeviceGateway（真机链路），收编（removePendingIfMatch）本体
 * 归 AppWorkerFactory 注入的 prefs 收口，此处依赖全 fake。
 *
 * 装配照 DeviceExportWorkerTest（TestListenableWorkerBuilder + 匿名 WorkerFactory + lambda fakes +
 * 统一 call log），去掉 serverId/ensure/切服/retryable 桶——本机 IO 无瞬时网络错，只有源已删（计失败
 * 继续）、ENOSPC（整批 retry）、其余 insert 错（计失败继续）三条。[landed] 已落地集合跨 worker 实例
 * 存活，模拟 MediaStore 在 WorkManager 各轮重跑之间的持久现状——钉住「重跑经查重不重复 insert」。
 */
@RunWith(RobolectricTestRunner::class)
class DeviceCopyWorkerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    /**
     * 通知 fake：复制进度前台路径（copyForegroundInfo）throw 走 worker 的 runCatching 降级（对照
     * DeviceExportWorkerTest.foregroundInfo 同款）；[completedCalls] 记录复制汇总入参——钉「仅
     * failed>0 终态发汇总」。导出侧方法（foregroundInfo/notifyCompleted）复制 worker 不调，throw 兜底
     * 误用即红灯。
     */
    private val completedCalls = mutableListOf<Triple<Int, Int, String>>()
    private val noopNotifier = object : DeviceExportNotifier {
        override fun ensureChannel() {}
        override fun foregroundInfo(done: Int, total: Int, targetPath: String): ForegroundInfo =
            throw IllegalStateException("复制 worker 不调导出进度")
        override fun notifyCompleted(serverId: Long, ok: Int, failed: Int, targetPath: String): Unit =
            throw IllegalStateException("复制 worker 不调导出汇总")
        override fun copyForegroundInfo(done: Int, total: Int, targetPath: String): ForegroundInfo =
            throw IllegalStateException("测试不升前台")   // runCatching 降级路径
        override fun notifyCopyCompleted(ok: Int, failed: Int, targetPath: String) {
            completedCalls += Triple(ok, failed, targetPath)
        }
    }

    /** insertCopy/findCopy 入参记录（对照 FakeDeviceGateway 口径），按调用顺序追加。 */
    private val insertCalls = mutableListOf<Pair<DeviceSource, String>>()
    private val findCopyCalls = mutableListOf<Pair<String, String>>()

    /**
     * 统一 call log（沿用 DeviceExportWorkerTest 形态）：`"find:<名>"` / `"insert:<名>"` 按**实际
     * 调用序**交错追加——只有共享时间线才能钉「逐张先查后插」。
     */
    private val calls = mutableListOf<String>()

    /** 已落地副本集合（"path|name"）：insert 成功即登记、findCopy 据此命中——模拟真实 MediaStore 现状。 */
    private val landed = mutableSetOf<String>()

    /** 收编回调入参记录：worker 成功 ≥1 张时以 targetPath 调一次。 */
    private val removePendingCalls = mutableListOf<String>()

    /** insertCopy 结果定制旋钮（默认成功落地）：ENOSPC/普通失败用例覆写。 */
    private var insertResult: (DeviceSource, String) -> Result<Uri> = { _, _ ->
        Result.success(Uri.parse("content://media/external/images/media/${insertCalls.size}"))
    }

    private fun media(id: Long) = DeviceMedia(
        mediaId = id,
        uri = Uri.parse("content://media/external/images/media/$id"),
        isVideo = false,
        displayName = "img-$id.jpg",
        relativePath = "DCIM/Camera/",
        width = 100,
        height = 100,
        sizeBytes = 1_000,
        takenAtMs = id,
        durationMs = null,
    )

    private fun worker(
        mediaIds: LongArray = longArrayOf(1L, 2L, 3L),
        targetPath: String = "Pictures/Yande/",
        // 默认还原全部 id；源已删用例覆写为漏项
        restore: suspend (List<Long>) -> List<DeviceMedia> = { ids -> ids.map { media(it) } },
    ): DeviceCopyWorker =
        TestListenableWorkerBuilder<DeviceCopyWorker>(context)
            .setInputData(workDataOf(
                DeviceCopyWorker.KEY_MEDIA_IDS to mediaIds,
                DeviceCopyWorker.KEY_TARGET_PATH to targetPath,
            ))
            .setWorkerFactory(object : WorkerFactory() {
                override fun createWorker(c: Context, name: String, p: WorkerParameters): ListenableWorker =
                    DeviceCopyWorker(
                        c, p,
                        mediaByIds = restore,
                        insertCopy = { source, path ->
                            insertCalls += source to path
                            val dn = (source as DeviceSource.Media).media.displayName
                            calls += "insert:$dn"
                            insertResult(source, path).onSuccess { landed += "$path|$dn" }
                        },
                        findCopy = { path, name ->
                            findCopyCalls += path to name
                            calls += "find:$name"
                            if ("$path|$name" in landed) Uri.parse("content://media/external/images/media/999") else null
                        },
                        removePendingIfMatch = { path -> removePendingCalls += path },
                        notifier = noopNotifier,
                    )
            })
            .build() as DeviceCopyWorker

    private fun failedCountOf(result: ListenableWorker.Result): Int {
        assertTrue("应为 Success：$result", result is ListenableWorker.Result.Success)
        return result.outputData.getInt(DeviceCopyWorker.KEY_FAILED_COUNT, -1)
    }

    @Test
    fun `全成功——逐张先查重后 insertCopy，失败计数 0`() = runTest {
        val w = worker()

        assertEquals("全成功失败计数应为 0", 0, failedCountOf(w.doWork()))

        assertEquals("三张应各查重一次（insert 前置）", 3, findCopyCalls.size)
        assertEquals("三张应各 insertCopy 一次", 3, insertCalls.size)
        // 逐张严格「先查后插」交错序（防未来改成批查或先插后查）
        assertEquals(
            listOf(
                "find:img-1.jpg", "insert:img-1.jpg",
                "find:img-2.jpg", "insert:img-2.jpg",
                "find:img-3.jpg", "insert:img-3.jpg",
            ),
            calls,
        )
        insertCalls.forEach { (source, path) ->
            assertEquals("targetPath 应逐张透传", "Pictures/Yande/", path)
            assertTrue("复制源封装 DeviceSource.Media", source is DeviceSource.Media)
        }
        assertTrue("全成功不发汇总通知", completedCalls.isEmpty())
    }

    @Test
    fun `查重命中——跳过 insert 计成功，失败计数 0`() = runTest {
        // 预置第 1 张已落地：findCopy 命中即跳过计成功，仅其余两张 insert
        landed += "Pictures/Yande/|img-1.jpg"
        val w = worker()

        assertEquals("命中跳过计成功，失败计数 0", 0, failedCountOf(w.doWork()))

        assertEquals("三张全查重", 3, findCopyCalls.size)
        assertEquals("命中张跳过，仅 2 张 insert", 2, insertCalls.size)
        assertEquals(
            "落地的是未命中的 2、3 号",
            listOf("img-2.jpg", "img-3.jpg"),
            insertCalls.map { (it.first as DeviceSource.Media).media.displayName },
        )
    }

    @Test
    fun `源已删——mediaByIds 缺项计失败继续，其余照常落地`() = runTest {
        // 3 个 id 还原 2 条（id 2 源已删）：缺项计失败，前后成功张照常落地
        val w = worker(restore = { ids -> ids.filter { it != 2L }.map { media(it) } })

        assertEquals("缺项那张计失败", 1, failedCountOf(w.doWork()))

        assertEquals("其余两张仍应落地", 2, insertCalls.size)
        assertEquals(
            "成功两张按入参顺序为 1、3 号",
            listOf("img-1.jpg", "img-3.jpg"),
            insertCalls.map { (it.first as DeviceSource.Media).media.displayName },
        )
    }

    @Test
    fun `insert 侧 ENOSPC——识别为磁盘满整批 retry，而非计普通失败`() = runTest {
        // 满盘首现于 MediaStore 写流——IOException 的 cause 链上是 ErrnoException(ENOSPC)
        insertResult = { _, _ ->
            Result.failure(IOException("write failed", ErrnoException("write", OsConstants.ENOSPC)))
        }
        val w = worker()

        assertEquals(ListenableWorker.Result.retry(), w.doWork())
        assertEquals("撞上满盘立即 retry，不再逐张空转", 1, insertCalls.size)
    }

    @Test
    fun `部分失败——完成时发汇总通知（成功2失败1）`() = runTest {
        // 第 2 张 insert 普通失败（非 ENOSPC）→ 计失败继续；终态成功但 failed>0 → 发一次汇总
        insertResult = { source, _ ->
            val id = (source as DeviceSource.Media).media.mediaId
            if (id == 2L) Result.failure(IllegalStateException("boom"))
            else Result.success(Uri.parse("content://media/external/images/media/9$id"))
        }
        val w = worker()

        assertEquals("仅第 2 张计失败", 1, failedCountOf(w.doWork()))
        assertEquals(
            "部分失败终态应发一次汇总通知（成功 2、失败 1、目标路径透传）",
            listOf(Triple(2, 1, "Pictures/Yande/")),
            completedCalls,
        )
    }

    @Test
    fun `成功后目标为待落地路径——触发收编回调；全失败不触发`() = runTest {
        // 全失败（ok=0）先跑：insert 全失败 → 不触发收编回调。失败不落地，landed 保持空，
        // 不污染下一轮的查重（若先跑成功轮，landed 会预置命中令失败轮跳过成计成功——刻意避开）。
        insertResult = { _, _ -> Result.failure(IllegalStateException("boom")) }
        assertEquals("全失败计满", 3, failedCountOf(worker().doWork()))
        assertTrue("全失败（ok=0）不触发收编回调", removePendingCalls.isEmpty())

        // 成功 ≥1 张：removePendingIfMatch 收到 targetPath 恰一次（landed 起始空，逐张 insert 成功）
        insertResult = { _, _ -> Result.success(Uri.parse("content://media/external/images/media/${insertCalls.size}")) }
        assertEquals(0, failedCountOf(worker().doWork()))
        assertEquals("成功收编回调恰一次带 targetPath", listOf("Pictures/Yande/"), removePendingCalls)
    }
}
