package com.bluskysoftware.yandegallery.domain.export

import android.content.Context
import android.net.Uri
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

/**
 * DeviceExportWorker（桌面→手机导出，本机相册 spec §6.1）：worker 只做「逐张（串行）ensure 原图
 * → insertCopy 落 MediaStore + 失败计数分流」——ensure 本体（落盘/校验/删 HQ）归 ImageMirrorStoreTest，
 * insertCopy 本体（ContentValues/IS_PENDING）归 MediaStoreDeviceGatewayTest，此处依赖全 fake。
 * 装配对照 DownloadWorkerTest / DownloadE2ETest：TestListenableWorkerBuilder + 匿名 WorkerFactory。
 */
@RunWith(RobolectricTestRunner::class)
class DeviceExportWorkerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    /** no-op 通知 fake：worker 通知路径 runCatching 包裹，用例不碰真通知服务（对照 DownloadWorkerTest）。 */
    private val noopNotifier = object : DeviceExportNotifier {
        override fun ensureChannel() {}
        override fun foregroundInfo(done: Int, total: Int, targetPath: String) =
            throw IllegalStateException("测试不升前台")   // runCatching 降级路径
    }

    /** insertCopy 入参记录（source + targetRelativePath），按调用顺序追加（对照 FakeDeviceGateway 口径）。 */
    private val insertCalls = mutableListOf<Pair<DeviceSource, String>>()

    private fun worker(
        activeId: Long? = 1L,
        ensure: suspend (Long, Long) -> Result<File>,
    ): DeviceExportWorker =
        TestListenableWorkerBuilder<DeviceExportWorker>(context)
            .setInputData(workDataOf(
                DeviceExportWorker.KEY_SERVER_ID to 1L,
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
                            Result.success(Uri.parse("content://media/external/images/media/${insertCalls.size}"))
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
    fun `全成功——逐张 ensure 后 insertCopy，失败计数 0`() = runTest {
        val ensured = mutableMapOf<Long, File>()
        val w = worker(ensure = { serverId, imageId ->
            assertEquals("ensure 应收到 inputData 的 serverId", 1L, serverId)
            Result.success(File("mirror/s1/i$imageId/img-$imageId.jpg").also { ensured[imageId] = it })
        })

        assertEquals("全成功失败计数应为 0", 0, failedCountOf(w.doWork()))

        assertEquals("三张应各 insertCopy 一次", 3, insertCalls.size)
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
    fun `磁盘不足——整批 retry（退避后续跑）`() = runTest {
        val w = worker(ensure = { _, _ -> Result.failure(ImageMirrorStore.DiskFullException()) })
        assertEquals(ListenableWorker.Result.retry(), w.doWork())
        assertEquals("磁盘满不应有任何 insertCopy", 0, insertCalls.size)
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
