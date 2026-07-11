package com.bluskysoftware.yandegallery.ui.common

import com.bluskysoftware.yandegallery.data.prefs.AlbumSort
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 排序预览函数的穷举映射契约：每个枚举值都必须映射到非空预览。
 * 目的不是测兜底分支（当前枚举全覆盖、兜底不可达），而是钉住「枚举 ↔ 字段表」的同步——
 * 谁往 PhotoSort/AlbumSort 加档而忘了同步 *SortField，这里先红，而不是线上顶栏渲染出空预览。
 */
class MiuiMoreMenuPreviewTest {

    @Test
    fun `photoSortPreview 对全部 PhotoSort 档位产出非空预览`() {
        PhotoSort.entries.forEach { sort ->
            val preview = photoSortPreview(sort)
            assertTrue("PhotoSort.$sort 缺少字段映射（*SortField 未同步？）", preview.isNotEmpty())
            assertTrue("PhotoSort.$sort 预览缺方向箭头: $preview", preview.endsWith("↑") || preview.endsWith("↓"))
        }
    }

    @Test
    fun `albumSortPreview 对全部 AlbumSort 档位产出非空预览_手动档无方向`() {
        AlbumSort.entries.forEach { sort ->
            val preview = albumSortPreview(sort)
            assertTrue("AlbumSort.$sort 缺少字段映射（*SortField 未同步？）", preview.isNotEmpty())
        }
        assertEquals("手动", albumSortPreview(AlbumSort.MANUAL))
    }

    @Test
    fun `预览内容为字段名加方向箭头`() {
        assertEquals("时间 ↓", photoSortPreview(PhotoSort.TIME_DESC))
        assertEquals("文件名 ↑", photoSortPreview(PhotoSort.NAME_ASC))
        assertEquals("名称 ↑", albumSortPreview(AlbumSort.NAME_ASC))
        assertEquals("张数 ↓", albumSortPreview(AlbumSort.COUNT_DESC))
    }
}
