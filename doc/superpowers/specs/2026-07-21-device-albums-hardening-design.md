# v0.8.1 手机相册加固轮设计（DEFER backlog 七类修复）

状态：✅ 已实施（2026-07-22）
分支：`feature/device-albums-hardening`（自 master@6abb2e5，v0.8.0 已合并）
版本：versionCode 10 / versionName "0.8.1"
来源：v0.8.0 终审 DEFER backlog（A-G）+ 真机复核新增两项（`.superpowers/sdd/progress.md` 归档）

## §0 决策记录

- **H1 落点**：v0.8.0 先合并 master，本轮在独立分支 `feature/device-albums-hardening` 上做，版本 v0.8.1。（用户决策）
- **H2 批量复制 WorkManager 化**：手机→手机多选批量复制从组合作用域改为 WorkManager 后台任务，对齐桌面→手机导出 worker 形态；**大图页单张复制保持现状同步执行**（即时反馈体感优先）。（用户决策）
- **H3 移动两段式进程重建 = 诚实降级**：重建后选中集为空则整流程静默放弃（不调 moveTo、不弹 snackbar），不做选中集持久化——修复成本与窄窗口概率不成比例，且避免 SelectionState 双源。（用户决策）
- **H4 手势修复语义**：RetryableAsyncImage 错误占位在多选模式下手势让位于格子（可选中/长按），非多选模式保留点击重试；重试入口在多选下转为角标按钮。（常规设计，见 §3）
- **H5 复用收敛不改行为**：A 类所有抽取/搬家必须字节级等价现有渲染与逻辑，纯结构重构，测试锁定后进行。（常规设计）
- **H6 导出防御口径**：enqueue 返回成败，serverId null 时 UI 提示失败而非假成功；findCopy 异常归入 retryable。（终审建议原案）
- **H7 汇总通知 id 加盐**：多批导出的汇总通知 id 由固定值改为 `基值 - serverId 哈希扰动`，批间不互覆；同 serverId 多批仍覆盖（同源任务累计语义可接受）。（终审建议原案）
- **H8 测试补强 = 全量清欠**：F 类按各任务 review Minor 清单逐条补齐，不做筛选。（用户默认"都修"）
- **H9 settle null→clear-all 翻转**：DeviceViewerScreen settle 清理在快照瞬空（peek null）时跳过清理而非 clear-all，消除放大态外部脉冲缩放回位窗口（终审复核裁定的一行翻转）。

## §1 范围

七类全修（用户指令"这些都修复一下"）：

| 类 | 内容 | 性质 |
|---|---|---|
| A | 复用收敛（findActivity/系统栏辅助/手机节 UI 镜像/路径构造/mime() 落址/过滤层级统一） | 纯重构 |
| B | 手机→手机批量复制 WorkManager 化 | 行为改造 |
| C | RetryableAsyncImage 错误占位手势让位 | 行为修复（三网格共享组件） |
| D | 导出防御（serverId null 提示 + findCopy runCatching + 顺序断言） | 健壮性 |
| E | 移动进程重建诚实降级 | 边界收口 |
| F | 测试补强全量清欠 | 纯测试 |
| G | 小 UX（picker 闪旧快照/连点防抖/Viewer move 空相册 auto-back/汇总通知加盐/settle 翻转/联调计划退出标准行） | 杂项 |

**不做**：SelectionState 持久化（H3 已弃）；手机→手机复制的字节级查重（沿用同名即已存在语义）；photos 域连点防抖之外的大改（防抖修复覆盖三域共享组件即止）。

## §2 A 类——复用收敛明细

全部为**零行为差**重构，每项先由现有测试锁定，抽取后全量回归：

