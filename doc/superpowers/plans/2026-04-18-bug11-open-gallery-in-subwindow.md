# Bug11 — 图集卡片右键缺少 "用单独窗口打开"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 图集卡片右键菜单新增 "用单独窗口打开" 项，点击后弹独立子窗口直接进入该图集的详情视图；复用现有 `WINDOW_OPEN_SECONDARY_MENU` 通道扩展第四个 `extra` 参数，`GalleryPage` 接 `initialGalleryId` 并在子窗口模式下禁止写回持久化。

**Architecture:**
- IPC handler 扩展 `extra?: Record<string, string|number>`，打入 URL 查询串。
- `SubWindowApp` 从 `params` 取 `galleryId`，透传 `initialGalleryId` 给 `GalleryPage`。
- `GalleryPage` 新增 `initialGalleryId` / `disablePreferencesPersistence` 两个 prop：
  - 水合时优先按 `initialGalleryId` 打开详情；
  - 保存 effect 与 "返回" 按钮在 `disablePreferencesPersistence=true` 时跳过落盘。
- 右键菜单顶部加 "用单独窗口打开"。

**Tech Stack:** Electron IPC、React、TypeScript、vitest

---

## File Structure

- 修改：`src/main/window.ts:399-405`（handler 接 `extra`）
- 修改：`src/preload/shared/createWindowApi.ts:21-22`（增 4th 参数）
- 修改：`src/preload/index.ts:317`（类型声明）
- 修改：`src/renderer/SubWindowApp.tsx:244-268`（取 `galleryId` 并透传）
- 修改：`src/renderer/pages/GalleryPage.tsx`
  - 新增 `initialGalleryId` / `disablePreferencesPersistence` prop
  - 水合分支 L660-L687 优先按入参
  - 保存 effect L713-L776 加 prop 守卫
  - 右键菜单 L1242-L1253 加入口

---

### Task 1: IPC handler 接 `extra` 参数

**Files:**
- Modify: `src/main/window.ts:399-405`

- [ ] **Step 1: 替换 handler 实现**

把 `src/main/window.ts:399-405` 替换为：

```ts
  // 打开二级菜单页面子窗口
  ipcMain.handle(IPC_CHANNELS.WINDOW_OPEN_SECONDARY_MENU, async (
    _event,
    section: string,
    key: string,
    tab?: string,
    extra?: Record<string, string | number>,
  ) => {
    const params = new URLSearchParams({ section, key });
    if (tab) params.set('tab', tab);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (v != null) params.set(k, String(v));
      }
    }
    createSubWindow(`secondary-menu?${params.toString()}`);
    return { success: true };
  });
```

- [ ] **Step 2: TS 编译**

Run: `npx tsc -p tsconfig.main.json --noEmit`

Expected: 无错误。

---

### Task 2: preload 暴露 4th 参数

**Files:**
- Modify: `src/preload/shared/createWindowApi.ts:21-22`
- Modify: `src/preload/index.ts:317`

- [ ] **Step 1: 改 createWindowApi**

把 `src/preload/shared/createWindowApi.ts:21-22` 替换为：

```ts
    openSecondaryMenu: (
      section: string,
      key: string,
      tab?: string,
      extra?: Record<string, string | number>,
    ) =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_SECONDARY_MENU, section, key, tab, extra),
```

- [ ] **Step 2: 改类型声明**

把 `src/preload/index.ts:317` 的 `openSecondaryMenu` 类型改成：

```ts
        openSecondaryMenu: (
          section: string,
          key: string,
          tab?: string,
          extra?: Record<string, string | number>,
        ) => Promise<{ success: boolean }>;
```

- [ ] **Step 3: TS 编译**

Run: `npx tsc -p tsconfig.main.json --noEmit`

Expected: 无错误。

---

### Task 3: SubWindowApp 透传 galleryId

**Files:**
- Modify: `src/renderer/SubWindowApp.tsx:123-154`（`renderSecondaryMenuPage` 签名）
- Modify: `src/renderer/SubWindowApp.tsx:244-268`（secondary-menu 路由分支）

- [ ] **Step 1: 扩展 renderSecondaryMenuPage 签名**

在 `src/renderer/SubWindowApp.tsx:123` 函数签名加第四个可选参数：

