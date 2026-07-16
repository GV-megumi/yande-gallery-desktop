package com.bluskysoftware.yandegallery.domain.export

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo

/** worker 侧可注入的导出通知抽象（对照 DownloadNotifier 理由）：测试注 no-op fake，用例不碰真通知。 */
interface DeviceExportNotifier {
    fun ensureChannel()
    fun foregroundInfo(done: Int, total: Int, targetPath: String): ForegroundInfo
}

/** 聚合进度通知「正在复制到手机相册 x/y」：单通知确定进度（对照 AndroidMirrorSyncNotifier 形态）。 */
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

    companion object {
        const val CHANNEL_ID = "device_export"
        // 固定负值：Long.hashCode() 对本工程实际范围的非负 imageId 恒产出非负 Int，负值常量
        // 不可能与逐图下载通知 id 撞车（对照 MirrorSyncNotifier.NOTIFICATION_ID 的论证与教训）。
        const val NOTIFICATION_ID = -0x4558
    }
}
