# 安卓 App UI 重塑：组件级仿 MIUI 相册（设计文档）

> ✅ 已实施（v0.5.0 / versionCode 6，2026-07-09）：实施计划 `doc/superpowers/plans/2026-07-08-android-miui-ui-redesign.md`，
> 工作流 9 任务全过双阶段审查，全量单测 61 类/332 例绿，MuMu 深浅双主题逐页截图核验通过；
> §2.3 折叠头 nestedScroll 方案实机手感正常，未触发降级预案。

- 日期：2026-07-08
- 目标版本：0.5.0（versionCode 6）
- 决策人确认：组件级仿 MIUI（不追像素级动效复刻）；字体跟随系统（不内置 MiSans）
- 现状基线：v0.4.1，全部界面为 Material 3 出厂默认样式（默认 TopAppBar、带胶囊指示器的 NavigationBar、方格 1dp 缝、下划线搜索框、裸 ListItem 设置页），未开 edge-to-edge

## 0. 背景与目标

用户反馈当前 UI「原始」，要求整体仿小米相册（MIUI/HyperOS 相册）观感。本期做**视觉与结构层重塑**：主题基座、导航壳、逐页换皮、统一弹窗体系；**不改动**数据层、同步协议、下载状态机、写路径与既有交互契约（多选/捏合切档/快滚/沉浸切换等行为全部保留）。

## 1. 设计基座（theme 层）

### 1.1 配色（`ui/theme/Color.kt` + `Theme.kt` 补全 colorScheme）

| 语义 | 浅色 | 深色 | 用途 |
|---|---|---|---|
| primary | `#3482FF`（现值保留） | `#5C9BFF`（现值保留） | 选中态/主按钮/勾选 |
| background / surface | `#FFFFFF` | `#000000`（OLED 真黑） | 照片/相册页底、导航壳 |
| surfaceContainerLow | `#F5F6F8` | `#000000` | 设置族页面底色 |
| surfaceContainer 族（container/High/Highest） | `#FFFFFF` | `#1C1C1E` | 卡片、菜单、弹窗底 |
| surfaceVariant | `#F2F3F5` | `#1F2022` | 胶囊搜索框/输入框/chip 灰底 |
| onSurface | `#1A1A1A` | `#F2F2F2` | 主文字 |
| onSurfaceVariant | `#8A8F99` | `#9AA0AA` | 次要文字（现值保留） |
| outlineVariant | `#000000` 8% | `#FFFFFF` 10% | 发丝线（hairline） |
| error | `#E53935` | `#FF6B6B` | 危险按钮（删除确认） |

- 弹窗（AlertDialog→MiuiDialog）、DropdownMenu、设置卡片统一落在 surfaceContainer 族上：浅色白、深色 `#1C1C1E`。
- 多选顶/底栏改用 `surface` + hairline（弃用 surfaceContainerHigh 灰底）。

### 1.2 字号层级（`Type.kt`，系统字体）

| 槽位 | 规格 | 用途 |
|---|---|---|
| headlineLarge | 30sp / W700 / 字距 0 | 页面大标题（照片/相册） |
| titleLarge | 17sp / W600 | 收起态小标题、二级页居中标题、弹窗标题 |
| titleMedium | 16sp / W600 | 时间轴日期头 |
| bodyLarge / bodyMedium | 15sp / 14sp | 列表主文字 / 正文 |
| labelMedium / labelSmall | 12sp / 11sp | 数量灰字 / 底栏与操作栏标签 |

中文场景全部字距归零（M3 默认 letterSpacing 对中文偏散）。

### 1.3 形状体系

- 网格格子 3dp；封面/卡片/菜单 12dp；弹窗 20dp；按钮、输入框、搜索框、chip 全圆角胶囊。
- 注册进 `MaterialTheme.shapes`（extraSmall=12 / small=12 / medium=12 / large=16 / extraLarge=20）；DropdownMenu 取 extraSmall、故设 12dp 使菜单圆角自动跟随。

## 2. 全局壳（`AppNav.kt` + `MainActivity`）

### 2.1 edge-to-edge

- `MainActivity` 开 `enableEdgeToEdge()`；状态栏图标深浅随主题（浅色深图标/深色浅图标），Theme 层 `SideEffect` 设 `isAppearanceLightStatusBars`。
- 各页面自行处理顶部 inset：tab 页由常驻顶部动作层处理；二级页由各自 Scaffold TopBar 处理（现已如此）；大图页已有沉浸逻辑不动。

