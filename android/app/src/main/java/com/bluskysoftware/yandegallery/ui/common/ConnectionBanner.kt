package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.domain.ConnState

/**
 * 连接状态细横幅（spec §8，MIUI 柔和化：淡色底 + 同色系文字，不再用高对比 container 色块）：
 * - unauthorized：「密钥失效，请重新配对」（error 12% 底 + error 字），点击跳服务器页重新配对；
 * - offline：「未连接到 <名>，点按管理服务器」（琥珀 15% 底 + 深浅主题各自琥珀字），点击跳服务器页
 *   （IP 变化引导，复用 onReconnectAuth 同一去向）；
 * - online：不渲染。
 * unauthorized 优先于 offline（密钥失效更需用户处置）。文案/tag/点击行为与旧版完全一致。
 */
@Composable
fun ConnectionBanner(
    state: ConnState,
    onReconnectAuth: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when {
        state.unauthorized -> BannerRow(
            text = "密钥失效，请重新配对",
            bg = MaterialTheme.colorScheme.error.copy(alpha = 0.12f),
            fg = MaterialTheme.colorScheme.error,
            tag = "banner_unauthorized",
            onClick = onReconnectAuth,
            modifier = modifier,
        )
        !state.online -> BannerRow(
            text = "未连接到 ${state.serverName ?: "服务器"}，点按管理服务器",
            bg = Color(0x26FFA000),   // 琥珀 15%
            fg = if (isSystemInDarkTheme()) Color(0xFFFFC46B) else Color(0xFF9A6B00),
            tag = "banner_offline",
            onClick = onReconnectAuth,
            modifier = modifier,
        )
        else -> Unit
    }
}

@Composable
private fun BannerRow(text: String, bg: Color, fg: Color, tag: String, onClick: () -> Unit, modifier: Modifier) {
    Surface(color = bg, contentColor = fg, modifier = modifier.fillMaxWidth().clickable(onClick = onClick).testTag(tag)) {
        Text(
            text,
            style = MaterialTheme.typography.labelMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp, horizontal = 12.dp),
        )
    }
}
