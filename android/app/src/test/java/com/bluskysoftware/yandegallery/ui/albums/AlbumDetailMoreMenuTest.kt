package com.bluskysoftware.yandegallery.ui.albums

import androidx.compose.foundation.layout.Box
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import com.bluskysoftware.yandegallery.data.prefs.PhotoSort
import com.bluskysoftware.yandegallery.data.prefs.PhotoSortField
import com.bluskysoftware.yandegallery.ui.theme.YandeGalleryTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * 详情页「⋯」菜单的组件级契约：page 插槽按裸字符串 key（"sort"/"columns"）分发，
 * key 打错编译照过、表现为「二级页只剩返回行的空白页」——此处钉住两条 key 的真实接线
 * （照片页/相册页的同构结构有屏级测试兜着，详情页是唯一有「列数」二级的页面）。
 */
@RunWith(RobolectricTestRunner::class)
class AlbumDetailMoreMenuTest {
    @get:Rule
    val rule = createComposeRule()

    private fun setMenu(
        sort: PhotoSort = PhotoSort.TIME_DESC,
        columns: Int = 4,
        onSortField: (PhotoSortField) -> Unit = {},
        onColumns: (Int) -> Unit = {},
    ) {
        rule.setContent {
            YandeGalleryTheme {
                Box {
                    AlbumDetailMoreMenu(
                        expanded = true,
                        sort = sort,
                        columns = columns,
                        onDismiss = {},
                        onSortField = onSortField,
                        onColumns = onColumns,
                    )
                }
            }
        }
    }

    @Test
    fun `排序二级页接线_明细行可达且点击回调字段`() {
        var picked: PhotoSortField? = null
        setMenu(onSortField = { picked = it })
        rule.onNodeWithTag("menu_group_sort").assertIsDisplayed().performClick()
        rule.waitForIdle()
        // key="sort" 分发成功：明细行真实渲染（key 打错时这里是空白二级页）
        rule.onNodeWithTag("detail_sort_option_size").assertIsDisplayed().performClick()
        assertEquals(PhotoSortField.SIZE, picked)
    }

    @Test
    fun `列数二级页接线_档位行可达且点击回调列数`() {
        var picked = -1
        setMenu(columns = 4, onColumns = { picked = it })
        rule.onNodeWithTag("menu_group_columns").assertIsDisplayed().performClick()
        rule.waitForIdle()
        // key="columns" 分发成功：3/4/5 档全部渲染，点 3 列回调 3
        rule.onNodeWithTag("detail_columns_5").assertIsDisplayed()
        rule.onNodeWithTag("detail_columns_3").assertIsDisplayed().performClick()
        assertEquals(3, picked)
    }

    @Test
    fun `当前列数档位显示选中勾`() {
        setMenu(columns = 4)
        rule.onNodeWithTag("menu_group_columns").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("detail_columns_4_check", useUnmergedTree = true).assertIsDisplayed()
        rule.onNodeWithTag("detail_columns_3_check", useUnmergedTree = true).assertDoesNotExist()
    }
}
