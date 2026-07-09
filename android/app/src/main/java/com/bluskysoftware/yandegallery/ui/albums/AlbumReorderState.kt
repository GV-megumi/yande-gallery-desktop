package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.geometry.Offset

/** 重排分区标识（spec §4.5：不跨区拖动）。 */
enum class ReorderSection { PINNED, NORMAL }

/**
 * 拖拽重排状态机（spec §4.5，纯逻辑直测）：进入时快照两分区 id 序、区内 move；
 * 「完成」由调用方读 pinnedOrder/normalOrder 落盘；「取消」即丢弃本实例。
 */
class AlbumReorderState(pinned: List<Long>, normal: List<Long>) {
    val pinnedOrder: SnapshotStateList<Long> = mutableStateListOf<Long>().apply { addAll(pinned) }
    val normalOrder: SnapshotStateList<Long> = mutableStateListOf<Long>().apply { addAll(normal) }

    fun sectionOf(id: Long): ReorderSection? = when {
        pinnedOrder.contains(id) -> ReorderSection.PINNED
        normalOrder.contains(id) -> ReorderSection.NORMAL
        else -> null
    }

    /** 区内换位：[fromId] 插到 [toId] 当前位置；跨区/未知 id 忽略。 */
    fun move(fromId: Long, toId: Long) {
        val section = sectionOf(fromId) ?: return
        if (section != sectionOf(toId)) return
        val list = if (section == ReorderSection.PINNED) pinnedOrder else normalOrder
        val from = list.indexOf(fromId)
        val to = list.indexOf(toId)
        if (from < 0 || to < 0 || from == to) return
        list.add(to, list.removeAt(from))
    }
}

/**
 * LazyVerticalGrid 拖拽控制器（spec §4.5）：拖动中按被拖卡片中心命中同分区目标格即 move；
 * move 后被拖项基准位变为目标位，用「旧基准位 − 新基准位」反向补偿 dragOffset，视觉不跳。
 *
 * 已知限制（本期定界，评审记录）：无边缘自动滚动——目标命中只扫 visibleItemsInfo，且拖动
 * 手势独占指针后网格不滚动，相册超一屏时需「拖到边缘→松手→滚动→再长按」分段完成。补
 * autoscroll 需要滚动量反哺 dragOffset、被拖 item 滚出组合窗口后手势存活等配套，Robolectric
 * 驱动不了这类连续滚动手感，随 Task 11 实机验证一并迭代。
 */
class GridReorderController(
    private val gridState: LazyGridState,
    private val canSwap: (fromKey: Any, toKey: Any) -> Boolean,
    private val onMove: (fromKey: Any, toKey: Any) -> Unit,
) {
    var draggingKey by mutableStateOf<Any?>(null)
        private set
    var dragOffset by mutableStateOf(Offset.Zero)
        private set

    fun onDragStart(key: Any) {
        draggingKey = key
        dragOffset = Offset.Zero
    }

    fun onDrag(delta: Offset) {
        val key = draggingKey ?: return
        dragOffset += delta
        val current = gridState.layoutInfo.visibleItemsInfo.firstOrNull { it.key == key } ?: return
        val center = Offset(
            current.offset.x + dragOffset.x + current.size.width / 2f,
            current.offset.y + dragOffset.y + current.size.height / 2f,
        )
        val target = gridState.layoutInfo.visibleItemsInfo.firstOrNull { info ->
            info.key != key && canSwap(key, info.key) &&
                center.x >= info.offset.x && center.x <= info.offset.x + info.size.width &&
                center.y >= info.offset.y && center.y <= info.offset.y + info.size.height
        } ?: return
        val fromOffset = Offset(current.offset.x.toFloat(), current.offset.y.toFloat())
        val toOffset = Offset(target.offset.x.toFloat(), target.offset.y.toFloat())
        onMove(key, target.key)
        dragOffset += fromOffset - toOffset
    }

    fun onDragEnd() {
        draggingKey = null
        dragOffset = Offset.Zero
    }
}
