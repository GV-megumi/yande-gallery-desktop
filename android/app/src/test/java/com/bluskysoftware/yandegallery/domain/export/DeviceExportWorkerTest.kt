package com.bluskysoftware.yandegallery.domain.export

import android.content.Context
import android.net.Uri
import android.system.ErrnoException
import android.system.OsConstants
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.device.DeviceSource
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.io.IOException

/**
 * DeviceExportWorker（桌面→手机导出，本机相册 spec §6.1）：worker 只做「逐张（串行）ensure 原图
 * → findCopy 查重 → 未落地才 insertCopy + 失败分流」——ensure 本体（落盘/校验/删 HQ）归
 * ImageMirrorStoreTest，insertCopy/findCopy 本体归 MediaStoreDeviceGateway（真机链路），此处依赖全 fake。
 * 装配对照 DownloadWorkerTest / DownloadE2ETest：TestListenableWorkerBuilder + 匿名 WorkerFactory。
 * [landed] 已落地集合跨 worker 实例存活，模拟 MediaStore 在 WorkManager 各轮重跑之间的持久现状——
 * 钉住「重跑经查重不重复 insert」（review Critical #1）。
 */
@RunWith(RobolectricTestRunner::class)
class DeviceExportWorkerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    /**
     * 通知 fake：前台路径 runCatching 包裹照旧 no-op（对照 DownloadWorkerTest），
     * [completedCalls] 记录完成汇总调用入参——钉住「仅部分失败终态发汇总」（终审 Fix 1）。
     * G4 加盐（v0.8.1 H7）签名 +serverId：并行记入 [completedServerIds]（既有 Triple 断言零改动），
     * worker 层只验 serverId 透传——通知 id 加盐公式属 Android 实现，不在本层断言。
     */
    private val completedCalls = mutableListOf<Triple<Int, Int, String>>()
    private val completedServerIds = mutableListOf<Long>()
    private val noopNotifier = object : DeviceExportNotifier {
        override fun ensureChannel() {}
        override fun foregroundInfo(done: Int, total: Int, targetPath: String) =
            throw IllegalStateException("测试不升前台")   // runCatching 降级路径
        override fun notifyCompleted(serverId: Long, ok: Int, failed: Int, targetPath: String) {
            completedServerIds += serverId
            completedCalls += Triple(ok, failed, targetPath)
        }
    }

    /** insertCopy/findCopy 入参记录（对照 FakeDeviceGateway 口径），按调用顺序追加。 */
    private val insertCalls = mutableListOf<Pair<DeviceSource, String>>()
    private val findCopyCalls = mutableListOf<Pair<String, String>>()

    /**
     * 统一 call log（加固轮 D3；Task 8 的 DeviceCopyWorkerTest 沿用此形态）：`"find:<名>"` /
     * `"insert:<名>"` 按**实际调用序**交错追加——上面两张分列表各自保序但相互无序，只有共享
     * 时间线才能钉「逐张先查后插」；两分列表保留同步追加，既有断言零改动。
     */
    private val calls = mutableListOf<String>()

    /** 已落地副本集合（"path|name"）：insert 成功即登记、findCopy 据此命中——模拟真实 MediaStore 现状。 */
    private val landed = mutableSetOf<String>()

    /** insertCopy 结果定制旋钮（默认成功落地）：ENOSPC 用例覆写为满盘异常。 */
    private var insertResult: (DeviceSource, String) -> Result<Uri> = { _, _ ->
        Result.success(Uri.parse("content://media/external/images/media/${insertCalls.size}"))
    }

    private fun worker(
        activeId: Long? = 1L,
        serverId: Long = 1L,
        ensure: suspend (Long, Long) -> Result<File>,
    ): DeviceExportWorker =
        TestListenableWorkerBuilder<DeviceExportWorker>(context)
            .setInputData(workDataOf(
                DeviceExportWorker.KEY_SERVER_ID to serverId,
                DeviceExportWorker.KEY_IMAGE_IDS to longArrayOf(1L, 2L, 3L),
                DeviceExportWorker.KEY_TARGET_PATH to "Pictures/Yande/",
            ))
            .setWorkerFactory(object : WorkerFactory() {
                override fun createWorker(c: Context, name: String, p: WorkerParameters): ListenableWorker =
                    DeviceExportWorker(
                        c, p,
                        ensureOriginal = ensure,
                        insertCopy = { source, path ->
                            insertCalls += source to path
                            val name = (source as DeviceSource.LocalFile).displayName
                            calls += "insert:$name"
                            insertResult(source, path).onSuccess { landed += "$path|$name" }
                        },
                        findCopy = { path, name ->
                            findCopyCalls += path to name
                            calls += "find:$name"
                            if ("$path|$name" in landed) Uri.parse("content://media/external/images/media/999") else null
                        },
                        activeServerId = { activeId },
                        notifier = noopNotifier,
                    )
            })
            .build() as DeviceExportWorker

    private fun failedCountOf(result: ListenableWorker.Result): Int {
        assertTrue("应为 Success：$result", result is ListenableWorker.Result.Success)
        return result.outputData.getInt(DeviceExportWorker.KEY_FAILED_COUNT, -1)
    }

    @Test
    fun `全成功——逐张先查重后 insertCopy，失败计数 0`() = runTest {
        val ensured = mutableMapOf<Long, File>()
        val w = worker(ensure = { serverId, imageId ->
            assertEquals("ensure 应收到 inputData 的 serverId", 1L, serverId)
            Result.success(File("mirror/s1/i$imageId/img-$imageId.jpg").also { ensured[imageId] = it })
        })

        assertEquals("全成功失败计数应为 0", 0, failedCountOf(w.doWork()))

        assertEquals("三张应各查重一次（insert 前置）", 3, findCopyCalls.size)
        assertEquals("三张应各 insertCopy 一次", 3, insertCalls.size)
        // 逐张严格「先查后插」交错序（加固轮 D3，防未来改成批查或先插后查）；
        // 文件名按本用例 ensure 实际返回（img-<id>.jpg），brief 示意的 1.jpg 系另一命名
        assertEquals(
            listOf(
                "find:img-1.jpg", "insert:img-1.jpg",
                "find:img-2.jpg", "insert:img-2.jpg",
                "find:img-3.jpg", "insert:img-3.jpg",
            ),
            calls,
        )
        insertCalls.forEachIndexed { i, (source, path) ->
            val imageId = (i + 1).toLong()   // 串行保持 inputData 顺序 1→2→3
            assertEquals("targetPath 应逐张透传", "Pictures/Yande/", path)
            val local = source as DeviceSource.LocalFile
            assertSame("LocalFile.file 必须是 ensure 返回的同一 File", ensured[imageId], local.file)
            assertEquals("displayName 取镜像文件名", "img-$imageId.jpg", local.displayName)
            assertEquals("mime 按实际文件扩展名映射", "image/jpeg", local.mime)
        }
    }

    @Test
    fun `单张 404——该张计失败继续，其余成功落地`() = runTest {
        val w = worker(ensure = { _, imageId ->
            if (imageId == 2L) Result.failure(ApiException("NOT_FOUND", "原图已删", 404))
            else Result.success(File("mirror/s1/i$imageId/$imageId.png"))
        })

        assertEquals("仅 404 那张计失败", 1, failedCountOf(w.doWork()))

        assertEquals("其余两张仍应落地", 2, insertCalls.size)
        assertEquals(
            "成功两张按入参顺序为 1、3 号",
            listOf("1.png", "3.png"),
            insertCalls.map { (it.first as DeviceSource.LocalFile).displayName },
        )
    }

    @Test
    fun `部分404失败——完成时发汇总通知（成功2失败1）`() = runTest {
        // spec §6.1「失败项汇总提示」（终审 Fix 1）：终态成功但有失败张 → notifyCompleted 恰一次，
        // 入参 = 成功数/失败数/目标路径——否则 404 跳过对用户完全静默
        val w = worker(ensure = { _, imageId ->
            if (imageId == 2L) Result.failure(ApiException("NOT_FOUND", "原图已删", 404))
            else Result.success(File("mirror/s1/i$imageId/$imageId.jpg"))
        })
        assertEquals("仅 404 那张计失败", 1, failedCountOf(w.doWork()))
        assertEquals(
            "部分失败终态应发一次汇总通知（成功 2、失败 1、目标路径透传）",
            listOf(Triple(2, 1, "Pictures/Yande/")),
            completedCalls,
        )
    }

    @Test
    fun `全成功——不发汇总通知`() = runTest {
        // 全成功保持静默：前台进度通知已展示到 total/total，再发汇总是噪音
        val w = worker(ensure = { _, imageId -> Result.success(File("mirror/s1/i$imageId/$imageId.jpg")) })
        assertEquals(0, failedCountOf(w.doWork()))
        assertTrue("全成功不应发汇总通知", completedCalls.isEmpty())
    }

    @Test
    fun `汇总通知_不同服务器id落不同通知位`() = runTest {
        // G4 加盐（v0.8.1 H7）：两台服务器相继部分失败导出，notifyCompleted 须各携本批 serverId——
        // id 加盐公式（SUMMARY - serverId % 64）在 Android 实现内，worker 层只验参数透传
        val ensure404At2: suspend (Long, Long) -> Result<File> = { serverId, imageId ->
            if (imageId == 2L) Result.failure(ApiException("NOT_FOUND", "原图已删", 404))
            else Result.success(File("mirror/s$serverId/i$imageId/img-$imageId.jpg"))
        }
        assertEquals(1, failedCountOf(worker(activeId = 1L, serverId = 1L, ensure = ensure404At2).doWork()))
        assertEquals(1, failedCountOf(worker(activeId = 7L, serverId = 7L, ensure = ensure404At2).doWork()))
        assertEquals("两批汇总各携本批 serverId", listOf(1L, 7L), completedServerIds)
    }

    @Test
    fun `网络瞬断（IOException）——先落完可落的张，收尾整批 retry 而非静默计失败`() = runTest {
        // 对照 MirrorSyncWorker retryable 口径：瞬时错误不与 404 同流——若计失败则整批
        // SUCCEEDED 后永不自愈；retry 后重跑经 findCopy 查重只补余量，不重复照片
        val w = worker(ensure = { _, imageId ->
            if (imageId == 2L) Result.failure(IOException("连接重置"))
            else Result.success(File("mirror/s1/i$imageId/$imageId.jpg"))
        })
        assertEquals(ListenableWorker.Result.retry(), w.doWork())
        assertEquals(
            "瞬断只影响该张，前后成功张本轮照常落地",
            listOf("1.jpg", "3.jpg"),
            insertCalls.map { (it.first as DeviceSource.LocalFile).displayName },
        )
    }

    @Test
    fun `ensure 磁盘不足——整批 retry（退避后续跑）`() = runTest {
        val w = worker(ensure = { _, _ -> Result.failure(ImageMirrorStore.DiskFullException()) })
        assertEquals(ListenableWorker.Result.retry(), w.doWork())
        assertEquals("磁盘满不应有任何 insertCopy", 0, insertCalls.size)
    }

    @Test
    fun `已成功前缀后磁盘满——retry 重跑经查重跳过已落地，不产生重复照片`() = runTest {
        // 第一轮：第 1 张成功落地，第 2 张磁盘满 → retry（worker 无断点，重跑从头走）
        val run1 = worker(ensure = { _, imageId ->
            if (imageId == 1L) Result.success(File("mirror/s1/i$imageId/img-$imageId.jpg"))
            else Result.failure(ImageMirrorStore.DiskFullException())
        })
        assertEquals(ListenableWorker.Result.retry(), run1.doWork())
        assertEquals("第一轮仅第 1 张落地", 1, insertCalls.size)

        // 第二轮（退避后重跑，磁盘已清出；landed 跨实例存活模拟 MediaStore 持久现状）：
        // findCopy 命中第 1 张已落地 → 跳过计成功，不重复 insert
        val run2 = worker(ensure = { _, imageId ->
            Result.success(File("mirror/s1/i$imageId/img-$imageId.jpg"))
        })
        assertEquals("重跑走完计 0 失败（查重跳过计成功）", 0, failedCountOf(run2.doWork()))
        assertEquals(
            "两轮合计每张恰 insert 一次，无 \"img-1 (1).jpg\" 式重复照片",
            listOf("img-1.jpg", "img-2.jpg", "img-3.jpg"),
            insertCalls.map { (it.first as DeviceSource.LocalFile).displayName },
        )
    }

    @Test
    fun `insert 侧 ENOSPC——识别为磁盘满整批 retry，而非计普通失败`() = runTest {
        // 全批 ensure 命中镜像缓存 + 设备真满：ensure 的 500MB 前置检查被绕过，满盘首现于
        // MediaStore 写流——IOException 的 cause 链上是 ErrnoException(ENOSPC)
        insertResult = { _, _ ->
            Result.failure(IOException("write failed", ErrnoException("write", OsConstants.ENOSPC)))
        }
        val w = worker(ensure = { _, imageId -> Result.success(File("mirror/s1/i$imageId/$imageId.jpg")) })
        assertEquals(ListenableWorker.Result.retry(), w.doWork())
        assertEquals("撞上满盘立即 retry，不再逐张空转", 1, insertCalls.size)
    }

    @Test
    fun `陈旧任务（已切服）——直接 success 丢弃，不动 ensure 与 insertCopy`() = runTest {
        var ensureCalled = false
        val w = worker(activeId = 999L, ensure = { _, _ ->
            ensureCalled = true
            Result.success(File("x"))
        })
        assertEquals(ListenableWorker.Result.success(), w.doWork())
        assertFalse("陈旧任务不应触发 ensure", ensureCalled)
        assertEquals("陈旧任务不应有任何 insertCopy", 0, insertCalls.size)
    }
}