### 2.2 顶栏归属重构（壳→页面）

- AppScaffold **不再渲染 topBar 槽**；照片/相册两 tab 的顶部区域下放进各自页面（与设置/相册详情等其余页面既有模式一致）。
- 壳保留：底部导航、以及多选激活时的底栏 swap。`PhotosSelectionBars` 桥瘦身为**只管底部**：`Model(online, onDownload, onShare, onDelete, onAddToGallery)`；`count/onSelectAll/onCancel` 移回 PhotosScreen 内部（顶部选择栏随页面渲染）。

### 2.3 tab 页顶部模式（新共享组件 `MiuiTopBars.kt`）

- **大标题滚走**：`headlineLarge` 大标题作为网格首项（span 满行，高约 64dp），随内容上滚消失。
- **常驻动作层（overlay）**：右上动作图标常驻（照片 tab：搜索/设置；相册 tab：+）；居中小标题（titleLarge）仅在大标题滚出视口后淡入，同时动作层从透明底过渡为 `background` 95% 不透明底 + 底部 hairline（以半透明纯色近似毛玻璃，Compose 跨层 blur 不引入）。
- 判据：`firstVisibleItemIndex > 0`（大标题项完全滚出）驱动 `AnimatedVisibility` fade。
- **多选态**：PhotosScreen 内部把顶部区域换成选择栏（取消 × /「已选 N 项」/全选），行为与今日一致，仅样式换 `surface` + hairline。

### 2.4 底部导航重绘（`MiuiNavBar`）

- 替换 M3 NavigationBar：`surface` 底色 + 顶部 hairline，高 56dp + 导航条 inset。
- item：图标 24dp + 11sp 标签垂直排布；选中 = Filled 图标 + primary 着色，未选 = Outlined 图标 + onSurfaceVariant；**无胶囊指示器**。
- 保留 `tab_photos` / `tab_albums` testTag 与导航逻辑（popUpTo/saveState 等原样）。

## 3. 照片页（`PhotosScreen.kt` + `TimelineModels.kt`）

- **日期头文案 MIUI 化**（formatter 改造 + 单测）：
  - 日分组：今天 → `今天`；昨天 → `昨天`；同年 → `M月d日 周X`；跨年 → `yyyy年M月d日 周X`（周X = 周一…周日）。
  - 月分组：同年 → `M月`；跨年 → `yyyy年M月`。
  - 「今天/昨天」以 formatter 执行时的本地日期为准（跨午夜长驻会话可能滞后，接受；下拉刷新/重建即恢复）。
- **网格缝隙与圆角**：去掉 per-cell 1dp padding，改 `Arrangement.spacedBy(3.dp)`（水平+垂直）+ 格子 `clip(RoundedCornerShape(3.dp))`；`animateItem` 切档动画保留。
- **sticky 日期浮层修复**（现与列表内日期头重叠）：改为**仅滚动进行中显示**（`isScrollInProgress` 驱动，停止后延迟约 500ms 淡出）；样式为半透明胶囊（surface 92% + hairline 描边）。
- **多选态 MIUI 化**（`SelectableCell`）：
  - 多选激活时：未选格子右上叠**空心圆角标**（白描边 70% 透明）；选中叠 primary 底白勾角标 + 30% 黑遮罩（保留）+ 格子 `scale` 微缩至 0.94（spring 动画）。
  - testTag `selection_badge` 保留。
- 快滚滑块（`FastScrollbar`）：把手细条化（宽约 5dp 胶囊），拖动态日期气泡改胶囊样式；行为逻辑不动。
- 引导态/空态：文案不变，按钮为 primary 胶囊（M3 Button 默认即胶囊，配色随主题）。

## 4. 相册页 + 相册详情

### 4.1 相册页（`AlbumsScreen.kt`）

