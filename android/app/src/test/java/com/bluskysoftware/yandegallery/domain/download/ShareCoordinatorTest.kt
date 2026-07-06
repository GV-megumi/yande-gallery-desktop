package com.bluskysoftware.yandegallery.domain.download

import androidx.work.WorkInfo
import com.bluskysoftware.yandegallery.data.db.ImageEntity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareCoordinatorTest {
    private fun img(id: Long) = ImageEntity(id, "f$id.jpg", 1, 1, 1L, "jpg", "2026", "2026")

    @Test fun `全部已下载直接返回 不入队`() = runTest {
        var enqueued = 0
        val c = ShareCoordinator(
            isDownloaded = { "content://$it" },
            enqueue = { enqueued++ },
            observeState = { MutableStateFlow(null) },
            exists = { true },
            clearStaleRow = {},
        )
        val r = c.ensureDownloadedUris(listOf(img(1), img(2)))
        assertEquals(listOf("content://1", "content://2"), r.uris)
        assertTrue(r.failedIds.isEmpty())
        assertEquals(0, enqueued)
    }

    @Test fun `缺失项入队等待成功后重查回uri`() = runTest {
        val row = mutableMapOf<Long, String>()
        val state = MutableStateFlow<WorkInfo.State?>(null)
        val c = ShareCoordinator(
            isDownloaded = { row[it] },
            enqueue = { image -> row[image.id] = "content://dl-${image.id}"; state.value = WorkInfo.State.SUCCEEDED },
            observeState = { state },
            exists = { true },
            clearStaleRow = {},
        )
        val r = c.ensureDownloadedUris(listOf(img(9)))
        assertEquals(listOf("content://dl-9"), r.uris)
    }

    @Test fun `失败项归入 failedIds 保留成功集`() = runTest {
        val state = MutableStateFlow<WorkInfo.State?>(WorkInfo.State.FAILED)
        val c = ShareCoordinator(
            isDownloaded = { if (it == 1L) "content://1" else null },
            enqueue = {},
            observeState = { state },
            exists = { true },
            clearStaleRow = {},
        )
        val r = c.ensureDownloadedUris(listOf(img(1), img(2)))
        assertEquals(listOf("content://1"), r.uris)
        assertEquals(listOf(2L), r.failedIds)
    }

    @Test fun `失效映射先清行再按未下载重下`() = runTest {
        var cleared = 0
        val fresh = mutableMapOf(5L to "content://stale")
        val state = MutableStateFlow<WorkInfo.State?>(null)
        val c = ShareCoordinator(
            isDownloaded = { fresh[it] },
            enqueue = { image -> fresh[image.id] = "content://fresh"; state.value = WorkInfo.State.SUCCEEDED },
            observeState = { state },
            exists = { it != "content://stale" },   // 旧 uri 文件已被用户删除
            clearStaleRow = { cleared++; fresh.remove(it) },
        )
        val r = c.ensureDownloadedUris(listOf(img(5)))
        assertEquals(1, cleared)
        assertEquals(listOf("content://fresh"), r.uris)
    }
}
