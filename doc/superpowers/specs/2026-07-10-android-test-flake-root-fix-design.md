# 安卓测试套件 DataStore 协程饥饿 flake 根治设计

> 状态：✅ 已根治（2026-07-10）。全量 **五连真跑全绿**（协议要求三连；71 类/385 例/0 失败，每轮 ~30s
> vs 治前 2m36s+ 必挂 1-3 例），三惯犯类单跑复证绿。
> **根因修正**（实施中实证推翻原假设一半，见 §1.1）：原「泄漏累积饥饿」只是第一层（App 替身治之，
> 带来 5 倍提速）；flake 真身是 **DataStore data flow 的 lost-wakeup 竞态**——测试用谓词
> `first { 条件 }` 等「写后新值」，若收集者初读旧值后写完成的更新通知未达（写发生在其注册监听
> 前的窗口），该收集者永久挂起至 runTest 60s 超时。实证铁证：挂死用例内紧随其后的裸 `first()`
> 能读到目标值（值早已落盘）。机器时序决定初读快慢 → flake 表象；生产端长活 stateIn 收集
> 自愈无影响。修法见 §2.1（awaitValue 轮询等值）。
> **排除项修订**：原「不改测试源码」基于第一层假设，真身在测试等待模式自身，故按 §2.1 修改了
> 6 个测试文件的等待写法（等待语义不变，断言不变）。
> 排查中证伪并撤销的路径（记录防重蹈）：forkEvery 分片（24 类内即复现，非累积病）、java.io.tmpdir
> 迁移（文件系统/杀软无罪：同类兄弟用例毫秒级过、挂例精确 60.0s 单点死锁）、双调度器分裂
> （诊断测试实证 runTest 与 setMain 共享同一 scheduler）。
>
> 原文如下（√ 为仍成立部分）：背景见 `android/README.md` §8「2026-07-10 升级为阻塞级」：v0.6.0
> 收官日 7 轮全量无一全绿，失败清一色 `UncompletedCoroutinesError: After waiting for 1m`，
> 在 4 个 DataStore 回环类间轮转。

## 1.1 实施后确证的完整根因（覆盖 §1 原假设）

- **第一层（√ 原 §1，App 替身治）**：每测试方法实例化真实 YandeGalleryApp→AppGraph→Room 库且永不释放
  ——替身后全量从 2m36s 降至 30s，泄漏与开销属实；但它只是放大时序压力的噪声因子，不是 flake 真身。
- **第二层（真身）**：`runTest` 内对真实 IO 回环（DataStore 落盘/Room 发射）用单收集者谓词
  `flow.first { 条件 }` 或 turbine 等发射——DataStore data flow 存在 lost-wakeup：收集者初读旧值后，
  写完成通知若发生在其注册前则永不送达。定位手段：分段探针（写路径直写对照 + 5s 短超时 + 裸读现值），
  DIAG-A 谓词等待超时 / DIAG-B 裸读即得目标值，一击定案。

## 1. 根因（代码证据链）

1. Robolectric 对**每个测试方法**实例化 manifest 声明的真实 `YandeGalleryApp`，其 `onCreate()` 无条件
   `graph = AppGraph(this)`（`YandeGalleryApp.kt:23`）。
2. `AppGraph` 构造即在 `Dispatchers.IO` scope 启动永不结束的 `serverRepository.observeActive().collect{}`，
   连带 `db` lazy → 每方法建一个真实磁盘 Room 库（连接/失效追踪器/执行器）。App 创建的 graph 无人调
   `shutdownForTest()`，永不释放。
3. `onCreate` 向 `ProcessLifecycleOwner`（沙箱 classloader 内静态单例、跨测试类共享）注册持有 graph 的观察者
   ——泄漏对象被静态引用钉死，GC 收不走。
4. 385 个方法逐个累积 → 单测试 JVM 后段 IO 调度与 GC 劣化 → 正在跑的 DataStore 回环用例（真实
   `Dispatchers.IO` 落盘 + `runTest` 60s 上限）超时。完全解释全部症状：失败类轮转（谁跑在劣化窗口谁中招）、
   越跑越糟、单类隔离多次全绿、加大 test worker 堆无效。
5. 替身可行性：`app/src/test/` 对 `YandeGalleryApp` **零引用**，`ApplicationProvider` 全部取 `<Context>` 泛型；
   WorkManager 默认初始化器已在 manifest 移除（按需初始化，替身下不启动）；无既有 robolectric.properties。

## 2. 方案

**采用：Application 替身（根治）。** 新增 `android/app/src/test/resources/robolectric.properties`：

```properties
application=android.app.Application
```

全部 Robolectric 测试改用裸 Application，真实 graph 从源头不再创建。零生产代码、零测试代码改动。

### 2.1 追加修复（实施中确证真身后新增）：awaitValue 轮询等值

新增 `app/src/test/.../TestAwait.kt`：

```kotlin
suspend fun <T> awaitValue(read: suspend () -> T, until: (T) -> Boolean): T =
    withContext(Dispatchers.Default) {
        var last = read()
        repeat(600) {
            if (until(last)) return@withContext last
            delay(25)
            last = read()
        }
        last   // 超时返回末值交断言报红
    }
```

**每轮全新收集读现值**（新收集者首发射不依赖更新通知）→ lost-wakeup 无面可踩；跑在 Default 真实
调度器，跳出 runTest 虚拟时间。与仓内既有先例 `M4DensityPrefsE2ETest.awaitHeaderDisplays` 同构。
6 个测试文件 24 处等待点转写（PhotosViewModelTest/M4DensityPrefsE2ETest/CacheViewModelTest/
AlbumDetailViewModelTest/AlbumsViewModelTest/SearchViewModelTest），含 2 处 turbine 等发射改终态轮询。

**测试纪律（今后新测试必须遵守）**：runTest 内等「真实回环产生的值」一律 `awaitValue({ flow.first() })
{ 条件 }`，禁用谓词 `first { 条件 }` 与 turbine 等真实链路发射。

**预案（试过并撤销）**：`forkEvery` 分片——24 类分片内即复现，证伪「累积」模型，已还原。

**否决**：生产代码测试感知（App 内检测 Robolectric 跳过建 graph）——生产代码为测试让路，反模式。

## 3. 验证协议（达标才算完成）

1. 全量套件（`:app:testDebugUnitTest`）**连续 3 次全绿**，以 test-results XML 汇总为准（71 类 / 385 例 /
   0 失败 0 错误），并记录三次耗时与根治前对比。
2. 昨日轮转最凶的三类（CacheViewModelTest / PhotosViewModelTest / M4DensityPrefsE2ETest）各单类跑一次全绿。
3. 任一步不达标：先查是否有测试暗依赖真实 App（回归网即本协议），仍饥饿则启用 forkEvery 预案，两档仍不达标
   回到诊断。

## 4. 收尾

- `android/README.md` §8 阻塞级记录改写为「已根治」+ 根因一句话 + 本 spec 指路；memory 同步更新。
- 本 spec 回填状态行。
- 回滚：单文件 revert 即回。

## 5. 排除项

不动 maxHeapSize（历史已证无效）、不做测试并行化（maxParallelForks）、不改任何生产/测试源码、不清理
既有测试的 graph 构造惯例（各测试自建自清的 graph 不在泄漏链上）。
