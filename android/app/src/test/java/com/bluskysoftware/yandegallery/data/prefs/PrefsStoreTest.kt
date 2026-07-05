package com.bluskysoftware.yandegallery.data.prefs

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class PrefsStoreTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val tmp = File.createTempFile("prefs-test", ".preferences_pb").also { it.delete() }
    private val store = PrefsStore(PreferenceDataStoreFactory.create(scope = scope) { tmp })

    @After fun teardown() { scope.cancel(); tmp.delete() }

    @Test fun `档位默认未设置为 null 设置后读回`() = runTest {
        assertNull(store.densityTierName.first())
        store.setDensityTierName("DAY_3")
        assertEquals("DAY_3", store.densityTierName.first())
    }

    @Test fun `缓存上限默认 2G与1G 可改并持久`() = runTest {
        assertEquals(2L * 1024 * 1024 * 1024, store.thumbnailCacheMaxBytes.first())
        assertEquals(1L * 1024 * 1024 * 1024, store.previewCacheMaxBytes.first())
        store.setThumbnailCacheMaxBytes(4L * 1024 * 1024 * 1024)
        store.setPreviewCacheMaxBytes(512L * 1024 * 1024)
        assertEquals(4L * 1024 * 1024 * 1024, store.thumbnailCacheMaxBytes.first())
        assertEquals(512L * 1024 * 1024, store.previewCacheMaxBytes.first())
    }
}
