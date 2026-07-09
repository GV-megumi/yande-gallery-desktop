package com.bluskysoftware.yandegallery.ui.albums

import com.bluskysoftware.yandegallery.data.db.AlbumPrefsEntity
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.prefs.AlbumSort
import org.junit.Assert.assertEquals
import org.junit.Test

class AlbumSectionsTest {
    private fun card(id: Long, name: String, count: Int = 0, createdAt: String? = null) =
        AlbumCard(GalleryEntity(id, name, null, count, createdAt), coverImageId = null)

    private fun prefs(vararg items: AlbumPrefsEntity) = items.associateBy { it.galleryId }

    @Test
    fun `置顶与其他相册分区_置顶按pinnedAt新到旧`() {
        val sections = assembleAlbumSections(
            listOf(card(1, "a"), card(2, "b"), card(3, "c"), card(4, "d")),
            prefs(
                AlbumPrefsEntity(1, pinned = true, pinnedAt = 100L),
                AlbumPrefsEntity(3, pinned = true, pinnedAt = 200L),
                AlbumPrefsEntity(4, inOther = true),
            ),
            AlbumSort.NAME_ASC,
        )
        assertEquals(listOf(3L, 1L), sections.pinned.map { it.gallery.id })   // 新置顶在前
        assertEquals(listOf(2L), sections.normal.map { it.gallery.id })
        assertEquals(listOf(4L), sections.other.map { it.gallery.id })
    }

    @Test
    fun `名称与张数排序_同值按名兜底`() {
        val cards = listOf(card(1, "b", 5), card(2, "a", 5), card(3, "c", 9))
        assertEquals(listOf(2L, 1L, 3L), assembleAlbumSections(cards, emptyMap(), AlbumSort.NAME_ASC).normal.map { it.gallery.id })
        assertEquals(listOf(3L, 1L, 2L), assembleAlbumSections(cards, emptyMap(), AlbumSort.NAME_DESC).normal.map { it.gallery.id })
        assertEquals(listOf(3L, 2L, 1L), assembleAlbumSections(cards, emptyMap(), AlbumSort.COUNT_DESC).normal.map { it.gallery.id })
        assertEquals(listOf(2L, 1L, 3L), assembleAlbumSections(cards, emptyMap(), AlbumSort.COUNT_ASC).normal.map { it.gallery.id })
    }

    @Test
    fun `创建时间排序_NULL排尾按名兜底`() {
        val cards = listOf(
            card(1, "b", createdAt = "2026-01-02T00:00:00.000Z"),
            card(2, "a", createdAt = null),
            card(3, "c", createdAt = "2026-01-01T00:00:00.000Z"),
        )
        assertEquals(listOf(1L, 3L, 2L), assembleAlbumSections(cards, emptyMap(), AlbumSort.CREATED_DESC).normal.map { it.gallery.id })
        assertEquals(listOf(3L, 1L, 2L), assembleAlbumSections(cards, emptyMap(), AlbumSort.CREATED_ASC).normal.map { it.gallery.id })
    }

    @Test
    fun `手动排序_无序值排尾按名`() {
        val cards = listOf(card(1, "z"), card(2, "a"), card(3, "m"))
        val sections = assembleAlbumSections(
            cards,
            prefs(AlbumPrefsEntity(1, manualOrder = 0), AlbumPrefsEntity(3, manualOrder = 1)),
            AlbumSort.MANUAL,
        )
        assertEquals(listOf(1L, 3L, 2L), sections.normal.map { it.gallery.id })   // 2 无序值排尾
    }

    @Test
    fun `手动模式下置顶区也按manualOrder`() {
        val sections = assembleAlbumSections(
            listOf(card(1, "a"), card(2, "b")),
            prefs(
                AlbumPrefsEntity(1, pinned = true, pinnedAt = 999L, manualOrder = 1),
                AlbumPrefsEntity(2, pinned = true, pinnedAt = 1L, manualOrder = 0),
            ),
            AlbumSort.MANUAL,
        )
        assertEquals(listOf(2L, 1L), sections.pinned.map { it.gallery.id })
    }
}
