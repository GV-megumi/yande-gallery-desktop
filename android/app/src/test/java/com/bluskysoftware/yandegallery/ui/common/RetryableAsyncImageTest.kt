package com.bluskysoftware.yandegallery.ui.common

import android.content.Context
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import coil3.Uri as CoilUri
import coil3.fetch.Fetcher
import coil3.request.Options
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalFoundationApi::class)
@RunWith(RobolectricTestRunner::class)
class RetryableAsyncImageTest {
    @get:Rule val rule = createComposeRule()

    @Test fun `失败占位渲染且点按触发重试回调`() {
        var retries = 0
        rule.setContent { ImageErrorPlaceholder(dark = false, onRetry = { retries++ }) }
        rule.onNodeWithTag("image_error_placeholder").assertIsDisplayed().performClick()
        assertEquals(1, retries)
    }

    @Test fun `黑底样式渲染不崩`() {
        rule.setContent { ImageErrorPlaceholder(dark = true, onRetry = {}) }
        rule.onNodeWithTag("image_error_placeholder").assertIsDisplayed()
    }

    /**
     * 加固轮 C 类（spec §3/H4）：重试角标两态恒渲染（视觉一致）——默认模式下也存在且点按触发
     * 重试**恰一次**（角标消费 up 后，占位整面 clickable 不得再叠加一次重试）。
     */
    @Test fun `默认模式角标恒渲染_点按角标触发重试恰一次`() {
        var retries = 0
        rule.setContent { ImageErrorPlaceholder(dark = false, onRetry = { retries++ }) }
        rule.onNodeWithTag("image_error_retry_badge", useUnmergedTree = true)
            .assertIsDisplayed()
            .performClick()
        assertEquals(1, retries)
    }

