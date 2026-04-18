# Bug1 — 一级菜单切换未恢复 pin 缓存 + 基础页也要常驻缓存（合并修）

## 背景

Bug1 原 bug：路径 B（一级菜单切换回某 section）进入固定标签页面时未命中缓存。
追加需求：非固定项的"上次二级页面"也应常驻缓存，三个 section 各自的"当前页"
在一级菜单之间切换时持续挂载、`display:none` 切换而非卸载。

### 原 bug 触发路径

1. 进入菜单 2 的 `2-2`（pin 项），等待缓存形成。
2. 切到菜单 1 → 再切回菜单 2，自动恢复到 `2-2`。
3. `2-2` 重新加载（路径 B 未命中缓存）。

对照：路径 A（直接点底部固定标签 `2-2`）命中缓存正常。

### 根因

一级菜单 `onSelect` 只做 `setActivePinnedId(null)` 一刀切，从不检查目标 section
的当前 subKey 是否命中 `pinnedItems`。于是缓存层依然存在（`mountedPinnedIds`
未清），但 `activePinnedId=null` 让基础层接管，基础层外层 div 的 `key` 带
`selectedKey`，一级菜单变动立即触发 DOM 卸载重挂。

## 核心改动

### 1. 状态统一 `mountedPinnedIds` → `mountedPageIds`

把固定项与基础页的挂载集合合并成单一 `Set<string>`（`${section}:${subKey}`），
不再维护两套并行机制。

### 2. 引入 `renderPageForId(section, key, isActive)` 工厂

替代原 `basePage` useMemo 内部的 switch + 原 `renderPageForPin` 两处重复。
由此允许多份不同 `(section, subKey)` 的页面实例在 DOM 中并存，
每个都能独立 mount 一次、后续通过 `display:none` 切换显隐。

### 3. 二级菜单 `onSelect` 维护 `mountedPageIds`

抽出 `onSubKeyChanged(section, oldKey, newKey)` helper：新 id 入集合；
旧 id 若非固定项，出集合（避免无限增长）。

### 4. 一级菜单 `onSelect` 恢复 pin

目标 section 的当前 subKey 对应 id 入集合；若命中 pin 则 `handlePinnedClick`
恢复 `activePinnedId`，否则 `activePinnedId` 置 null 走基础层。

### 5. 渲染层合并成单一 `.map(mountedPageIds)` 叠加

删掉原来的"唯一 basePage 容器 + pinnedItems 遍历"两套渲染。统一
按 id 遍历，embed 页（gdrive/gphotos/gemini）独立走 `position:absolute`
覆盖层保留 webview 独立定位，其它页用滚动容器包装。导航栈非空时只覆盖
当前活跃基础页，不影响其他 section 缓存。

外层 div 的 `key` 改为 `page-${pinId}`，不再依赖 `selectedKey`，
避免一级菜单切换整体卸载。

### 6. 首次进入 section 自动入集合

新增 effect：`selectedKey / selectedSubKey / selectedBooruSubKey / selectedGoogleSubKey`
变动时，确保当前 `${selectedKey}:${currentSubKey}` 进入 `mountedPageIds`，
让初始页面也进入缓存层。

## 反模式守卫

新增 `tests/renderer/App.mountedPageIds.test.tsx`，4 条测试：

1. **反模式守卫**：一级菜单切回 booru 时，若当前 subKey 是 pin 应恢复 pin 缓存。
2. 三个 section 各自的当前页都保留挂载（非 pin 也常驻）。
3. 同 section 切换 subKey 后，旧 subKey 若非 pin 应从 DOM 卸载。
4. 同 section 切走到非 pin subKey 时，pin 项应保留缓存（display:none）。

先在旧代码（git stash）上跑，第 1/2/4 条 FAIL（证明反模式被捕获）；
恢复修复后 4 条全部 PASS。

并同步修正 `tests/renderer/App.navigation.test.tsx` 里"切到 booru 时
gallery-page 不应在 DOM 中"的一条断言，改为"gallery 容器 display:none"，
符合追加需求（非 pin 也常驻缓存）。

## 影响与收益

- 一级菜单之间切换完全不触发重渲染/重加载；
- 固定项在路径 A / 路径 B 两条路径下行为一致，都走同一份缓存实例；
- DOM 节点数会随会话中访问过的 `(section, subKey)` 对数线性增长，
  但受限于 4（gallery 子菜单）+ 11（booru 子菜单）+ 3（google 子菜单），
  上限 18 页。组件自身有 `suspended` 降级渲染，内存压力可控。

## 验收

- TS 编译：`tsconfig.json` 下 App.tsx 相关无新增错误（其他预存在报错
  与本次修复无关）。
- 单测：
  - `tests/renderer/App.navigation.test.tsx` 10 条 PASS；
  - `tests/renderer/App.mountedPageIds.test.tsx` 4 条新测 PASS；
  - `tests/renderer` 全量 713 条 PASS。
- 人工验证：skipped（headless）。
