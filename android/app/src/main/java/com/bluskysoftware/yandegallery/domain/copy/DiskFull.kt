package com.bluskysoftware.yandegallery.domain.copy

import android.system.ErrnoException
import android.system.OsConstants
import com.bluskysoftware.yandegallery.data.mirror.ImageMirrorStore

/**
 * 满盘判读（insert 侧，v0.8.1 B 类抽出）：MediaStore 输出流写满盘抛出的 IOException 在 cause 链上包
 * ErrnoException(ENOSPC)（镜像层 DiskFullException 一并识别，防未来网关实现转包）。深度上限防御
 * 异常自环；ENOSPC 之外的 errno 不揽——其余本地错误按普通失败计。
 *
 * 原为 DeviceExportWorker.companion 的 internal 扩展（Task 10）；DeviceCopyWorker（B 类）同款满盘
 * 分流也要用，抽到共享位置由两个 worker 共用（brief 授权「迁至 domain/copy/DiskFull.kt」选项）——
 * 导出/复制两域的满盘 → Result.retry() 口径由此单点收敛，不双份实现漂移。
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
