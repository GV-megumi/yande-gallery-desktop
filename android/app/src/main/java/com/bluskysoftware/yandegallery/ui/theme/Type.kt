package com.bluskysoftware.yandegallery.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * MIUI 式字号层级（spec §1.2）：大标题 30/W700、小标题 17/W600、日期头 16/W600、底栏标签 11sp；
 * 中文场景全部字距归零（M3 默认 letterSpacing 对中文偏散）。
 */
val AppTypography = Typography().run {
    copy(
        headlineLarge = headlineLarge.copy(fontSize = 30.sp, lineHeight = 38.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.sp),
        titleLarge = titleLarge.copy(fontSize = 17.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
        titleMedium = titleMedium.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
        titleSmall = titleSmall.copy(letterSpacing = 0.sp),
        bodyLarge = bodyLarge.copy(fontSize = 15.sp, letterSpacing = 0.sp),
        bodyMedium = bodyMedium.copy(letterSpacing = 0.sp),
        bodySmall = bodySmall.copy(letterSpacing = 0.sp),
        labelLarge = labelLarge.copy(letterSpacing = 0.sp),
        labelMedium = labelMedium.copy(letterSpacing = 0.sp),
        labelSmall = labelSmall.copy(fontSize = 11.sp, letterSpacing = 0.sp),
    )
}