- 网格：2 列、`contentPadding(horizontal=16dp)`、项间距 12dp（水平）/ 16dp（垂直）；封面 `aspectRatio(1f)` + 12dp 圆角；名称 bodyLarge（15sp/W500）+ 数量 labelMedium 灰字，封面下方左对齐。
- **移除 FAB**：新建入口改为顶部常驻动作层右上 `+` 图标；新建/重命名/删除对话框与 snackbar 逻辑留在本屏（动作层由本屏渲染，无需跨壳桥接）。testTag 由 `albums_new_fab` 改名 `albums_new`（同步测试）。
- 空态文案改为「点右上『+』新建…」。
- 长按菜单（重命名/删除）保留，DropdownMenu 圆角随 shapes 变 12dp。

### 4.2 相册详情（`AlbumDetailScreen.kt`）

- 顶栏改**居中标题**（相册名，titleLarge）+ 副标题（`N 张`，labelMedium 灰字）双行居中；返回居左。
- 网格格子、缝隙、多选样式与照片页统一（复用同一套常量）。
- 多选顶/底栏换皮同 §2.3/§6。

## 5. 大图页（`ViewerScreen.kt` + `ViewerActionBar.kt` + `DetailPanel.kt`）

- **顶部 chrome**（非沉浸时显示）：黑 45% →透明垂直渐变遮罩（状态栏 inset + 约 96dp 高）；左返回（现 `viewer_back` 保留）；**居中两行**：第一行日期（15sp/W600/白）、第二行时间（11sp/白 70%），取当前页 `image.createdAt` 本地时区格式化（`M月d日 周X` / `HH:mm`，跨年带年份）。定位完成前（located=false）只显返回，不显日期（无当前图语义，与操作栏门控同口径）。
- **底部 chrome**：透明→黑 55% 渐变遮罩（约 140dp + 导航条 inset）；操作栏五项与三态逻辑不动，样式统一为图标 22dp + 11sp 白字，禁用 38% 透明度（现状保留）。
- chrome 隐显（沉浸切换已有）补 150ms fade 动画（`AnimatedVisibility`）。
- **详情面板**：改为底部抽屉样式——顶部 20dp 圆角 + 顶部居中拖动把手条（32×4dp 圆角灰条），信息行左标签灰字/右值主字；面板底色 surfaceContainer 族。展示字段与关闭逻辑不动。

## 6. 多选栏与横幅（`SelectionBars.kt` + `ConnectionBanner.kt`）

- 顶部选择栏：`surface` 底 + 底部 hairline；「已选 N 项」居中（titleLarge 17sp），取消 × 居左、全选居右（图标不变）；testTag 全保留。
- 底部动作栏：`surface` 底 + 顶部 hairline，item 样式与大图页操作栏统一（图标 22dp + 11sp 标签）；禁用置灰逻辑不变。
- 连接横幅：保持全宽条，但配色柔和化——离线 = 黄底 12%+黄字，未授权 = 红底 12%+红字，高度收窄（约 36dp），文字 labelMedium；可点击行为不变。

## 7. 搜索页（`SearchScreen.kt`）

- 顶部：返回图标 + **灰底胶囊搜索框**（高 40dp、全圆角、`surfaceVariant` 底、TextField indicator 全透明、内嵌放大镜与清除 ×）；不再用 TopAppBar+下划线 TextField。
- 历史区：标题「搜索历史」+ 右侧**垃圾桶图标**清空（替换文字按钮）；历史词 chip 改灰底胶囊（`surfaceVariant` 底、无描边、13sp）。
- 结果网格：与照片页统一（3dp 缝 + 3dp 圆角格子）。
- `search_field` / `search_no_server` / `search_grid` / `search_history_*` 等 testTag 保留。

## 8. 设置族 + 表单 + 弹窗体系

### 8.1 共享组件（新建 `ui/common/MiuiCardGroup.kt`）

- `MiuiCardGroup(title?)`: 12dp 圆角卡片（surfaceContainer 族底色），组间距 12dp，组标题（可选）为卡片外 12sp 灰字。
- `MiuiListItem(headline, supporting?, value?, trailingChevron, onClick?)`: 高约 56dp，行内无分隔线（靠内边距分隔），行尾灰值文字或 chevron `›`。

### 8.2 应用页面

