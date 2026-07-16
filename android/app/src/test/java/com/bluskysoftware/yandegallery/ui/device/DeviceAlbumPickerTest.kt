package com.bluskysoftware.yandegallery.ui.device

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * [DeviceAlbumPicker] compose 契约（Task 7，spec §5.3/§5.5）：只列可写路径（DCIM//Pictures/）
 * 的真实相册 + 待落地相册、excludeKey 滤当前相册防自指、canCreate 门控「新建相册」行、
 * 新建重名错误文案就地显示与成功后以 Pictures/<名>/ 回调 onPick。
 * 纯无状态组件冒烟，装置对照 GalleryPickerDialogTest（该文件 Task 11 删除，不共用装置）。
 */
@RunWith(RobolectricTestRunner::class)
class DeviceAlbumPickerTest {
    @get:Rule
    val compose = createComposeRule()

    private fun album(id: Long, name: String, path: String) = DeviceAlbum(
        key = BucketKey.Bucket(id),
        name = name,
        relativePath = path,
        count = 3,
        coverUri = null,
        isPending = false,
    )

    private fun pending(name: String) = DeviceAlbum(
        key = BucketKey.Pending(name),
        name = name,
        relativePath = "Pictures/$name/",
        count = 0,
        coverUri = null,
        isPending = true,
    )

    @Test
    fun `非法路径相册不出现_待落地相册出现`() {
        compose.setContent {
            DeviceAlbumPicker(
                albums = listOf(
                    album(1, "Camera", "DCIM/Camera/"),
                    album(2, "Download", "Download/"),   // 三方写入限 DCIM/ 与 Pictures/（spec §5.3）
                    pending("旅行"),
                ),
                canCreate = true,
                excludeKey = null,
                onPick = {},
                onCreate = { null },
                onDismiss = {},
            )
        }
        compose.onNodeWithTag("device_pick_b1").assertIsDisplayed()
        compose.onNodeWithTag("device_pick_p旅行").assertIsDisplayed()
        compose.onNodeWithTag("device_pick_b2").assertDoesNotExist()
    }

    @Test
    fun `excludeKey滤掉当前相册防自指`() {
        compose.setContent {
            DeviceAlbumPicker(
                albums = listOf(
                    album(1, "Camera", "DCIM/Camera/"),
                    album(2, "Pics", "Pictures/Pics/"),
                ),
                canCreate = true,
                excludeKey = BucketKey.Bucket(2),
                onPick = {},
                onCreate = { null },
                onDismiss = {},
            )
        }
        compose.onNodeWithTag("device_pick_b1").assertIsDisplayed()
        compose.onNodeWithTag("device_pick_b2").assertDoesNotExist()
    }

    @Test
    fun `canCreate为false时无新建相册行`() {
        compose.setContent {
            DeviceAlbumPicker(
                albums = listOf(album(1, "Camera", "DCIM/Camera/")),
                canCreate = false,
                excludeKey = null,
                onPick = {},
                onCreate = { null },
                onDismiss = {},
            )
        }
        compose.onNodeWithTag("device_pick_b1").assertIsDisplayed()
        compose.onNodeWithTag("device_pick_create").assertDoesNotExist()
    }

    @Test
    fun `新建重名错误文案就地显示且不回调onPick`() {
        var picked: String? = null
        compose.setContent {
            DeviceAlbumPicker(
                albums = listOf(album(1, "Camera", "DCIM/Camera/")),
                canCreate = true,
                excludeKey = null,
                onPick = { picked = it },
                onCreate = { "已存在同名相册" },
                onDismiss = {},
            )
        }
        compose.onNodeWithTag("device_pick_create").performClick()
        compose.onNodeWithTag("device_pick_create_name").performTextInput("Camera")
        compose.onNodeWithTag("device_pick_create_confirm").performClick()
        compose.onNodeWithText("已存在同名相册").assertIsDisplayed()
        assertNull(picked)
    }

    @Test
    fun `新建成功以Pictures路径回调onPick`() {
        var picked: String? = null
        compose.setContent {
            DeviceAlbumPicker(
                albums = emptyList(),
                canCreate = true,
                excludeKey = null,
                onPick = { picked = it },
                onCreate = { null },
                onDismiss = {},
            )
        }
        compose.onNodeWithTag("device_pick_create").performClick()
        compose.onNodeWithTag("device_pick_create_name").performTextInput("旅行")
        compose.onNodeWithTag("device_pick_create_confirm").performClick()
        assertEquals("Pictures/旅行/", picked)
    }

    @Test
    fun `点选真实相册回调其relativePath`() {
        var picked: String? = null
        compose.setContent {
            DeviceAlbumPicker(
                albums = listOf(album(1, "Camera", "DCIM/Camera/")),
                canCreate = true,
                excludeKey = null,
                onPick = { picked = it },
                onCreate = { null },
                onDismiss = {},
            )
        }
        compose.onNodeWithTag("device_pick_b1").performClick()
        assertEquals("DCIM/Camera/", picked)
    }
}
