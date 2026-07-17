package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.bluskysoftware.yandegallery.data.db.GalleryEntity
import com.bluskysoftware.yandegallery.data.device.BucketKey
import com.bluskysoftware.yandegallery.data.device.DeviceAlbum
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * [CopyTargetPicker] compose 契约（Task 11，spec §6.1/§6.2）：桌面相册节恒在（excludeIds 过滤自指、
 * 空态文案），手机相册节仅 Copy 模式且 deviceEnabled 时渲染（Move 模式硬编码永不渲染，spec D5）；
 * 点选两节分别回调 galleryId / relativePath；内联新建镜像 DeviceAlbumPicker 语义（错误就地显示、
 * 成功以 Pictures/<名>/ 回调）。
 */
@RunWith(RobolectricTestRunner::class)
class CopyTargetPickerTest {
    @get:Rule
    val compose = createComposeRule()

    private fun gallery(id: Long, name: String) = GalleryEntity(id, name, null, 0)

    private fun deviceAlbum(id: Long, name: String, path: String) = DeviceAlbum(
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

    private fun setPicker(
        mode: PickerMode,
        galleries: List<GalleryEntity> = listOf(gallery(1, "旅行"), gallery(2, "风景")),
        deviceAlbums: List<DeviceAlbum> = emptyList(),
        deviceEnabled: Boolean = false,
        canCreateDeviceAlbum: Boolean = false,
        excludeIds: Set<Long> = emptySet(),
        onPickGallery: (Long) -> Unit = {},
        onPickDeviceAlbum: (String) -> Unit = {},
        onCreateDeviceAlbum: (String) -> String? = { null },
    ) {
        compose.setContent {
            CopyTargetPicker(
                mode = mode,
                galleries = galleries,
                deviceAlbums = deviceAlbums,
                deviceEnabled = deviceEnabled,
                canCreateDeviceAlbum = canCreateDeviceAlbum,
                onPickGallery = onPickGallery,
                onPickDeviceAlbum = onPickDeviceAlbum,
                onCreateDeviceAlbum = onCreateDeviceAlbum,
                onDismiss = {},
                excludeIds = excludeIds,
            )
        }
    }

    @Test
    fun `Copy模式_两节齐全_标题复制到`() {
        setPicker(
            mode = PickerMode.Copy,
            deviceAlbums = listOf(deviceAlbum(1, "Camera", "DCIM/Camera/"), pending("新建中")),
            deviceEnabled = true,
            canCreateDeviceAlbum = true,
        )
        compose.onNodeWithText("复制到").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_section_gallery").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_section_device").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_gallery_1").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_gallery_2").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_device_b1").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_device_p新建中").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_create_device").assertIsDisplayed()
    }

    @Test
    fun `Copy模式_deviceEnabled为false隐藏手机节`() {
        setPicker(
            mode = PickerMode.Copy,
            deviceAlbums = listOf(deviceAlbum(1, "Camera", "DCIM/Camera/")),
            deviceEnabled = false,
            canCreateDeviceAlbum = true,
        )
        compose.onNodeWithTag("copy_picker_section_gallery").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_section_device").assertDoesNotExist()
        compose.onNodeWithTag("copy_picker_device_b1").assertDoesNotExist()
        compose.onNodeWithTag("copy_picker_create_device").assertDoesNotExist()
    }

    @Test
    fun `Move模式_手机节永不渲染_标题移动到`() {
        // deviceEnabled=true 也不得渲染（spec D5 硬编码非参数）
        setPicker(
            mode = PickerMode.Move,
            deviceAlbums = listOf(deviceAlbum(1, "Camera", "DCIM/Camera/")),
            deviceEnabled = true,
            canCreateDeviceAlbum = true,
        )
        compose.onNodeWithText("移动到").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_gallery_1").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_section_device").assertDoesNotExist()
        compose.onNodeWithTag("copy_picker_device_b1").assertDoesNotExist()
        compose.onNodeWithTag("copy_picker_create_device").assertDoesNotExist()
    }

    @Test
    fun `excludeIds滤自指_两模式同语义`() {
        setPicker(mode = PickerMode.Move, excludeIds = setOf(1L))
        compose.onNodeWithTag("copy_picker_gallery_2").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_gallery_1").assertDoesNotExist()
    }

    @Test
    fun `过滤后为空复用空态文案`() {
        setPicker(mode = PickerMode.Copy, galleries = listOf(gallery(1, "旅行")), excludeIds = setOf(1L))
        compose.onNodeWithText("暂无相册，可先在相册 tab 新建").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_gallery_1").assertDoesNotExist()
    }

    @Test
    fun `点桌面相册回调id_点手机相册回调路径`() {
        var pickedGallery: Long? = null
        var pickedPath: String? = null
        setPicker(
            mode = PickerMode.Copy,
            deviceAlbums = listOf(deviceAlbum(1, "Camera", "DCIM/Camera/")),
            deviceEnabled = true,
            onPickGallery = { pickedGallery = it },
            onPickDeviceAlbum = { pickedPath = it },
        )
        compose.onNodeWithTag("copy_picker_gallery_2").performClick()
        assertEquals(2L, pickedGallery)
        compose.onNodeWithTag("copy_picker_device_b1").performClick()
        assertEquals("DCIM/Camera/", pickedPath)
    }

    @Test
    fun `手机节滤不可写路径与聚合卡`() {
        setPicker(
            mode = PickerMode.Copy,
            deviceAlbums = listOf(
                deviceAlbum(1, "Camera", "DCIM/Camera/"),
                deviceAlbum(2, "Download", "Download/"),   // 三方写入限 DCIM/ 与 Pictures/（spec §5.3）
                DeviceAlbum(BucketKey.All, "全部照片", null, 9, null, false),   // 聚合卡 path=null 非法目标
            ),
            deviceEnabled = true,
        )
        compose.onNodeWithTag("copy_picker_device_b1").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_device_b2").assertDoesNotExist()
        compose.onNodeWithTag("copy_picker_device_all").assertDoesNotExist()
    }

    @Test
    fun `新建重名错误文案就地显示且不回调`() {
        var pickedPath: String? = null
        setPicker(
            mode = PickerMode.Copy,
            deviceEnabled = true,
            canCreateDeviceAlbum = true,
            onPickDeviceAlbum = { pickedPath = it },
            onCreateDeviceAlbum = { "已存在同名相册" },
        )
        compose.onNodeWithTag("copy_picker_create_device").performClick()
        compose.onNodeWithTag("copy_picker_create_name").performTextInput("Camera")
        compose.onNodeWithTag("copy_picker_create_confirm").performClick()
        compose.onNodeWithText("已存在同名相册").assertIsDisplayed()
        assertNull(pickedPath)
    }

    @Test
    fun `新建成功以Pictures路径回调`() {
        var pickedPath: String? = null
        setPicker(
            mode = PickerMode.Copy,
            deviceEnabled = true,
            canCreateDeviceAlbum = true,
            onPickDeviceAlbum = { pickedPath = it },
            onCreateDeviceAlbum = { null },
        )
        compose.onNodeWithTag("copy_picker_create_device").performClick()
        compose.onNodeWithTag("copy_picker_create_name").performTextInput("旅行相册")
        compose.onNodeWithTag("copy_picker_create_confirm").performClick()
        assertEquals("Pictures/旅行相册/", pickedPath)
    }

    @Test
    fun `canCreateDeviceAlbum为false时无新建行`() {
        setPicker(
            mode = PickerMode.Copy,
            deviceAlbums = listOf(deviceAlbum(1, "Camera", "DCIM/Camera/")),
            deviceEnabled = true,
            canCreateDeviceAlbum = false,
        )
        compose.onNodeWithTag("copy_picker_device_b1").assertIsDisplayed()
        compose.onNodeWithTag("copy_picker_create_device").assertDoesNotExist()
    }
}
