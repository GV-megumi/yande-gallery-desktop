# 安卓 UI 重塑（仿 MIUI 相册）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `doc/superpowers/specs/2026-07-08-android-miui-ui-redesign-design.md`，把 v0.4.1 的 Material 3 默认皮重塑为组件级仿 MIUI 相册观感（v0.5.0），行为契约与 testTag 全保留（唯一改名 `albums_new_fab`→`albums_new`）。

**Architecture:** 三层推进——①theme 基座（配色/字号/形状/edge-to-edge）②共享组件（MiuiDialog/MiuiWidgets/MiuiTopBars/网格 tokens）③逐页接入（壳→设置族→照片→相册→大图→搜索）。数据层/VM/交互逻辑零改动。

**Tech Stack:** Jetpack Compose + Material3（自定义配色与组件皮）、Robolectric 单测（`createComposeRule`）。

---

## 全局约定

- **测试命令**（git-bash，仓库根执行）：
  `cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest"`
  预期尾行 `BUILD SUCCESSFUL`；基线 314 例。首跑若遇 DataStore 类偶发 UncompletedCoroutinesError，重跑一次即绿（Robolectric 冷缓存 flake，见 memory）。
- **每个 Task 结束**：全量单测绿 → `git add -A && git commit`（中文 message，前缀 `feat(android):` / `refactor(android):`）。
- **不改**：任何 ViewModel 业务逻辑、写路径、同步、下载状态机；PhotosScreen 的捏合/锚定/快滚索引数学（folding 头方案已避开索引偏移）。
- 图标库 `material-icons-extended` 已在依赖（`app/build.gradle.kts:63`），Outlined 变体可直接用。

## 文件结构总览

| 文件 | 动作 | 职责 |
|---|---|---|
| `ui/theme/Color.kt` `Type.kt` `Theme.kt` | 重写 | 配色表/字号层级/shapes + 系统栏图标色 |
| `ui/theme/Tokens.kt` | 新建 | 网格缝隙/圆角/顶栏高度常量（三网格统一取此处） |
| `MainActivity.kt` | 修改 | enableEdgeToEdge + PhotosScreen 新参数接线 |
| `ui/photos/TimelineModels.kt` | 修改 | MIUI 日期头 formatter（今天/昨天/周X）+ viewer 日期标签 |
| `ui/common/MiuiDialog.kt` | 新建 | 统一弹窗（等宽双胶囊按钮） |
| `ui/common/MiuiWidgets.kt` | 新建 | SubPageTopBar/CardGroup/ListItem/TextField/胶囊按钮 |
| `ui/common/MiuiTopBars.kt` | 新建 | tab 页折叠大标题（nestedScroll exitUntilCollapsed）+ 常驻顶栏 |
| `ui/AppNav.kt` | 重写壳 | 去 topBar 槽、MiuiNavBar 替换 NavigationBar、桥瘦身 |
| `ui/common/PhotosSelectionBars.kt` | 修改 | Model 瘦身为底栏五字段 |
| `ui/photos/PhotosScreen.kt` | 修改 | 顶部区域自持 + 网格样式 + sticky 滚动显隐 |
| `ui/albums/AlbumsScreen.kt` `AlbumDetailScreen.kt` | 修改 | 去 FAB/顶栏「+」/封面卡片；居中双行顶栏 |
| `ui/viewer/ViewerScreen.kt` `ViewerActionBar.kt` | 修改 | 上下渐变 chrome + 日期时间 + fade |
| `ui/search/SearchScreen.kt` | 修改 | 胶囊搜索框 + 胶囊历史 chip |
| `ui/settings/SettingsScreen.kt` `CacheScreen.kt`、`ui/servers/*Screen.kt` | 修改 | 卡片分组/表单/服务器卡片 |
| `ui/common/SelectionBars.kt` `ConnectionBanner.kt` `FastScrollbar.kt` `GalleryPickerDialog.kt` | 修改 | 多选栏换皮/横幅柔和/把手细条/选择器弹窗 |
| 测试 | 适配+新增 | 详见各 Task；新增 MiuiDialogTest / MiuiTopBarsTest |

---

### Task 1: 主题基座 + edge-to-edge

**Files:** Modify `android/app/src/main/java/com/bluskysoftware/yandegallery/ui/theme/{Color,Type,Theme}.kt`、`MainActivity.kt`；Create `ui/theme/Tokens.kt`

- [ ] **Step 1.1: 重写 Color.kt**（全文件替换）

```kotlin
package com.bluskysoftware.yandegallery.ui.theme

import androidx.compose.ui.graphics.Color

// 浅色：纯白基调（MIUI 相册照片页白底）；设置族页面用 PageGray 做底、白卡片（spec §1.1）
val LightPrimary = Color(0xFF3482FF)
val LightBackground = Color(0xFFFFFFFF)
val LightSurface = Color(0xFFFFFFFF)
val LightPageGray = Color(0xFFF5F6F8)
val LightSurfaceVariant = Color(0xFFF2F3F5)
val LightOnSurface = Color(0xFF1A1A1A)
val LightOnSurfaceVariant = Color(0xFF8A8F99)
val LightHairline = Color(0x14000000)   // 黑 8% 发丝线
val LightError = Color(0xFFE53935)

// 深色：OLED 真黑基调 + #1C1C1E 卡片（MIUI 深色相册）
val DarkPrimary = Color(0xFF5C9BFF)
val DarkBackground = Color(0xFF000000)
val DarkSurface = Color(0xFF000000)
val DarkCard = Color(0xFF1C1C1E)
val DarkSurfaceVariant = Color(0xFF1F2022)
val DarkOnSurface = Color(0xFFF2F2F2)
val DarkOnSurfaceVariant = Color(0xFF9AA0AA)
val DarkHairline = Color(0x1AFFFFFF)   // 白 10% 发丝线
val DarkError = Color(0xFFFF6B6B)
```

- [ ] **Step 1.2: 重写 Type.kt**（全文件替换）

```kotlin
package com.bluskysoftware.yandegallery.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * MIUI 式字号层级（spec §1.2）：大标题 30/W700、小标题 17/W600、日期头 16/W600、底栏标签 11sp；
 * 中文场景全部字距归零（M3 默认 letterSpacing 对中文偏散）。
 */
val AppTypography = Typography().run {
    copy(
        headlineLarge = headlineLarge.copy(fontSize = 30.sp, lineHeight = 38.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.sp),
        titleLarge = titleLarge.copy(fontSize = 17.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
        titleMedium = titleMedium.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
        titleSmall = titleSmall.copy(letterSpacing = 0.sp),
        bodyLarge = bodyLarge.copy(fontSize = 15.sp, letterSpacing = 0.sp),
        bodyMedium = bodyMedium.copy(letterSpacing = 0.sp),
        bodySmall = bodySmall.copy(letterSpacing = 0.sp),
        labelLarge = labelLarge.copy(letterSpacing = 0.sp),
        labelMedium = labelMedium.copy(letterSpacing = 0.sp),
        labelSmall = labelSmall.copy(fontSize = 11.sp, letterSpacing = 0.sp),
    )
}
```

- [ ] **Step 1.3: 重写 Theme.kt**（全文件替换；补全 colorScheme + shapes + 系统栏图标色）

```kotlin
package com.bluskysoftware.yandegallery.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat

private val LightColors = lightColorScheme(
    primary = LightPrimary,
    background = LightBackground,
    onBackground = LightOnSurface,
    surface = LightSurface,
    onSurface = LightOnSurface,
    surfaceVariant = LightSurfaceVariant,
    onSurfaceVariant = LightOnSurfaceVariant,
    surfaceContainerLowest = LightSurface,
    surfaceContainerLow = LightPageGray,
    surfaceContainer = LightSurface,
    surfaceContainerHigh = LightSurface,
    surfaceContainerHighest = LightSurface,
    outlineVariant = LightHairline,
    error = LightError,
)

private val DarkColors = darkColorScheme(
    primary = DarkPrimary,
    background = DarkBackground,
    onBackground = DarkOnSurface,
    surface = DarkSurface,
    onSurface = DarkOnSurface,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = DarkOnSurfaceVariant,
    surfaceContainerLowest = DarkBackground,
    surfaceContainerLow = DarkBackground,
    surfaceContainer = DarkCard,
    surfaceContainerHigh = DarkCard,
    surfaceContainerHighest = DarkCard,
    outlineVariant = DarkHairline,
    error = DarkError,
)

/** MIUI 式圆角体系（spec §1.3）：菜单/卡片 12dp、大容器 16dp、弹窗/底部抽屉 20dp。 */
private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(12.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(20.dp),
)

/** 动态取色关闭（spec §7）：固定浅/深配色随系统；edge-to-edge 后系统栏图标深浅须显式跟主题。 */
@Composable
fun YandeGalleryTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = if (dark) DarkColors else LightColors
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            // Robolectric/非 Activity 宿主拿不到 window：静默跳过（与 ViewerScreen.applySystemBars 同口径）
            val window = view.context.findActivity()?.window ?: return@SideEffect
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = !dark
            controller.isAppearanceLightNavigationBars = !dark
        }
    }
    MaterialTheme(colorScheme = colors, typography = AppTypography, shapes = AppShapes, content = content)
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
```

- [ ] **Step 1.4: 新建 ui/theme/Tokens.kt**

```kotlin
package com.bluskysoftware.yandegallery.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/** 跨页面共享的 MIUI 视觉常量（spec §1.3/§2.3/§3）——照片/图集详情/搜索三网格统一取此处，不许各写一份。 */
object MiuiTokens {
    /** 网格缝隙（水平+垂直 Arrangement.spacedBy）。 */
    val GridGap = 3.dp
    /** 网格格子圆角。 */
    val CellShape = RoundedCornerShape(3.dp)
    /** 封面/卡片圆角。 */
    val CoverShape = RoundedCornerShape(12.dp)
    /** tab 页大标题行高（随内容滚动收起的部分）。 */
    val LargeTitleHeight = 64.dp
    /** tab 页常驻顶栏行高（不含状态栏 inset）。 */
    val PinnedBarHeight = 44.dp
}
```

- [ ] **Step 1.5: MainActivity 开 edge-to-edge**

