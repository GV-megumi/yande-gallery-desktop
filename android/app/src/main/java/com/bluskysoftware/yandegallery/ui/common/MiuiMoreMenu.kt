package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.data.prefs.AlbumSort
import com.bluskysoftware.yandegallery.data.prefs.AlbumSortField
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import com.bluskysoftware.yandegallery.data.prefs.PhotoSortField

/** 二级页描述：key 供 [MiuiMoreMenu.page] 插槽分发，title 渲染在「‹ 标题」返回头行。 */
private data class MenuPage(val key: String, val title: String)

/** 菜单恒定宽度（MIUI 弹出菜单同款恒宽）：一二级切换只动高度不跳宽。 */
private val MenuWidth = 224.dp

/**
 * MIUI 皮「⋯」多级下拉菜单（面板改版）：锚定顶栏按钮、右上角原位弹出，替代旧底部
 * ModalBottomSheet 方案（MiuiOptionsSheet，已删）。一级页放分类行（[MiuiMenuGroupRow]，
 * 右侧带当前值预览）与直达行（[MiuiMenuNavRow]）；点分类行滑入对应二级明细页（自动带
 * 「‹ 标题」返回头行，点返回滑回一级）。选择即生效即收菜单——收口由调用方在回调里做
 * （与旧面板同约定）。菜单收起后内容销毁，重新展开天然回到一级页。
 *
 * 使用方式：与锚点 IconButton 放进同一个 Box（DropdownMenu 锚定语义），expanded 常驻组合、
 * 由布尔控制显隐（保留展开/收起动画），不要再用 `if (show)` 条件挂载。
 */
@Composable
fun MiuiMoreMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    root: @Composable ColumnScope.(openPage: (key: String, title: String) -> Unit) -> Unit,
    page: @Composable ColumnScope.(key: String) -> Unit,
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(18.dp),
        containerColor = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.testTag("options_menu"),
    ) {
        // 页状态放弹层内容里：收起动画结束内容随之销毁，下次展开天然回到一级页；
        // 关闭动画期间保留当前页，不会闪回一级。
        var current by remember { mutableStateOf<MenuPage?>(null) }
        AnimatedContent(
            targetState = current,
            transitionSpec = {
                // 进二级从右滑入、一级向左让位；返回反向。高度差走 ContentTransform 默认 SizeTransform。
                val forward = targetState != null
                (slideInHorizontally { if (forward) it else -it } + fadeIn()) togetherWith
                    (slideOutHorizontally { if (forward) -it else it } + fadeOut())
            },
            label = "miui_menu_page",
        ) { target ->
            Column(Modifier.width(MenuWidth)) {
                if (target == null) {
                    root { key, title -> current = MenuPage(key, title) }
                } else {
                    MiuiMenuBackRow(target.title) { current = null }
                    page(target.key)
                }
            }
        }
    }
}

/** 一级分类行：标题 + 右侧当前值预览 + chevron，点击进入对应二级页。 */
@Composable
fun MiuiMenuGroupRow(label: String, value: String?, tag: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .testTag(tag),
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.weight(1f))
        if (value != null) {
            Text(
                value,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 12.dp, end = 2.dp),
            )
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            modifier = Modifier.size(18.dp),
        )
    }
}

/** 二级页返回头行：「‹ 标题」+ 发丝分隔线，点击回一级页。 */
@Composable
private fun MiuiMenuBackRow(title: String, onBack: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onBack)
            .padding(horizontal = 12.dp, vertical = 12.dp)
            .testTag("menu_back"),
    ) {
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowLeft,
            contentDescription = "返回上级",
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
        Text(
            title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp),
        )
    }
    HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
}

/** 一级直达行（设置/拖拽排序等导航动作）：观感与分类行一致（行尾 chevron），但不进二级。 */
@Composable
fun MiuiMenuNavRow(label: String, tag: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .testTag(tag),
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            modifier = Modifier.size(18.dp),
        )
    }
}

/** 一级页分组间的发丝分隔线。 */
@Composable
fun MiuiMenuDivider() {
    HorizontalDivider(
        thickness = 0.5.dp,
        color = MaterialTheme.colorScheme.outlineVariant,
        modifier = Modifier.padding(vertical = 4.dp),
    )
}

/** 排序字段行（原 MiuiOptionsSheet 迁入，tag 契约不变）：选中主色 + 行尾方向箭头；切字段/翻方向语义由调用方经 next() 决定。 */
@Composable
fun MiuiSortRow(label: String, selected: Boolean, ascending: Boolean, tag: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .testTag(tag),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        if (selected) {
            Icon(
                if (ascending) Icons.Filled.ArrowUpward else Icons.Filled.ArrowDownward,
                contentDescription = if (ascending) "升序" else "降序",
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp).testTag("${tag}_dir"),
            )
        }
    }
}

/** 单选档位行（密度/列数/手动排序；原 MiuiOptionsSheet 迁入，tag 契约不变）：选中主色 + 行尾蓝勾。 */
@Composable
fun MiuiChoiceRow(label: String, selected: Boolean, tag: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .testTag(tag),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        if (selected) {
            Icon(
                Icons.Filled.Check,
                contentDescription = "已选",
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp).testTag("${tag}_check"),
            )
        }
    }
}

/**
 * 照片/详情「排序方式」分类行的当前值预览：字段名 + 方向箭头。
 * firstOrNull 兜底：枚举新增档位而字段表漏同步时降级为空预览（顶栏每次重组都会执行，
 * 不能让 first 的 NoSuchElementException 崩整页）；穷举映射由 MiuiMoreMenuPreviewTest 钉住。
 */
fun photoSortPreview(sort: PhotoSort): String {
    val field = PhotoSortField.entries.firstOrNull { it.contains(sort) } ?: return ""
    return "${field.label} ${if (sort.ascending) "↑" else "↓"}"
}

/** 相册「排序方式」分类行的当前值预览：手动档无方向。兜底同 [photoSortPreview]。 */
fun albumSortPreview(sort: AlbumSort): String {
    if (sort == AlbumSort.MANUAL) return "手动"
    val field = AlbumSortField.entries.firstOrNull { it.contains(sort) } ?: return ""
    return "${field.label} ${if (sort.ascending) "↑" else "↓"}"
}
