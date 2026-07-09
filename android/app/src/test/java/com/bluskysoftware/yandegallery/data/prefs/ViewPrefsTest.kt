package com.bluskysoftware.yandegallery.data.prefs

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// Robolectric 与 PrefsStoreTest 装置一致，且为落盘正确性所必需：datastore 1.2.1 的
// atomicMoveTo 在 SDK_INT<26（纯 JVM 单测里恒为 0）退回 File.renameTo，Windows 上
// 目标文件已存在时 rename 失败 → 第二次写盘必抛 IOException；Robolectric 提供
// SDK_INT≥26 走 NIO Files.move(REPLACE_EXISTING)。
@RunWith(RobolectricTestRunner::class)
@OptIn(ExperimentalCoroutinesApi::class)
class ViewPrefsTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private fun kotlinx.coroutines.test.TestScope.newStore(): PrefsStore = PrefsStore(
        PreferenceDataStoreFactory.create(
            scope = kotlinx.coroutines.CoroutineScope(backgroundScope.coroutineContext + UnconfinedTestDispatcher(testScheduler)),
            // 与 PrefsStoreTest 装置同款「建后即删」：Windows 上 DataStore 落盘靠 rename，
            // 目标文件若已存在（newFile 预创建）rename 失败抛 IOException
        ) { tmp.newFile("view_prefs_${System.nanoTime()}.preferences_pb").also { it.delete() } },
    )

    // 驱动 backgroundScope 用 runCurrent 而非 advanceUntilIdle：后者在队列只剩后台任务时
    // 直接返回（TestCoroutineScheduler 只保证前台任务跑完），ViewPrefs 的回填/持久化协程
    // 全在 backgroundScope，advanceUntilIdle 一个都不会执行。

    @Test
    fun `setter 即改内存态并落盘`() = runTest {
        val store = newStore()
        val prefs = ViewPrefs(store, backgroundScope)
        prefs.setPhotoSort(PhotoSort.SIZE_DESC)
        prefs.setAlbumsSort(AlbumSort.MANUAL)
        prefs.setDetailSort(PhotoSort.NAME_ASC)
        prefs.setDetailColumns(5)
        assertEquals(PhotoSort.SIZE_DESC, prefs.photoSort.value)   // 内存态即时
        testScheduler.runCurrent()
        assertEquals("SIZE_DESC", store.photosSortName.first())    // 已落盘
        assertEquals("MANUAL", store.albumsSortName.first())
        assertEquals("NAME_ASC", store.albumDetailSortName.first())
        assertEquals(5, store.albumDetailColumns.first())
    }

    @Test
    fun `冷启动回填持久化值且非法列数夹取`() = runTest {
        val store = newStore()
        store.setPhotosSortName("NAME_DESC")
        store.setAlbumDetailColumns(99)
        val prefs = ViewPrefs(store, backgroundScope)
        testScheduler.runCurrent()
        assertEquals(PhotoSort.NAME_DESC, prefs.photoSort.value)
        assertEquals(5, prefs.detailColumns.value)   // coerceIn 3..5
        assertEquals(AlbumSort.NAME_ASC, prefs.albumsSort.value)  // 未存过 → 默认
    }

    @Test
    fun `回填前用户已切档则不回冲`() = runTest {
        val store = newStore()
        store.setPhotosSortName("NAME_DESC")
        val prefs = ViewPrefs(store, backgroundScope)
        prefs.setPhotoSort(PhotoSort.SIZE_ASC)   // 回填协程跑起来前抢先操作
        testScheduler.runCurrent()
        assertEquals(PhotoSort.SIZE_ASC, prefs.photoSort.value)   // compareAndSet 不回冲
    }
}