`MainActivity.kt` 加 import `androidx.activity.enableEdgeToEdge`，`onCreate` 里 `super.onCreate(savedInstanceState)` 之后、取 graph 之前插入一行 `enableEdgeToEdge()`。

- [ ] **Step 1.6: AppScaffold 内容 insets 归零**（防 edge-to-edge 后二级页双 inset）

`ui/AppNav.kt` 的 `Scaffold(` 调用加参数（本 Task 只加这一处，壳重构在 Task 5）：

```kotlin
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
```

需补 import：`androidx.compose.foundation.layout.WindowInsets`。此后内容区顶部 inset 全部交给各页面自己的 TopAppBar/自定义顶栏（设置族等二级页已是自带 Scaffold+TopAppBar 模式，自然处理）。

- [ ] **Step 1.7: 全量测试**

Run: `cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest"`
Expected: BUILD SUCCESSFUL（纯 theme/inset 改动，无断言变化）。若有涉及颜色断言的用例失败，按新色值适配断言。

- [ ] **Step 1.8: Commit**

```bash
git add -A && git commit -m "feat(android): MIUI 主题基座——真黑/纯白配色全族、字号层级、12-20dp 圆角体系、edge-to-edge"
```

### Task 2: MIUI 日期文案 formatter（TDD）

**Files:** Modify `ui/photos/TimelineModels.kt`、`ui/photos/PhotosViewModel.kt:133`；Test `test/.../ui/photos/TimelineModelsTest.kt`

- [ ] **Step 2.1: 先写失败测试**（TimelineModelsTest 追加；同时删除原 `dayDisplayOf 中文年月日` 用例——该函数将被移除）

```kotlin
    // 固定 today 注入保证跨年/跨日运行稳定（формatter 不内取 LocalDate.now()）
    @Test
    fun `dayHeaderDisplayOf 今天昨天同年周X跨年（MIUI 文案）`() {
        val today = java.time.LocalDate.of(2026, 7, 8)   // 周三
        assertEquals("今天", dayHeaderDisplayOf("2026-07-08", today))
        assertEquals("昨天", dayHeaderDisplayOf("2026-07-07", today))
        assertEquals("7月3日 周五", dayHeaderDisplayOf("2026-07-03", today))
        assertEquals("2025年12月31日 周三", dayHeaderDisplayOf("2025-12-31", today))
        assertEquals("bad-key", dayHeaderDisplayOf("bad-key", today))   // 解析失败回退原 key
    }

    @Test
    fun `monthHeaderDisplayOf 同年只显月跨年带年`() {
        val today = java.time.LocalDate.of(2026, 7, 8)
        assertEquals("7月", monthHeaderDisplayOf("2026-07", today))
        assertEquals("2025年12月", monthHeaderDisplayOf("2025-12", today))
        assertEquals("oops", monthHeaderDisplayOf("oops", today))
    }

    @Test
    fun `viewer 日期时间标签（本地时区换算构造期望，防时区脆断言）`() {
        val iso = "2026-07-03T04:05:00.000Z"
        val local = java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault())
        val expectDate = "${local.monthValue}月${local.dayOfMonth}日 ${weekdayCn(local.toLocalDate())}"
        assertEquals(expectDate, viewerDateLabel(iso, local.toLocalDate()))
        assertEquals("2026年7月3日", viewerDateLabel(iso, local.toLocalDate().plusYears(1)).takeIf { local.year == 2026 } ?: viewerDateLabel(iso, local.toLocalDate().plusYears(1)))
        val expectTime = local.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
        assertEquals(expectTime, viewerTimeLabel(iso))
        assertEquals("", viewerDateLabel("garbage", local.toLocalDate()))
    }
```

注意跨年断言的期望：本地时区可能把 07-03 换算成 07-02/07-04，跨年期望串应同样用 `local` 拼（`"${local.year}年${local.monthValue}月${local.dayOfMonth}日"`），执行时按此改写上面第二行（不写死 7月3日）。

- [ ] **Step 2.2: 跑测试确认红**

Run: `cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests \"*TimelineModelsTest\""`
Expected: FAIL（Unresolved reference: dayHeaderDisplayOf 编译错）。

- [ ] **Step 2.3: TimelineModels.kt 实现**（删除 `dayDisplayOf`，追加下列函数；`monthDisplayOf`/`dayBubbleDisplayOf` 保留——sticky/气泡仍用）

```kotlin
private val WEEKDAY_CN = arrayOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")

/** LocalDate → 周X（DayOfWeek.value 1..7 → 周一..周日）。 */
fun weekdayCn(date: LocalDate): String = WEEKDAY_CN[date.dayOfWeek.value - 1]

/**
 * 日分组头 MIUI 文案（spec §3）：今天/昨天/同年「M月d日 周X」/跨年「yyyy年M月d日 周X」。
 * [today] 由调用方传执行时日期（分页 map 时取 LocalDate.now()，跨午夜长驻会话滞后可接受——
 * 下拉刷新/重建即恢复，spec §3 记录性取舍）；解析失败回退原 key。
 */
fun dayHeaderDisplayOf(dayKey: String, today: LocalDate): String = runCatching {
    val date = LocalDate.parse(dayKey)
    when {
        date == today -> "今天"
        date == today.minusDays(1) -> "昨天"
        date.year == today.year -> "${date.monthValue}月${date.dayOfMonth}日 ${weekdayCn(date)}"
        else -> "${date.year}年${date.monthValue}月${date.dayOfMonth}日 ${weekdayCn(date)}"
    }
}.getOrElse { dayKey }

/** 月分组头 MIUI 文案：同年「M月」/跨年「yyyy年M月」；解析失败回退原 key。 */
fun monthHeaderDisplayOf(monthKey: String, today: LocalDate): String = runCatching {
    val (y, m) = monthKey.split("-").map { it.toInt() }
    if (y == today.year) "${m}月" else "${y}年${m}月"
}.getOrElse { monthKey }

/** 大图页顶部日期行（spec §5）：同年「M月d日 周X」/跨年「yyyy年M月d日」；解析失败回退空串（不显）。 */
fun viewerDateLabel(createdAt: String, today: LocalDate): String = runCatching {
    val date = Instant.parse(createdAt).atZone(ZoneId.systemDefault()).toLocalDate()
    if (date.year == today.year) "${date.monthValue}月${date.dayOfMonth}日 ${weekdayCn(date)}"
    else "${date.year}年${date.monthValue}月${date.dayOfMonth}日"
}.getOrElse { "" }

/** 大图页顶部时间行：本地时区 HH:mm；解析失败回退空串。 */
fun viewerTimeLabel(createdAt: String): String = runCatching {
    Instant.parse(createdAt).atZone(ZoneId.systemDefault())
        .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
}.getOrElse { "" }
```

- [ ] **Step 2.4: PhotosViewModel 接线**

`PhotosViewModel.kt:133` 原：
```kotlin
TimelineItem.Header(afterKey, if (monthly) monthDisplayOf(afterKey) else dayDisplayOf(afterKey))
```
改为（文件顶补 `import java.time.LocalDate`）：
```kotlin
TimelineItem.Header(
    afterKey,
    if (monthly) monthHeaderDisplayOf(afterKey, LocalDate.now())
    else dayHeaderDisplayOf(afterKey, LocalDate.now()),
)
```

- [ ] **Step 2.5: 全量测试确认绿**（PhotosViewModelTest 若断言了旧 Header display 文案，按新格式适配——同年数据的期望改「M月d日 周X」形态，用与生产同函数拼期望）

- [ ] **Step 2.6: Commit** `feat(android): 时间轴日期头 MIUI 文案——今天/昨天/周X/跨年，viewer 日期标签就绪`

### Task 3: MiuiDialog 统一弹窗（TDD）+ 全调用点替换

**Files:** Create `ui/common/MiuiDialog.kt`；Test Create `test/.../ui/common/MiuiDialogTest.kt`；Modify `PhotosScreen.kt`、`AlbumDetailScreen.kt`、`AlbumsScreen.kt`、`ViewerScreen.kt`、`DetailPanel.kt`（TagEditDialog）、`SettingsScreen.kt`、`ServersScreen.kt`、`GalleryPickerDialog.kt`

- [ ] **Step 3.1: 新建 MiuiDialogTest.kt（先红）**

```kotlin
package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** MiuiDialog 契约（spec §8.3）：标题/正文渲染、双按钮回调、confirmEnabled 门控、content 槽、confirmTag 透传。 */
@RunWith(RobolectricTestRunner::class)
class MiuiDialogTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `双按钮回调与危险确认渲染`() {
        var confirmed = 0
        var dismissed = 0
        compose.setContent {
            MiuiDialog(
                title = "删除图片",
                text = "确定删除？",
                onDismiss = { dismissed++ },
                confirmText = "删除",
                destructive = true,
                confirmTag = "t_confirm",
                onConfirm = { confirmed++ },
            )
        }
        compose.onNodeWithText("删除图片").assertIsDisplayed()
        compose.onNodeWithText("确定删除？").assertIsDisplayed()
        compose.onNodeWithTag("t_confirm").performClick()
        compose.onNodeWithTag("miui_dialog_dismiss").performClick()
        assertEquals(1, confirmed)
        assertEquals(1, dismissed)
    }

    @Test
    fun `confirmEnabled=false 点确认不回调`() {
        var confirmed = 0
        compose.setContent {
            MiuiDialog(
                title = "新建图集",
                onDismiss = {},
                confirmText = "创建",
                confirmEnabled = false,
                onConfirm = { confirmed++ },
                content = { Text("槽内容", androidx.compose.ui.Modifier.let { it }) },
            )
        }
        compose.onNodeWithText("槽内容").assertIsDisplayed()
        compose.onNodeWithTag("miui_dialog_confirm").performClick()
        assertEquals(0, confirmed)
    }

    @Test
    fun `单按钮模式只渲染确认`() {
        compose.setContent {
            MiuiDialog(title = "开源协议", text = "Apache", onDismiss = {}, confirmText = "关闭", dismissText = null)
        }
        compose.onNodeWithTag("miui_dialog_confirm").assertIsDisplayed()
        compose.onNodeWithTag("miui_dialog_dismiss").assertDoesNotExist()
    }
}
```

