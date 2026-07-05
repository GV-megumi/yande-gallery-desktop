package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** M3-T13: 选择栏与可多选格子的 Compose 冒烟（Robolectric）。 */
@RunWith(RobolectricTestRunner::class)
class SelectionBarsTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `顶栏显示已选数量并回调全选与取消`() {
        var selectAll = 0
        var cancel = 0
        compose.setContent {
            SelectionTopBar(count = 3, onSelectAll = { selectAll++ }, onCancel = { cancel++ })
        }

        compose.onNodeWithText("已选 3 项").assertIsDisplayed()
        compose.onNodeWithTag("selection_select_all").performClick()
        compose.onNodeWithTag("selection_cancel").performClick()

        assertEquals(1, selectAll)
        assertEquals(1, cancel)
    }

    @Test
    fun `底部栏离线置灰写动作——下载分享仍可用`() {
        compose.setContent {
            SelectionBottomBar(
                online = false,
                inGallery = true,
                onDownload = {}, onShare = {}, onDelete = {}, onAddToGallery = {},
                onRemoveFromGallery = {},
            )
        }

        compose.onNodeWithTag("selection_action_download").assertIsEnabled()
        compose.onNodeWithTag("selection_action_share").assertIsEnabled()
        compose.onNodeWithTag("selection_action_delete").assertIsNotEnabled()
        compose.onNodeWithTag("selection_action_add_to_gallery").assertIsNotEnabled()
        compose.onNodeWithTag("selection_action_remove_from_gallery").assertIsNotEnabled()
    }

    @Test
    fun `底部栏非图集上下文——无移出图集项`() {
        compose.setContent {
            SelectionBottomBar(
                online = true,
                inGallery = false,
                onDownload = {}, onShare = {}, onDelete = {}, onAddToGallery = {},
            )
        }

        compose.onNodeWithTag("selection_action_remove_from_gallery").assertDoesNotExist()
        compose.onNodeWithTag("selection_action_delete").assertIsEnabled()
    }

    @Test
    fun `格子非多选态——单击开大图，长按进多选`() {
        var open = 0
        var toggle = 0
        compose.setContent {
            SelectableCell(
                selected = false,
                selectionActive = false,
                onOpen = { open++ },
                onToggle = { toggle++ },
                modifier = Modifier.size(48.dp),
            ) { Box(Modifier.size(48.dp)) }
        }

        compose.onRoot().performClick()
        assertEquals(1, open)
        assertEquals(0, toggle)

        compose.onRoot().performTouchInput { longClick() }
        assertEquals(1, open)
        assertEquals(1, toggle)
    }

    @Test
    fun `格子多选态——单击切换选中且选中显示角标`() {
        var open = 0
        var toggle = 0
        compose.setContent {
            SelectableCell(
                selected = true,
                selectionActive = true,
                onOpen = { open++ },
                onToggle = { toggle++ },
                modifier = Modifier.size(48.dp),
            ) { Box(Modifier.size(48.dp)) }
        }

        // 角标在 combinedClickable 的合并语义树内——用未合并树查找
        compose.onNodeWithTag("selection_badge", useUnmergedTree = true).assertExists()
        compose.onRoot().performClick()
        assertEquals(0, open)
        assertEquals(1, toggle)
    }
}
