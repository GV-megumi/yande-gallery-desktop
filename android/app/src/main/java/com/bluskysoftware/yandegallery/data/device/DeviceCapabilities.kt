package com.bluskysoftware.yandegallery.data.device

import android.os.Build

/** 手机域访问级别（spec §3）：34+ 可能处于「部分照片」授权。 */
enum class DeviceAccessLevel { FULL, PARTIAL, DENIED }

/**
 * 门控矩阵唯一判定点（spec §7）：分界线是「要不要动本机文件」——
 * 26–28 浏览+分享；29+ 复制/新建（自有新文件免权限落盘）；30+ 删除/移动
 * （createDeleteRequest/createWriteRequest 是 30+ API）。不可用 = 入口隐藏（不是置灰）。
 */
object DeviceCapabilities {
    const val READ_MEDIA_IMAGES = "android.permission.READ_MEDIA_IMAGES"
    const val READ_MEDIA_VIDEO = "android.permission.READ_MEDIA_VIDEO"
    const val READ_MEDIA_VISUAL_USER_SELECTED = "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
    const val READ_EXTERNAL_STORAGE = "android.permission.READ_EXTERNAL_STORAGE"

    fun canCopy(sdk: Int = Build.VERSION.SDK_INT): Boolean = sdk >= 29

    /** 新建相册与复制同门（spec §2.3：26–28 建了也永远无法落地）。 */
    fun canCreateAlbum(sdk: Int = Build.VERSION.SDK_INT): Boolean = canCopy(sdk)

    fun canDelete(sdk: Int = Build.VERSION.SDK_INT): Boolean = sdk >= 30

    fun canMove(sdk: Int = Build.VERSION.SDK_INT): Boolean = sdk >= 30

    /** 运行时申请清单：33+ 双媒体权限（34+ 追加部分授权项），26–32 旧读权限。 */
    fun readPermissions(sdk: Int = Build.VERSION.SDK_INT): List<String> = when {
        sdk >= 34 -> listOf(READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_VISUAL_USER_SELECTED)
        sdk >= 33 -> listOf(READ_MEDIA_IMAGES, READ_MEDIA_VIDEO)
        else -> listOf(READ_EXTERNAL_STORAGE)
    }

    /**
     * 授权结果 → 访问级别（spec §3）：33+ 双媒体权限齐 = FULL；34+ 仅部分授权项 = PARTIAL
     * （FULL 分支先判，双权限齐时不误报 PARTIAL）；26–32 旧读权限 = FULL；其余 DENIED。
     */
    fun accessLevelOf(sdk: Int, granted: Set<String>): DeviceAccessLevel = when {
        sdk >= 33 && READ_MEDIA_IMAGES in granted && READ_MEDIA_VIDEO in granted -> DeviceAccessLevel.FULL
        sdk >= 34 && READ_MEDIA_VISUAL_USER_SELECTED in granted -> DeviceAccessLevel.PARTIAL
        sdk in 26..32 && READ_EXTERNAL_STORAGE in granted -> DeviceAccessLevel.FULL
        else -> DeviceAccessLevel.DENIED
    }
}
