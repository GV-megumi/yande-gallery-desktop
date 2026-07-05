package com.bluskysoftware.yandegallery.domain.sync

import com.bluskysoftware.yandegallery.data.api.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

private fun item(id: Long, updatedAt: String = "2026-01-01T00:00:00.000Z") = SyncImageItemDto(
    id, "$id.jpg", 10, 10, 1, "jpg", "2026-01-01T00:00:00.000Z", updatedAt, emptyList(), emptyList(),
)

private class FakeApi(
    var metaDto: SyncMetaDto,
    var pages: MutableList<SyncImagesPageDto> = mutableListOf(),
    var galleryList: List<SyncGalleryDto> = emptyList(),
    var tagList: List<SyncTagDto> = emptyList(),
    var ids: List<Long> = emptyList(),
) : SyncApi {
    val imagesCalls = mutableListOf<String?>()
    override suspend fun meta() = metaDto
    override suspend fun images(cursor: String?, limit: Int): SyncImagesPageDto {
        imagesCalls += cursor
        return pages.removeAt(0)
    }
    override suspend fun galleries() = galleryList
    override suspend fun tags() = tagList
    override suspend fun imageIds() = ids
}

private open class InMemoryStore : MirrorStore {
    var state: SyncState? = null
    val images = linkedMapOf<Long, SyncImageItemDto>()
    var galleries: List<SyncGalleryDto> = emptyList()
    var tags: List<SyncTagDto> = emptyList()
    var cleared = 0
    override suspend fun readSyncState() = state
    override suspend fun writeSyncState(s: SyncState) { state = s }
    override suspend fun clearMirror() { cleared++; images.clear(); galleries = emptyList(); tags = emptyList(); state = null }
    override suspend fun applyImagePage(items: List<SyncImageItemDto>) { items.forEach { images[it.id] = it } }
    override suspend fun localImageIds() = images.keys.toList()
    override suspend fun deleteImages(ids: List<Long>) { ids.forEach { images.remove(it) } }
    override suspend fun replaceGalleries(items: List<SyncGalleryDto>) { galleries = items }
    override suspend fun replaceTags(items: List<SyncTagDto>) { tags = items }
}

class SyncEngineTest {
    private val now = { "2026-07-03T00:00:00.000Z" }

    @Test
    fun `首次同步：空游标全量分页拉取并落游标`() = runTest {
        val api = FakeApi(
            metaDto = SyncMetaDto("srv", 1, 3, "c3"),
            pages = mutableListOf(
                SyncImagesPageDto(listOf(item(1), item(2)), "c2", true),
                SyncImagesPageDto(listOf(item(3)), "c3", false),
            ),
            ids = listOf(1, 2, 3),
        )
        val store = InMemoryStore()
        val outcome = SyncEngine(api, store, pageLimit = 2, now = now).sync()

        assertTrue(outcome.fullRebuild)
        assertEquals(3L, outcome.upserted)
        assertEquals(listOf(null, "c2"), api.imagesCalls)
        assertEquals("c3", store.state!!.cursor)
        assertEquals(1L, store.state!!.dataVersion)
        assertEquals(setOf(1L, 2L, 3L), store.images.keys)
    }

    @Test
    fun `增量：从存储游标续拉且不清镜像`() = runTest {
        val api = FakeApi(
            metaDto = SyncMetaDto("srv", 1, 4, "c4"),
            pages = mutableListOf(SyncImagesPageDto(listOf(item(4)), "c4", false)),
            ids = listOf(1, 4),
        )
        val store = InMemoryStore().apply {
            state = SyncState("srv", "c3", 1, "old")
            images[1] = item(1)
        }
        val outcome = SyncEngine(api, store, now = now).sync()

        assertFalse(outcome.fullRebuild)
        assertEquals(0, store.cleared)
        assertEquals(listOf("c3"), api.imagesCalls)
        assertEquals(setOf(1L, 4L), store.images.keys)
    }

    @Test
    fun `dataVersion 变化触发全量重建`() = runTest {
        val api = FakeApi(
            metaDto = SyncMetaDto("srv", 2, 1, "c1"),
            pages = mutableListOf(SyncImagesPageDto(listOf(item(9)), "c1", false)),
            ids = listOf(9),
        )
        val store = InMemoryStore().apply {
            state = SyncState("srv", "c9", 1, "old")
            images[1] = item(1)
        }
        val outcome = SyncEngine(api, store, now = now).sync()

        assertTrue(outcome.fullRebuild)
        assertEquals(1, store.cleared)
        assertEquals(listOf<String?>(null), api.imagesCalls)
        assertEquals(setOf(9L), store.images.keys)
    }

    @Test
    fun `serverId 变化同样触发全量重建`() = runTest {
        val api = FakeApi(
            metaDto = SyncMetaDto("srv-B", 1, 0, null),
            pages = mutableListOf(SyncImagesPageDto(emptyList(), null, false)),
        )
        val store = InMemoryStore().apply { state = SyncState("srv-A", "c1", 1, "old") }
        assertTrue(SyncEngine(api, store, now = now).sync().fullRebuild)
    }

