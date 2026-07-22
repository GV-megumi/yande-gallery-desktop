package com.bluskysoftware.yandegallery.domain.copy

import android.content.Context
import android.net.Uri
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.bluskysoftware.yandegallery.data.device.DeviceMedia
import com.bluskysoftware.yandegallery.data.device.DeviceSource
import com.bluskysoftware.yandegallery.domain.download.shouldUpdateNotification
import com.bluskysoftware.yandegallery.domain.export.DeviceExportNotifier
import kotlinx.coroutines.CancellationException

/**
 * 手机→手机批量复制 worker（本机相册 spec §5.3，v0.8.1 B 类）：把多选批量复制从 composition scope
 * 里的同步逐张 insert 挪进 WorkManager——离屏/进程被杀后不再随 scope 消亡，WorkManager 续跑。
 * 镜像 DeviceExportWorker 形态但去掉半程 ensure（源已在本机，无需收原图入镜像）与切服检查
 * （纯本机操作无 serverId 维度）。
 *
 * doWork：`mediaByIds` 批量还原选中 id → 逐张（保入参序）`findCopy` 查重命中跳过计成功 → 未落地才
 * `insertCopy(DeviceSource.Media, path)`；进度经 notifier 节流；尾部成功 ≥1 张触发收编、failed>0 发汇总。
 *
 * 查重前置（同 DeviceExportWorker review Critical #1）：worker 无断点，retry/约束中断/进程被杀后
 * WorkManager 都从头重跑，而 insertCopy 刻意不幂等（同名 MediaStore 自动改名 "xx (1).jpg"）——不查重
 * 则每轮重跑给已成功前缀追加一套真实重复照片；已落地张跳过计成功，重跑只补余量（无内存断点，纯
 * MediaStore 再查）。
 *
 * 失败分流（本机 IO 无瞬时网络错，故无 DeviceExportWorker 的 retryable 桶）：
 * - 源已删（`mediaByIds` 还原时该 id 查无）→ 该张计失败继续，末尾 [KEY_FAILED_COUNT] 汇总；
 * - insert 写流 ENOSPC（磁盘满，[isDiskFull] 识别 cause 链）→ 立即 [Result.retry]，退避等清出空间；
 * - insert 其余失败（本地 MediaStore 错误）→ 该张计失败继续；
 * - `findCopy` 返回 null（含 OEM ROM 拒绝该查询时网关 runCatching 吞成 null，T6）→ 视作「未落地」
 *   放行 insert——不把查重故障放大成整批失败（同导出侧口径）。
 */
class DeviceCopyWorker(
    context: Context,
    params: WorkerParameters,
    // 显式 kotlin.Result：本类继承 CoroutineWorker，裸 Result 在类作用域内解析为继承来的
    // androidx.work.ListenableWorker.Result（非泛型），必须全限定名避免歧义（对照 DeviceExportWorker）。
    // 生产接 graph.deviceMediaGateway::mediaByIds / ::insertCopy / ::findCopy（方法引用），测试注 fake。
    private val mediaByIds: suspend (List<Long>) -> List<DeviceMedia>,
    private val insertCopy: suspend (source: DeviceSource, targetRelativePath: String) -> kotlin.Result<Uri>,
    private val findCopy: suspend (targetRelativePath: String, displayName: String) -> Uri?,
    // 收编：worker 成功 ≥1 张时以 targetPath 回调——待落地占位与真实 bucket 的匹配/清除本体注在
    // AppWorkerFactory（读 prefsStore + pendingAlbumPath），worker 本身不依赖 prefs（保持可测纯净）。
    private val removePendingIfMatch: suspend (targetPath: String) -> Unit,
    private val notifier: DeviceExportNotifier,
    private val timeMs: () -> Long = { System.currentTimeMillis() },
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val mediaIds = inputData.getLongArray(KEY_MEDIA_IDS)
        val targetPath = inputData.getString(KEY_TARGET_PATH)
        if (mediaIds == null || targetPath.isNullOrBlank()) return Result.failure()

        // 批量还原选中行：查无的 id（源已删）不在 byId 里，逐张循环时计失败继续
        val byId = mediaByIds(mediaIds.toList()).associateBy { it.mediaId }

        val total = mediaIds.size
        // 前台通知：33+ 未授权/31+ 后台 FGS 限制 runCatching 降级纯后台，唯 CancellationException
        // 重抛（不吞取消，仓内惯例）；确定进度 0/total 起步
        runCatching {
            notifier.ensureChannel()
            setForeground(notifier.copyForegroundInfo(0, total, targetPath))
        }.onFailure { if (it is CancellationException) throw it }

        var ok = 0            // 成功落地（含查重命中跳过的已落地张）
        var done = 0          // 已处理张数（含失败）——进度展示口径
        var failed = 0        // 终态失败（源已删 / insert 本地错误）——重试无法自愈
        var lastNotifyMs = 0L
        var lastPct = -1
        for (id in mediaIds) {
            val media = byId[id]
            when {
                media == null -> failed++   // 源已删（mediaByIds 缺项）：计失败继续，不 retry
                // 查重：目标目录已有同名副本（上轮重跑前已插入）→ 跳过计成功
                findCopy(targetPath, media.displayName) != null -> ok++
                else -> {
                    val inserted = insertCopy(DeviceSource.Media(media), targetPath)
                    when {
                        inserted.isSuccess -> ok++
                        inserted.exceptionOrNull().isDiskFull() -> return Result.retry()
                        else -> failed++
                    }
                }
            }
            done++
            val pct = if (total > 0) (done * 100) / total else -1
            // 节流复用下载域 shouldUpdateNotification（≥1s 或进度跳 ≥5%）；setForeground 可能抛
            // 非取消异常（33+ 未授权通知），runCatching 降级避免异常中断剩余批次
            if (shouldUpdateNotification(lastNotifyMs, timeMs(), lastPct, pct)) {
                lastNotifyMs = timeMs()
                lastPct = pct
                runCatching { setForeground(notifier.copyForegroundInfo(done, total, targetPath)) }
                    .onFailure { if (it is CancellationException) throw it }
            }
        }
        // 收编（spec §5.5，从 DeviceAlbumDetailViewModel.copySelectedTo 迁入）：成功 ≥1 张且目标恰为
        // 某待落地占位路径时清占位记录——best-effort（收编本体抛不反噬已落地的真实文件；DeviceAlbumsViewModel
        // 下一轮相册查询仍会兜底收编，故这里的失败可静默）。全失败（ok=0）不调：占位没有任何文件落地。
        if (ok > 0) {
            runCatching { removePendingIfMatch(targetPath) }
                .onFailure { if (it is CancellationException) throw it }
        }
        // 部分/全部失败终态 → 发汇总通知（spec §5.3「失败项汇总提示」，对照导出侧终审 Fix 1）：
        // 全成功不发（前台进度通知已展示到 total/total）。runCatching 同 setForeground 口径：通知失败
        // 不反噬工作结果，唯取消重抛。复制无 serverId 维度，汇总走固定 id（不加盐，见 AndroidDeviceExportNotifier）。
        if (failed > 0) {
            runCatching { notifier.notifyCopyCompleted(ok, failed, targetPath) }
                .onFailure { if (it is CancellationException) throw it }
        }
        return Result.success(workDataOf(KEY_FAILED_COUNT to failed))
    }

    companion object {
        const val KEY_MEDIA_IDS = "mediaIds"
        const val KEY_TARGET_PATH = "targetPath"
        const val KEY_FAILED_COUNT = "failedCount"
    }
}