```ts
const renderSecondaryMenuPage = (
  section: string,
  key: string,
  tab?: string,
  extra?: { galleryId?: number },
): React.ReactNode => {
  // Gallery 区域
  if (section === 'gallery') {
    if (key === 'settings') return <SettingsPage />;
    if (key === 'invalid-images') return <InvalidImagesPage />;
    return (
      <GalleryPage
        subTab={key as 'recent' | 'all' | 'galleries'}
        initialGalleryId={extra?.galleryId}
        disablePreferencesPersistence={extra?.galleryId != null}
      />
    );
  }
  // ... 其它 section 保持不变
```

- [ ] **Step 2: 在 secondary-menu 分支取 galleryId 并透传**

把 `src/renderer/SubWindowApp.tsx:244-268` 的 `case 'secondary-menu'` 分支里调用 `renderSecondaryMenuPage(section, key, tab)` 的那一行改成：

```tsx
            {renderSecondaryMenuPage(section, key, tab, {
              galleryId: (() => {
                const raw = route.params.get('galleryId');
                if (!raw) return undefined;
                const n = Number(raw);
                return Number.isFinite(n) ? n : undefined;
              })(),
            })}
```

（若觉得可读性不佳，抽成 `const galleryIdParam = ...;` 常量再传也行。）

- [ ] **Step 3: TS 编译**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: 无错误（`GalleryPage` 的新 prop 要在 Task 4 补齐才能通过）。

---

### Task 4: GalleryPage 接 `initialGalleryId` / `disablePreferencesPersistence`

**Files:**
- Modify: `src/renderer/pages/GalleryPage.tsx:43-48`（Props 类型）
- Modify: `src/renderer/pages/GalleryPage.tsx:660-687`（水合）
- Modify: `src/renderer/pages/GalleryPage.tsx:713-776`（保存 effect）
- Modify: `src/renderer/pages/GalleryPage.tsx:1078-1086`（返回按钮，与 bug10 的改动合并；若 bug10 已合并，本步骤在其基础上加守卫）

- [ ] **Step 1: Props 类型**

把 `src/renderer/pages/GalleryPage.tsx:43-48` 改为：

```ts
interface GalleryPageProps {
  subTab?: 'recent' | 'all' | 'galleries';
  /** 子窗口直接进入指定图集详情时使用 */
  initialGalleryId?: number;
  /** 子窗口模式下禁用 pagePreferences 回写，避免污染主窗口状态 */
  disablePreferencesPersistence?: boolean;
}

export const GalleryPage: React.FC<GalleryPageProps> = ({
  subTab = 'recent',
  initialGalleryId,
  disablePreferencesPersistence = false,
}) => {
```

- [ ] **Step 2: 水合分支优先 initialGalleryId**

找到 `src/renderer/pages/GalleryPage.tsx:660-687` `else if (subTab === 'galleries')` 的水合块，把 `if (galleriesPreferences?.selectedGalleryId) { ... }` 改为：

```ts
      const targetGalleryId = initialGalleryId ?? galleriesPreferences?.selectedGalleryId;
      if (targetGalleryId) {
        const galleryResult = await window.electronAPI.gallery.getGallery(targetGalleryId);
        if (galleryResult.success && galleryResult.data
            && !cancelled
            && preferencesHydrationRunIdRef.current === runId) {
          setSelectedGallery(galleryResult.data);
          loadGalleryImages(targetGalleryId);
        }
      }
```

- [ ] **Step 3: 保存 effect 守卫**

定位 `src/renderer/pages/GalleryPage.tsx:713-776` 的保存 effect（`useEffect` 里 `persistPreferences(nextPreferences)` 那块）。在 `const timer = window.setTimeout(...)` 的上一行加早返回：

```ts
      if (disablePreferencesPersistence) {
        return;
      }
```

此外 `persistPreferences` 函数本身（L535-L541）保留不变；它仍可能被 "返回" 按钮等外部显式调用——但在子窗口模式下 "返回" 按钮的语义不同（见 Step 4）。

- [ ] **Step 4: 子窗口模式下 "返回" 按钮改为关闭窗口**

把 `src/renderer/pages/GalleryPage.tsx:1078-1086`（若 bug10 已合并则在其修改基础上）的 Button 内 onClick 加分支：

```tsx
                    <Button onClick={async () => {
                      if (disablePreferencesPersistence) {
                        // 子窗口模式：返回 = 关闭子窗口
                        window.close();
                        return;
                      }
                      console.log('[GalleryPage] 返回图集列表');
                      galleryDetailRequestRunIdRef.current += 1;
                      setSelectedGallery(null);
                      setGalleryImages([]);
                      setDetailSourceFavoriteTags([]);
                      try {
                        await persistPreferences({
                          galleries: {
                            gallerySearchQuery,
                            gallerySortKey,
                            gallerySortOrder,
                            gallerySort,
                            selectedGalleryId: null,
                          },
                        });
                      } catch (err) {
                        console.warn('[GalleryPage] 清除 selectedGalleryId 失败:', err);
                      }
                    }}>
                      返回
                    </Button>
```

