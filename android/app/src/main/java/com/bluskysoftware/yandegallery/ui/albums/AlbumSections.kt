package com.bluskysoftware.yandegallery.ui.albums

import com.bluskysoftware.yandegallery.data.db.AlbumPrefsEntity
import com.bluskysoftware.yandegallery.data.prefs.AlbumSort

/** 相册页三分区模型（spec §4.2）：置顶 / 全部相册 / 其他相册。 */
data class AlbumSections(
    val pinned: List<AlbumCard>,
    val normal: List<AlbumCard>,
    val other: List<AlbumCard>,
) {
    val isEmpty: Boolean get() = pinned.isEmpty() && normal.isEmpty() && other.isEmpty()
}

/**
 * 分区组装纯函数（spec §4.2）：
 * - 归属：pinned 优先（DAO 事务保证与 inOther 互斥；万一脏数据同真，置顶优先）；
 * - 置顶区：默认按 pinnedAt 新→旧，MANUAL 模式按 manualOrder；
 * - 普通/其他区：按 [sort]；MANUAL 下 manualOrder 升序、无序值排尾按名；CREATED 下 NULL 排尾按名。
 * 所有排序以名称升序作最终兜底，保证确定性。
 */
fun assembleAlbumSections(
    cards: List<AlbumCard>,
    prefs: Map<Long, AlbumPrefsEntity>,
    sort: AlbumSort,
): AlbumSections {
    fun prefOf(card: AlbumCard) = prefs[card.gallery.id]
    val (pinnedCards, rest) = cards.partition { prefOf(it)?.pinned == true }
    val (otherCards, normalCards) = rest.partition { prefOf(it)?.inOther == true }

    val nameAsc = compareBy<AlbumCard> { it.gallery.name }
    val manual = compareBy<AlbumCard> { prefOf(it)?.manualOrder ?: Int.MAX_VALUE }.then(nameAsc)

    fun sorted(list: List<AlbumCard>): List<AlbumCard> = when (sort) {
        AlbumSort.MANUAL -> list.sortedWith(manual)
        AlbumSort.NAME_ASC -> list.sortedWith(nameAsc)
        AlbumSort.NAME_DESC -> list.sortedWith(compareByDescending<AlbumCard> { it.gallery.name }.then(nameAsc))
        AlbumSort.COUNT_DESC -> list.sortedWith(compareByDescending<AlbumCard> { it.gallery.imageCount }.then(nameAsc))
        AlbumSort.COUNT_ASC -> list.sortedWith(compareBy<AlbumCard> { it.gallery.imageCount }.then(nameAsc))
        AlbumSort.CREATED_DESC -> list.sortedWith(
            // NULL 视为最小（?: ""），降序自然排尾
            compareByDescending<AlbumCard> { it.gallery.createdAt ?: "" }.then(nameAsc),
        )
        AlbumSort.CREATED_ASC -> list.sortedWith(
            compareBy<AlbumCard> { it.gallery.createdAt == null }   // false(有值) 在前 → NULL 排尾
                .then(compareBy { it.gallery.createdAt ?: "" })
                .then(nameAsc),
        )
    }

    val pinnedSorted = if (sort == AlbumSort.MANUAL) {
        pinnedCards.sortedWith(manual)
    } else {
        pinnedCards.sortedWith(compareByDescending<AlbumCard> { prefOf(it)?.pinnedAt ?: 0L }.then(nameAsc))
    }
    return AlbumSections(pinnedSorted, sorted(normalCards), sorted(otherCards))
}