- **A1 系统栏辅助入 ui/common**：`findActivity`（现三份：ViewerScreen/Theme/DeviceViewerScreen）与 `applySystemBars`/`setSystemBarAppearanceLight`（现两份）合并为 `ui/common/SystemBarUtil.kt` 顶层函数；三处调用点改引用，原 private 副本删除。
- **A2 手机相册节共享组件**：DeviceAlbumPicker 与 CopyTargetPicker 手机节的 ~80 行镜像（相册行渲染/待落地徽标/内联新建输入）抽为 `ui/device/DeviceAlbumSection.kt`（含 MiuiTextField 纵向堆叠坑的既有注释随迁）；两 picker 改为组合该组件。
- **A3 路径构造单点**：`Pictures/<名>/` 拼接收敛为 `DeviceModels.kt` 顶层 `fun pendingAlbumPath(name: String): String`；现两处（DeviceAlbumsViewModel.buildTargetAlbums、picker 内联新建回调）改调用。
- **A4 mime() 迁址**：`DeviceMedia.mime()` 从 DeviceAlbumDetailScreen.kt 迁至 `data/device/DeviceModels.kt`（DeviceMedia 的扩展或成员），引用点更新。
- **A5 目标候选过滤层级统一**：`isWritableAlbumPath` 过滤前置进 `buildTargetAlbums`（或新增 `buildWritableTargets` 变体），三个 VM（DeviceAlbumDetail/DeviceViewer/DeviceCopyTargets）目标候选与重名校验快照同层——消除「与不可写 bucket 同名的新建在不同页面判定不一致」漂移（终审 N3）；picker 内过滤退化为幂等兜底保留。

## §3 C 类——错误占位手势让位

**现状**：RetryableAsyncImage 加载失败时占位层 `clickable(onRetry) + matchParentSize()` 吞掉 SelectableCell 的点击/长按——失败格无法打开/选中（Photos/AlbumDetail/Device 三网格同病，2c07417 起既有）。

**设计**：
- 占位层的重试 clickable 仅在**非多选模式**下挂载；多选模式下占位层不消费手势，点击/长按透传给 SelectableCell（可选中）。
- 非多选模式下保留整格点击重试的现有习惯（用户已习得），但**长按恒透传**（进多选不再被吞）。
- RetryableAsyncImage 增加 `gesturePassthrough: Boolean = false` 参数（或回调形态，实现细节由实施定），三网格调用点按选中态传入；非网格调用点（大图页海报等）零改动默认旧行为。
- 测试：失败格多选态可长按选中/点击切换选中；非多选态点击触发重试、长按进多选。

## §4 B 类——批量复制 worker（DeviceCopyWorker 三件套）

**范围**：仅手机域**多选批量**复制（DeviceAlbumDetailViewModel.copySelectedTo 的调用链）；大图页单张 copyTo 保持同步。

**设计**（镜像 DeviceExportWorker 形态，去掉 ensure 下载半程）：
- `DeviceCopyWorker(context, params, gateway 相关能力, notifier)`：inputData `KEY_MEDIA_IDS: LongArray` + `KEY_TARGET_PATH`；逐张 `mediaByIds` 还原 → `findCopy` 查重（命中跳过计成功，防重跑重复——与导出 worker 同款）→ `insertCopy(DeviceSource.Media, path)`。失败分流：源已删（查无此 media）→计失败继续；insert 侧 ENOSPC/DiskFull cause 链→`Result.retry()`；其余失败→计失败继续（本机操作无瞬时网络错，无 retryable 桶）。结束 outputData failedCount；failed>0 发汇总通知。
- `DeviceCopyManager`：唯一工作名 `device-copy`（本机操作无 serverId 维度），`APPEND_OR_REPLACE` 排队；**无 CONNECTED 约束**（纯本机 IO）；退避 EXPONENTIAL 10s。>500 张分块入队（复用 EXPORT_BATCH 常量，抽到共享位置）。
- 通知：复用 `device_export` channel 改名为通用「复制到手机相册」语义已成立（v0.8.0 文案本就如此）——进度「正在复制到手机相册 x/y」与汇总通知形态与导出一致；通知 id 独立常量防撞（枚举现有 id 体系后取值）。
- 入口改造：多选「复制到」选手机相册后 → `deviceCopyManager.enqueue(ids, path)` + toast「已开始复制到手机相册」+ 清选择（与导出侧文案/行为对齐）；VM 的 copySelectedTo 同步版保留给单张调用或删除（以实施时调用面为准）。
- 待落地收编：worker 成功 ≥1 张且目标为占位路径时清 prefs 记录（沿 copySelectedTo 现有语义迁入 worker）；DeviceAlbumsViewModel 兜底收编不变。
- AppWorkerFactory 分支 + AppGraph lazy。

## §5 D/E/G 类——防御与杂项明细

