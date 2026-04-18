# Bug10 — 图集详情"返回"后切换二级菜单再回来仍停留在旧图集详情

## 现象

打开任一图集详情 → 点击 "返回" 按钮（回到图集列表）→ 立刻点击二级菜单"全部图片"→ 再点回"图集"时，会再次自动打开先前的那个图集详情页；重启应用后现象仍存在（证明磁盘上的 `selectedGalleryId` 未被清空）。

## 根因

1. 原 `GalleryPage` 返回按钮 `onClick` 只清内存状态（`setSelectedGallery(null)`），磁盘持久化依赖外层 `useEffect` 中 250ms 防抖的 `persistPreferences`。
2. 用户返回后立刻切换二级菜单，组件状态发生变化，防抖的 `setTimeout` 被 cleanup 函数 `clearTimeout`，落盘被取消，磁盘上旧的 `selectedGalleryId` 残留。
3. 下次再进入"图集"时，hydrate 分支读到旧 `selectedGalleryId`，自动 `getGallery` + 重开详情视图。
4. `rebuildPagePreferences` 合并语义上没有"显式清空"通道：`null` 和 `undefined` 都被 `?? current` fallback 回旧值，即使前端补救传 null 也无效。

## 修复

1. `src/main/services/config.ts`：
   - `GalleryGalleriesPagePreference.selectedGalleryId` 类型放宽为 `number | null`，并注明语义：`null`=显式清空、`undefined`=保留旧值、`number`=覆盖。
   - `rebuildPagePreferences` 对 `selectedGalleryId` 改三值合并：`=== null` 走 `undefined`（删字段），其它仍走 `?? current`。
2. `src/renderer/pages/GalleryPage.tsx`：返回按钮 `onClick` 改为 `async`，`await persistPreferences({ galleries: { ..., selectedGalleryId: null } })` 同步落盘，绕过 250ms 防抖；其余本地状态清理保持不变。
3. 新增测试 `tests/main/services/config.pagePreferences.test.ts`（3 条）覆盖三值合并语义；`tests/renderer/pages/GalleryPage.test.tsx` 追加 Bug10 回归用例断言返回按钮点击后 `saveGalleryPagePreferences` 被调用且 `selectedGalleryId === null`。

## 反模式守卫

第一条 "null = 显式删除" 测试在旧 `?? current` 合并逻辑下会 FAIL（`expected 42 to be undefined`），修复后 PASS；防止后续被意外回退。
