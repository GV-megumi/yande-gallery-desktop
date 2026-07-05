package com.bluskysoftware.yandegallery.ui.common

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * 多选状态（M3-T13）：纯逻辑，无 Android 依赖，由 Photos/AlbumDetail 两个 VM 各持一份。
 *
 * - 激活语义：selected 非空即处于多选模式（长按首选进入；取消/清空/删光即退出），无独立 mode 标志。
 * - [selectAll] 为**并集**语义：把传入 id 并入已有选择（分页下「全选」只对已加载快照生效，
 *   追加加载后再点全选继续并入，不会丢用户已勾选的项）。
 * - Compose 端订阅 [selectedFlow]（collectAsState）驱动角标与选择栏重组；
 *   非 UI 调用方直接读 [selected]/[active]/[count] 快照。
 */
class SelectionState {
    private val _selected = MutableStateFlow<Set<Long>>(emptySet())

    /** 选中 id 集合的可订阅流（Compose collectAsState 用）。 */
    val selectedFlow: StateFlow<Set<Long>> = _selected.asStateFlow()

    /** 当前选中 id 集合快照。 */
    val selected: Set<Long> get() = _selected.value

    /** 是否处于多选模式：非空即激活。 */
    val active: Boolean get() = _selected.value.isNotEmpty()

    /** 选中数量。 */
    val count: Int get() = _selected.value.size

    /** 反转某 id 的选中态：未选则加入，已选则移出（移出最后一个即自动退出多选）。 */
    fun toggle(id: Long) {
        _selected.update { if (id in it) it - id else it + id }
    }

    /** 并入一批 id（全选当前已加载项）。 */
    fun selectAll(ids: Collection<Long>) {
        _selected.update { it + ids }
    }

    /** 清空选择（取消多选/批量动作完成后调用）。 */
    fun clear() {
        _selected.value = emptySet()
    }
}
