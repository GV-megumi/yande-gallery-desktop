package com.bluskysoftware.yandegallery.ui.common

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

/**
 * 下载前台通知的 POST_NOTIFICATIONS 运行时请求（M4-D8）：33+ 未授权时首帧静默申请一次
 * （rememberSaveable 防旋转/重组重复弹）；拒绝仅静默降级——下载照常进行、仅无进度通知，
 * 不弹阻断对话框。<33 通道级授予、无需运行时请求，直接 no-op。
 * 请求范式照抄 ScanScreen.kt 的 CAMERA 申请；挂载于 AppScaffold 之前。
 */
@Composable
fun NotificationPermissionEffect() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return   // <33：通道级授予，无运行时权限

    val context = LocalContext.current
    val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
    // 已请求置位（拒绝也算已请求）——rememberSaveable 跨旋转存活，不重复弹
    var requested by rememberSaveable { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* 授予或拒绝均静默：拒绝时下载纯后台进行，无进度通知 */ }

    LaunchedEffect(Unit) {
        if (!granted && !requested) {
            requested = true
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
