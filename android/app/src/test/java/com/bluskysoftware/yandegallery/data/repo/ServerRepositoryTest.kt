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
 * 注：观察窗口设计——Room 的 observeActive() 建立在触发器 + 后台失效轮询之上；
 * addAndActivate() 内部是 insert() + activate() 两次独立写入。若 Turbine 订阅在
 * 两次写入之间已经挂起（即 compound write 全程在订阅窗口内发生），失效轮询有概率
 * 先于 activate() 完成前对 insert() 触发一次多余的中间发射（内容仍是旧值），导致
 * 断言拿到的不是最终态而是过渡态——这是真实存在的 Room 测试陷阱，不是本仓库特有 bug。
 * 因此这里统一采用「先完成写入、再订阅看当前态」或「仅在订阅期间执行单次原子写入
 * （如 delete/activate）」两种安全模式，与 ServerDaoTest 已验证可靠的用法保持一致。
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
        val id = repo.addAndActivate("desktop", "http://x:1", "key-1")

        repo.observeActive().test {
            val active = awaitItem()
            assertNotNull(active)
            assertEquals(id, active?.id)
            assertEquals("desktop", active?.name)
            assertEquals(true, active?.isActive)
        }
        assertEquals(id, repo.activeServer()?.id)

        val all = repo.observeAll().first()
        assertEquals(1, all.count { it.isActive })
    }

    @Test
    fun `第二次 addAndActivate 切换激活`() = runTest {
        val id1 = repo.addAndActivate("a", "http://a:1", "key-a")
        assertEquals(id1, repo.activeServer()?.id)

        val id2 = repo.addAndActivate("b", "http://b:1", "key-b")

        repo.observeActive().test {
            assertEquals(id2, awaitItem()?.id)
        }
        assertEquals(id2, repo.activeServer()?.id)

        // 唯一激活：全表只有一行 isActive，且是最后激活的那行
        val all = repo.observeAll().first()
        assertEquals(1, all.count { it.isActive })
        assertEquals(id2, all.first { it.isActive }.id)
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
