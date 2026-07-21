package com.bluskysoftware.yandegallery.data.prefs

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.bluskysoftware.yandegallery.awaitValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class PrefsStoreDeviceTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    // .also { it.delete() }：createTempFile 会先落一个 0 字节空文件占位，Windows JVM 的
    // File.renameTo 目标存在时直接返回 false（同 ImageMirrorStore 的 renameTo 注释），
    // DataStore 首次落盘走 tmp→目标 rename 会因此报 "Unable to rename" IOException；
    // 删掉占位空文件后 DataStore 自己首次写入时创建，规避该 Windows 专属坑（照 PrefsStoreTest 既有写法）。
    private val file = File.createTempFile("device_prefs_test", ".preferences_pb").also { it.delete() }
    private val store = PrefsStore(PreferenceDataStoreFactory.create(scope = scope) { file })

    @After fun teardown() { scope.cancel(); file.delete() }

    @Test
    fun `待落地相册_增删读`() = runTest {
        assertEquals(emptySet<String>(), store.devicePendingAlbums.first())
        store.addPendingAlbum("旅行")
        store.addPendingAlbum("美食")
        awaitValue({ store.devicePendingAlbums.first() }) { it == setOf("旅行", "美食") }
        store.removePendingAlbum("旅行")
        awaitValue({ store.devicePendingAlbums.first() }) { it == setOf("美食") }
    }
}