- [ ] **Step 3.2: 跑该测试确认编译失败** `--tests "*MiuiDialogTest"` → Unresolved reference: MiuiDialog

- [ ] **Step 3.3: 新建 ui/common/MiuiDialog.kt**

```kotlin
package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog

/**
 * MIUI 式统一弹窗（spec §8.3）：20dp 圆角、标题居中、底部等宽胶囊按钮排——
 * 取消=灰底深字、确认=主蓝底白字、危险确认（删除类）=红底白字；单按钮场景把另一侧传 null。
 * [content] 槽放输入框/列表等自定义内容（可与 [text] 叠加，text 先渲染）。
 * confirmTag 透传各调用点既有 testTag（batch_delete_confirm 等），断言零迁移。
 */
@Composable
fun MiuiDialog(
    title: String,
    onDismiss: () -> Unit,
    text: String? = null,
    confirmText: String? = null,
    onConfirm: () -> Unit = {},
    confirmEnabled: Boolean = true,
    destructive: Boolean = false,
    confirmTag: String? = null,
    dismissText: String? = "取消",
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.fillMaxWidth().testTag("miui_dialog"),
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 20.dp)) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier
                        .align(Alignment.CenterHorizontally)
                        .padding(bottom = 16.dp),
                )
                if (text != null) {
                    Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 8.dp))
                }
                content?.invoke(this)
                Spacer(Modifier.height(20.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                    if (dismissText != null) {
                        MiuiDialogButton(
                            label = dismissText,
                            container = MaterialTheme.colorScheme.surfaceVariant,
                            contentColor = MaterialTheme.colorScheme.onSurface,
                            enabled = true,
                            onClick = onDismiss,
                            tag = "miui_dialog_dismiss",
                            modifier = Modifier.weight(1f),
                        )
                    }
                    if (confirmText != null) {
                        MiuiDialogButton(
                            label = confirmText,
                            container = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                            contentColor = Color.White,
                            enabled = confirmEnabled,
                            onClick = onConfirm,
                            tag = confirmTag ?: "miui_dialog_confirm",
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

/** 等宽胶囊按钮：44dp 高全圆角；禁用降透明（配色不换，MIUI 同款观感）。 */
@Composable
private fun MiuiDialogButton(
    label: String,
    container: Color,
    contentColor: Color,
    enabled: Boolean,
    onClick: () -> Unit,
    tag: String,
    modifier: Modifier = Modifier,
) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .height(44.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(if (enabled) container else container.copy(alpha = 0.38f))
            .clickable(enabled = enabled, onClick = onClick)
            .testTag(tag),
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = if (enabled) contentColor else contentColor.copy(alpha = 0.6f))
    }
}
```

- [ ] **Step 3.4: 跑 MiuiDialogTest 确认绿**

- [ ] **Step 3.5: 替换 9 处调用点**（模式统一：AlertDialog(title/text/confirmButton/dismissButton) → MiuiDialog；confirm onClick 原逻辑原样搬进 onConfirm；各处既有 testTag 经 confirmTag 透传）

1. `PhotosScreen.kt` 批量删除（`confirmBatchDelete` 块）：
```kotlin
    if (confirmBatchDelete) {
        val count = selected.size
        MiuiDialog(
            title = "批量删除",
            text = if (batchHasLocalCopies) {
                "确定删除选中的 $count 张图片？将从服务器删除；本机已保存的原图副本也会一并删除。"
            } else {
                "确定删除选中的 $count 张图片？将从服务器删除。"
            },
            onDismiss = { confirmBatchDelete = false },
            confirmText = "删除",
            destructive = true,
            confirmTag = "batch_delete_confirm",
            onConfirm = {
                confirmBatchDelete = false
                val ids = viewModel.selection.selected.toList()
                scope.launch {
                    // ……（原 confirmButton onClick 协程体原样保留，一字不动）
                }
            },
        )
    }
```
2. `AlbumDetailScreen.kt` 批量删除：同上模式（tag 同为 `batch_delete_confirm`）。
3. `AlbumsScreen.kt` 的 `AlbumNameDialog`：
```kotlin
@Composable
internal fun AlbumNameDialog(
    title: String,
    name: String,
    onNameChange: (String) -> Unit,
    confirmLabel: String,
    confirmTag: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    MiuiDialog(
        title = title,
        onDismiss = onDismiss,
        confirmText = confirmLabel,
        confirmEnabled = name.isNotBlank(),
        confirmTag = confirmTag,
        onConfirm = onConfirm,
        content = {
            OutlinedTextField(
                value = name,
                onValueChange = onNameChange,
                label = { Text("图集名") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("album_name_field"),
            )
        },
    )
}
```
4. `AlbumsScreen.kt` 的 `DeleteAlbumConfirmDialog`：`MiuiDialog(title = "删除图集", text = "确定删除图集「$albumName」？只删除图集本身，不删除其中的图片文件。", confirmText = "删除", destructive = true, confirmTag = "album_delete_confirm", onConfirm = onConfirm, onDismiss = onDismiss)`。
5. `ViewerScreen.kt` 删除确认（`confirmDeleteId?.let` 块）：`title = "删除图片"`、text 原两分支文案、`confirmText = "删除"`、`destructive = true`、`confirmTag = "viewer_delete_confirm"`、onConfirm = `{ confirmDeleteId = null; performDelete(imageId) }`。
6. `DetailPanel.kt` 的 `TagEditDialog`：外壳换 `MiuiDialog(title = "编辑标签", onDismiss = onDismiss, dismissText = null, confirmText = "完成", onConfirm = onDismiss, content = { ……原 text 槽 Column 内容原样…… })`。
7. `SettingsScreen.kt` 开源协议：`MiuiDialog(title = "开源协议", text = 原文案, onDismiss = { showLicenses = false }, dismissText = null, confirmText = "关闭", onConfirm = { showLicenses = false })`。
8. `ServersScreen.kt` 删除服务器：`title = "删除服务器"`、text 原文案、`confirmText = "删除"`、`destructive = true`、`confirmTag = "server_delete_confirm"`（新 tag）。
9. `GalleryPickerDialog.kt` 全文件重写：
```kotlin
@Composable
fun GalleryPickerDialog(
    galleries: List<GalleryEntity>,
    onPick: (Long) -> Unit,
    onDismiss: () -> Unit,
    excludeIds: Set<Long> = emptySet(),
) {
    val visible = galleries.filterNot { it.id in excludeIds }
    MiuiDialog(title = "加入图集", onDismiss = onDismiss, confirmText = null, dismissText = "取消", content = {
        if (visible.isEmpty()) {
            Text("暂无图集，可先在相册 tab 新建", style = MaterialTheme.typography.bodyMedium)
        } else {
            LazyColumn(Modifier.heightIn(max = 320.dp)) {
                items(visible, key = { it.id }) { gallery ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { onPick(gallery.id) }
                            .padding(horizontal = 8.dp, vertical = 12.dp)
                            .testTag("gallery_pick_${gallery.id}"),
                    ) {
                        Text(gallery.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                        Text("${gallery.imageCount} 张", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    })
}
```
各文件删掉不再使用的 `AlertDialog`/`TextButton` import（TagEditDialog 若仍用 TextButton 保留）。

- [ ] **Step 3.6: 全量测试**——预期需适配的既有断言：弹窗按钮从 `TextButton(文本)` 变胶囊 Box（`onNodeWithText("取消")` 仍可命中）；`GalleryPickerDialogTest` 若断言 ListItem 结构改为断言行 tag/文本。跑绿为准。

- [ ] **Step 3.7: Commit** `feat(android): MiuiDialog 统一弹窗——等宽双胶囊按钮/危险红确认，9 处 AlertDialog 全量换装`

### Task 4: MiuiWidgets 共享部件 + 设置族换皮 + 横幅柔和化

**Files:** Create `ui/common/MiuiWidgets.kt`；Modify `SettingsScreen.kt`、`CacheScreen.kt`、`ServersScreen.kt`、`AddServerScreen.kt`、`EditServerScreen.kt`、`ScanScreen.kt`（仅顶栏）、`ConnectionBanner.kt`、`AlbumsScreen.kt`（AlbumNameDialog 输入框换 MiuiTextField）、`DetailPanel.kt`（TagEditDialog 输入框同换）

- [ ] **Step 4.1: 新建 ui/common/MiuiWidgets.kt**

```kotlin
package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** 二级页顶栏（spec §8.2）：居中标题（可选副标题双行）+ 左返回 + 右动作槽；背景与页面同色。 */
@Composable
fun MiuiSubPageTopBar(
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Box(
        modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .height(48.dp),
    ) {
        IconButton(onClick = onBack, modifier = Modifier.align(Alignment.CenterStart)) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.align(Alignment.Center)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.align(Alignment.CenterEnd)) { actions() }
    }
}

/** 设置卡片组（spec §8.1）：12dp 圆角、surfaceContainer 底；组内行靠间距分隔（无分割线）。 */
@Composable
fun MiuiCardGroup(
    modifier: Modifier = Modifier,
    title: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth()) {
        if (title != null) {
            Text(
                title,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 16.dp, bottom = 6.dp),
            )
        }
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceContainer,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(content = content)
        }
    }
}

/** 卡片组内列表行：标题 + 可选副文/右值/chevron；行高靠内边距（约 56dp）。 */
@Composable
fun MiuiListItem(
    headline: String,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    value: String? = null,
    chevron: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(headline, style = MaterialTheme.typography.bodyLarge)
            if (supporting != null) {
                Text(
                    supporting,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        if (value != null) {
            Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (chevron) {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
        }
    }
}

/** 灰底圆角填充输入框（spec §8.2）：标签固定在框上方灰字、无下划线；错误提示走 supporting。 */
@Composable
fun MiuiTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    singleLine: Boolean = true,
    isError: Boolean = false,
    supportingText: String? = null,
) {
    Column(Modifier.fillMaxWidth()) {
        if (label != null) {
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
            )
        }
        TextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = singleLine,
            isError = isError,
            placeholder = placeholder?.let { { Text(it) } },
            shape = RoundedCornerShape(12.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                errorContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                disabledIndicatorColor = Color.Transparent,
                errorIndicatorColor = Color.Transparent,
            ),
            modifier = modifier.fillMaxWidth(),
        )
        if (supportingText != null) {
            Text(
                supportingText,
                style = MaterialTheme.typography.bodySmall,
                color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 4.dp, top = 4.dp),
            )
        }
    }
}

/** 主/次胶囊按钮（48dp 高）：主=蓝底白字，次=灰底深字；loading 时前置转圈并禁点。 */
@Composable
fun MiuiPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) = MiuiCapsuleButton(text, onClick, modifier, enabled, loading, MaterialTheme.colorScheme.primary, Color.White)

@Composable
fun MiuiSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) = MiuiCapsuleButton(text, onClick, modifier, enabled, loading, MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurface)

@Composable
private fun MiuiCapsuleButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier,
    enabled: Boolean,
    loading: Boolean,
    container: Color,
    contentColor: Color,
) {
    val canClick = enabled && !loading
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
        modifier = modifier
            .height(48.dp)
            .androidx.compose.ui.draw.clip(RoundedCornerShape(24.dp))
            .background(if (canClick) container else container.copy(alpha = 0.5f))
            .clickable(enabled = canClick, onClick = onClick),
    ) {
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = contentColor)
            androidx.compose.foundation.layout.Spacer(Modifier.size(8.dp))
        }
        Text(text, style = MaterialTheme.typography.bodyLarge, color = if (canClick) contentColor else contentColor.copy(alpha = 0.6f))
    }
}
```

