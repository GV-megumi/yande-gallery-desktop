# 安卓测试套件 DataStore 协程饥饿 flake 根治设计

> 状态：待实施。背景见 `android/README.md` §8「2026-07-10 升级为阻塞级」：v0.6.0 收官日 7 轮全量无一全绿，
> 失败清一色 `UncompletedCoroutinesError: After waiting for 1m`，在 4 个 DataStore 回环类间轮转。

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

**预案（不实施，验证不达标才启用）**：`forkEvery` 分片（24/36 两档试），症状缓解不根治，每 fork 重付
Robolectric 初始化成本。

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
