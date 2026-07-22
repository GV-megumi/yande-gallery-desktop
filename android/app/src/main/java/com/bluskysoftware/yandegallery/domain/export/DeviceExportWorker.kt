package com.bluskysoftware.yandegallery.domain.export

import android.content.Context
import android.net.Uri
import android.system.ErrnoException
import android.system.OsConstants
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.api.ApiException
import com.bluskysoftware.yandegallery.data.device.DeviceSource
import com.bluskysoftware.yandegallery.data.device.mimeOf
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore
import com.bluskysoftware.yandegallery.domain.download.shouldUpdateNotification
import kotlinx.coroutines.CancellationException
import java.io.File

/**
 * 桌面→手机导出 worker（本机相册 spec §6.1）：逐张（串行）`ensureOriginal` 把原图收进镜像
 * （同 D7 语义：导出即升原图档，镜像层落盘/校验/删 HQ 全在 ImageMirrorStore.ensure 内）→
 * `findCopy` 查重 → 未落地才 `insertCopy(LocalFile)` 复制落 MediaStore 目标相册。
 *
 * 查重前置（review Critical #1）：worker 无断点，retry/约束中断/进程被杀后 WorkManager 都从头
 * 重跑，而 insertCopy 刻意不幂等（同名 MediaStore 自动改名 "xx (1).jpg"）——不查重则每轮重跑
 * 给已成功前缀追加一套真实重复照片；已落地张跳过计成功，重跑只补余量。
 *
 * 失败分流（对照 DownloadWorker/MirrorSyncWorker 口径）：
 * - ensure 404（原图已在桌面删除）/ IllegalStateException（元数据缺失、下载中途切服）——重试
 *   无法自愈的终态 → 该张计失败继续，末尾 outputData [KEY_FAILED_COUNT] 汇总 + failed>0 时
 *   发完成汇总通知（spec §6.1「失败项汇总提示」，终审 Fix 1）；
 * - ensure 其余失败（断网/连接重置/桌面离线等瞬时错误）→ 计 retryable 继续，先把能落的张落完，
 *   收尾整批 [Result.retry]（对照 MirrorSyncWorker retryable 口径）——不与 404 同流静默计失败，
 *   否则整批 SUCCEEDED 后瞬时错误永不自愈；
 * - 磁盘不足（ensure 前置检查，或 insert 写流 ENOSPC——全批 ensure 命中缓存时前置检查被绕过，
 *   满盘首现于 MediaStore 写流）→ 立即 [Result.retry]，退避等清出空间；
 * - insert 其余失败（本地 MediaStore 错误）→ 该张计失败继续；
 * - 陈旧任务（activeServerId != 入参 serverId，切服后残留队列）→ [Result.success] 直接丢弃，
 *   每张开工前复查——已落地的照片是用户手机相册的真实文件，保留不回滚。
 */