注意：上面 `MiuiCapsuleButton` 里 `.androidx.compose.ui.draw.clip(...)` 写法不合法，执行时用顶部 `import androidx.compose.ui.draw.clip` + `.clip(RoundedCornerShape(24.dp))`；`Spacer`/`Arrangement` 同理提升为顶部 import（此处为避免遗漏依赖显式全名标注）。

- [ ] **Step 4.2: SettingsScreen 换皮**（保留全部 testTag 与文案；Scaffold 结构改为）

```kotlin
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        topBar = { MiuiSubPageTopBar(title = "设置", onBack = onBack) },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            MiuiCardGroup {
                MiuiListItem("服务器管理", supporting = "列表、扫码/手动添加、编辑、切换、删除", chevron = true, onClick = onOpenServers, modifier = Modifier.testTag("settings_servers"))
                MiuiListItem("缓存管理", supporting = "缩略图/预览占用与清理、上限调整、已下载记录", chevron = true, onClick = onOpenCache, modifier = Modifier.testTag("settings_cache"))
            }
            MiuiCardGroup {
                MiuiListItem("版本", value = versionName, modifier = Modifier.testTag("settings_version"))
                MiuiListItem("开源协议", chevron = true, onClick = { showLicenses = true }, modifier = Modifier.testTag("settings_licenses"))
            }
        }
    }
```
删除 ListItem/HorizontalDivider/TopAppBar/IconButton/ArrowBack import，补 verticalScroll/rememberScrollState/Arrangement。SettingsScreenTest 三用例断言（tag 点击回调/版本文本/Apache 文案）不受影响。

- [ ] **Step 4.3: CacheScreen 换皮**（行为与 tag 全保留：`cache_clear_thumb/preview/downloads`）

结构改为：`Scaffold(containerColor = surfaceContainerLow, topBar = { MiuiSubPageTopBar("缓存管理", onBack) }, snackbarHost = 原样)`；LazyColumn `contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)`、`verticalArrangement = spacedBy(12.dp)`，三个区块各包 `MiuiCardGroup`：

```kotlin
item {
    MiuiCardGroup(title = "缩略图缓存") {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(usage文案（原拼接逻辑）, style = MaterialTheme.typography.bodyMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { ……FilterChip 原样…… }
            MiuiSecondaryButton("清理", onClick = 原onClear, modifier = Modifier.testTag("cache_clear_thumb"))
        }
    }
}
```
（预览缓存同构；`CacheTierSection` 保留函数壳、内部按上式改写，参数不变。）已下载记录区：`MiuiCardGroup(title = "已下载记录（${downloads.size}）")` 内：清空按钮 `MiuiSecondaryButton("清空记录", enabled = downloads.isNotEmpty(), tag 保留)` + 说明文字 + 记录行改 `MiuiListItem(headline = rec.filename ?: "图片 #${rec.imageId}", supporting = rec.downloadedAt)`（注意 LazyColumn 的 `items(downloads)` 需挪进卡片：改为把记录行放同一 `item {}` 的 Column 内 `downloads.forEach { … }`——记录量级为已下载数，可接受；删除两处 `HorizontalDivider` item）。页脚提示文案原样保留。

- [ ] **Step 4.4: ServersScreen 换皮**（激活台蓝点+「当前」；卡片化；底部按钮换胶囊）

```kotlin
    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        topBar = { MiuiSubPageTopBar("服务器", onBack) },
        bottomBar = {
            Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MiuiSecondaryButton("扫码添加", onClick = onScan, modifier = Modifier.weight(1f).testTag("btn_scan_add"))
                MiuiPrimaryButton("手动添加", onClick = onAddManual, modifier = Modifier.weight(1f).testTag("btn_manual_add"))
            }
        },
    ) { padding ->
        // 空态原文案原样；列表：
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(servers, key = { it.id }) { server ->
                val isActive = server.id == active?.id
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceContainer,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).combinedClickable(
                        onClick = { vm.activate(server.id) },
                        onLongClick = { deleteTarget = server },
                    ),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp)) {
                        if (isActive) {
                            Box(Modifier.size(8.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
                            Spacer(Modifier.size(8.dp))
                        }
                        Column(Modifier.weight(1f)) {
                            Text(server.name, style = MaterialTheme.typography.bodyLarge)
                            Text(server.baseUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (isActive) Text("当前", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        IconButton(onClick = { onEdit(server.id) }, modifier = Modifier.testTag("server_edit_${server.id}")) {
                            Icon(Icons.Filled.Edit, contentDescription = "编辑")
                        }
                    }
                }
            }
        }
    }
```
删除 ListItem/CheckCircle/Button/OutlinedButton/TopAppBar import，补 CircleShape/Spacer/PaddingValues/navigationBarsPadding/clip。

- [ ] **Step 4.5: AddServerScreen / EditServerScreen 表单换皮**（两屏同构；校验/防抖/预填逻辑一字不动）

- 顶栏：`MiuiSubPageTopBar("添加服务器"/"编辑服务器", onBack)`；Scaffold `containerColor = surfaceContainerLow`。
- 三个 `OutlinedTextField` → `MiuiTextField`（label 文案移到框上方参数）：
```kotlin
MiuiTextField(value = name, onValueChange = { name = it }, label = "名称（可选）", modifier = Modifier.testTag("field_name"))
MiuiTextField(value = baseUrl, onValueChange = { baseUrl = it; baseUrlError = null }, label = "服务器地址", placeholder = "http://主机:端口", isError = baseUrlError != null, supportingText = baseUrlError, modifier = Modifier.testTag("field_baseUrl"))
MiuiTextField(value = apiKey, onValueChange = { apiKey = it }, label = "API Key", modifier = Modifier.testTag("field_apiKey"))
```
- 按钮行：`MiuiSecondaryButton("测试连接", loading = testing, enabled = baseUrl.isNotBlank(), onClick = 原逻辑, modifier = weight(1f).testTag("btn_test"))` + `MiuiPrimaryButton("保存并激活"/"保存", enabled = !saving && …原条件, onClick = 原逻辑, modifier = weight(1f).testTag("btn_save"))`。
- AlbumNameDialog 与 TagEditDialog 的 `OutlinedTextField` 同步换 `MiuiTextField`（`album_name_field` / `tag_edit_input` tag 保留；TagEditDialog 的 label="新标签" 保留在框上方）。

- [ ] **Step 4.6: ScanScreen 顶栏**：`TopAppBar(title=扫码配对…)` → `MiuiSubPageTopBar("扫码配对", onBack)`（其余相机逻辑不动）。

- [ ] **Step 4.7: ConnectionBanner 柔和化**（文案/tag/点击行为不动）

```kotlin
@Composable
fun ConnectionBanner(state: ConnState, onReconnectAuth: () -> Unit, modifier: Modifier = Modifier) {
    when {
        state.unauthorized -> BannerRow(
            text = "密钥失效，请重新配对",
            bg = MaterialTheme.colorScheme.error.copy(alpha = 0.12f),
            fg = MaterialTheme.colorScheme.error,
            tag = "banner_unauthorized",
            onClick = onReconnectAuth,
            modifier = modifier,
        )
        !state.online -> BannerRow(
            text = "未连接到 ${state.serverName ?: "服务器"}，点按管理服务器",
            bg = Color(0x26FFA000),   // 琥珀 15%
            fg = if (isSystemInDarkTheme()) Color(0xFFFFC46B) else Color(0xFF9A6B00),
            tag = "banner_offline",
            onClick = onReconnectAuth,
            modifier = modifier,
        )
        else -> Unit
    }
}

@Composable
private fun BannerRow(text: String, bg: Color, fg: Color, tag: String, onClick: () -> Unit, modifier: Modifier) {
    Surface(color = bg, contentColor = fg, modifier = modifier.fillMaxWidth().clickable(onClick = onClick).testTag(tag)) {
        Text(
            text,
            style = MaterialTheme.typography.labelMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp, horizontal = 12.dp),
        )
    }
}
```
ConnectionBannerTest 断言文案/tag/点击——不受影响。

- [ ] **Step 4.8: 全量测试跑绿 → Commit** `feat(android): 设置族 MIUI 卡片化——SubPageTopBar/CardGroup/灰底输入框/胶囊按钮，横幅柔和化`

### Task 5: 壳重构（顶栏下放/MiuiNavBar/桥瘦身）+ 折叠大标题 + 照片页顶部接入

**Files:** Create `ui/common/MiuiTopBars.kt`；Modify `ui/AppNav.kt`（重写壳）、`ui/common/PhotosSelectionBars.kt`、`ui/photos/PhotosScreen.kt`（顶部区域）、`MainActivity.kt`（接线）；Test Modify `AppNavTest.kt`，Create `ui/common/MiuiTopBarsTest.kt`

