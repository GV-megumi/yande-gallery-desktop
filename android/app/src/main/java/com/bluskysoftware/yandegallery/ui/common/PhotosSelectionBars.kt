package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * 照片 tab 多选栏上提壳级的桥（D11）：PhotosScreen 每次重组经 SideEffect 回填最新回调
 * （「全选」闭包捕获分页快照，无法用静态参数上提），AppScaffold 按 model 非空条件 swap 顶/底栏。
 * 离开照片路由或退出多选时回 null，壳恢复常规 TopAppBar/NavigationBar。
 */
class PhotosSelectionBars {
    var model by mutableStateOf<Model?>(null)

    data class Model(
        val count: Int,
        val online: Boolean,
        val onSelectAll: () -> Unit,
        val onCancel: () -> Unit,
        val onDownload: () -> Unit,
        val onShare: () -> Unit,
        val onDelete: () -> Unit,
        val onAddToGallery: () -> Unit,
    )
}
