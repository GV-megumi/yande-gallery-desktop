package com.bluskysoftware.yandegallery.data.repo

import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import com.bluskysoftware.yandegallery.data.db.AppDatabase
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * 活体断言前提：addAndActivate 底层是 ServerDao.insertAndActivate 单事务——
 * 订阅期间执行它只产生一次失效信号，observeActive 只发射最终态。
 * （若退化回 insert+activate 两笔独立事务，订阅横跨写入会出现过渡态发射导致
 * 本套测试失败；且该过渡窗口对直连 okHttp apiKeyProvider 的 Coil 是真实的
 * Bearer 撕裂缺陷——旧 key 打新 baseUrl。测试失败即缺陷回归信号。）
 */
@RunWith(RobolectricTestRunner::class)
class ServerRepositoryTest {
    private lateinit var db: AppDatabase
    private lateinit var repo: ServerRepository

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
        repo = ServerRepository(db.serverDao())
    }

    @After
    fun teardown() = db.close()

    @Test
    fun `addAndActivate 后 observeActive 发射该行且唯一激活`() = runTest {
        repo.observeActive().test {
            assertNull(awaitItem())

            val id = repo.addAndActivate("desktop", "http://x:1", "key-1")

            val active = awaitItem()
            assertNotNull(active)
            assertEquals(id, active?.id)
            assertEquals("desktop", active?.name)
            assertEquals(true, active?.isActive)
            assertEquals(id, repo.activeServer()?.id)
        }

        val all = repo.observeAll().first()
        assertEquals(1, all.count { it.isActive })
    }

    @Test
    fun `第二次 addAndActivate 切换激活`() = runTest {
        repo.observeActive().test {
            assertNull(awaitItem())

            val id1 = repo.addAndActivate("a", "http://a:1", "key-a")
            assertEquals(id1, awaitItem()?.id)

            val id2 = repo.addAndActivate("b", "http://b:1", "key-b")
            assertEquals(id2, awaitItem()?.id)
            assertEquals(id2, repo.activeServer()?.id)
        }

        // 唯一激活：全表只有一行 isActive，且是最后激活的那行
        val all = repo.observeAll().first()
        assertEquals(1, all.count { it.isActive })
        assertEquals(repo.activeServer()?.id, all.first { it.isActive }.id)
    }

    @Test
    fun `delete 激活行后 observeActive 发射 null`() = runTest {
        val id = repo.addAndActivate("desktop", "http://x:1", "key-1")

        repo.observeActive().test {
            assertEquals(id, awaitItem()?.id)

            repo.delete(id)
            assertNull(awaitItem())
        }
    }

    @Test
    fun `baseUrl 尾斜杠剥离并 trim`() = runTest {
        val id = repo.addAndActivate("  desktop  ", "http://x:1/", "  key-1  ")
        val active = repo.activeServer()
        assertEquals(id, active?.id)
        assertEquals("desktop", active?.name)
        assertEquals("http://x:1", active?.baseUrl)
        assertEquals("key-1", active?.apiKey)
    }
}