- **设置页**：页底 surfaceContainerLow；两组卡片——[服务器管理 / 缓存管理]、[版本 / 开源协议]；行尾 chevron。
- **缓存管理页**：占用/清理/上限/已下载记录改卡片分组呈现（具体行结构照现有功能映射，计划期逐行对照）。
- **服务器列表页**：每台服务器一张 12dp 圆角卡片：名称 + 地址灰字，激活台左侧 primary 圆点 + 「当前」标记；操作入口保留现有交互（点击/菜单）。
- **添加/编辑服务器表单**：输入框改灰底圆角填充样式（`surfaceVariant` 底、12dp 圆角、无下划线，label 上浮改为框上方固定灰字标签）；主按钮为底部 48dp 全宽 primary 胶囊；「测试连接」为次级灰底胶囊。防抖/校验逻辑不动。
- **扫码页**：仅统一顶栏（居中标题）与提示文案样式，扫码逻辑不动。
- 二级页顶栏统一组件 `MiuiSubPageTopBar`：居中 titleLarge 标题 + 左返回，背景与页面同色、滚动内容页可选 hairline。

### 8.3 统一弹窗 `MiuiDialog`（新建 `ui/common/MiuiDialog.kt`）

- 结构：20dp 圆角、`surfaceContainerHigh` 底；标题居中 titleLarge；正文居左 bodyMedium（或 content 槽放输入框等）；底部**等宽双胶囊按钮**（高 44dp、间距 12dp）：取消 = `surfaceVariant` 底 + onSurface 字；确认 = primary 底白字；**危险确认 = error 底白字**。单按钮弹窗（如开源协议「关闭」）为单个全宽胶囊。
- 替换现有全部 AlertDialog 调用点（计划期逐一清点，已知：照片页批量删除√危险、相册页命名/重命名、删除相册√危险、大图页删除√危险、设置页开源协议、缓存页清理确认、服务器删除确认等）；`confirmTag` 参数保留各处既有 testTag（`batch_delete_confirm`、`album_new_confirm` 等）。
- `GalleryPickerDialog` 同步换皮：20dp 圆角、列表行 48dp、标题居中。

## 9. 实现结构（新增/改动文件清单）

**新增**（均在 `ui/common/`，除注明外）：
- `MiuiTopBars.kt`：大标题网格首项 + 常驻动作层 + `MiuiSubPageTopBar`
- `MiuiNavBar.kt`：底部导航（或并入 AppNav.kt）
- `MiuiDialog.kt`：统一弹窗 + 按钮排
- `MiuiCardGroup.kt`：设置卡片组 + 列表行
- `ui/photos/TimelineDateFormat.kt`（或并入 TimelineModels.kt）：日期头 formatter

**主要改动**：theme 三件套、MainActivity（edge-to-edge）、AppNav.kt（壳瘦身）、PhotosScreen、AlbumsScreen、AlbumDetailScreen、ViewerScreen/ViewerActionBar/DetailPanel、SearchScreen、SettingsScreen、CacheScreen、ServersScreen、AddServerScreen、EditServerScreen、ScanScreen、SelectionBars、ConnectionBanner、FastScrollbar、GalleryPickerDialog。

## 10. 测试与验收

- **行为契约不变**：所有既有 testTag 保留（唯一改名：`albums_new_fab`→`albums_new`）；多选/捏合/快滚/沉浸/定位门控等交互逻辑零改动。
- **单测**：全量 Robolectric 须全绿（基线 314 例）；受影响断言适配（壳顶栏迁移相关：AppNav 系、photos_search 归属）。新增：
  - 日期头 formatter：今天/昨天/同年周X/跨年/月分组 5 类断言
  - MiuiDialog：确认/取消回调、危险态渲染、confirmEnabled 门控
  - tab 页大标题滚动：滚出首项后小标题浮现（compose 测试）
  - 相册页「+」入口：点击弹新建对话框（替代原 FAB 用例）
  - 大图页顶部日期：located 前不渲染、located 后取当前页 createdAt
- **实机验证**（只读操作）：MuMu（API 32）全页面截图对照本文档逐节核对；红魔 NX769J（API 34）装机看真机渲染（edge-to-edge/状态栏图标色重点核对）；小米平板留用户解锁后自验。
- **版本**：0.5.0 / versionCode 6；`android/README.md` 与联调文档同步。

## 11. 明确不做（本期排除）

共享元素 hero 转场、捏合跟手连续缩放（保持离散档）、弹性过滚回弹、自绘年月快滚导轨刻度、内置 MiSans 字体、真毛玻璃 blur、图标库更换（沿用 Material Icons 的 Filled/Outlined 变体）。
