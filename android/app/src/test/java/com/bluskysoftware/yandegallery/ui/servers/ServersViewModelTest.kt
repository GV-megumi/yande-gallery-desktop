package com.bluskysoftware.yandegallery.ui.servers

import androidx.test.core.app.ApplicationProvider
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import com.bluskysoftware.yandegallery.di.AppGraph
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * BUG-08 回归：testConnection 与「保存」同路走 normalizeBaseUrl——
 * 裸 IP（缺 scheme，M4-T14 明确支持的输入形态）不得在 Retrofit 构建期抛英文
 * IllegalArgumentException 造成「测试判失败、保存判成功」的相反判定；
 * 非法地址给中文可读失败信息。
 */
@RunWith(RobolectricTestRunner::class)
class ServersViewModelTest {

    private fun withVm(block: suspend (ServersViewModel) -> Unit) = runTest {
        val db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        val graph = AppGraph(
            ApplicationProvider.getApplicationContext(),
            dbOverride = db,
            autoSyncOnActiveChange = false,
        )
        try {
            block(ServersViewModel(graph))
        } finally {
            graph.shutdownForTest()
            db.close()
        }
    }

    @Test
    fun `裸 IP 缺 scheme——testConnection 归一化补 http 后成功（BUG-08）`() = withVm { vm ->
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setBody("""{"success":true,"data":{"name":"d","permissions":{"imageBinary":true}}}""")
                    .addHeader("Content-Type", "application/json"),
            )
            server.start()

            // 与「保存并激活」相同的输入：host:port 无 http://（修复前此处抛
            // "Expected URL scheme 'http' or 'https'..." 直接判连接失败）
            val result = vm.testConnection("${server.hostName}:${server.port}", "k")

            assertTrue("裸 IP 应测试成功而非 scheme 异常：${result.exceptionOrNull()}", result.isSuccess)
            assertEquals("连接成功", result.getOrNull())
        }
    }

    @Test
    fun `连接成功——不再依响应里的 agent 面 imageBinary 权限键产生警告文案（agent 权限键残留清理回归）`() = withVm { vm ->
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    // imageBinary 是 agent 面（/api/v1/*）专属的 11 键细化权限之一，与手机 App 走的
                    // 手机面（/api/app/v1/*）完全无关；即使响应里带着它且为 false，testConnection
                    // 也不应再解析或据此产生任何缩略图/权限相关警告——连接成功只有一种纯成功文案，
                    // 防止未来有人把权限告警逻辑加回来（曾经的缺陷：手机面已开仍误报「缩略图将无法加载」）。
                    .setBody("""{"success":true,"data":{"name":"d","permissions":{"imageBinary":false}}}""")
                    .addHeader("Content-Type", "application/json"),
            )
            server.start()

            val result = vm.testConnection("${server.hostName}:${server.port}", "k")

            assertTrue(result.isSuccess)
            assertEquals("连接成功", result.getOrNull())
        }
    }

    @Test
    fun `非法地址——中文可读失败而非 Retrofit 构建异常`() = withVm { vm ->
        val result = vm.testConnection("ftp://h", "k")

        assertTrue(result.isFailure)
        assertEquals("地址格式不正确，应为 http://主机:端口", result.exceptionOrNull()?.message)
    }
}
