package com.bluskysoftware.yandegallery.domain.download

import com.bluskysoftware.yandegallery.data.db.ImageEntity
import com.bluskysoftware.yandegallery.data.mirror.MirrorTier
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** 分享四级规则（spec §4.4/需求 4）：原图 > HQ > 在线临时拉取 > 离线失败。纯逻辑注入，无 Android 依赖。 */
class ShareCoordinatorTest {

    private fun img(id: Long) = ImageEntity(id, "a$id.jpg", 1, 1, 100, "jpg", "", "")

    @Test
    fun `本地有文件直接用——不触发 ensure`() = runTest {
        var ensured = 0
        val c = ShareCoordinator(
            localFile = { File("local-$it.jpg") },
            ensure = { _, _ -> ensured++; Result.failure(IllegalStateException("不该调")) },
            saveMode = { MirrorTier.HQ },
            online = { true },
        )
        val out = c.shareFiles(listOf(img(1), img(2)))
        assertEquals(listOf("local-1.jpg", "local-2.jpg"), out.files.map { it.name })
        assertEquals(0, ensured)
        assertTrue(out.failedIds.isEmpty())
    }

    @Test
    fun `本地缺失且在线——按当前保存方式 ensure 后分享（D10）`() = runTest {
        var ensuredTier: MirrorTier? = null
        val c = ShareCoordinator(
            localFile = { null },
            ensure = { id, tier -> ensuredTier = tier; Result.success(File("pulled-$id.jpg")) },
            saveMode = { MirrorTier.ORIGINAL },
            online = { true },
        )
        val out = c.shareFiles(listOf(img(7)))
        assertEquals(listOf("pulled-7.jpg"), out.files.map { it.name })
        assertEquals(MirrorTier.ORIGINAL, ensuredTier)
    }

    @Test
    fun `本地缺失且离线——计入 failedIds 不 ensure`() = runTest {
        var ensured = 0
        val c = ShareCoordinator(
            localFile = { null },
            ensure = { _, _ -> ensured++; Result.success(File("x")) },
            saveMode = { MirrorTier.HQ },
            online = { false },
        )
        val out = c.shareFiles(listOf(img(7)))
        assertEquals(listOf(7L), out.failedIds)
        assertEquals(0, ensured)
    }

    @Test
    fun `多张混合——在线拉取失败的计入 failedIds，其余照常`() = runTest {
        val c = ShareCoordinator(
            localFile = { id -> if (id == 1L) File("local-1.jpg") else null },
            ensure = { id, _ ->
                if (id == 2L) Result.success(File("pulled-2.jpg"))
                else Result.failure(java.io.IOException("断了"))
            },
            saveMode = { MirrorTier.HQ },
            online = { true },
        )
        val out = c.shareFiles(listOf(img(1), img(2), img(3)))
        assertEquals(listOf("local-1.jpg", "pulled-2.jpg"), out.files.map { it.name })
        assertEquals(listOf(3L), out.failedIds)
    }
}
