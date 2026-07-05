package com.bluskysoftware.yandegallery.data.media

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream

/**
 * AndroidMediaStoreGateway 冒烟测试（Robolectric，29+ scoped storage 分支 + 26-28 legacy 分支）。
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

    @Test
    @Config(sdk = [28])
    fun `legacy 26-28 分支——createPending 到 finalize 不崩（DATA 列缺失也须安全跳过扫描）`() {
        val uri = gateway.createPending("smoke-legacy.jpg", "image/jpeg")
        assertNotNull("createPending 应返回非空 Uri（26-28 legacy 直接 insert 分支）", uri)

        // Robolectric sdk 28 环境不解析 MediaStore content URI 的输出流（sdk 29 环境可以），
        // 直接 openOutputStream 抛 FileNotFoundException——已知 shadow 差异，注册 shadow 输出流绕过；
        // 生产代码不动，此处只为验证 Gateway 调用链不崩
        shadowOf(context.contentResolver).registerOutputStream(uri!!, ByteArrayOutputStream())
        val out = gateway.openOutput(uri)
        assertNotNull("openOutput 应返回可写流", out)
        out?.use { it.write(byteArrayOf(1, 2, 3)) }

        // finalize 走 DATA 列查真实路径再触发扫描；Robolectric shadow 查不到 DATA 行时，
        // null 安全路径必须让它静默跳过而非抛异常——仅验不抛
        gateway.finalize(uri)
    }
}