**核心裁定（spec §2.3）**：大标题不进 LazyGrid（避免全部索引数学 +1 波及锚定/快滚/sticky），改用 nestedScroll exitUntilCollapsed——上滑先收头部再滚内容、下滑内容到顶后余量展开头部；松手 settle 到全收/全展。

- [ ] **Step 5.1: 新建 ui/common/MiuiTopBars.kt**

```kotlin
package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.bluskysoftware.yandegallery.ui.theme.MiuiTokens

/**
 * tab 页折叠大标题状态（spec §2.3，exitUntilCollapsed）：
 * - onPreScroll：上滑（y<0）先收头部、消费掉收缩量，再把余量给内容滚动；
 * - onPostScroll：下滑（y>0）内容滚到顶后未消费的余量用来展开头部——中途下滑不弹头（exitUntilCollapsed 语义）；
 * - [settle]：松手后按 0.5 阈值动画贴齐全收/全展，不留半截标题。
 */
@Stable
class MiuiHeaderState(val heightPx: Float) {
    var offsetPx by mutableFloatStateOf(0f)   // 0（展开）.. -heightPx（收起）
        private set
    val collapseFraction: Float get() = if (heightPx <= 0f) 1f else -offsetPx / heightPx
    val scrolled: Boolean get() = collapseFraction > 0.9f

    val connection = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            if (available.y >= 0) return Offset.Zero
            val new = (offsetPx + available.y).coerceIn(-heightPx, 0f)
            val consumed = new - offsetPx
            offsetPx = new
            return Offset(0f, consumed)
        }

        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            if (available.y <= 0) return Offset.Zero
            val new = (offsetPx + available.y).coerceIn(-heightPx, 0f)
            val used = new - offsetPx
            offsetPx = new
            return Offset(0f, used)
        }
    }

    suspend fun settle() {
        val target = if (collapseFraction > 0.5f) -heightPx else 0f
        if (target == offsetPx) return
        animate(initialValue = offsetPx, targetValue = target) { v, _ -> offsetPx = v }
    }
}

@Composable
fun rememberMiuiHeaderState(height: Dp = MiuiTokens.LargeTitleHeight): MiuiHeaderState {
    val px = with(LocalDensity.current) { height.toPx() }
    return remember(px) { MiuiHeaderState(px) }
}

/** 大标题行：高度随折叠收缩、文字随之淡出；挂在常驻顶栏与内容之间的普通布局位。 */
@Composable
fun MiuiLargeTitle(title: String, state: MiuiHeaderState, modifier: Modifier = Modifier) {
    val heightDp = with(LocalDensity.current) { (state.heightPx + state.offsetPx).toDp() }
    Box(
        modifier
            .fillMaxWidth()
            .height(heightDp)
            .clipToBounds()
            .testTag("miui_large_title"),
        contentAlignment = Alignment.BottomStart,
    ) {
        Text(
            title,
            style = MaterialTheme.typography.headlineLarge,
            modifier = Modifier
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .graphicsLayer { alpha = 1f - state.collapseFraction },
        )
    }
}

/** tab 页常驻顶栏：状态栏垫高 + 44dp；居中小标题在大标题收起后淡入；右侧动作常驻；收起态补发丝线。 */
@Composable
fun MiuiPinnedTopBar(
    title: String,
    scrolled: Boolean,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Column(
        modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .testTag("miui_pinned_bar"),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .height(MiuiTokens.PinnedBarHeight),
        ) {
            AnimatedVisibility(
                visible = scrolled,
                enter = fadeIn(tween(150)),
                exit = fadeOut(tween(150)),
                modifier = Modifier.align(Alignment.Center),
            ) {
                Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.testTag("miui_pinned_title"))
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.align(Alignment.CenterEnd).padding(end = 4.dp),
            ) { actions() }
        }
        if (scrolled) {
            HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}
```

- [ ] **Step 5.2: 新建 MiuiTopBarsTest.kt（覆盖状态机与顶栏门控）**

```kotlin
package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MiuiTopBarsTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `折叠状态机：上滑先收头、余量给内容，下滑余量展开，clamp 生效`() {
        val state = MiuiHeaderState(heightPx = 100f)
        // 上滑 60px：全部被头部消费
        var consumed = state.connection.onPreScroll(Offset(0f, -60f), NestedScrollSource.UserInput)
        assertEquals(-60f, consumed.y)
        assertEquals(0.6f, state.collapseFraction)
        // 再上滑 80px：只剩 40 可收，余量放行给内容
        consumed = state.connection.onPreScroll(Offset(0f, -80f), NestedScrollSource.UserInput)
        assertEquals(-40f, consumed.y)
        assertTrue(state.scrolled)
        // 中途下滑走 onPreScroll 不展开（exitUntilCollapsed）
        consumed = state.connection.onPreScroll(Offset(0f, 50f), NestedScrollSource.UserInput)
        assertEquals(0f, consumed.y)
        // 内容到顶后的 onPostScroll 余量展开
        consumed = state.connection.onPostScroll(Offset.Zero, Offset(0f, 30f), NestedScrollSource.UserInput)
        assertEquals(30f, consumed.y)
        assertFalse(state.scrolled)
    }

    @Test
    fun `常驻顶栏：未滚动无小标题，滚动后小标题浮现，动作槽常驻可点`() {
        var clicks = 0
        var scrolled = false
        compose.setContent {
            val s = androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
            scrolledState = s
            MiuiPinnedTopBar(title = "照片", scrolled = s.value, actions = {
                IconButton(onClick = { clicks++ }, modifier = Modifier.testTag("t_action")) {
                    Icon(Icons.Filled.Search, contentDescription = "搜索")
                }
            })
        }
        compose.onNodeWithTag("miui_pinned_title").assertDoesNotExist()
        compose.onNodeWithTag("t_action").assertIsDisplayed()
        compose.onNodeWithTag("t_action").performClick()
        assertEquals(1, clicks)
        compose.runOnUiThread { scrolledState.value = true }
        compose.onNodeWithTag("miui_pinned_title").assertIsDisplayed()
    }

    private lateinit var scrolledState: androidx.compose.runtime.MutableState<Boolean>
}
```
（执行时把 `scrolledState` 写成规范形式：`lateinit var` 提前声明即可，如上。）

- [ ] **Step 5.3: PhotosSelectionBars 瘦身**（全文件替换）

```kotlin
package com.bluskysoftware.yandegallery.ui.common

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * 照片 tab 多选底栏上提壳级的桥（D11→v0.5 瘦身）：顶部选择栏已随顶栏下放回 PhotosScreen 自渲染，
 * 壳只需知道「多选中 + 底栏五回调」来把 NavigationBar swap 成 SelectionBottomBar。
 * PhotosScreen 每次重组经 SideEffect 回填（闭包捕获屏内状态）；离开路由/退出多选回 null。
 */
class PhotosSelectionBars {
    var model by mutableStateOf<Model?>(null)

    data class Model(
        val online: Boolean,
        val onDownload: () -> Unit,
        val onShare: () -> Unit,
        val onDelete: () -> Unit,
        val onAddToGallery: () -> Unit,
    )
}
```

- [ ] **Step 5.4: 重写 AppNav.kt 壳**（Routes 与 NavHost 路由/转场不动；变化＝去 topBar、MiuiNavBar、bottomBar swap）

```kotlin
// imports 增：Icons.Outlined.Photo / Icons.Outlined.PhotoAlbum（androidx.compose.material.icons.outlined.*）、
// MutableInteractionSource、HorizontalDivider、graphics vector ImageVector、clickable、navigationBarsPadding、
// size/height/fillMaxHeight、Arrangement、Alignment；删：TopAppBar/NavigationBar/NavigationBarItem/Search/Settings icon import

private data class BottomTab(val route: String, val label: String, val filled: ImageVector, val outlined: ImageVector)

private val bottomTabs = listOf(
    BottomTab(Routes.Photos, "照片", Icons.Filled.Photo, Icons.Outlined.Photo),
    BottomTab(Routes.Albums, "相册", Icons.Filled.PhotoAlbum, Icons.Outlined.PhotoAlbum),
)

/** MIUI 式底部导航（spec §2.4）：surface 底 + 顶发丝线，无胶囊指示器、无水波；选中实心主色/未选线框灰。 */
@Composable
private fun MiuiNavBar(currentRoute: String?, onSelect: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)) {
        HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
        Row(Modifier.fillMaxWidth().navigationBarsPadding().height(56.dp)) {
            bottomTabs.forEach { tab ->
                val selected = currentRoute == tab.route
                val tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { onSelect(tab.route) }
                        .testTag("tab_${tab.route}"),
                ) {
                    Icon(if (selected) tab.filled else tab.outlined, contentDescription = tab.label, tint = tint, modifier = Modifier.size(24.dp))
                    Text(tab.label, style = MaterialTheme.typography.labelSmall, color = tint, modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
    }
}
```

`AppScaffold` 的 Scaffold 调用改为（NavHost 内容原样）：

```kotlin
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            // 多选激活：底部选择动作栏替换导航栏（顶部选择栏已在 PhotosScreen 内自渲染）
            val bars = photosSelectionBars.model
            if (currentRoute == Routes.Photos && bars != null) {
                SelectionBottomBar(
                    online = bars.online,
                    inGallery = false,
                    onDownload = bars.onDownload,
                    onShare = bars.onShare,
                    onDelete = bars.onDelete,
                    onAddToGallery = bars.onAddToGallery,
                )
            } else if (showBottomBar) {
                MiuiNavBar(currentRoute) { route ->
                    navController.navigate(route) {
                        popUpTo(navController.graph.startDestinationId) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                }
            }
        },
    ) { padding -> /* NavHost 原样 */ }
```
`AppNavForTest` 保持占位结构不动（占位 Text 无顶栏——顶栏已属页面职责）。

- [ ] **Step 5.5: PhotosScreen 顶部接入**

