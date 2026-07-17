package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * 照片 tab 多选底栏上提壳级的桥（D11→v0.5 瘦身）：顶部选择栏已随顶栏下放回 PhotosScreen 自渲染，
 * 壳只需知道「多选中 + 底栏五回调」来把 NavigationBar swap 成 SelectionBottomBar。
 * PhotosScreen 每次重组经 SideEffect 回填（闭包捕获屏内状态）；离开路由/退出多选回 null。
 */
class PhotosSelectionBars {
    var model by mutableStateOf<Model?>(null)

    data class Model(
        val online: Boolean,
        val onDownload: () -> Unit,
        val onShare: () -> Unit,
        val onDelete: () -> Unit,
        val onCopyTo: () -> Unit,   // Task 11 改名：「加入相册」→「复制到」；时间轴无移动（spec §6.2）
    )
}
