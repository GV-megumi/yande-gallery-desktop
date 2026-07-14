package com.bluskysoftware.yandegallery.domain.download

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo

/** worker 侧可注入的通知抽象（D8）：测试注 no-op fake，四条 IO 路径用例不碰真通知。 */
interface DownloadNotifier {
    fun ensureChannel()
    fun foregroundInfo(imageId: Long, filename: String, written: Long, total: Long): ForegroundInfo
}

/** 节流：≥1s 或进度跳 ≥5% 才更新（每 64KB 调 setForeground 会刷爆系统通知服务）。 */
fun shouldUpdateNotification(lastMs: Long, nowMs: Long, lastPct: Int, pct: Int): Boolean =
    nowMs - lastMs >= 1_000L || (pct in 0..100 && pct - lastPct >= 5)

/** written/total → 百分比；total 未知（≤0，Content-Length=-1）返回 -1（通知转 indeterminate）。 */
fun pctOf(written: Long, total: Long): Int = if (total > 0) ((written * 100) / total).toInt() else -1

class AndroidDownloadNotifier(private val context: Context) : DownloadNotifier {

    override fun ensureChannel() {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "原图下载", NotificationManager.IMPORTANCE_LOW),
        )   // IMPORTANCE_LOW：不响铃不悬浮；createNotificationChannel 幂等
    }

    override fun foregroundInfo(imageId: Long, filename: String, written: Long, total: Long): ForegroundInfo {
        val pct = pctOf(written, total)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("正在下载原图")
            .setContentText(filename)
            .setOngoing(true)
            .apply { if (pct >= 0) setProgress(100, pct, false) else setProgress(0, 0, true) }
            .build()
        val id = imageId.hashCode()   // 每图独立通知 id（与 Interfaces 约定一致）
        return if (Build.VERSION.SDK_INT >= 29) {
            // 29+ 必须带 FGS 类型。注意 31+ 还要求 manifest 给 WorkManager 的 SystemForegroundService
            // 元素合并 foregroundServiceType="dataSync"（仅声明权限不够，BUG-01 曾因此全档闪退）
            ForegroundInfo(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(id, notification)
        }
    }

    companion object {
        const val CHANNEL_ID = "download_progress"
    }
}

/** 镜像同步聚合进度通知（spec §3.4）：单通知「正在同步图片 x/y」；抽象注入同 DownloadNotifier 理由。 */
interface MirrorSyncNotifier {
    fun ensureChannel()
    fun foregroundInfo(done: Long, total: Long): ForegroundInfo
}

class AndroidMirrorSyncNotifier(private val context: Context) : MirrorSyncNotifier {

    override fun ensureChannel() {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "图片同步", NotificationManager.IMPORTANCE_LOW),
        )
    }

    override fun foregroundInfo(done: Long, total: Long): ForegroundInfo {
        val pct = if (total > 0) ((done * 100) / total).toInt() else -1
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("正在同步图片")
            .setContentText("$done / $total")
            .setOngoing(true)
            .apply { if (pct >= 0) setProgress(100, pct, false) else setProgress(0, 0, true) }
            .build()
        return if (Build.VERSION.SDK_INT >= 29) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        const val CHANNEL_ID = "mirror_sync"
        // 固定负值（而非原 0x4D53）：Long.hashCode() 对非负 imageId（本工程实际范围远小于 2^31）
        // 恒产出非负 Int，负值常量因此不可能与任何 imageId.hashCode() 撞车——原正值常量曾与
        // imageId=19795（即 0x4D53）真实相等，导致该图下载通知与镜像同步通知互相覆盖。
        const val NOTIFICATION_ID = -0x4D53
    }
}
