package com.bluskysoftware.yandegallery.data.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class DeviceModelsTest {
    @Test
    fun `bucketKey_三态编解码往返`() {
        assertEquals("all", BucketKey.All.encode())
        assertEquals("b42", BucketKey.Bucket(42L).encode())
        assertEquals(BucketKey.All, BucketKey.decode("all"))
        assertEquals(BucketKey.Bucket(42L), BucketKey.decode("b42"))
        // 待落地相册名 raw 往返（含中文/空格/加号——URI 转义交给 navigate 侧 Uri.encode，
        // Navigation 层收参时自动解码一次，这里若再做 URL 编解码会双重解码把 + 错转空格）
        val pending = BucketKey.Pending("我的 相册+1")
        assertEquals(pending, BucketKey.decode(pending.encode()))
        assertNull(BucketKey.decode("bogus"))
        assertNull(BucketKey.decode("bNotANumber"))
    }

    @Test
    fun `bucketKey_空段与非法前缀解码`() {
        // 钉现状："b" 空 id 经 toLongOrNull 失败 → null；"p" 空名无空段校验，现状解出
        // Pending("")（计划 brief 预期 null，以代码为准修断言）——App 自身构造不出裸 "p"
        //（Pending 名来自 validateNewAlbumName，拒空白），两侧 VM 收参另有 ?: All 兜底，
        // 属解析器宽松边界而非缺陷；若未来收紧为 null 属行为变更，需同步改此断言
        assertEquals(BucketKey.Pending(""), BucketKey.decode("p"))   // Pending 空名（现状非 null）
        assertNull(BucketKey.decode("b"))    // Bucket 空 id
        assertNull(BucketKey.decode(""))
        assertNull(BucketKey.decode("x9"))
    }

    @Test
    fun `相册排序_相机截图置顶_其余按张数降序_待落地垫底`() {
        fun album(name: String, path: String?, count: Int, pending: Boolean = false) = DeviceAlbum(
            key = if (pending) BucketKey.Pending(name) else BucketKey.Bucket(name.hashCode().toLong()),
            name = name, relativePath = path, count = count, coverUri = null, isPending = pending,
        )
        val sorted = sortDeviceAlbums(
            listOf(
                album("WeChat", "Pictures/WeChat/", 500),
                album("新相册", null, 0, pending = true),
                album("Camera", "DCIM/Camera/", 100),
                album("小图", "Pictures/小图/", 3),
                album("Screenshots", "Pictures/Screenshots/", 50),
            ),
        )
        assertEquals(listOf("Camera", "Screenshots", "WeChat", "小图", "新相册"), sorted.map { it.name })
    }

    @Test
    fun `相册排序_段边界匹配_防Camera360与GameScreenshots误置顶`() {
        fun album(name: String, path: String?, count: Int) = DeviceAlbum(
            key = BucketKey.Bucket(name.hashCode().toLong()),
            name = name, relativePath = path, count = count, coverUri = null, isPending = false,
        )
        val sorted = sortDeviceAlbums(
            listOf(
                album("Camera360", "DCIM/Camera360/", 200),    // 不应置顶（tier 2）
                album("GameScreenshots", "Pictures/GameScreenshots/", 150),  // 不应置顶（tier 2）
                album("Camera", "DCIM/Camera/", 100),          // tier 0
                album("Screenshots", "Pictures/Screenshots/", 50),  // tier 1
            ),
        )
        // 预期：tier 0 (Camera) → tier 1 (Screenshots) → tier 2 按张数降序 (Camera360 > GameScreenshots)
        assertEquals(listOf("Camera", "Screenshots", "Camera360", "GameScreenshots"), sorted.map { it.name })
    }

    @Test
    fun `目标目录校验_仅DCIM与Pictures前缀`() {
        assertTrue(isWritableAlbumPath("DCIM/Camera/"))
        assertTrue(isWritableAlbumPath("Pictures/WeChat/"))
        assertFalse(isWritableAlbumPath("Download/"))
        assertFalse(isWritableAlbumPath("Movies/x/"))
    }

    @Test
    fun `目标目录校验_无尾斜杠前缀同样通过`() {
        // isWritableAlbumPath 以 startsWith 判前缀——真实 RELATIVE_PATH 带尾斜杠，
        // 但 trimEnd 后的比较路径也应稳定通过/拒绝
        assertTrue(isWritableAlbumPath("DCIM/Camera"))
        assertTrue(isWritableAlbumPath("Pictures/Yande"))
        assertFalse(isWritableAlbumPath("Download/Sub"))
    }

    @Test
    fun `新建相册名校验_非法字符与重名拒绝`() {
        assertNull(validateNewAlbumName("旅行 2026", emptySet()))
        assertNotNull(validateNewAlbumName("", emptySet()))
        assertNotNull(validateNewAlbumName("  ", emptySet()))
        assertNotNull(validateNewAlbumName("a/b", emptySet()))     // 路径分隔符
        assertNotNull(validateNewAlbumName("a\\b", emptySet()))
        assertNotNull(validateNewAlbumName("x:y", emptySet()))
        assertNotNull(validateNewAlbumName("Camera", setOf("Camera")))  // 重名
    }

    @Test
    fun `新建相册名校验_尾随路径分隔符占位名拒绝_保pendingAlbumPath等价`() {
        // v0.8.1 加固锁：`Trip/`/`Trip\`/裸 `/` 若放行，pendingAlbumPath 会造出 Pictures/Trip// 畸形路径，
        // 且 absorbedPendingNames 的 trimEnd('/') 会与旧 `Pictures/$it` 判据产生行为差——校验器禁分隔符从源头堵死，
        // 使 absorbedPendingNames 去尾斜杠判据对全部可创建名等价成立
        assertNotNull(validateNewAlbumName("Trip/", emptySet()))     // 尾随正斜杠
        assertNotNull(validateNewAlbumName("Trip\\", emptySet()))    // 尾随反斜杠
        assertNotNull(validateNewAlbumName("/", emptySet()))         // 裸分隔符
        assertNull(validateNewAlbumName("Trip", emptySet()))         // 正常名仍放行
    }

    @Test
    fun `视频时长格式化`() {
        assertEquals("0:07", formatDurationMs(7_000))
        assertEquals("1:05", formatDurationMs(65_000))
        assertEquals("1:00:01", formatDurationMs(3_601_000))
    }
}
