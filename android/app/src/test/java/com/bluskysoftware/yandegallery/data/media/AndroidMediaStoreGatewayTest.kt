package com.bluskysoftware.yandegallery.data.media

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * AndroidMediaStoreGateway 冒烟测试（Robolectric，仅 29+ scoped storage 分支）。
 *
 * MediaStore 在真机上的语义（IS_PENDING 生命周期、RELATIVE_PATH 落盘、MediaScanner 扫描结果）
 * Robolectric 的 ContentResolver 模拟不可靠——沿用项目对 Coil DiskCache 的既有政策：
 * 这里断言故意宽松，只验「不崩溃 + 返回非空/可写」，真实语义留给实机验证。
 * 下游 worker 逻辑（Task 8）改对 fake 实现测试，不依赖本类的真实 MediaStore 行为。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class AndroidMediaStoreGatewayTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val gateway: MediaStoreGateway = AndroidMediaStoreGateway(context)

    @Test
    fun `createPending 到 openOutput 到 finalize 全流程不崩且返回非空`() {
        val uri = gateway.createPending("smoke-test.jpg", "image/jpeg")
        assertNotNull("createPending 应返回非空 Uri（29+ scoped storage 分支）", uri)

        val out = gateway.openOutput(uri!!)
        assertNotNull("openOutput 应返回可写流", out)
        out?.use { it.write(byteArrayOf(1, 2, 3)) }

        gateway.finalize(uri) // 仅验不抛异常
    }
}
