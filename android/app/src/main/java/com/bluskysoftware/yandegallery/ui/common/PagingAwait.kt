package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.runtime.snapshotFlow
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import kotlinx.coroutines.flow.dropWhile
import kotlinx.coroutines.flow.first

/**
 * 排序切换回顶的「第二针」（审查 minor，照片页/相册详情共用）：
 *
 * 切排序后立即 scrollToItem(0) 作用的是旧世代快照，LazyGrid 会记下此刻首可见项的 key；
 * 新世代落地时「按 key 维持滚动位置」机制若在新快照首载窗口内找到同 key（小库、日头键族、
 * 照片 key 恒存在），视口就跟着跳离顶部——回顶被抵消。等新世代 refresh 走完
 * Loading→NotLoading 再钉一次顶即可。
 *
 * 若本收集启动时新世代已落地（错过 Loading 相位），则一直挂起：此时首针本就作用于新快照、
 * 无需第二针；挂起体随调用方 LaunchedEffect 在下次排序切换时整体取消，无泄漏。
 */
suspend fun awaitPagingRefreshSettled(items: LazyPagingItems<*>) {
    snapshotFlow { items.loadState.refresh }
        .dropWhile { it !is LoadState.Loading }
        .first { it is LoadState.NotLoading }
}