class DeviceExportWorker(
    context: Context,
    params: WorkerParameters,
    // 显式 kotlin.Result：本类继承 CoroutineWorker，裸 Result 在类作用域内解析为继承来的
    // androidx.work.ListenableWorker.Result（非泛型），必须全限定名避免歧义（对照 DownloadWorker 用法）。
    // ORIGINAL 档位在 AppWorkerFactory 柯里化时烘焙，worker 不感知 tier。
    private val ensureOriginal: suspend (serverId: Long, imageId: Long) -> kotlin.Result<File>,
    // 生产接 graph.deviceMediaGateway::insertCopy / ::findCopy（方法引用），测试注 fake 记录入参
    private val insertCopy: suspend (source: DeviceSource, targetRelativePath: String) -> kotlin.Result<Uri>,
    private val findCopy: suspend (targetRelativePath: String, displayName: String) -> Uri?,
    // 陈旧任务判定（对齐 DownloadWorker/MirrorSyncWorker 先例）：切服后残留的旧队列项不应再动手
    private val activeServerId: suspend () -> Long?,
    private val notifier: DeviceExportNotifier,
    private val timeMs: () -> Long = { System.currentTimeMillis() },
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val serverId = inputData.getLong(KEY_SERVER_ID, -1L)
        val imageIds = inputData.getLongArray(KEY_IMAGE_IDS)
        val targetPath = inputData.getString(KEY_TARGET_PATH)
        if (serverId <= 0 || imageIds == null || targetPath.isNullOrBlank()) return Result.failure()
        if (activeServerId() != serverId) return Result.success()

        val total = imageIds.size
        // 前台通知：33+ 未授权/31+ 后台 FGS 限制 runCatching 降级纯后台，唯 CancellationException
        // 重抛（不吞取消，仓内惯例）；确定进度 0/total 起步
        runCatching {
            notifier.ensureChannel()
            setForeground(notifier.foregroundInfo(0, total, targetPath))
        }.onFailure { if (it is CancellationException) throw it }

        var done = 0          // 已处理张数（含失败）——进度展示口径
        var failed = 0        // 终态失败（404/元数据缺失/insert 本地错误）——重试无法自愈
        var retryable = 0     // 瞬时失败（网络等）——收尾整批 retry，重跑经查重只补余量
        var lastNotifyMs = 0L
        var lastPct = -1
        for (imageId in imageIds) {
            // 每张开工前复查切服：长批次中途切服即丢弃剩余（已插入的照片保留），
            // 不留给 ensure 内部 IllegalStateException 去逐张膨胀失败计数
            if (activeServerId() != serverId) return Result.success()

            val ensured = ensureOriginal(serverId, imageId)
            when {
                ensured.isSuccess -> {
                    val file = ensured.getOrThrow()
                    // 查重：目标目录已有同名副本（上轮重跑前已插入）→ 跳过计成功
                    if (findCopy(targetPath, file.name) == null) {
                        // mimeOf 按实际文件扩展名（镜像原图档保留源扩展名，不做转码改名）
                        val source = DeviceSource.LocalFile(file, file.name, mimeOf(file.extension))
                        val inserted = insertCopy(source, targetPath)
                        when {
                            inserted.isSuccess -> Unit
                            inserted.exceptionOrNull().isDiskFull() -> return Result.retry()
                            else -> failed++
                        }
                    }
                }
                ensured.exceptionOrNull() is ImageMirrorStore.DiskFullException ->
                    // 磁盘满是整批性障碍：立即退避重试（已入镜像的张重跑时 ensure 直接命中缓存）
                    return Result.retry()
                (ensured.exceptionOrNull() as? ApiException)?.httpStatus == 404 -> failed++
                ensured.exceptionOrNull() is IllegalStateException -> failed++
                else -> retryable++
            }
            done++
            val pct = if (total > 0) (done * 100) / total else -1
            // 节流复用下载域 shouldUpdateNotification（≥1s 或进度跳 ≥5%）；setForeground 可能抛
            // 非取消异常（33+ 未授权通知），runCatching 降级避免异常中断剩余批次
            if (shouldUpdateNotification(lastNotifyMs, timeMs(), lastPct, pct)) {
                lastNotifyMs = timeMs()
                lastPct = pct
                runCatching { setForeground(notifier.foregroundInfo(done, total, targetPath)) }
                    .onFailure { if (it is CancellationException) throw it }
            }
        }
        // 有瞬时失败 → 整批 retry 自愈（重跑经 findCopy 查重不重复）；否则终态成功带失败汇总
        if (retryable > 0) return Result.retry()
        // 部分失败终态（404/insert 本地错误）→ 发汇总通知（spec §6.1「失败项汇总提示」，终审 Fix 1）：
        // 全成功不发（前台进度通知已展示到 total/total）；retry/切服丢弃路径不发（非终态/非本批）。
        // runCatching 同 setForeground 口径：33+ 未授权等通知失败不反噬工作结果，唯取消重抛。
        if (failed > 0) {
            // serverId 透传（v0.8.1 H7）：实现层按服务器加盐通知 id，多服务器汇总互不顶替
            runCatching { notifier.notifyCompleted(serverId, done - failed, failed, targetPath) }
                .onFailure { if (it is CancellationException) throw it }
        }
        return Result.success(workDataOf(KEY_FAILED_COUNT to failed))
    }

    companion object {
        const val KEY_SERVER_ID = "serverId"
        const val KEY_IMAGE_IDS = "imageIds"
        const val KEY_TARGET_PATH = "targetPath"
        const val KEY_FAILED_COUNT = "failedCount"

        /**
         * 满盘判读（insert 侧）：MediaStore 输出流写满盘抛出的 IOException 在 cause 链上包
         * ErrnoException(ENOSPC)（镜像层 DiskFullException 一并识别，防未来网关实现转包）。
         * 深度上限防御异常自环；ENOSPC 之外的 errno 不揽——其余本地错误按普通失败计。
         */
        internal fun Throwable?.isDiskFull(): Boolean {
            var t = this
            var depth = 0
            while (t != null && depth++ < 10) {
                if (t is ImageMirrorStore.DiskFullException) return true
                if (t is ErrnoException && t.errno == OsConstants.ENOSPC) return true
                t = t.cause
            }
            return false
        }
    }
}
