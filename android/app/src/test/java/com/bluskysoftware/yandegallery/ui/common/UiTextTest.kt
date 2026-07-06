package com.bluskysoftware.yandegallery.ui.common

import com.bluskysoftware.yandegallery.domain.write.WriteResult
import org.junit.Assert.assertEquals
import org.junit.Test

/** D12A 归拢单源：mimeOf/writeFailText 逐字迁自 ui.viewer / SelectionBars，行为不变。 */
class UiTextTest {
    @Test fun `mimeOf 常见格式与回退`() {
        assertEquals("image/jpeg", mimeOf("JPG"))
        assertEquals("image/jpeg", mimeOf("jpeg"))
        assertEquals("image/png", mimeOf("png"))
        assertEquals("image/gif", mimeOf("gif"))
        assertEquals("image/webp", mimeOf("webp"))
        assertEquals("image/bmp", mimeOf("bmp"))
        assertEquals("image/*", mimeOf("tiff"))
    }

    @Test fun `writeFailText 401 引导重配对 其余带前缀`() {
        assertEquals("密钥失效，请重新配对", writeFailText("删除失败", WriteResult.Failed("x", unauthorized = true)))
        assertEquals("删除失败：网络错误", writeFailText("删除失败", WriteResult.Failed("网络错误")))
    }
}
