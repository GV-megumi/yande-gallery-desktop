package com.bluskysoftware.yandegallery.ui.common

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.View
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Context → Activity 解包（原 ViewerScreen/DeviceViewerScreen/Theme 三份私有副本收敛，v0.8.1 A1）。 */
internal tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** 沉浸态系统栏显隐（原 ViewerScreen/DeviceViewerScreen 两份私有副本收敛）。 */
internal fun applySystemBars(activity: Activity?, view: View, hide: Boolean) {
    val window = activity?.window ?: return
    val controller = WindowCompat.getInsetsController(window, view)
    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    if (hide) controller.hide(WindowInsetsCompat.Type.systemBars())
    else controller.show(WindowInsetsCompat.Type.systemBars())
}

/** 状态栏/导航栏图标明暗（同上收敛）。 */
internal fun setSystemBarAppearanceLight(activity: Activity?, view: View, light: Boolean) {
    val window = activity?.window ?: return
    val controller = WindowCompat.getInsetsController(window, view)
    controller.isAppearanceLightStatusBars = light
    controller.isAppearanceLightNavigationBars = light
}
