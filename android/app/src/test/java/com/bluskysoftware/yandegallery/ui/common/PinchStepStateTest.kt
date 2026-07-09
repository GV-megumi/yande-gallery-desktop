package com.bluskysoftware.yandegallery.ui.common

import com.bluskysoftware.yandegallery.ui.photos.DensityTier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** v0.6：由 PinchDensityStateTest 迁移（构造改泛型，断言不变）+ 列数档泛型用例。 */
class PinchStepStateTest {
    private fun densityState() = PinchStepState<DensityTier>(
        larger = { it.larger() },
        smaller = { it.smaller() },
    )

    @Test fun `累计放大越过阈值升一档并复位`() {
        val s = densityState()
        s.onGestureStart(DensityTier.DAY_4)
        assertNull(s.onZoom(1.1f))              // 1.1 未过阈值
        assertEquals(DensityTier.DAY_3, s.onZoom(1.2f))  // 1.1*1.2=1.32 ≥ 1.25 → 变大一档
        assertNull(s.onZoom(1.1f))              // 复位后重新累计
    }

    @Test fun `累计缩小越过阈值降一档 连续捏可跨多档`() {
        val s = densityState()
        s.onGestureStart(DensityTier.DAY_4)
        assertEquals(DensityTier.DAY_5, s.onZoom(0.7f))   // ≤0.8 → 变密一档
        assertEquals(DensityTier.MONTH, s.onZoom(0.7f))   // 同一手势继续捏 → 再降一档
    }

    @Test fun `边界档不再越档`() {
        val s = densityState()
        s.onGestureStart(DensityTier.DAY_3)
        assertNull(s.onZoom(2f))                // DAY_3 已是最大格
        s.onGestureStart(DensityTier.MONTH)
        assertNull(s.onZoom(0.5f))              // MONTH 已是最密
    }

    @Test fun `新手势 onGestureStart 复位累计与档位`() {
        val s = densityState()
        s.onGestureStart(DensityTier.DAY_4)
        assertNull(s.onZoom(1.2f))              // 累计 1.2 未过阈值
        s.onGestureStart(DensityTier.DAY_4)     // 新手势：累计清零
        assertNull(s.onZoom(1.1f))              // 若未复位 1.2*1.1=1.32 会误越档
        assertEquals(DensityTier.DAY_3, s.onZoom(1.2f))
    }

    @Test fun `边界档撞墙后累计复位 反向捏立即生效`() {
        val s = densityState()
        s.onGestureStart(DensityTier.DAY_3)
        assertNull(s.onZoom(2f))                // 撞最大档，累计应复位为 1
        assertEquals(DensityTier.DAY_4, s.onZoom(0.7f))   // 反向缩小 ≤0.8 → 降一档
    }

    @Test
    fun `列数档步进_放大列数减_到边界返回null不再步进`() {
        val state = PinchStepState<Int>(
            larger = { if (it > 3) it - 1 else null },
            smaller = { if (it < 5) it + 1 else null },
        )
        state.onGestureStart(4)
        assertEquals(3, state.onZoom(1.3f))       // 放大越阈值 → 4→3
        assertEquals(null, state.onZoom(1.3f))    // 已到 3 列边界
        state.onGestureStart(4)
        assertEquals(5, state.onZoom(0.7f))       // 缩小 → 4→5
    }
}
