package com.bluskysoftware.yandegallery.domain.export

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo

/** worker 侧可注入的导出通知抽象（对照 DownloadNotifier 理由）：测试注 fake，用例不碰真通知。 */
interface DeviceExportNotifier {
    fun ensureChannel()
    fun foregroundInfo(done: Int, total: Int, targetPath: String): ForegroundInfo

    /** 完成失败汇总（spec §6.1「失败项汇总提示」）：worker 仅在终态成功且 failed>0 时调用。 */
    fun notifyCompleted(ok: Int, failed: Int, targetPath: String)
}

/**
 * 聚合进度通知「正在复制到手机相册 x/y」：单通知确定进度（对照 AndroidMirrorSyncNotifier 形态）；
 * 完成失败汇总走独立 id 的常规通知（[notifyCompleted]，非前台，worker 结束后驻留可事后查看）。
 */
class AndroidDeviceExportNotifier(private val context: Context) : DeviceExportNotifier {

    override fun ensureChannel() {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "复制到手机相册", NotificationManager.IMPORTANCE_LOW),
        )   // IMPORTANCE_LOW：不响铃不悬浮；createNotificationChannel 幂等
    }

    override fun foregroundInfo(done: Int, total: Int, targetPath: String): ForegroundInfo {
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
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    override fun notifyCompleted(ok: Int, failed: Int, targetPath: String) {
        // 沿用 device_export 渠道（IMPORTANCE_LOW 不响铃）；非前台常规通知，worker 结束后仍驻留，
        // 用户事后可见「y 张失败」——补上 KEY_FAILED_COUNT 无消费者的静默缺口（终审 Fix 1）
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("复制到手机相册完成")
            .setContentText("成功 $ok 张，$failed 张失败")
            .setSubText(targetPath.trimEnd('/'))
            .setAutoCancel(true)
            .build()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(SUMMARY_NOTIFICATION_ID, notification)
    }

    companion object {
        const val CHANNEL_ID = "device_export"
        // 固定负值：Long.hashCode() 对本工程实际范围的非负 imageId 恒产出非负 Int，负值常量
        // 不可能与逐图下载通知 id 撞车（对照 MirrorSyncNotifier.NOTIFICATION_ID 的论证与教训）。
        const val NOTIFICATION_ID = -0x4558
        // 汇总通知独立 id（同为负值防撞 imageId.hashCode()）：与进度 id 错开，避免完成汇总
        // 被后续批次的前台进度通知顶掉。
        const val SUMMARY_NOTIFICATION_ID = -0x4559
    }
}
