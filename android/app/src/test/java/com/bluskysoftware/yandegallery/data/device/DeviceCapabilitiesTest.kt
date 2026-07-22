package com.bluskysoftware.yandegallery.data.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** spec §7 门控矩阵 + §3 权限模型的纯函数面。 */
class DeviceCapabilitiesTest {
    @Test
    fun `门控矩阵_26到28只读_29可复制_30全功能`() {
        assertFalse(DeviceCapabilities.canCopy(28))
        assertTrue(DeviceCapabilities.canCopy(29))
        assertFalse(DeviceCapabilities.canDelete(29))
        assertTrue(DeviceCapabilities.canDelete(30))
        assertFalse(DeviceCapabilities.canMove(29))
        assertTrue(DeviceCapabilities.canMove(30))
        // 新建相册与复制同门（spec §2.3：26–28 无法落文件，占位永不落地）
        assertFalse(DeviceCapabilities.canCreateAlbum(28))
        assertTrue(DeviceCapabilities.canCreateAlbum(29))
    }

    @Test
    fun `权限清单按版本分段`() {
        assertEquals(listOf(DeviceCapabilities.READ_EXTERNAL_STORAGE), DeviceCapabilities.readPermissions(32))
        assertEquals(
            listOf(DeviceCapabilities.READ_MEDIA_IMAGES, DeviceCapabilities.READ_MEDIA_VIDEO),
            DeviceCapabilities.readPermissions(33),
        )
        assertTrue(DeviceCapabilities.READ_MEDIA_VISUAL_USER_SELECTED in DeviceCapabilities.readPermissions(34))
    }

    @Test
    fun `访问级别_全量_部分_拒绝`() {
        val bothMedia = setOf(DeviceCapabilities.READ_MEDIA_IMAGES, DeviceCapabilities.READ_MEDIA_VIDEO)
        assertEquals(DeviceAccessLevel.FULL, DeviceCapabilities.accessLevelOf(34, bothMedia))
        assertEquals(
            DeviceAccessLevel.PARTIAL,
            DeviceCapabilities.accessLevelOf(34, setOf(DeviceCapabilities.READ_MEDIA_VISUAL_USER_SELECTED)),
        )
        assertEquals(DeviceAccessLevel.DENIED, DeviceCapabilities.accessLevelOf(34, emptySet()))
        assertEquals(
            DeviceAccessLevel.FULL,
            DeviceCapabilities.accessLevelOf(30, setOf(DeviceCapabilities.READ_EXTERNAL_STORAGE)),
        )
        assertEquals(DeviceAccessLevel.DENIED, DeviceCapabilities.accessLevelOf(30, emptySet()))
    }

    @Test
    fun `访问级别_sdk33单权限授予视为拒绝`() {
        // 33 无「部分授权」概念（34+ 才有 READ_MEDIA_VISUAL_USER_SELECTED）——
        // 双媒体权限缺一即 DENIED，不得误判 PARTIAL
        assertEquals(
            DeviceAccessLevel.DENIED,
            DeviceCapabilities.accessLevelOf(33, setOf(DeviceCapabilities.READ_MEDIA_IMAGES)),
        )
        assertEquals(
            DeviceAccessLevel.DENIED,
            DeviceCapabilities.accessLevelOf(33, setOf(DeviceCapabilities.READ_MEDIA_VIDEO)),
        )
    }
}
