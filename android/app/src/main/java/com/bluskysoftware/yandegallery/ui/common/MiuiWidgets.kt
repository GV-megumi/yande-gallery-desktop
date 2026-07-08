package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** 二级页顶栏（spec §8.2）：居中标题（可选副标题双行）+ 左返回 + 右动作槽；背景与页面同色。 */
@Composable
fun MiuiSubPageTopBar(
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Box(
        modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .height(48.dp),
    ) {
        IconButton(onClick = onBack, modifier = Modifier.align(Alignment.CenterStart)) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.align(Alignment.Center)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.align(Alignment.CenterEnd)) { actions() }
    }
}

/** 设置卡片组（spec §8.1）：12dp 圆角、surfaceContainer 底；组内行靠间距分隔（无分割线）。 */
@Composable
fun MiuiCardGroup(
    modifier: Modifier = Modifier,
    title: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth()) {
        if (title != null) {
            Text(
                title,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 16.dp, bottom = 6.dp),
            )
        }
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceContainer,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(content = content)
        }
    }
}

/** 卡片组内列表行：标题 + 可选副文/右值/chevron；行高靠内边距（约 56dp）。 */
@Composable
fun MiuiListItem(
    headline: String,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    value: String? = null,
    chevron: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(headline, style = MaterialTheme.typography.bodyLarge)
            if (supporting != null) {
                Text(
                    supporting,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        if (value != null) {
            Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (chevron) {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
        }
    }
}

/** 灰底圆角填充输入框（spec §8.2）：标签固定在框上方灰字、无下划线；错误提示走 supporting。 */
@Composable
fun MiuiTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    singleLine: Boolean = true,
    isError: Boolean = false,
    supportingText: String? = null,
) {
    Column(Modifier.fillMaxWidth()) {
        if (label != null) {
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
            )
        }
        TextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = singleLine,
            isError = isError,
            placeholder = placeholder?.let { { Text(it) } },
            shape = RoundedCornerShape(12.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                errorContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                disabledIndicatorColor = Color.Transparent,
                errorIndicatorColor = Color.Transparent,
            ),
            modifier = modifier.fillMaxWidth(),
        )
        if (supportingText != null) {
            Text(
                supportingText,
                style = MaterialTheme.typography.bodySmall,
                color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 4.dp, top = 4.dp),
            )
        }
    }
}

/** 主/次胶囊按钮（48dp 高）：主=蓝底白字，次=灰底深字；loading 时前置转圈并禁点。 */
@Composable
fun MiuiPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) = MiuiCapsuleButton(text, onClick, modifier, enabled, loading, MaterialTheme.colorScheme.primary, Color.White)

@Composable
fun MiuiSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) = MiuiCapsuleButton(text, onClick, modifier, enabled, loading, MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurface)

@Composable
private fun MiuiCapsuleButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier,
    enabled: Boolean,
    loading: Boolean,
    container: Color,
    contentColor: Color,
) {
    val canClick = enabled && !loading
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
        modifier = modifier
            .height(48.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(if (canClick) container else container.copy(alpha = 0.5f))
            .clickable(enabled = canClick, onClick = onClick)
            // 内容水平留白：wrap-content 场景（缓存页「清理」）保持胶囊形；weight 拉伸场景居中不受影响
            .padding(horizontal = 24.dp),
    ) {
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = contentColor)
            Spacer(Modifier.size(8.dp))
        }
        Text(text, style = MaterialTheme.typography.bodyLarge, color = if (canClick) contentColor else contentColor.copy(alpha = 0.6f))
    }
}
