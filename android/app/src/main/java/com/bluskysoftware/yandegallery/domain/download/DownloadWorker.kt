package com.bluskysoftware.yandegallery.domain.download

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.api.DesktopApi
import com.bluskysoftware.yandegallery.data.db.DownloadDao
import com.bluskysoftware.yandegallery.data.db.DownloadEntity
import com.bluskysoftware.yandegallery.data.media.MediaStoreGateway
import kotlinx.coroutines.CancellationException

/**
 * 原图下载 worker：流式 GET /api/v1/images/{id}/file → 校验 Content-Length → 写入系统相册 → 落库。
 *
 * deps 经构造注入（[AppWorkerFactory] 从 AppGraph 提供真实实例，无 Hilt）：apiProvider 复用带
 * Bearer 的 okHttp（含错误映射拦截器）、gateway 写系统相册、downloadDao 记录、onNotFound 触发对账。
 * 前台进度通知（M4-D8）：[notifier] 建通道并产出 [androidx.work.ForegroundInfo]，doWork 拿到 body 后
 * setForeground 一次、拷贝循环内经 [shouldUpdateNotification] 节流（≥1s 或 ≥5%）刷新；setForeground
 * 全程 runCatching 包裹——33+ 未授权/31+ 后台 FGS 限制抛异常时优雅降级纯后台（下载不崩不阻），
 * 唯 CancellationException 向上重抛（不吞取消）。UI 仍经 WorkInfo/setProgress 观察状态。
 */
class DownloadWorker(
    context: Context,
    params: WorkerParameters,
    private val apiProvider: suspend () -> DesktopApi?,
    private val gateway: MediaStoreGateway,
    private val downloadDao: DownloadDao,
    private val onNotFound: () -> Unit,
    private val now: () -> String,
    private val activeServerId: suspend () -> Long?,
    private val notifier: DownloadNotifier,
    private val timeMs: () -> Long = { System.currentTimeMillis() },
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val serverId = inputData.getLong(KEY_SERVER_ID, -1L)
        val imageId = inputData.getLong(KEY_IMAGE_ID, -1L)
        val filename = inputData.getString(KEY_FILENAME) ?: "$imageId"
        val mime = inputData.getString(KEY_MIME) ?: "image/jpeg"
        val api = apiProvider() ?: return Result.retry()

        // graph.okHttp 的错误映射拦截器对非 2xx **先抛 ApiException**（Response 永远拿不到 404）——
        // 故必须 catch ApiException 分支，不能查 response.code()（那是死代码，且 404 会被无限重试）。
        val response = try {
            api.downloadOriginal(imageId)
        } catch (e: ApiException) {
            if (e.httpStatus == 404) {
                onNotFound(); return Result.failure()  // 原图已删，终止+触发对账
            }
            return Result.retry()                       // 其它 HTTP 错误可重试
        } catch (e: CancellationException) {
            throw e   // 取消不吞：向上重抛，WorkManager 按取消语义处理（不误判成 retry）
        } catch (e: Exception) {
            return Result.retry()
        }
        val body = response.body() ?: return Result.retry()

        // body.use：@Streaming 的 ResponseBody 持有底层 OkHttp 连接直到 close——必须保证**所有**
        // 路径都关闭，包括 createPending/openOutput 返回 null 的早退（use 为 inline，非局部 return
        // 也会走 close），否则每次失败泄漏一条连接。
        return body.use {
            val expected = body.contentLength()   // Content-Length（-1 表示未知）

            // 前台通知（D8）：建通道并升前台一次。runCatching 优雅降级——33+ 未授权/31+ 后台 FGS 限制
            // 抛异常时纯后台续跑（下载不崩），唯取消向上重抛（不吞 CancellationException）。
            runCatching {
                notifier.ensureChannel()
                setForeground(notifier.foregroundInfo(imageId, filename, 0, expected))
            }.onFailure { if (it is CancellationException) throw it }

            // 系统相册写入失败（权限/空间，通常非瞬态）→ Result.failure()（spec §8「明确报错，不静默」），
            // UI 层观察 WorkInfo FAILED 弹「保存到系统相册失败」（Task 9 downloadState/Task 11/13 消费）。
            val uri = gateway.createPending(filename, mime) ?: return Result.failure()
            var written = 0L
            var lastNotifyMs = 0L   // 通知节流游标（见 shouldUpdateNotification）
            var lastPct = -1
            try {
                gateway.openOutput(uri).use { out ->
                    if (out == null) { gateway.discard(uri); return Result.failure() }
                    body.byteStream().use { input ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf); if (n < 0) break
                            out.write(buf, 0, n); written += n
                            setProgress(workDataOf(KEY_PROGRESS to written))
                            // 通知节流：绝不每 64KB 调一次 setForeground（会刷爆系统通知服务）。
                            if (shouldUpdateNotification(lastNotifyMs, timeMs(), lastPct, pctOf(written, expected))) {
                                lastNotifyMs = timeMs()
                                lastPct = pctOf(written, expected)
                                runCatching {
                                    setForeground(notifier.foregroundInfo(imageId, filename, written, expected))
                                }.onFailure { if (it is CancellationException) throw it }
                            }
                        }
                    }
                }
            } catch (e: CancellationException) {
                gateway.discard(uri); throw e   // 取消不吞：先清理半成品条目再重抛，不留 pending 行
            } catch (e: Exception) {
                gateway.discard(uri); return Result.retry()
            }

            if (expected >= 0 && written != expected) {   // Content-Length 完整性校验（spec §6.4）
                gateway.discard(uri); return Result.retry()
            }
            // 落行前校验（D10 竞态根治）：下载期间用户切服 → 本次产物属旧服务器域，宁可丢弃也不落错行。
            // 校验在 finalize 之前——半成品直接 discard，不让它在系统相册转正。
            if (activeServerId() != serverId) {
                gateway.discard(uri)
                return@use Result.failure()
            }
            gateway.finalize(uri)
            downloadDao.upsert(DownloadEntity(serverId, imageId, uri.toString(), now()))
            Result.success()
        }
    }

    companion object {
        const val KEY_SERVER_ID = "serverId"
        const val KEY_IMAGE_ID = "imageId"
        const val KEY_FILENAME = "filename"
        const val KEY_MIME = "mime"
        const val KEY_PROGRESS = "progress"
    }
}
