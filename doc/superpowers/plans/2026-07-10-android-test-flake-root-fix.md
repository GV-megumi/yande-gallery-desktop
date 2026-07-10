# 安卓测试 flake 根治 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 本计划实际由主会话**内联执行**（诊断-验证紧耦合，不拆子代理）。

**Goal:** 用 Robolectric Application 替身根治测试套件 DataStore 协程饥饿 flake，并以「全量三连绿」协议验证。

**Architecture:** 单配置文件 `robolectric.properties` 把测试期 Application 从真实 `YandeGalleryApp`（每方法泄漏一整套 AppGraph/Room/IO 协程）换成裸 `android.app.Application`。不动任何生产/测试源码。

**Tech Stack:** Robolectric 全局配置（properties 文件承载 @Config 键）。

**Spec:** `doc/superpowers/specs/2026-07-10-android-test-flake-root-fix-design.md`

---

### Task 1: Application 替身落地

**Files:**
- Create: `android/app/src/test/resources/robolectric.properties`

- [ ] **Step 1: 写配置文件**

```properties
# Robolectric 全局配置（@Config 键的 properties 形态）。
# application 替身（2026-07-10 flake 根治，spec 见 doc/superpowers/specs/2026-07-10-android-test-flake-root-fix-design.md）：
# 默认会按 manifest 每个测试方法实例化真实 YandeGalleryApp——onCreate 无条件建 AppGraph，
# 启动永不结束的 IO 收集器 + 真实磁盘 Room 库，并被 ProcessLifecycleOwner 静态观察者钉死不可回收；
# 385 个方法逐个累积令测试 JVM 后段 IO 调度/GC 劣化，DataStore 回环用例（真实 IO 落盘 + runTest 60s）
# 轮转超时（UncompletedCoroutinesError）。换裸 Application 后泄漏源整体消失。
# 前提（已核死）：app/src/test 对 YandeGalleryApp 零引用，ApplicationProvider 全取 <Context> 泛型，
# WorkManager 默认初始化器已在 manifest 移除（按需初始化，替身下不启动）。
application=android.app.Application
```

- [ ] **Step 2: 单类快验（替身未破坏基本盘）**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.ui.photos.PhotosViewModelTest"
```
预期：BUILD SUCCESSFUL，XML `tests=10 failures=0 errors=0`。

### Task 2: 验证协议（spec §3，达标才算完成）

- [ ] **Step 1: 全量三连绿**

连续三次执行（每次核 XML，不看尾行）：

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest"
cd app/build/test-results/testDebugUnitTest && grep -h '<testsuite ' *.xml | sed 's/.*tests="\([0-9]*\)".*failures="\([0-9]*\)".*errors="\([0-9]*\)".*/\1 \2 \3/' | awk '{t+=$1;f+=$2;e+=$3} END {print "classes="NR" tests="t" failures="f" errors="e}'
```
预期：三次均 `classes=71 tests=385 failures=0 errors=0`；记录三次耗时与根治前（~2m36s 且必挂 1-3 例）对比。

- [ ] **Step 2: 三个惯犯类单跑各一次**

```bash
cd android && cmd //c "D:\\Android\\gw.bat :app:testDebugUnitTest --tests com.bluskysoftware.yandegallery.ui.settings.CacheViewModelTest --tests com.bluskysoftware.yandegallery.ui.photos.PhotosViewModelTest --tests com.bluskysoftware.yandegallery.M4DensityPrefsE2ETest"
```
预期：`4+10+2` 例全绿。

- [ ] **Step 3（仅不达标时）: 预案 forkEvery**

`android/app/build.gradle.kts` 的 `testOptions.unitTests.all { test -> ... }` 块内追加：

```kotlin
                test.setForkEvery(24)   // 预案：分片限制单 JVM 累积；24 不行再试 36
```
重跑 Step 1。三连绿后保留（并在 spec 状态行记录预案启用）；若两档仍不达标，revert 全部改动回到诊断。

### Task 3: 收尾

**Files:**
- Modify: `android/README.md`（§8 阻塞级记录改「已根治」）
- Modify: `doc/superpowers/specs/2026-07-10-android-test-flake-root-fix-design.md`（状态行回填）
- Modify: memory `android-realdevice-test-quirks.md`（flake 条目改已根治）

- [ ] **Step 1: README §8 升级记录段替换为根治结论**（根因一句话 + robolectric.properties 指路 + 三连绿数据）
- [ ] **Step 2: spec 状态行回填 ✅ + 实测数据**
- [ ] **Step 3: memory 更新**（对策从「重跑」改为「已根治；若复发先查 robolectric.properties 是否还在」）
- [ ] **Step 4: Commit**

```bash
git add android/app/src/test/resources/robolectric.properties android/README.md doc/superpowers/
git commit -m "fix(android): 根治测试套件 DataStore 协程饥饿——Robolectric Application 替身斩断每方法真实 AppGraph 泄漏，全量三连绿"
```

---

## 自审记录

1. **Spec 覆盖**：§2 方案→Task 1；§3 验证协议三条→Task 2 三步；§4 收尾三项→Task 3；预案→Task 2 Step 3（仅条件触发）。
2. **占位符**：无。
3. **类型一致性**：单文件配置，无类型面；命令与 v0.6.0 收官期实测命令逐字一致。
