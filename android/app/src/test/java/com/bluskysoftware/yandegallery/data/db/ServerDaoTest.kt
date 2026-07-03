package com.bluskysoftware.yandegallery.data.db

import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ServerDaoTest {
    private lateinit var db: AppDatabase

    @Before
    fun setup() {
        db = AppDatabase.inMemory(ApplicationProvider.getApplicationContext())
    }

    @After
    fun teardown() = db.close()

    private fun server(name: String) = ServerEntity(
        name = name, baseUrl = "http://$name", apiKey = "key-$name", isActive = false,
    )

    @Test
    fun `insert 与 observeAll 列出全部服务器`() = runTest {
        db.serverDao().insert(server("a"))
        db.serverDao().insert(server("b"))
        assertEquals(listOf("a", "b"), db.serverDao().observeAll().first().map { it.name })
    }

    @Test
    fun `update 更新字段`() = runTest {
        val id = db.serverDao().insert(server("a"))
        db.serverDao().update(server("a").copy(id = id, apiKey = "new-key"))
        assertEquals("new-key", db.serverDao().observeAll().first().first { it.id == id }.apiKey)
    }

    @Test
    fun `deleteById 后 observeAll 不再包含该行`() = runTest {
        val id = db.serverDao().insert(server("a"))
        db.serverDao().deleteById(id)
        assertTrue(db.serverDao().observeAll().first().isEmpty())
    }

    @Test
    fun `activate 事务后仅一行 isActive`() = runTest {
        val id1 = db.serverDao().insert(server("a"))
        val id2 = db.serverDao().insert(server("b"))
        db.serverDao().activate(id1)
        db.serverDao().activate(id2)
        val all = db.serverDao().observeAll().first()
        assertEquals(listOf(id2), all.filter { it.isActive }.map { it.id })
        assertEquals(id2, db.serverDao().active()?.id)
    }

    @Test
    fun `observeActive 随 activate 切换发射`() = runTest {
        val id1 = db.serverDao().insert(server("a"))
        val id2 = db.serverDao().insert(server("b"))
        db.serverDao().observeActive().test {
            assertNull(awaitItem())
            db.serverDao().activate(id1)
            assertEquals(id1, awaitItem()?.id)
            db.serverDao().activate(id2)
            assertEquals(id2, awaitItem()?.id)
        }
    }
}
