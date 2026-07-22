package com.bluskysoftware.yandegallery.domain.export

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo

/**
 * worker 侧可注入的「复制到手机相册」通知抽象（对照 DownloadNotifier 理由）：测试注 fake，用例不碰
 * 真通知。双域共用（channel 文案本就是通用「复制到手机相册」）：
 * - 桌面→手机导出（DeviceExportWorker）：[foregroundInfo]/[notifyCompleted]（后者按 serverId 加盐）；
 * - 手机→手机复制（DeviceCopyWorker，v0.8.1 B 类）：[copyForegroundInfo]/[notifyCopyCompleted]
 *   （无 serverId 维度，固定通知 id）。两域进度/汇总形态一致，仅通知 id 各占独立常量防互相顶替。
 */
interface DeviceExportNotifier {
    fun ensureChannel()
    fun foregroundInfo(done: Int, total: Int, targetPath: String): ForegroundInfo

    /**
     * 导出完成失败汇总（spec §6.1「失败项汇总提示」）：worker 仅在终态成功且 failed>0 时调用。
     * [serverId] 供实现层给通知 id 加盐（v0.8.1 H7）——多服务器相继导出各占独立通知位，
     * 后一台的汇总不再顶掉前一台。
     */
    fun notifyCompleted(serverId: Long, ok: Int, failed: Int, targetPath: String)

    /**
     * 复制进度前台通知（v0.8.1 B 类）：与 [foregroundInfo] 同形态（复用 device_export channel），
     * 仅通知 id 用复制域独立常量（-0x4650）与导出进度（-0x4558）错开，避免复制/导出并发时互相顶替。
     */
    fun copyForegroundInfo(done: Int, total: Int, targetPath: String): ForegroundInfo

    /**
     * 复制完成失败汇总（v0.8.1 B 类）：worker 仅在终态且 failed>0 时调用。复制是纯本机操作无 serverId
     * 维度，故不加盐——固定汇总 id（-0x4651）；多批复制（同一逻辑操作被 EXPORT_BATCH 切成的多批）
     * 相继完成时后者顶替前者的汇总，语义上正确（同一次复制操作只需一条最终汇总）。
     */
    fun notifyCopyCompleted(ok: Int, failed: Int, targetPath: String)
}

/**
 * 聚合进度通知「正在复制到手机相册 x/y」：单通知确定进度（对照 AndroidMirrorSyncNotifier 形态）；
 * 完成失败汇总走独立 id 的常规通知（非前台，worker 结束后驻留可事后查看）。导出/复制两域共用同一
 * device_export channel 与同款进度/汇总形态，仅通知 id 分域独立（见各常量）。
 */
class AndroidDeviceExportNotifier(private val context: Context) : DeviceExportNotifier {

    override fun ensureChannel() {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "复制到手机相册", NotificationManager.IMPORTANCE_LOW),
        )   // IMPORTANCE_LOW：不响铃不悬浮；createNotificationChannel 幂等
    }

    override fun foregroundInfo(done: Int, total: Int, targetPath: String): ForegroundInfo =
        progressForegroundInfo(NOTIFICATION_ID, done, total, targetPath)

    override fun copyForegroundInfo(done: Int, total: Int, targetPath: String): ForegroundInfo =
        progressForegroundInfo(COPY_NOTIFICATION_ID, done, total, targetPath)

    /** 进度前台通知构造（导出/复制共用，仅通知 [id] 分域）：确定进度 done/total，FGS dataSync 类型。 */
    private fun progressForegroundInfo(id: Int, done: Int, total: Int, targetPath: String): ForegroundInfo {
        val pct = if (total > 0) (done * 100) / total else -1
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("正在复制到手机相册")
            .setContentText("$done / $total")
            .setSubText(targetPath.trimEnd('/'))   // 目标相册路径（如 Pictures/Yande）
            .setOngoing(true)
            .apply { if (pct >= 0) setProgress(100, pct, false) else setProgress(0, 0, true) }
            .build()
        return if (Build.VERSION.SDK_INT >= 29) {
            // 29+ 必须带 FGS 类型；31+ 还依赖 manifest 已给 WorkManager 的 SystemForegroundService
            // 合并 foregroundServiceType="dataSync"（BUG-01 先例，随 DownloadWorker 已配好）
            ForegroundInfo(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(id, notification)
        }
    }

    override fun notifyCompleted(serverId: Long, ok: Int, failed: Int, targetPath: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // 汇总 id 按 serverId 加盐（v0.8.1 H7）：多服务器相继导出各占独立通知位，后一台不顶前一台。
        // worker 已把 serverId <= 0 挡在 doWork 入口（Result.failure），此处 serverId ≥ 1 恒成立，
        // `% 64` 落 [0, 63]、id 落 [-0x4559-63, -0x4559] 全负——不撞进度 id（-0x4558 在区间上方）、
        // 不撞逐图下载 id（非负）、不撞 MirrorSync（-0x4D53 在区间下方）、不撞复制 id（-0x4650/-0x4651 在区间下方）。
        nm.notify(SUMMARY_NOTIFICATION_ID - (serverId % 64).toInt(), summaryNotification(ok, failed, targetPath))
    }

    override fun notifyCopyCompleted(ok: Int, failed: Int, targetPath: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // 复制无 serverId 维度，固定 id（-0x4651）不加盐——同一次复制操作的多批只需一条最终汇总。
        nm.notify(COPY_SUMMARY_NOTIFICATION_ID, summaryNotification(ok, failed, targetPath))
    }

    /** 完成失败汇总常规通知构造（导出/复制共用，仅通知 id 由调用方分域）：非前台，worker 结束后驻留。 */
    private fun summaryNotification(ok: Int, failed: Int, targetPath: String): Notification =
        NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("复制到手机相册完成")
            .setContentText("成功 $ok 张，$failed 张失败")
            .setSubText(targetPath.trimEnd('/'))
            .setAutoCancel(true)
            .build()

    companion object {
        const val CHANNEL_ID = "device_export"
        // 固定负值：Long.hashCode() 对本工程实际范围的非负 imageId 恒产出非负 Int，负值常量
        // 不可能与逐图下载通知 id 撞车（对照 MirrorSyncNotifier.NOTIFICATION_ID 的论证与教训）。
        const val NOTIFICATION_ID = -0x4558
        // 导出汇总通知独立 id（同为负值防撞 imageId.hashCode()）：与进度 id 错开，避免完成汇总
        // 被后续批次的前台进度通知顶掉。加盐后实占 [-0x4559-63, -0x4559]。
        const val SUMMARY_NOTIFICATION_ID = -0x4559
        // 复制域通知 id（v0.8.1 B 类，全景见 plan 通知 id 表）：进度 -0x4650 / 汇总 -0x4651。二者均落
        // 在导出加盐区间（[-0x4598,-0x4559]）与 MirrorSync（-0x4D53）之间的空档，互不撞车。
        const val COPY_NOTIFICATION_ID = -0x4650
        const val COPY_SUMMARY_NOTIFICATION_ID = -0x4651
    }
}