(a) 签名加两参数：
```kotlin
fun PhotosScreen(
    viewModel: PhotosViewModel,
    barsState: PhotosSelectionBars,
    onAddServer: () -> Unit,
    onOpenViewer: (imageId: Long) -> Unit,
    onOpenSearch: () -> Unit,
    onOpenSettings: () -> Unit,
)
```
(b) 引导态早退分支包上顶栏（无服务器仍可进设置）：
```kotlin
    if (server == null) {
        Column(Modifier.fillMaxSize()) {
            MiuiPinnedTopBar(title = "照片", scrolled = false, actions = {
                IconButton(onClick = onOpenSettings) { Icon(Icons.Filled.Settings, contentDescription = "设置") }
            })
            PhotosGuide(onAddServer = onAddServer)
        }
        return
    }
```
(c) SideEffect 桥回填改瘦身 Model（count/onSelectAll/onCancel 三项删除，其余五项字段名不变、闭包体一字不动）：
```kotlin
    SideEffect {
        barsState.model = if (selectionActive) {
            PhotosSelectionBars.Model(
                online = connState.online,
                onDownload = { …原闭包… },
                onShare = { storageGate { shareSelected() } },
                onDelete = { …原闭包… },
                onAddToGallery = { showGalleryPicker = true },
            )
        } else null
    }
```
(d) 主布局 Column 顶部（原 ConnectionBanner 之前）插入顶栏区，根 Column 挂 nestedScroll；「全选」闭包移到本地 SelectionTopBar：
```kotlin
    val header = rememberMiuiHeaderState()
    LaunchedEffect(gridState) {
        snapshotFlow { gridState.isScrollInProgress }.collect { if (!it) header.settle() }
    }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().nestedScroll(header.connection)) {
            if (selectionActive) {
                SelectionTopBar(
                    count = selected.size,
                    onSelectAll = {
                        viewModel.selection.selectAll(
                            (0 until items.itemCount).mapNotNull { (items.peek(it) as? TimelineItem.Photo)?.image?.id },
                        )
                    },
                    onCancel = { viewModel.selection.clear() },
                    insetStatusBar = true,
                )
            } else {
                MiuiPinnedTopBar(title = "照片", scrolled = header.scrolled, actions = {
                    IconButton(onClick = onOpenSearch, modifier = Modifier.testTag("photos_search")) {
                        Icon(Icons.Filled.Search, contentDescription = "搜索")
                    }
                    IconButton(onClick = onOpenSettings) { Icon(Icons.Filled.Settings, contentDescription = "设置") }
                })
            }
            ConnectionBanner(state = connState, onReconnectAuth = onAddServer)
            MiuiLargeTitle("照片", header)
            PullToRefreshBox(…原样…) { …原样（SyncProgressBar/捏合 Box/网格/overlay）… }
        }
        SnackbarHost(…原样…)
    }
```
imports 增：Search/Settings 图标、IconButton、nestedScroll、snapshotFlow、MiuiPinnedTopBar/MiuiLargeTitle/rememberMiuiHeaderState、SelectionTopBar。
注意：`resolved=false` 空白分支不加顶栏（防冷启动闪帧，原语义保留）。

- [ ] **Step 5.6: MainActivity 接线**

photosContent 的 PhotosScreen 调用补：
```kotlin
    onOpenSearch = { nav.navigate(Routes.search()) },
    onOpenSettings = { nav.navigate(Routes.Settings) },
```

- [ ] **Step 5.7: AppNavTest 适配**（全文件替换）

```kotlin
package com.bluskysoftware.yandegallery.ui

import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.bluskysoftware.yandegallery.ui.common.PhotosSelectionBars
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AppNavTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `底部双tab渲染且可切换`() {
        compose.setContent { AppNavForTest() }
        compose.onNodeWithTag("tab_photos").assertIsDisplayed()
        compose.onNodeWithTag("tab_albums").assertIsDisplayed()
        compose.onNodeWithTag("tab_albums").performClick()
        compose.onNodeWithText("相册页占位").assertIsDisplayed()
    }

    // v0.5 壳重构：顶栏（搜索/设置入口、选择顶栏）已下放 PhotosScreen 自渲染——
    // 壳只验证底栏 swap；顶部入口覆盖见 MiuiTopBarsTest 与 PhotosScreen 装配。
    @Test
    fun `照片tab多选激活时壳级swap底栏`() {
        lateinit var bars: PhotosSelectionBars
        compose.setContent {
            bars = remember { PhotosSelectionBars() }
            AppNavForTest(photosSelectionBars = bars)
        }
        compose.onNodeWithTag("selection_bottom_bar").assertDoesNotExist()
        compose.runOnUiThread {
            bars.model = PhotosSelectionBars.Model(true, {}, {}, {}, {})
        }
        compose.onNodeWithTag("selection_bottom_bar").assertIsDisplayed()
        compose.onNodeWithTag("tab_photos").assertDoesNotExist()   // 导航栏被替换
        compose.runOnUiThread { bars.model = null }
        compose.onNodeWithTag("selection_bottom_bar").assertDoesNotExist()
        compose.onNodeWithTag("tab_photos").assertIsDisplayed()
    }
}
```

- [ ] **Step 5.8: 全量测试**——重点观察 PhotosScreenTest（组件级注入，预期不受壳影响）；若有引用 8 参 Model 的其他用例一并改 5 参。

- [ ] **Step 5.9: Commit** `refactor(android): 壳顶栏下放页面自持——折叠大标题/无胶囊底栏/多选桥瘦身为底栏五字段`

### Task 6: 相册页去 FAB + 顶栏「+」 + 封面卡片；图集详情居中顶栏

**Files:** Modify `ui/albums/AlbumsScreen.kt`、`ui/albums/AlbumDetailScreen.kt`；Test：涉及 `albums_new_fab` 的用例改 `albums_new`（grep `albums_new_fab` 全仓替换后跑测）

- [ ] **Step 6.1: AlbumsScreen 结构重排**（对话框/写逻辑/snackbar 一字不动；仅壳与卡片）

外层 `Scaffold(floatingActionButton=…)` 拆掉，改：

```kotlin
    val header = rememberMiuiHeaderState()
    val gridState = rememberLazyGridState()
    LaunchedEffect(gridState) {
        snapshotFlow { gridState.isScrollInProgress }.collect { if (!it) header.settle() }
    }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().nestedScroll(header.connection)) {
            MiuiPinnedTopBar(title = "相册", scrolled = header.scrolled, actions = {
                // 离线可点但给明确原因（原 FAB 语义平移）；置灰观感 + 无障碍 disabled
                val tint = if (online) MaterialTheme.colorScheme.onSurface
                else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                IconButton(
                    onClick = {
                        if (online) { newName = ""; showNew = true }
                        else scope.launch { snackbarHostState.showSnackbar("离线状态无法新建图集") }
                    },
                    modifier = Modifier
                        .semantics { if (!online) disabled() }
                        .testTag("albums_new"),
                ) { Icon(Icons.Filled.Add, contentDescription = "新建图集", tint = tint) }
            })
            MiuiLargeTitle("相册", header)
            val cards = albums
            when {
                cards == null -> Box(Modifier.fillMaxSize())
                cards.isEmpty() -> AlbumsEmpty()
                else -> LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    state = gridState,
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    modifier = Modifier.fillMaxSize().testTag("albums_grid"),
                ) {
                    items(cards, key = { it.gallery.id }) { card -> AlbumCardItem(…参数原样…) }
                }
            }
        }
        SnackbarHost(
            snackbarHostState,
            Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp),
        )
    }
```
imports：去 Scaffold/FloatingActionButton/WindowInsets；补 rememberLazyGridState/PaddingValues/Arrangement/nestedScroll/snapshotFlow/LaunchedEffect/Box/Alignment/MiuiTopBars 三件/testTag（保留 semantics/disabled）。

- [ ] **Step 6.2: AlbumCardItem 卡片化**（菜单逻辑不动）

Column 去掉 `padding(8.dp)`（网格间距接管）；封面块改：

```kotlin
            if (coverId != null) {
                RetryableAsyncImage(
                    model = thumbnailRequest(LocalContext.current, baseUrl, serverId, coverId),
                    imageLoader = loader,
                    contentDescription = card.gallery.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().aspectRatio(1f).clip(MiuiTokens.CoverShape),
                )
            } else {
                Box(
                    Modifier.fillMaxWidth().aspectRatio(1f)
                        .clip(MiuiTokens.CoverShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
            }
            Text(card.gallery.name, maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
            Text("${card.gallery.imageCount} 张", style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
```

- [ ] **Step 6.3: 空态文案改**：`"点右下「+」新建…"` → `"点右上「+」新建，或连接服务器同步后在此查看"`。

- [ ] **Step 6.4: 全仓替换 tag**：`grep -rl "albums_new_fab" android/` → 生产已改，测试文件里的 `albums_new_fab` 全部替换为 `albums_new`；断言 FAB 存在性的用例语义不变（同 tag 的 IconButton）。

- [ ] **Step 6.5: AlbumDetailScreen 顶栏**（Scaffold 骨架/多选/底栏逻辑不动）

非多选分支的 TopAppBar 换：

```kotlin
            } else {
                // 居中标题 + 数量副标题（spec §4.2）；数量取镜像图集行的 imageCount（galleries 流已在收集）
                val count = galleries.firstOrNull { it.id == viewModel.currentGalleryId }?.imageCount
                MiuiSubPageTopBar(
                    title = title,
                    subtitle = count?.let { "$it 张" },
                    onBack = onBack,
                )
            }
```
若 `AlbumDetailViewModel` 无 `currentGalleryId` 公开属性（图集详情已有 `viewModel.currentGalleryId` 用于 GalleryPicker excludeIds——已确认存在），直接用之。删 TopAppBar/ArrowBack/IconButton 相关 import（IconButton 若他处用保留）。

- [ ] **Step 6.6: 全量测试跑绿 → Commit** `feat(android): 相册页 MIUI 化——顶栏加号替代 FAB/12dp 圆角封面卡片，图集详情居中双行顶栏`

### Task 7: 网格体系统一（3dp 缝+圆角）+ 多选视觉 + sticky 滚动显隐 + 快滚把手

**Files:** Modify `ui/photos/PhotosScreen.kt`（PhotosGrid/photoCell/sticky）、`ui/albums/AlbumDetailScreen.kt`（AlbumDetailGrid/imageCell）、`ui/search/SearchScreen.kt`（SearchResultGrid，仅格子部分——顶栏在 Task 8）、`ui/common/SelectionBars.kt`（SelectableCell）、`ui/common/FastScrollbar.kt`

- [ ] **Step 7.1: PhotosGrid 间距**（骨架函数）

