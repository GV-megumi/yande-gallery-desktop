package com.bluskysoftware.yandegallery.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/** 跨页面共享的 MIUI 视觉常量（spec §1.3/§2.3/§3）——照片/相册详情/搜索三网格统一取此处，不许各写一份。 */
object MiuiTokens {
    /** 网格缝隙（水平+垂直 Arrangement.spacedBy）。 */
    val GridGap = 3.dp
    /** 网格格子圆角。 */
    val CellShape = RoundedCornerShape(3.dp)
    /** 封面/卡片圆角。 */
    val CoverShape = RoundedCornerShape(12.dp)
    /** tab 页大标题行高（随内容滚动收起的部分）。 */
    val LargeTitleHeight = 64.dp
    /** tab 页常驻顶栏行高（不含状态栏 inset）。 */
    val PinnedBarHeight = 44.dp
}
