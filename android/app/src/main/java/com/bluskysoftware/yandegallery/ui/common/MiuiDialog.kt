package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.bluskysoftware.yandegallery.ui.theme.DarkDialogButton

/**
 * MIUI 式统一弹窗（spec §8.3）：20dp 圆角、标题居中、底部等宽胶囊按钮排——
 * 取消=灰底深字、确认=主蓝底白字、危险确认（删除类）=红底白字；单按钮场景把另一侧传 null。
 * [content] 槽放输入框/列表等自定义内容（可与 [text] 叠加，text 先渲染）。
 * confirmTag 透传各调用点既有 testTag（batch_delete_confirm 等），断言零迁移。
 */
@Composable
fun MiuiDialog(
    title: String,
    onDismiss: () -> Unit,
    text: String? = null,
    confirmText: String? = null,
    onConfirm: () -> Unit = {},
    confirmEnabled: Boolean = true,
    destructive: Boolean = false,
    confirmTag: String? = null,
    dismissText: String? = "取消",
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.fillMaxWidth().testTag("miui_dialog"),
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 20.dp)) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier
                        .align(Alignment.CenterHorizontally)
                        .padding(bottom = 16.dp),
                )
                if (text != null) {
                    Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 8.dp))
                }
                content?.invoke(this)
                Spacer(Modifier.height(20.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                    if (dismissText != null) {
                        MiuiDialogButton(
                            label = dismissText,
                            // 暗色下 surfaceVariant(#1F2022) 与弹窗底(#1C1C1E) 肉眼同色，取消键会
                            // 退化成裸文字；亮色维持 spec §8.3 原值（审查 minor）
                            container = if (isSystemInDarkTheme()) DarkDialogButton else MaterialTheme.colorScheme.surfaceVariant,
                            contentColor = MaterialTheme.colorScheme.onSurface,
                            enabled = true,
                            onClick = onDismiss,
                            tag = "miui_dialog_dismiss",
                            modifier = Modifier.weight(1f),
                        )
                    }
                    if (confirmText != null) {
                        MiuiDialogButton(
                            label = confirmText,
                            container = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                            contentColor = Color.White,
                            enabled = confirmEnabled,
                            onClick = onConfirm,
                            tag = confirmTag ?: "miui_dialog_confirm",
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

/** 等宽胶囊按钮：44dp 高全圆角；禁用降透明（配色不换，MIUI 同款观感）。 */
@Composable
private fun MiuiDialogButton(
    label: String,
    container: Color,
    contentColor: Color,
    enabled: Boolean,
    onClick: () -> Unit,
    tag: String,
    modifier: Modifier = Modifier,
) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .height(44.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(if (enabled) container else container.copy(alpha = 0.38f))
            .clickable(enabled = enabled, onClick = onClick)
            .testTag(tag),
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = if (enabled) contentColor else contentColor.copy(alpha = 0.6f))
    }
}
