package com.bluskysoftware.yandegallery.data.mirror

import org.junit.Assert.assertEquals
import org.junit.Test

/** 镜像文件名规则（spec §3.1）：非法字符清洗、HQ 扩展名按 Content-Type、tier 解析收敛。 */
class MirrorModelsTest {
    @Test
    fun `sanitizeFilename 清洗安卓非法字符为下划线`() {
        assertEquals("a_b_c_d_e_f_g_h_i_.jpg", sanitizeFilename("""a\b/c:d*e?f"g<h>i|.jpg"""))
    }

    @Test
    fun `hqFilename png 源 jpeg 响应 → 主名不变扩展名 jpg`() {
        assertEquals("foo.jpg", hqFilename("foo.png", "image/jpeg"))
    }

    @Test
    fun `hqFilename webp 响应保持 webp；gif 直通保持 gif`() {
        assertEquals("bar.webp", hqFilename("bar.webp", "image/webp"))
        assertEquals("anim.gif", hqFilename("anim.gif", "image/gif"))
    }

    @Test
    fun `hqFilename 体积保护回退原图 → Content-Type 即原格式，拼回原名`() {
        assertEquals("tiny.png", hqFilename("tiny.png", "image/png"))
    }

    @Test
    fun `hqFilename 未知 Content-Type 回退原扩展名；无扩展名回退 bin`() {
        assertEquals("x.png", hqFilename("x.png", null))
        assertEquals("noext.bin", hqFilename("noext", "application/octet-stream"))
    }

    @Test
    fun `mirrorTierOf 非法与 null 收敛 HQ`() {
        assertEquals(MirrorTier.HQ, mirrorTierOf(null))
        assertEquals(MirrorTier.HQ, mirrorTierOf("bogus"))
        assertEquals(MirrorTier.ORIGINAL, mirrorTierOf("ORIGINAL"))
    }
}
