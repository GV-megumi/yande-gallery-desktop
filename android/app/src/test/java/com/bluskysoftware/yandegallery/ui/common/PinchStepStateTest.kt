package com.bluskysoftware.yandegallery.ui.common

import com.bluskysoftware.yandegallery.ui.photos.DensityTier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** v0.6：由 PinchDensityStateTest 迁移（构造改泛型，断言不变）+ 列数档泛型用例；v0.8.2：改为单手势一档锁定断言（移除跨多档用例）。 */
class PinchStepStateTest {
    private fun densityState() = PinchStepState<DensityTier>(
        larger = { it.larger() },
        smaller = { it.smaller() },
    )

    @Test fun `累计放大越过阈值升一档`() {
        val s = densityState()
        s.onGestureStart(DensityTier.DAY_4)
        assertNull(s.onZoom(1.1f))              // 1.1 未过阈值
        assertEquals(DensityTier.DAY_3, s.onZoom(1.2f))  // 1.1*1.2=1.32 ≥ 1.25 → 变大一档
        assertNull(s.onZoom(1.1f))              // 升档后本手势已锁定，继续放大不再升档
    }

    @Test fun `同一手势内缩小只降一档 后续帧被锁定`() {
        val s = densityState()
        s.onGestureStart(DensityTier.DAY_4)
        assertEquals(DensityTier.DAY_5, s.onZoom(0.7f))   // ≤0.8 → 变密一档
        assertNull(s.onZoom(0.7f))                        // 同一手势继续捏 → 锁定，不再降档（旧行为会到 MONTH）
        assertNull(s.onZoom(0.7f))                        // 再喂也不动，须松手重捏
    }

    @Test fun `同一手势内放大只升一档 后续帧被锁定`() {
        val s = densityState()
        s.onGestureStart(DensityTier.DAY_5)
        assertEquals(DensityTier.DAY_4, s.onZoom(1.3f))   // ≥1.25 → 变大一档
        assertNull(s.onZoom(1.3f))                        // 同一手势继续放大 → 锁定（旧行为会到 DAY_3）
    }

    @Test fun `真步进后同一手势反向捏也被锁定`() {
        val s = densityState()
        s.onGestureStart(DensityTier.DAY_4)
        assertEquals(DensityTier.DAY_5, s.onZoom(0.7f))   // 缩小降一档 → 落锁
        assertNull(s.onZoom(1.3f))                        // 反向放大也被锁（对偶行为：撞边界不落锁、反向立即生效）
        assertNull(s.onZoom(1.3f))                        // 持续反向仍锁定，须松手重捏
    }

    @Test fun `松手重捏解除锁定 新手势可再升一档`() {
        val s = densityState()
        s.onGestureStart(DensityTier.DAY_5)
        assertEquals(DensityTier.DAY_4, s.onZoom(1.3f))   // 第一次手势升一档
        assertNull(s.onZoom(1.3f))                        // 锁定
        s.onGestureStart(DensityTier.DAY_4)               // 松手重捏 → 解锁
        assertEquals(DensityTier.DAY_3, s.onZoom(1.3f))   // 新手势再升一档
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
        assertEquals(null, state.onZoom(1.3f))    // 同一手势已步进一次 → 锁定（3 也恰是列数边界）
        state.onGestureStart(4)
        assertEquals(5, state.onZoom(0.7f))       // 缩小 → 4→5
    }
}