    /**
     * 加固轮 C 类（spec §3/H4 手势让位）：gesturePassthrough=true 时失败占位面不消费点击——
     * 透传给外层（生产中即 SelectableCell 的 combinedClickable 选择路由）；重试改由右下角
     * 角标按钮单独承载（点按角标真的重发请求，且不泄漏给外层）。
     * 占位/角标查询须 useUnmergedTree：透传模式下占位无自身 clickable，testTag 会被外层
     * clickable 的 mergeDescendants 吸并，合并树查不到。
     */
    @Test fun `gesturePassthrough时占位不消费点击_角标按钮承载重试`() {
        val failing = AlwaysFailFetcherFactory()
        var outerClicked = 0
        rule.setContent {
            val context = LocalContext.current
            // loader 必须 remember：重组重建 loader 会重发请求，attempts 计数失真
            // （DeviceAlbumDetailScreenTest 同款坑）
            val loader = remember { failingLoader(context, failing) }
            Box(Modifier.size(96.dp).clickable { outerClicked++ }) {
                RetryableAsyncImage(
                    model = "http://test.local/fail.png",
                    imageLoader = loader,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.matchParentSize(),
                    gesturePassthrough = true,
                )
            }
        }
        rule.waitUntil(timeoutMillis = 5_000) {
            rule.onAllNodesWithTag("image_error_placeholder", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals("挂出占位前应恰好请求一次", 1, failing.attempts)

        // 点占位面中心（角标在右下角，不重叠）：应透传外层，不触发重试
        rule.onNodeWithTag("image_error_placeholder", useUnmergedTree = true).performClick()
        rule.waitForIdle()
        assertEquals("点击应透传外层（现状缺陷：被占位 clickable 吞掉）", 1, outerClicked)
        assertEquals("占位面点击不得触发重试", 1, failing.attempts)

        // 点角标：触发重试（重发请求恰一次），且不泄漏给外层
        rule.onNodeWithTag("image_error_retry_badge", useUnmergedTree = true).performClick()
        rule.waitUntil(timeoutMillis = 5_000) { failing.attempts >= 2 }
        assertEquals("角标点按触发重试（重发请求恰一次）", 2, failing.attempts)
        assertEquals("角标点按不得泄漏给外层", 1, outerClicked)
    }

    /** 加固轮 C 类（spec §3/H4）：长按恒透传——透传模式下占位面长按到达外层（生产中即进多选/切选中）。 */
    @Test fun `gesturePassthrough时长按透传外层`() {
        val failing = AlwaysFailFetcherFactory()
        var outerLongClicked = 0
        rule.setContent {
            val context = LocalContext.current
            val loader = remember { failingLoader(context, failing) }
            Box(
                Modifier
                    .size(96.dp)
                    .combinedClickable(onClick = {}, onLongClick = { outerLongClicked++ }),
            ) {
                RetryableAsyncImage(
                    model = "http://test.local/fail.png",
                    imageLoader = loader,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.matchParentSize(),
                    gesturePassthrough = true,
                )
            }
        }
        rule.waitUntil(timeoutMillis = 5_000) {
            rule.onAllNodesWithTag("image_error_placeholder", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag("image_error_placeholder", useUnmergedTree = true)
            .performTouchInput { longClick() }
        rule.waitForIdle()
        assertEquals("长按应透传外层（现状缺陷：被占位 clickable 吞掉）", 1, outerLongClicked)
    }

    /**
     * 加固轮 C 类（spec §3/H4 长按恒透传，含角标自身）：角标只承载点按重试；在角标上长按同样
     * 透传外层（长按永远进入/切换选择），且不得在松手时误触重试。
     */
    @Test fun `gesturePassthrough时角标长按透传外层且不触发重试`() {
        val failing = AlwaysFailFetcherFactory()
        var outerLongClicked = 0
        rule.setContent {
            val context = LocalContext.current
            val loader = remember { failingLoader(context, failing) }
            Box(
                Modifier
                    .size(96.dp)
                    .combinedClickable(onClick = {}, onLongClick = { outerLongClicked++ }),
            ) {
                RetryableAsyncImage(
                    model = "http://test.local/fail.png",
                    imageLoader = loader,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.matchParentSize(),
                    gesturePassthrough = true,
                )
            }
        }
        rule.waitUntil(timeoutMillis = 5_000) {
            rule.onAllNodesWithTag("image_error_retry_badge", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag("image_error_retry_badge", useUnmergedTree = true)
            .performTouchInput { longClick() }
        rule.waitForIdle()
        assertEquals("角标长按应透传外层进多选", 1, outerLongClicked)
        assertEquals("角标长按松手不得误触重试", 1, failing.attempts)
    }
}

/** 装配辅助：恒失败 fetcher + Unconfined 协程上下文（请求同线程同步落定，消除 waitForIdle 竞态）。 */
private fun failingLoader(context: Context, factory: AlwaysFailFetcherFactory): ImageLoader =
    ImageLoader.Builder(context)
        .components { add(factory) }
        .coroutineContext(Dispatchers.Unconfined)
        .build()

/**
 * 测试专用恒失败 Fetcher（DeviceAlbumDetailScreenTest.AlwaysSucceedFetcherFactory 的对偶）：
 * fetch() 直接抛错让请求确定性落 Error 态、挂出 ImageErrorPlaceholder——不走真实网络管线，
 * Robolectric 下无 DNS/超时抖动。attempts 计数供断言「角标点按真的重发了请求」与「占位面/
 * 角标长按没有触发重试」。既有坑照搬：泛型锚 coil3.Uri（String model 先被内建 StringMapper
 * 映射成 coil3.Uri，锚别的类型永远不会被选中）；用户自注册组件优先于内建组件参与匹配。
 * Unconfined 下 fetch 与调用方同线程，计数无并发问题。
 */
private class AlwaysFailFetcherFactory : Fetcher.Factory<CoilUri> {
    var attempts = 0
    override fun create(data: CoilUri, options: Options, imageLoader: ImageLoader): Fetcher = Fetcher {
        attempts++
        throw IOException("测试恒失败：驱动 Error 态")
    }
}