- **D1**：`DeviceExportManager.enqueue`（及新 DeviceCopyManager.enqueue）返回 Boolean；serverId null / 入队异常 → false；三个调用点 false 时 toast「复制启动失败」，不清选择。
- **D2**：`MediaStoreDeviceGateway.findCopy` 内 `resolver.query` 包 runCatching → 异常返回 null（放行 insert，等价查无副本）；导出 worker 侧无需改（null 即走 insert）。KDoc 注明 OEM 异常降级语义。
- **D3**：DeviceExportWorkerTest 成功用例补「findCopy 先于 insert」顺序断言（统一 call log 记录序列）。
- **E1**：移动授权 RESULT_OK 回调内，若 `selection.selected` 为空（进程重建丢失）→ 直接 return（不调 moveSelectedTo、不弹 snackbar）；pendingMovePath 清空。网格页与大图页两处同口径（大图页中继本就 plain remember，重建即 null 自然放弃，确认现状即可，缺口在网格页）。
- **G1 picker 闪旧快照**：CopyTargetPicker/DeviceAlbumPicker 打开时 deviceAlbums 先置空再异步加载（或加 loading 态），不显示上次快照。
- **G2 连点防抖**：三域共享的多选底栏动作项（SelectionBottomBar/DeviceSelectionBottomBar）与 picker 行加统一防抖（沉淀 `ui/common` 的 debounced click modifier，300ms 窗口）；photos 域既有入口顺带覆盖，不扩到全 app。
- **G3 Viewer move 空相册 auto-back**：桌面域 Viewer 相册上下文移动成功后若列表清空 → onBack()（对齐删除清空语义）；手机域 DeviceViewer 已有 emptied→onBack，确认覆盖移动路径。
- **G4 汇总通知加盐**：见 H7。
- **G5 settle 翻转**：见 H9。
- **G6 联调计划退出标准行**：补 §L（既有缺口，一行）。

## §6 F 类——测试补强清单（全量清欠）

来源 = progress.md 各任务 Minor 中的测试缺口，逐条补：

| 编号 | 用例 | 来源 |
|---|---|---|
| F1 | accessLevelOf sdk=33 单权限授予 → DENIED | T1(b) |
| F2 | BucketKey.decode("p")/decode("b") 空段；isWritableAlbumPath 无尾斜杠 | T2 |
| F3 | moveTo 计数 rows-affected 语义对账（0 行不计） | T3(c) |
| F4 | absorbedPendingNames 双算路径；删除确认框 | T5(a)(c) |
| F5 | FakeMediaPagingSource Pending 空页分支消费 | T6(c) |
| F6 | device 域 swap 桥渲染（AppNavTest device 分支）；分享 intent 组装（mime 单张/多张） | T7(d) |
| F7 | deviceViewerDateLabel/TimeLabel 直测（同/跨年） | T8(d) |
| F8 | moveToGallery 空集守护；移动到已删相册 404 边界；补偿自身失败；用例2 nudge 计数 | T9(a-c) |
| F9 | EXPORT_BATCH 分块入队（>500 拆批、保序、尾批余数） | T11(e) |
| F10 | 新增：DeviceCopyWorker 全套（成功/查重跳过/源删继续/ENOSPC retry/汇总通知） | B 类新代码 |
| F11 | 新增：C 类手势让位、D1 false 分支、E1 空选中放弃、G1/G2/G3 | 本轮新行为 |

不补（维持原判）：MediaStore 真交互 JVM 测试（Robolectric shadow 弱，真机兜）、MainActivity 权限桥（无先例）、捏合手势驱动（Robolectric 不可靠）。

## §7 验收

- 全量安卓测试 GREEN，基线 530 只增不减（F 类预计 +25 以上）。
- 桌面 `npm run test` 全绿（本轮桌面零改动）。
- A 类每项抽取前后 UI 测试零改动（行为锁定证明）。
- B 类真机冒烟：MuMu 批量复制 30 张中途离屏/杀进程，回来复制完成且无重复（findCopy 查重生效）。
- versionCode 10 / "0.8.1"；README §11 附「v0.8.1 加固」小节；本 spec 状态翻 ✅。

## §8 实施顺序建议

F（先锁行为）→ A（结构重构，测试保护下）→ C/D/E/G（小改动批）→ B（最大件，worker 三件套）→ 收尾（版本/文档/回归/真机冒烟）。