```kotlin
    LazyVerticalGrid(
        columns = GridCells.Fixed(columns),
        state = state,
        horizontalArrangement = Arrangement.spacedBy(MiuiTokens.GridGap),
        verticalArrangement = Arrangement.spacedBy(MiuiTokens.GridGap),
        modifier = modifier.fillMaxSize(),
    ) {
```
Header 行 padding 改 `padding(horizontal = 16.dp, vertical = 10.dp)`（16sp 日期头呼吸感）。

- [ ] **Step 7.2: photoCell 格子**（PhotosScreen 装配处）：`SelectableCell(modifier = Modifier.aspectRatio(1f).padding(1.dp))` → `Modifier.aspectRatio(1f).clip(MiuiTokens.CellShape)`。AlbumDetailScreen `imageCell` 同改；AlbumDetailGrid 加同款 spacedBy 双向间距 + `contentPadding = PaddingValues(top = 2.dp)`。SearchResultGrid：格子 `padding(1.dp)` → `clip(MiuiTokens.CellShape)`，网格加 spacedBy 双向间距。

- [ ] **Step 7.3: SelectableCell 多选视觉**（`ui/common/SelectionBars.kt` 内该函数替换；tag/语义保留）

```kotlin
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SelectableCell(
    selected: Boolean,
    selectionActive: Boolean,
    onOpen: () -> Unit,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier.combinedClickable(
            onClick = { if (selectionActive) onToggle() else onOpen() },
            onLongClick = onToggle,
        ),
    ) {
        // MIUI 手感：选中格子微缩（spec §3）；缩放只作用内容，角标不缩
        val scale by animateFloatAsState(if (selected) 0.94f else 1f, label = "cell_scale")
        Box(Modifier.matchParentSize().graphicsLayer { scaleX = scale; scaleY = scale }) { content() }
        if (selected) {
            Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = 0.3f)))
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(6.dp)
                    .size(20.dp)
                    .background(MaterialTheme.colorScheme.primary, CircleShape)
                    .border(1.5.dp, Color.White, CircleShape)
                    .testTag("selection_badge"),
            ) {
                Icon(Icons.Filled.Check, contentDescription = "已选中", tint = Color.White, modifier = Modifier.size(14.dp))
            }
        } else if (selectionActive) {
            // 多选中未选：空心圈提示可选（MIUI 同款）
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(6.dp)
                    .size(20.dp)
                    .border(1.5.dp, Color.White.copy(alpha = 0.85f), CircleShape)
                    .testTag("selection_ring"),
            )
        }
    }
}
```
imports 增：`animateFloatAsState`、`graphicsLayer`、`border`、`Icons.Filled.Check`；`CheckCircle` import 移除。涉及 `selection_badge`/`已选中` 的既有断言兼容（tag 在 Box、contentDescription 在 Icon）。

- [ ] **Step 7.4: sticky 日期浮层滚动显隐**（PhotosScreen 装配处；StickyDateOverlay 组件本体与 `sticky_date` tag 不动，纯组件测试零影响）

```kotlin
                        // 仅滚动中浮现（spec §3 修重叠）：停止滚动 500ms 后淡出；collectLatest 保证
                        // 重新滚动会取消挂起中的隐藏
                        var stickyVisible by remember { mutableStateOf(false) }
                        LaunchedEffect(gridState) {
                            snapshotFlow { gridState.isScrollInProgress }.collectLatest { scrolling ->
                                if (scrolling) stickyVisible = true
                                else { delay(500); stickyVisible = false }
                            }
                        }
                        androidx.compose.animation.AnimatedVisibility(
                            visible = stickyVisible && topDateLabel != null,
                            enter = fadeIn(tween(120)),
                            exit = fadeOut(tween(200)),
                            modifier = Modifier.align(Alignment.TopStart),
                        ) {
                            StickyDateOverlay(label = topDateLabel)
                        }
```
StickyDateOverlay 样式微调：`RoundedCornerShape(12.dp)` → `RoundedCornerShape(50)`、加 `border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant)`（Surface 参数）。imports：collectLatest/delay/fadeIn/fadeOut/tween。
若 PhotosScreenTest 有「sticky 在静止时可见」的既有断言：该断言测试的是 StickyDateOverlay 组件本体（直接组合），不经 AnimatedVisibility——先跑测确认，仅当断言经由 PhotosScreen 整屏装配时才需要在测试里模拟滚动或改断言目标为组件本体。

- [ ] **Step 7.5: FastScrollbar 把手/气泡样式**（逻辑零改动）：thumb `size(width = 6.dp,…)` → `size(width = 5.dp,…)`、`RoundedCornerShape(3.dp)` → `RoundedCornerShape(50)`；气泡 Surface `RoundedCornerShape(16.dp)` → `RoundedCornerShape(50)`、`color = secondaryContainer` → `color = MaterialTheme.colorScheme.surfaceContainerHigh`、加 `shadowElevation = 3.dp`。

- [ ] **Step 7.6: 全量测试跑绿 → Commit** `feat(android): 网格 3dp 缝圆角统一三网格，多选蓝勾/空心圈/微缩，sticky 仅滚动中浮现`

### Task 8: 搜索页胶囊搜索框 + 胶囊历史 chip

**Files:** Modify `ui/search/SearchScreen.kt`；Test `SearchScreenTest.kt`（预期零改，跑确认）

- [ ] **Step 8.1: 顶部区替换**（TopAppBar+TextField → 返回 + MiuiSearchField；预填/焦点/防重入逻辑不动）

```kotlin
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 8.dp),
            ) {
                IconButton(onClick = onBack, modifier = Modifier.testTag("search_back")) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                }
                MiuiSearchField(
                    value = query,
                    onValueChange = viewModel::onQueryChange,
                    placeholder = "搜索标签或文件名",
                    onSearch = {
                        viewModel.commitSearch()
                        keyboard?.hide()
                    },
                    onClear = { viewModel.onQueryChange("") },
                    focusRequester = focusRequester,
                    modifier = Modifier.weight(1f),
                )
            }
        },
    ) { padding -> …内容区三分支原样… }
```

- [ ] **Step 8.2: 同文件新增私有 MiuiSearchField**

```kotlin
/** 灰底胶囊搜索框（spec §7）：40dp 高、无下划线；testTag search_field/search_clear_query 契约保留。 */
@Composable
private fun MiuiSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    onSearch: () -> Unit,
    onClear: () -> Unit,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = modifier.height(40.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 12.dp)) {
            Icon(
                Icons.Filled.Search, contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
            Box(Modifier.weight(1f).padding(horizontal = 8.dp), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) {
                    Text(placeholder, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { onSearch() }),
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(focusRequester)
                        .testTag("search_field"),
                )
            }
            if (value.isNotEmpty()) {
                Icon(
                    Icons.Filled.Close, contentDescription = "清除",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .size(20.dp)
                        .clip(CircleShape)
                        .clickable(onClick = onClear)
                        .testTag("search_clear_query"),
                )
            }
        }
    }
}
```
imports 增：BasicTextField/SolidColor/CircleShape/clip/clickable/Surface/statusBarsPadding/size；删 TextField/TopAppBar。
注意：原清除按钮是 IconButton（tag 在 IconButton 上）——现 tag 落在可点 Icon 上，`performClick` 兼容。

- [ ] **Step 8.3: 历史区换皮**（SearchHistory 函数体；tag `search_clear_history`/`search_history_$q` 保留）

```kotlin
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("搜索历史", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            IconButton(onClick = onClear, modifier = Modifier.testTag("search_clear_history")) {
                Icon(Icons.Outlined.Delete, contentDescription = "清空搜索历史", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            history.forEach { q ->
                Surface(
                    shape = RoundedCornerShape(50),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .clickable { onPick(q) }
                        .testTag("search_history_$q"),
                ) {
                    Text(q, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp))
                }
            }
        }
    }
```
（`search_clear_history` 原是 TextButton「清空」——SearchScreenTest 若断言文本「清空」改为断言 tag 点击后历史清空；先跑测再按报错适配。AssistChip import 删除。）

- [ ] **Step 8.4: 全量测试跑绿 → Commit** `feat(android): 搜索页 MIUI 化——灰底胶囊搜索框/胶囊历史词/垃圾桶清空`

### Task 9: 大图页上下渐变 chrome + 顶部日期时间 + 多选栏/详情面板换皮

**Files:** Modify `ui/viewer/ViewerScreen.kt`（ViewerPager chrome 区 + ModalBottomSheet 底色）、`ui/viewer/ViewerActionBar.kt`（图标 22dp）、`ui/common/SelectionBars.kt`（Top/Bottom 栏皮）；Test `ViewerScreenTest.kt` 增 2 例

- [ ] **Step 9.1: ViewerPager chrome 重排**（located 门控/占位层/错误态/pager 全部不动）

`if (!immersive) { … }` 整块替换为（`currentImage` 提升到块外共用；`highZoom` 保持在底栏内 derivedStateOf）：

