# Bug11 — 图集卡片右键新增"用单独窗口打开"

## 背景

图集列表右键菜单之前仅有"编辑 / 删除"，缺少在独立子窗口中打开图集详情的入口。用户希望能够在子窗口浏览某个图集，且不影响主窗口当前的图集列表状态。

## 核心改动

1. **IPC 通道扩展（`src/main/window.ts`）**
   - `WINDOW_OPEN_SECONDARY_MENU` handler 新增第 4 个 `extra?: Record<string, string | number>` 参数，
     允许在 URL query 串中打入任意附加参数（如 `galleryId`）。

2. **preload 签名同步**
   - `src/preload/shared/createWindowApi.ts`：`openSecondaryMenu` 新增第 4 参数。
   - `src/preload/index.ts`：`window.openSecondaryMenu` 类型声明同步扩展。

3. **SubWindowApp 透传 galleryId（`src/renderer/SubWindowApp.tsx`）**
   - 从 `route.params.get('galleryId')` 解析数字 ID，透传给 `renderSecondaryMenuPage`。
   - gallery 分支下将 `galleryId` 作为 `initialGalleryId` 传给 `GalleryPage`，
     并设置 `disablePreferencesPersistence` 为 `galleryId != null`。

4. **GalleryPage 新增 2 个 Prop（`src/renderer/pages/GalleryPage.tsx`）**
   - `initialGalleryId?: number`：水合时优先按入参打开图集详情。
   - `disablePreferencesPersistence?: boolean`：
     - 保存 effect 早返回，跳过 250ms 防抖落盘。
     - "返回"按钮在此模式下改为 `window.close()`，不写回 `selectedGalleryId=null`。

5. **右键菜单入口**
   - Dropdown items 顶部加 `open-window` 项 + 分隔线，点击后调用
     `openSecondaryMenu('gallery', 'galleries', undefined, { galleryId: gallery.id })`。

## 与 Bug10 的集成

Bug10 让主窗口返回按钮同步落盘 `selectedGalleryId=null`。本次在该行为之前加守卫：
子窗口模式下"返回"直接关窗，不触达 `persistPreferences`，从而避免污染主窗口持久化状态。

## 反模式守卫

新增 2 条测试用于固化"子窗口模式下不回写 pagePreferences"约束：

- `Bug11 反模式守卫：子窗口模式下切换详情排序不应回写 pagePreferences（主窗口 selectedGalleryId 不被污染）`
- `Bug11 反模式守卫：子窗口模式下"返回"= 关窗，不应 persistPreferences 落盘`

先在临时关闭守卫的前提下验证这两条测试 FAIL（第一条实际打出 `selectedGalleryId: 1` 落盘），
再恢复守卫后两条均 PASS，用于回归防护。

## 验收

- TS 编译：`tsconfig.main.json` + `tsconfig.json` 均无本次引入的错误。
- 单测：`tests/renderer/SubWindowApp.test.ts` + `tests/renderer/pages/GalleryPage.test.tsx`
  共 42 条全部 PASS。