    @Test
    fun `对账删除本地多余行`() = runTest {
        val api = FakeApi(
            metaDto = SyncMetaDto("srv", 1, 1, "c1"),
            pages = mutableListOf(SyncImagesPageDto(emptyList(), null, false)),
            ids = listOf(1),
        )
        val store = InMemoryStore().apply {
            state = SyncState("srv", "c1", 1, "old")
            images[1] = item(1); images[2] = item(2)
        }
        val outcome = SyncEngine(api, store, now = now).sync()
        assertEquals(1, outcome.deleted)
        assertEquals(setOf(1L), store.images.keys)
    }

    @Test
    fun `galleries 与 tags 全量覆盖`() = runTest {
        val api = FakeApi(
            metaDto = SyncMetaDto("srv", 1, 0, null),
            pages = mutableListOf(SyncImagesPageDto(emptyList(), null, false)),
            galleryList = listOf(SyncGalleryDto(1, "g", null, 0)),
            tagList = listOf(SyncTagDto(1, "t", null)),
        )
        val store = InMemoryStore()
        SyncEngine(api, store, now = now).sync()
        assertEquals(1, store.galleries.size)
        assertEquals(1, store.tags.size)
    }

    @Test
    fun `分页中途失败：已拉页与游标保留，progress 置 Failed 并重抛`() = runTest {
        val api = object : SyncApi {
            var call = 0
            override suspend fun meta() = SyncMetaDto("srv", 1, 4, "c4")
            override suspend fun images(cursor: String?, limit: Int): SyncImagesPageDto {
                call++
                if (call == 2) throw ApiException("INTERNAL_ERROR", "boom")
                return SyncImagesPageDto(listOf(item(1), item(2)), "c2", true)
            }
            override suspend fun galleries() = emptyList<SyncGalleryDto>()
            override suspend fun tags() = emptyList<SyncTagDto>()
            override suspend fun imageIds() = emptyList<Long>()
        }
        val store = InMemoryStore()
        val engine = SyncEngine(api, store, pageLimit = 2, now = now)

        assertThrows(ApiException::class.java) { kotlinx.coroutines.runBlocking { engine.sync() } }
        assertEquals("c2", store.state!!.cursor)       // 断点游标已落
        assertEquals(setOf(1L, 2L), store.images.keys) // 已拉页保留
        assertTrue(engine.progress.value is SyncPhase.Failed)
    }

    @Test
    fun `取消异常重抛且 progress 不置 Failed（对齐 T6-T8 取消惯例，M4-T14）`() = runTest {
        // fake images() 抛 CancellationException（取消而非失败）：应原样重抛、progress 不置 Failed（否则 UI 误报同步失败）
        val api = object : SyncApi {
            override suspend fun meta() = SyncMetaDto("srv", 1, 1, "c1")
            override suspend fun images(cursor: String?, limit: Int): SyncImagesPageDto =
                throw kotlinx.coroutines.CancellationException("cancelled")
            override suspend fun galleries() = emptyList<SyncGalleryDto>()
            override suspend fun tags() = emptyList<SyncTagDto>()
            override suspend fun imageIds() = emptyList<Long>()
        }
        val store = InMemoryStore()
        val engine = SyncEngine(api, store, now = now)

        val ex = runCatching { engine.sync() }.exceptionOrNull()

        assertTrue("取消原样重抛", ex is kotlinx.coroutines.CancellationException)
        assertFalse("取消不置 Failed", engine.progress.value is SyncPhase.Failed)
    }

    @Test
    fun `全量进度按 imageCount 上报（探针式断言——StateFlow 会合并中间值，不能用订阅逐值断言）`() = runTest {
        val api = FakeApi(
            metaDto = SyncMetaDto("srv", 1, 2, "c2"),
            pages = mutableListOf(
                SyncImagesPageDto(listOf(item(1)), "c1", true),
                SyncImagesPageDto(listOf(item(2)), "c2", false),
            ),
            ids = listOf(1, 2),
        )
        // 在每页落库时刻对 progress.value 拍快照：fake 全程无真实挂起点，
        // Turbine 订阅只能看到 Idle→Done（conflation），探针才能看到中间态
        val probes = mutableListOf<SyncPhase>()
        lateinit var engine: SyncEngine
        val store = object : InMemoryStore() {
            override suspend fun applyImagePage(items: List<SyncImageItemDto>) {
                super.applyImagePage(items)
                probes += engine.progress.value
            }
        }
        engine = SyncEngine(api, store, pageLimit = 1, now = now)
        engine.sync()

        assertEquals(listOf<SyncPhase>(SyncPhase.FullSync(0, 2), SyncPhase.FullSync(1, 2)), probes)
        assertEquals(SyncPhase.Done, engine.progress.value)
    }
}
