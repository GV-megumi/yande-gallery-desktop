package com.bluskysoftware.yandegallery.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColors = lightColorScheme(
    primary = LightPrimary,
    background = LightBackground,
    surface = LightSurface,
    onSurface = LightOnSurface,
    onSurfaceVariant = LightOnSurfaceVariant,
)

private val DarkColors = darkColorScheme(
    primary = DarkPrimary,
    background = DarkBackground,
    surface = DarkSurface,
    onSurface = DarkOnSurface,
    onSurfaceVariant = DarkOnSurfaceVariant,
)

/** 动态取色关闭（spec §7）：固定自定义浅/深配色，跟随系统深浅色。 */
@Composable
fun YandeGalleryTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(colorScheme = colors, typography = AppTypography, content = content)
}
