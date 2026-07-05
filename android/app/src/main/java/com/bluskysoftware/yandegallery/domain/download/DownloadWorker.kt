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

/**
 * 原图下载 worker：流式 GET /api/v1/images/{id}/file → 校验 Content-Length → 写入系统相册 → 落库。
 *
 * deps 经构造注入（[AppWorkerFactory] 从 AppGraph 提供真实实例，无 Hilt）：apiProvider 复用带
 * Bearer 的 okHttp（含错误映射拦截器）、gateway 写系统相册、downloadDao 记录、onNotFound 触发对账。
 * 前台进度通知（setForeground）后置到 M4；此处仅 setProgress，UI 经 WorkInfo 观察状态。
 */
class DownloadWorker(
    context: Context,
    params: WorkerParameters,
    private val apiProvider: suspend () -> DesktopApi?,
    private val gateway: MediaStoreGateway,
    private val downloadDao: DownloadDao,
    private val onNotFound: () -> Unit,
    private val now: () -> String,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
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
        } catch (e: Exception) {
            return Result.retry()
        }
        val body = response.body() ?: return Result.retry()
        val expected = body.contentLength()   // Content-Length（-1 表示未知）

        // 系统相册写入失败（权限/空间，通常非瞬态）→ Result.failure()（spec §8「明确报错，不静默」），
        // UI 层观察 WorkInfo FAILED 弹「保存到系统相册失败」（Task 9 downloadState/Task 11/13 消费）。
        val uri = gateway.createPending(filename, mime) ?: return Result.failure()
        var written = 0L
        try {
            gateway.openOutput(uri).use { out ->
                if (out == null) { gateway.discard(uri); return Result.failure() }
                body.byteStream().use { input ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf); if (n < 0) break
                        out.write(buf, 0, n); written += n
                        setProgress(workDataOf(KEY_PROGRESS to written))
                    }
                }
            }
        } catch (e: Exception) {
            gateway.discard(uri); return Result.retry()
        }

        if (expected >= 0 && written != expected) {   // Content-Length 完整性校验（spec §6.4）
            gateway.discard(uri); return Result.retry()
        }
        gateway.finalize(uri)
        downloadDao.upsert(DownloadEntity(imageId, uri.toString(), now()))
        return Result.success()
    }

    companion object {
        const val KEY_IMAGE_ID = "imageId"
        const val KEY_FILENAME = "filename"
        const val KEY_MIME = "mime"
        const val KEY_PROGRESS = "progress"
    }
}
