package com.bluskysoftware.yandegallery.ui.common

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

/** 提示文案统一出口：拒绝存储权限时各触发点弹同一句（spec §8 明确报错不静默）。 */
const val LEGACY_STORAGE_DENIED_TEXT = "未授予存储权限，无法保存原图到系统相册"

/**
 * API 26-28 原图下载的 WRITE_EXTERNAL_STORAGE 运行时门卫（BUG-07）：legacy 分支
 * resolver.insert(EXTERNAL_CONTENT_URI) 需要该权限，manifest 声明（maxSdkVersion=28）之外
 * 必须运行时授予，否则查看原图/批量下载/带下载分享在 26-28 一律静默失败。
 *
 * 返回动作门卫 `gate(action)`：29+（scoped storage 免权限）或已授予 → 直接执行；
 * 未授予 → 弹系统权限框，授予后续跑暂存动作、拒绝走 [onDenied]（调用方弹提示）。
 * 旋转丢暂存动作可接受（权限已授予，用户重点一次即生效）。
 */
@Composable
fun rememberLegacyStorageGate(onDenied: () -> Unit): (action: () -> Unit) -> Unit {
    val context = LocalContext.current
    val currentOnDenied by rememberUpdatedState(onDenied)
    var pendingAction by remember { mutableStateOf<(() -> Unit)?>(null) }
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val action = pendingAction
        pendingAction = null
        if (granted) action?.invoke() else currentOnDenied()
    }
    return remember {
        { action ->
            val allowed = Build.VERSION.SDK_INT >= 29 ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                PackageManager.PERMISSION_GRANTED
            if (allowed) {
                action()
            } else {
                pendingAction = action
                launcher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            }
        }
    }
}