```kotlin
        val currentImage = if (items.itemCount == 0) null
        else items.peek(pagerState.currentPage.coerceIn(0, items.itemCount - 1))

        // 顶部 chrome：渐变遮罩 + 返回 + 居中日期/时间（spec §5）；chrome 隐显 150ms fade
        androidx.compose.animation.AnimatedVisibility(
            visible = !immersive,
            enter = fadeIn(tween(150)),
            exit = fadeOut(tween(150)),
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.45f), 1f to Color.Transparent)),
            ) {
                IconButton(
                    onClick = onBack,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .statusBarsPadding()
                        .testTag("viewer_back"),
                ) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = Color.White)
                }
                // 定位完成前无「当前图」语义：与操作栏同门控（BUG-06 同口径），只显返回
                if (located && currentImage != null) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .statusBarsPadding()
                            .padding(top = 6.dp, bottom = 20.dp)
                            .testTag("viewer_title_date"),
                    ) {
                        Text(
                            viewerDateLabel(currentImage.createdAt, LocalDate.now()),
                            color = Color.White,
                            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
                        )
                        Text(
                            viewerTimeLabel(currentImage.createdAt),
                            color = Color.White.copy(alpha = 0.7f),
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                } else {
                    Spacer(Modifier.statusBarsPadding().height(48.dp))   // 维持遮罩高度稳定
                }
            }
        }

        // 底部 chrome：渐变遮罩 + 操作栏（viewer_bottom_bar tag 与 located 门控原样）
        androidx.compose.animation.AnimatedVisibility(
            visible = !immersive,
            enter = fadeIn(tween(150)),
            exit = fadeOut(tween(150)),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            if (located) {
                val highZoom by remember {
                    derivedStateOf {
                        (zoomStates[pagerState.currentPage]?.scale ?: 1f) > HIGH_ZOOM_THRESHOLD
                    }
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(Brush.verticalGradient(0f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.55f))),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 28.dp)
                            .navigationBarsPadding()
                            .padding(8.dp)
                            .testTag("viewer_bottom_bar"),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        if (currentImage != null) actionBar(currentImage, highZoom)
                    }
                }
            }
        }
```
imports 增：AnimatedVisibility/fadeIn/fadeOut/tween、Brush、Spacer/height、FontWeight、MaterialTheme、`viewerDateLabel`/`viewerTimeLabel`（`com.bluskysoftware.yandegallery.ui.photos.*`）、LocalDate、Icon/AutoMirrored 已有。原 `Row(...).background(Color.Black.copy(alpha = 0.4f))` 底栏块与旧返回键块删除。

- [ ] **Step 9.2: ModalBottomSheet 底色**（ViewerScreen 装配处）：`ModalBottomSheet(onDismissRequest = …)` 加 `containerColor = MaterialTheme.colorScheme.surfaceContainerHigh`（20dp 顶圆角与拖动把手 M3 默认已随 shapes.extraLarge 生效）。

- [ ] **Step 9.3: ViewerActionBar 微调**：`BarAction` 的 `Icon(icon, …)` 加 `modifier = Modifier.size(22.dp)`；Column padding 改 `padding(horizontal = 12.dp, vertical = 8.dp)`（labelSmall 已随 Type.kt 变 11sp，无需改）。

- [ ] **Step 9.4: SelectionBars 换皮**（回调/tag/文案零变化）

SelectionTopBar：`Surface(color = surfaceContainerHigh)` → `Surface(color = MaterialTheme.colorScheme.surface)`，Surface 内 Column 包裹：原 Row + 尾随 `HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)`；「已选 $count 项」Text 改居中：`Text(…, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)`。
SelectionBottomBar：`Surface(color = surface)` + Column{ 顶部 HorizontalDivider(0.5.dp, outlineVariant)；原 Row }；`SelectionAction` 的 Icon 加 `Modifier.size(22.dp)`。

- [ ] **Step 9.5: ViewerScreenTest 增 2 例**（文件已有 4 例，追加）

```kotlin
    /** spec §5：定位完成前顶部日期无「当前图」语义——与操作栏同门控，不得渲染。 */
    @Test
    fun `定位完成前不渲染顶部日期（沿用 BUG-06 口径）`() {
        compose.setContent {
            val items = flowOf(
                PagingData.from(
                    listOf(image(1), image(2)),
                    LoadStates(
                        refresh = LoadState.NotLoading(endOfPaginationReached = false),
                        prepend = LoadState.NotLoading(endOfPaginationReached = true),
                        append = LoadState.NotLoading(endOfPaginationReached = false),
                    ),
                ),
            ).collectAsLazyPagingItems()
            val context = androidx.compose.ui.platform.LocalContext.current
            ViewerPager(
                items = items, initialImageId = 999L,
                imageLoader = ImageLoader.Builder(context).build(),
                modelFor = { "file:///nonexistent/${it.id}.jpg" },
                onPrefetch = {}, onBack = {},
            )
        }
        compose.waitForIdle()
        compose.onNodeWithTag("viewer_title_date").assertDoesNotExist()
        compose.onNodeWithTag("viewer_back").assertIsDisplayed()
    }

    @Test
    fun `定位完成后顶部渲染日期时间`() {
        compose.setContent {
            val items = flowOf(PagingData.from(listOf(image(1), image(2)))).collectAsLazyPagingItems()
            val context = androidx.compose.ui.platform.LocalContext.current
            ViewerPager(
                items = items, initialImageId = 2L,
                imageLoader = ImageLoader.Builder(context).build(),
                modelFor = { "file:///nonexistent/${it.id}.jpg" },
                onPrefetch = {}, onBack = {},
            )
        }
        compose.waitForIdle()
        compose.onNodeWithTag("viewer_title_date").assertExists()
    }
```

- [ ] **Step 9.6: 全量测试跑绿 → Commit** `feat(android): 大图页 MIUI chrome——上下渐变遮罩/居中日期时间/150ms fade，多选栏发丝线换皮`

### Task 10: 版本 0.5.0 + 打包装机实机核验 + 文档收尾

**Files:** Modify `android/app/build.gradle.kts`、`android/README.md`、spec 文档状态行；实机操作 MuMu（127.0.0.1:16384）与红魔 NX769J（FY24148102C9）

- [ ] **Step 10.1: 版本号**：`versionCode = 5` → `6`；`versionName = "0.4.1"` → `"0.5.0"`。

- [ ] **Step 10.2: 全量单测终跑**：`cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest"` → BUILD SUCCESSFUL，用例数应 ≥ 基线 314 + 新增（MiuiDialogTest 3 + MiuiTopBarsTest 2 + TimelineModelsTest 3 + ViewerScreenTest 2 ≈ 324+）。

- [ ] **Step 10.3: 打包**：`cmd //c "D:\\Android\\gw.bat :app:assembleDebug"` → `android/app/build/outputs/apk/debug/app-debug.apk`。

- [ ] **Step 10.4: 装机**（先 `adb devices` 核对序列号，勿凭序列号猜设备——memory 教训）：
  - `adb -s 127.0.0.1:16384 install -r android/app/build/outputs/apk/debug/app-debug.apk`
  - `adb -s FY24148102C9 install -r ...`（真机 edge-to-edge/状态栏图标色重点核对）
  - 小米平板 `adb -s 4824f0aa install -r ...`（PIN 锁屏，装上即可，用户解锁自验）

- [ ] **Step 10.5: MuMu 逐页截图对照 spec**（`adb exec-out screencap -p`，深色主题）：
  1. 照片页顶部（大标题态）＋上滑后（小标题浮现+发丝线）＋日期头「今天/昨天/周X」＋3dp 缝圆角格子
  2. 滚动中 sticky 胶囊浮现、停止后淡出；快滚细把手+胶囊气泡
  3. 长按多选：空心圈/蓝勾/微缩 + 顶部选择栏 + 底部动作栏发丝线
  4. 相册页：右上「+」、12dp 圆角封面卡片、名称/数量排版
  5. 大图页：顶部渐变+日期时间居中、底部渐变操作栏；单击沉浸切换 fade
  6. 批量删除弹窗：等宽双胶囊按钮、红色危险确认
  7. 搜索页：胶囊搜索框、历史胶囊 chip
  8. 设置/缓存/服务器页：卡片分组、服务器卡片蓝点「当前」、表单灰底输入框+胶囊按钮
  9. 底部导航：无胶囊指示器、选中实心蓝
  逐项与 spec §2-§8 核对；观感偏差当场修（禁写测试数据，全程只读操作——桌面端写权限全开，误触会真删库）。
  红魔上抽查 1/4/5/9 四项 + 状态栏图标色（浅色模式下须为深色图标——红魔默认浅色主题正好覆盖浅色配色核验）。

- [ ] **Step 10.6: 折叠头手感核验**（实机）：照片页上滑大标题收起→继续滚内容；中途下滑不弹头；回顶后余量展开；松手无半截标题。若 nestedScroll 有跳变/掉帧，按 spec §2.3 预案降级为「二值动画收展」（`AnimatedVisibility` 包 MiuiLargeTitle，阈值 firstVisibleItemIndex>0）并记录到 spec。

- [ ] **Step 10.7: 文档**：
  - `android/README.md`：功能清单/截图口径处补一段「v0.5.0 UI 重塑（仿 MIUI 相册）」要点；版本号更新。
  - spec 文档顶部加状态行：`> ✅ 已实施（v0.5.0，实施计划 doc/superpowers/plans/2026-07-08-android-miui-ui-redesign.md）`。
  - 本计划文件勾选全部 checkbox。

- [ ] **Step 10.8: 终提交** `feat(android): 仿 MIUI 相册 UI 重塑收官——版本 0.5.0，全量单测绿+双真机核验`

---

## 计划自审记录（writing-plans self-review）

1. **Spec 覆盖**：§1 配色/字号/形状→Task 1；§2.1 edge-to-edge→Task 1；§2.2-2.4 壳/顶栏/底栏→Task 5；§3 照片页（日期头→Task 2、网格/sticky/多选/快滚→Task 7、顶部→Task 5）；§4 相册/图集详情→Task 6；§5 大图页→Task 9；§6 多选栏/横幅→Task 9/Task 4；§7 搜索页→Task 8（格子部分 Task 7）；§8 设置族/表单/弹窗→Task 4/Task 3；§10 测试与版本→各 Task + Task 10；§11 排除项未入任务 ✓。
2. **占位扫描**：Task 3.5 各调用点「原逻辑原样保留」是对既有代码的搬运指令（原文在仓库中，非 TBD）；Task 4.3 CacheTierSection「usage 文案（原拼接逻辑）」同理。无 TBD/TODO。
3. **类型一致性**：`MiuiHeaderState(heightPx)/collapseFraction/scrolled/settle()/connection` 在 Task 5 定义、Task 6 复用同名；`PhotosSelectionBars.Model(online,onDownload,onShare,onDelete,onAddToGallery)` 5 参在 Task 5 定义、AppNavTest 同参调用；`MiuiTokens.GridGap/CellShape/CoverShape` Task 1 定义、Task 6/7 引用；`dayHeaderDisplayOf/monthHeaderDisplayOf/viewerDateLabel/viewerTimeLabel/weekdayCn` Task 2 定义、Task 9 引用 ✓。
4. **已知风险与预案**：折叠头 nestedScroll 手感（Task 10.6 降级预案）；Robolectric 首跑 flake（重跑即绿）；`MiuiCapsuleButton` 代码块内联全名 import 已标注执行时规范化。