- [ ] **Step 5: TS 编译**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: 无错误。

---

### Task 5: 右键菜单加 "用单独窗口打开"

**Files:**
- Modify: `src/renderer/pages/GalleryPage.tsx:1242-1253`

- [ ] **Step 1: 扩展 Dropdown items**

找到 `src/renderer/pages/GalleryPage.tsx:1242-1253` 的 `<Dropdown>`，把 items / onClick 改为：

```tsx
                  <Dropdown
                    trigger={['contextMenu']}
                    menu={{
                      items: [
                        { key: 'open-window', label: '用单独窗口打开', icon: <ExportOutlined /> },
                        { type: 'divider' as const },
                        { key: 'edit', label: '编辑', icon: <EditOutlined /> },
                        { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'open-window') {
                          window.electronAPI?.window.openSecondaryMenu(
                            'gallery',
                            'galleries',
                            undefined,
                            { galleryId: gallery.id },
                          );
                          return;
                        }
                        if (key === 'edit') handleOpenEditGallery(gallery);
                        if (key === 'delete') handleDeleteGallery(gallery);
                      },
                    }}
                  >
```

（`ExportOutlined` 从 `@ant-design/icons` 引入；若已 import 无需再加。）

---

### Task 6: 回归、人工验证、归档提交

**Files:** —

- [ ] **Step 1: 测试**

Run: `npx vitest run tests/renderer/SubWindowApp.test.ts tests/renderer/pages/GalleryPage.test.tsx --config vitest.config.ts`

Expected: 全部 PASS。若 SubWindowApp 的测试断言 "只用 3 个参数调 renderSecondaryMenuPage"，更新测试。

- [ ] **Step 2: TS 编译**

Run: `npx tsc -p tsconfig.main.json --noEmit && npx tsc --noEmit -p tsconfig.json`

Expected: 无错误。

- [ ] **Step 3: 人工验证**

`npm run dev` →
- 图库 → 图集 → 随便挑一个卡片右键 → 选 "用单独窗口打开"：
  - 子窗口直接落在该图集详情页
  - 子窗口内点 "返回" → 子窗口关闭（不回到图集列表）
  - 主窗口的 "图集" 列表没有自动打开这个图集（`selectedGalleryId` 未被污染）
- 子窗口内随便切换排序、搜索等，关闭子窗口后回主窗口，主窗口状态与打开子窗口前一致。

- [ ] **Step 4: 归档 + 提交**

```bash
git mv bug11.md doc/done/bug11-open-gallery-in-subwindow.md
git add src/main/window.ts \
        src/preload/shared/createWindowApi.ts \
        src/preload/index.ts \
        src/renderer/SubWindowApp.tsx \
        src/renderer/pages/GalleryPage.tsx \
        doc/done/bug11-open-gallery-in-subwindow.md
git commit -m "feat(bug11): 图集卡片右键新增"用单独窗口打开"

$(cat <<'EOF'
- WINDOW_OPEN_SECONDARY_MENU handler 增加第 4 个 extra 参数，
  允许把 galleryId 等 query 串打入子窗口 URL
- preload openSecondaryMenu 同步扩展签名
- SubWindowApp 从 route params 取 galleryId，透传给 GalleryPage
  （initialGalleryId + disablePreferencesPersistence）
- GalleryPage 新增两个 prop：
  - initialGalleryId：水合时优先按入参打开图集详情
  - disablePreferencesPersistence：跳过 pagePreferences 回写，
    子窗口浏览不污染主窗口 selectedGalleryId；返回按钮在此模式下
    改为 window.close()
- 右键菜单加"用单独窗口打开"项
EOF
)"
```

Expected: commit 成功。

---

## Self-Review Checklist

- [x] Spec §批 B B4 全部覆盖：IPC extra 参数、preload、SubWindowApp 透传、GalleryPage 两 prop、右键菜单入口。
- [x] 子窗口不回写 `selectedGalleryId`（与 bug10 的主窗口修复互为镜像，不互相破坏）。
- [x] 返回按钮在子窗口模式下语义清晰（关窗），在主窗口模式下保留 bug10 的落盘行为（若 bug10 先合并）。
- [x] 无占位符。
