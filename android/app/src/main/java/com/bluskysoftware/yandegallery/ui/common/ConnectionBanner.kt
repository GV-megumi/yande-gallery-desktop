package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.domain.ConnState

/**
 * 连接状态细横幅（spec §8）：
 * - unauthorized：「密钥失效，请重新配对」，点击跳服务器页重新配对；
 * - offline：「未连接到 <名>，点按管理服务器」，点击跳服务器页（IP 变化引导，复用 onReconnectAuth 同一去向）；
 * - online：不渲染。
 * unauthorized 优先于 offline（密钥失效更需用户处置）。
 */
@Composable
fun ConnectionBanner(
    state: ConnState,
    onReconnectAuth: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when {
        state.unauthorized -> Surface(
            color = MaterialTheme.colorScheme.errorContainer,
            contentColor = MaterialTheme.colorScheme.onErrorContainer,
            modifier = modifier.fillMaxWidth().clickable(onClick = onReconnectAuth).testTag("banner_unauthorized"),
        ) {
            Text(
                "密钥失效，请重新配对",
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp, horizontal = 12.dp),
            )
        }
        !state.online -> Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = modifier.fillMaxWidth().clickable(onClick = onReconnectAuth).testTag("banner_offline"),
        ) {
            Text(
                "未连接到 ${state.serverName ?: "服务器"}，点按管理服务器",
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp, horizontal = 12.dp),
            )
        }
        else -> Unit
    }
}
