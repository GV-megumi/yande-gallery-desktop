package com.bluskysoftware.yandegallery.data.prefs

import org.junit.Assert.assertEquals
import org.junit.Test

class SortModelsTest {
    @Test
    fun `PhotoSort orderBy 生成二级键方向随主键`() {
        assertEquals("createdAt DESC, id DESC", PhotoSort.TIME_DESC.orderBy())
        assertEquals("createdAt ASC, id ASC", PhotoSort.TIME_ASC.orderBy())
        assertEquals("fileSize DESC, id DESC", PhotoSort.SIZE_DESC.orderBy())
        assertEquals("filename ASC, id ASC", PhotoSort.NAME_ASC.orderBy())
        assertEquals("i.createdAt DESC, i.id DESC", PhotoSort.TIME_DESC.orderBy("i."))
    }

    @Test
    fun `PhotoSort isTime 只有时间字段为真`() {
        assertEquals(listOf(true, true, false, false, false, false),
            listOf(PhotoSort.TIME_DESC, PhotoSort.TIME_ASC, PhotoSort.SIZE_DESC,
                PhotoSort.SIZE_ASC, PhotoSort.NAME_ASC, PhotoSort.NAME_DESC).map { it.isTime })
    }

    @Test
    fun `fromName 非法值收敛默认`() {
        assertEquals(PhotoSort.TIME_DESC, PhotoSort.fromName(null))
        assertEquals(PhotoSort.TIME_DESC, PhotoSort.fromName("BOGUS"))
        assertEquals(PhotoSort.SIZE_ASC, PhotoSort.fromName("SIZE_ASC"))
        assertEquals(AlbumSort.NAME_ASC, AlbumSort.fromName(null))
        assertEquals(AlbumSort.MANUAL, AlbumSort.fromName("MANUAL"))
    }

    @Test
    fun `PhotoSortField next 未选切默认方向_已选翻方向`() {
        // 当前时间↓：点大小 → 大小默认↓；再点大小 → 翻成↑；点时间 → 时间默认↓
        assertEquals(PhotoSort.SIZE_DESC, PhotoSortField.SIZE.next(PhotoSort.TIME_DESC))
        assertEquals(PhotoSort.SIZE_ASC, PhotoSortField.SIZE.next(PhotoSort.SIZE_DESC))
        assertEquals(PhotoSort.SIZE_DESC, PhotoSortField.SIZE.next(PhotoSort.SIZE_ASC))
        assertEquals(PhotoSort.TIME_DESC, PhotoSortField.TIME.next(PhotoSort.SIZE_ASC))
        assertEquals(PhotoSort.NAME_ASC, PhotoSortField.NAME.next(PhotoSort.TIME_DESC))  // 文件名默认升序
    }

    @Test
    fun `AlbumSortField next 同规则`() {
        assertEquals(AlbumSort.COUNT_DESC, AlbumSortField.COUNT.next(AlbumSort.NAME_ASC))
        assertEquals(AlbumSort.COUNT_ASC, AlbumSortField.COUNT.next(AlbumSort.COUNT_DESC))
        assertEquals(AlbumSort.NAME_ASC, AlbumSortField.NAME.next(AlbumSort.MANUAL))
        assertEquals(AlbumSort.CREATED_DESC, AlbumSortField.CREATED.next(AlbumSort.NAME_ASC))
    }
}
