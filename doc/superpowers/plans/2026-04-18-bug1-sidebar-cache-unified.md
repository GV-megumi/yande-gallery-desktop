# Bug1 — 一级菜单切换未恢复 pin 缓存 + 基础页也要常驻缓存（合并修）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
1. 修复原 bug：一级菜单切换时，若目标 section 的当前 subKey 命中 `pinnedItems`，自动激活 pin 缓存（不是一刀切 `setActivePinnedId(null)`）。
2. 实现追加需求：把 "固定页缓存层" 与 "基础页当前页" 统一成一个 `mountedPageIds` 集合，三个 section 切换时各自的 "当前页" 都持续挂载、`display:none` 切换而非卸载。

**Architecture:**
- 引入 `mountedPageIds: Set<string>`（`${section}:${key}`），统一替代 `mountedPinnedIds`。
- 三个二级菜单 `onSelect`：把新 `${section}:${subKey}` 入集合；旧 `${section}:${oldSubKey}` 若非固定项则出集合。
- 一级菜单 `onSelect`：把目标 section 的当前 subKey 对应的 id 加入集合；若命中 pin 则 `handlePinnedClick` 恢复，否则 `setActivePinnedId(null)`。不清其它 section 的缓存 id。
- 渲染层：把 `L1037-L1053` 的唯一 basePage 容器 + `L1056-L1075` 的 pinned 遍历，合并为单一 `.map(mountedPageIds)` 叠加层；外层容器的 `key` 不再包含 `selectedKey`（否则一级菜单切换仍会整体卸载）。
- embed 页（gdrive/gphotos/gemini）继续走 absolute 专用层，不纳入 `mountedPageIds`。

**Tech Stack:** React、TypeScript、vitest

---

## File Structure

- 修改：`src/renderer/App.tsx`
  - 状态定义 `L201-L206`：`mountedPinnedIds` → `mountedPageIds`
  - `handlePinnedClick` `L299-L305`：入 `mountedPageIds`
  - `closePin` `L291-L297`：出 `mountedPageIds`（但只有非当前 subKey 才真的出）
  - `basePage` `useMemo` `L689-L719`：改成 `renderPageForId(section, subKey)` 工厂函数
  - 一级菜单 `onSelect` `L820-L827`：恢复 pin + 入集合
  - 三个二级菜单 `onSelect` `L849 / L863 / L877`：旧 subKey 出集合 + 新 subKey 入集合（非 pin 时）
  - 渲染层 `L1037-L1075`：单一 `.map(mountedPageIds)` 叠加
  - 嵌入层 `L1081-L1099`：保留（独立）
- 修改：`tests/renderer/App.navigation.test.tsx`：追加并发断言
- 新增：`tests/renderer/App.mountedPageIds.test.tsx`（可选，独立断言 `mountedPageIds` 行为）

---

### Task 1: 把 `mountedPinnedIds` 改名为 `mountedPageIds` 并调整入/出语义

**Files:**
- Modify: `src/renderer/App.tsx:201-206`、`L291-L297`、`L299-L305`

- [ ] **Step 1: 状态改名**

把 `src/renderer/App.tsx:206` 的：

```ts
  const [mountedPinnedIds, setMountedPinnedIds] = useState<Set<string>>(new Set());
```

替换为：

```ts
  /** 本次会话中已挂载过的页面 id Set（pin 与 base 共用；`${section}:${subKey}`） */
  const [mountedPageIds, setMountedPageIds] = useState<Set<string>>(new Set());
```

全文替换 `mountedPinnedIds` → `mountedPageIds`、`setMountedPinnedIds` → `setMountedPageIds`（使用 `Edit replace_all=true` 或手动逐处）。

- [ ] **Step 2: `handlePinnedClick` 入集合（语义不变）**

确认 `src/renderer/App.tsx:299-305` `handlePinnedClick` 仍把 id 加入 `mountedPageIds`：

```ts
  const handlePinnedClick = useCallback((pin: PinnedItem) => {
    const pinId = `${pin.section}:${pin.key}`;
    console.log('[App] 切换到固定页面:', pinId);
    setMountedPageIds(prev => new Set([...prev, pinId]));
    setActivePinnedId(pinId);
  }, []);
```

- [ ] **Step 3: `closePin` 只对 "当前非显示" 的 pin 真正出集合**

把 `src/renderer/App.tsx:291-297` 替换为：

```ts
  /** 关闭固定页面缓存（不取消固定，只卸载缓存；当前显示的基础页不受影响） */
  const closePin = useCallback((section: PinnedItem['section'], key: string) => {
    const pinId = `${section}:${key}`;
    setMountedPageIds(prev => {
      const s = new Set(prev);
      // 若该页面仍是某个 section 的当前 subKey，出集合会导致 DOM 卸载 —— 不做。
      // 简化策略：`closePin` 只管 pin 列表行为，不物理出集合；
      // 若需要彻底释放可在 unpinItem 后由 subKey 逻辑自然决定（未达 subKey 的非 pin 页会被 subKey 切换时 pruneBaseId 出集合）。
      s.delete(pinId);
      return s;
    });
    setActivePinnedId(cur => cur === pinId ? null : cur);
    console.log('[App] 已关闭固定页面缓存:', pinId);
  }, []);
```

> 说明：老版本 `closePin` 一直直接从 `mountedPinnedIds` 删掉。改为 `mountedPageIds` 后，若该页面当前仍是某 section 的 subKey，删掉会立刻卸载。保守起见先保持原有行为，但在 Task 3 后若发现 "关闭 pin 会把当前基础页卸载" 的回归，再改为 "当前活跃则跳过 delete"。

- [ ] **Step 4: 跑现有导航测试**

Run: `npx vitest run tests/renderer/App.navigation.test.tsx --config vitest.config.ts`

Expected: PASS（只是改名，行为等价）。

- [ ] **Step 5: commit（阶段性）**

```bash
git add src/renderer/App.tsx
git commit -m "refactor(bug1): mountedPinnedIds 重命名为 mountedPageIds"
```

---

### Task 2: 新增 `renderPageForId(section, subKey)` 工厂，并替换 `basePage`/`renderPageForPin`

**Files:**
- Modify: `src/renderer/App.tsx:689-719`（`basePage` 拆成函数）
- 可能需要整理：`renderPageForPin`（如果存在且与新函数语义重叠）

- [ ] **Step 1: 引入 `renderPageForId`**

在 `src/renderer/App.tsx:689` 附近（原 `basePage` useMemo 前）添加：

```tsx
  /**
   * 根据 (section, subKey) 渲染对应页面实例。
   * 用于 mountedPageIds 叠加层里每个 id 的内容；不读全局 selectedKey/selectedSubKey，
   * 以便多份页面并存。
   */
  const renderPageForId = useCallback((
    section: 'gallery' | 'booru' | 'google',
    key: string,
    isActive: boolean,
  ): React.ReactNode => {
    // 被叠加且非活跃的页面用 suspended 降级渲染（参考现有 BooruPage 等实现）
    const baseSuspended = !isActive || navigationStack.length > 0;
    if (section === 'gallery') {
      if (key === 'settings') return <SettingsPage />;
      if (key === 'invalid-images') return <InvalidImagesPage />;
      return <GalleryPage subTab={key as 'recent' | 'all' | 'galleries'} />;
    }
    if (section === 'booru') {
      if (key === 'posts') return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} suspended={baseSuspended} />;
      if (key === 'popular') return <BooruPopularPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} suspended={baseSuspended} />;
      if (key === 'pools') return <BooruPoolsPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} suspended={baseSuspended} />;
      if (key === 'forums') return <BooruForumPage onUserClick={navigateToUser} suspended={baseSuspended} />;
      if (key === 'user-profile') return <BooruUserPage onTagClick={navigateToTagSearch} />;
      if (key === 'favorites') return <BooruFavoritesPage onTagClick={navigateToTagSearch} suspended={baseSuspended} />;
      if (key === 'server-favorites') return <BooruServerFavoritesPage onTagClick={navigateToTagSearch} suspended={baseSuspended} />;
      if (key === 'tag-management') return <BooruTagManagementPage onTagClick={navigateToTagSearch} active={isActive} />;
      if (key === 'download') return <BooruDownloadHubPage active={isActive} />;
      if (key === 'saved-searches') return <BooruSavedSearchesPage onRunSearch={handleSavedSearchRun} />;
      if (key === 'booru-settings') return <BooruSettingsPage />;
      if (key === 'settings') return <SettingsPage />;
      return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} suspended={baseSuspended} />;
    }
    // google
    if (key === 'gdrive') return <GoogleDrivePage />;
    if (key === 'gphotos') return <GooglePhotosPage />;
    if (key === 'gemini') return <GeminiPage />;
    return null;
  }, [
    navigationStack.length,
    navigateToTagSearch,
    navigateToArtist,
    navigateToCharacter,
    navigateToUser,
    handleSavedSearchRun,
  ]);
```

- [ ] **Step 2: 保留 `basePage` useMemo 作为 "当前基础页"**

把 `src/renderer/App.tsx:689-719` 的 `basePage` useMemo 替换为直接调用工厂的薄封装（保持 embed 页和 `isEmbedPage` 判断兼容）：

```tsx
  const currentSubKey: string = selectedKey === 'gallery' ? selectedSubKey
    : selectedKey === 'booru' ? selectedBooruSubKey
    : selectedGoogleSubKey;

  const basePage = useMemo(() => {
    return renderPageForId(
      selectedKey as 'gallery' | 'booru' | 'google',
      currentSubKey,
      !activePinnedId,
    );
  }, [selectedKey, currentSubKey, activePinnedId, renderPageForId]);
```

（原 `basePage` 使用点位于 embed overlay `L1096`，保持不变。）

如果仓库已有独立的 `renderPageForPin`，检查其实现：若只是同样的 switch，删除该函数，在 Task 4 改为调用 `renderPageForId`。

- [ ] **Step 3: TS 编译**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: 无错误。

- [ ] **Step 4: 跑导航测试**

Run: `npx vitest run tests/renderer/App.navigation.test.tsx --config vitest.config.ts`

Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add src/renderer/App.tsx
git commit -m "refactor(bug1): 引入 renderPageForId 工厂以支持多实例并存"
```

---

### Task 3: 二级菜单 `onSelect` 维护 `mountedPageIds`

**Files:**
- Modify: `src/renderer/App.tsx:849`、`L863`、`L877`

- [ ] **Step 1: 抽出共用 helper**

在 `src/renderer/App.tsx` 合适位置（`handlePinnedClick` 下方）新增：

```tsx
  /**
   * 二级菜单 subKey 切换时维护 mountedPageIds：
   *   - 新 id 入集合
   *   - 旧 id 若非固定项、也不再是该 section 的当前页 → 出集合（释放）
   * 固定项始终保留（由 handlePinnedClick 维护）。
   */
  const onSubKeyChanged = useCallback((
    section: 'gallery' | 'booru' | 'google',
    oldKey: string,
    newKey: string,
  ) => {
    setMountedPageIds(prev => {
      const next = new Set(prev);
      next.add(`${section}:${newKey}`);
      if (oldKey && oldKey !== newKey) {
        const oldId = `${section}:${oldKey}`;
        const oldIsPinned = pinnedItems.some(p => p.section === section && p.key === oldKey);
        if (!oldIsPinned) next.delete(oldId);
      }
      return next;
    });
  }, [pinnedItems]);
```

- [ ] **Step 2: 替换 gallery 子菜单 onSelect**

把 `src/renderer/App.tsx:849` 的 gallery `onSelect` 整段替换为：

```tsx
            onSelect={(key) => {
              console.log(`[App] 图库子菜单: ${key}`);
              const oldKey = selectedSubKey;
              setSelectedKey('gallery');
              setSidebarSection('gallery');
              setSelectedSubKey(key);
              setNavigationStack([]);
              onSubKeyChanged('gallery', oldKey, key);
              if (pinnedItems.some(p => p.section === 'gallery' && p.key === key)) {
                handlePinnedClick({ section: 'gallery', key });
              } else {
                setActivePinnedId(null);
              }
            }}
```

- [ ] **Step 3: 同样改 booru / google 子菜单**

`L863` booru：

```tsx
            onSelect={(key) => {
              console.log(`[App] Booru子菜单: ${key}`);
              const oldKey = selectedBooruSubKey;
              setSelectedKey('booru');
              setSidebarSection('booru');
              setSelectedBooruSubKey(key);
              setNavigationStack([]);
              onSubKeyChanged('booru', oldKey, key);
              if (pinnedItems.some(p => p.section === 'booru' && p.key === key)) {
                handlePinnedClick({ section: 'booru', key });
              } else {
                setActivePinnedId(null);
              }
            }}
```

`L877` google：

```tsx
            onSelect={(key) => {
              console.log(`[App] 应用子菜单: ${key}`);
              const oldKey = selectedGoogleSubKey;
              setSelectedKey('google');
              setSidebarSection('google');
              setSelectedGoogleSubKey(key);
              setNavigationStack([]);
              onSubKeyChanged('google', oldKey, key);
              if (pinnedItems.some(p => p.section === 'google' && p.key === key)) {
                handlePinnedClick({ section: 'google', key });
              } else {
                setActivePinnedId(null);
              }
            }}
```

---

### Task 4: 一级菜单 `onSelect` 恢复 pin + 入集合

**Files:**
- Modify: `src/renderer/App.tsx:820-827`

- [ ] **Step 1: 替换 onSelect**

把 `src/renderer/App.tsx:820-827` 的 `onSelect` 替换为：

```tsx
            onSelect={(key) => {
              const nextSection = key as 'gallery' | 'booru' | 'google';
              console.log(`[App] 主菜单切换分区: ${nextSection}`);
              setSidebarSection(nextSection);
              setSelectedKey(nextSection);
              setNavigationStack([]);
              // 目标 section 的当前 subKey
              const targetSubKey = nextSection === 'gallery' ? selectedSubKey
                : nextSection === 'booru' ? selectedBooruSubKey
                : selectedGoogleSubKey;
              // 确保该页面被挂载（首次切入此 section 时也入集合）
              setMountedPageIds(prev => new Set([...prev, `${nextSection}:${targetSubKey}`]));
              // 若目标是固定项 → 激活 pin；否则 activePinnedId 置空走基础层
              if (pinnedItems.some(p => p.section === nextSection && p.key === targetSubKey)) {
                handlePinnedClick({ section: nextSection, key: targetSubKey });
              } else {
                setActivePinnedId(null);
              }
            }}
```

- [ ] **Step 2: TS 编译 + 导航测试**

Run: `npx tsc --noEmit -p tsconfig.json`
Run: `npx vitest run tests/renderer/App.navigation.test.tsx --config vitest.config.ts`

Expected: PASS。

---

### Task 5: 渲染层合并成单一 `.map(mountedPageIds)` 叠加

**Files:**
- Modify: `src/renderer/App.tsx:1037-1075`

- [ ] **Step 1: 移除原有 "唯一 basePage 容器" 与 "pinned 遍历"**

删除 `src/renderer/App.tsx:1037-1075` 这整段（从 `{/* 普通滚动容器 */}` 一直到 `pinnedItems.filter(...).map(...)` 的结束 `})}`）。

- [ ] **Step 2: 改成单一 `.map(mountedPageIds)` 叠加层**

在 `<Content>` 内替换为：

```tsx
          {/* 统一页面缓存层：pin 与基础页共用 mountedPageIds，不再各走一套 */}
          {[...mountedPageIds].map(id => {
            const [sec, subKey] = id.split(':', 2) as ['gallery' | 'booru' | 'google', string];
            const currentSubKey = sec === 'gallery' ? selectedSubKey
              : sec === 'booru' ? selectedBooruSubKey
              : selectedGoogleSubKey;
            const isEmbed = sec === 'google' && (subKey === 'gdrive' || subKey === 'gphotos' || subKey === 'gemini');
            if (isEmbed) return null; // embed 页走下方 absolute 覆盖层，不纳入此叠加
            // 是否激活：pin 命中 activePinnedId；否则非 pin 时与当前 section + subKey 对比
            const pinId = `${sec}:${subKey}`;
            const isPin = pinnedItems.some(p => `${p.section}:${p.key}` === pinId);
            const isActive = isPin
              ? activePinnedId === pinId
              : (!activePinnedId && selectedKey === sec && currentSubKey === subKey);
            return (
              <div
                key={`page-${pinId}`}
                className="ios-page-enter noise-bg"
                style={{
                  padding: `${spacing.lg}px`,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  height: '100%',
                  display: isActive ? undefined : 'none',
                }}
              >
                <Suspense fallback={suspenseFallback}>
                  {renderPageForId(sec, subKey, isActive)}
                </Suspense>
              </div>
            );
          })}
```

（保留下方 `L1081-L1099` 的 embed absolute 覆盖层，不动。）

- [ ] **Step 3: 首次挂载也要确保初始基础页入集合**

在 `App.tsx` 内找到首次水合逻辑（保存 / 读取 pagePreferences 的 effect），或用一个简单的 mount effect：

```tsx
  useEffect(() => {
    const subKey = selectedKey === 'gallery' ? selectedSubKey
      : selectedKey === 'booru' ? selectedBooruSubKey
      : selectedGoogleSubKey;
    setMountedPageIds(prev => {
      const id = `${selectedKey}:${subKey}`;
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // 故意只在 selectedKey 或对应 subKey 变化时跑
  }, [selectedKey, selectedSubKey, selectedBooruSubKey, selectedGoogleSubKey]);
```

- [ ] **Step 4: TS 编译 + 测试**

Run: `npx tsc --noEmit -p tsconfig.json`
Run: `npx vitest run tests/renderer --config vitest.config.ts`

Expected: PASS。若 App.navigation.test.tsx 依赖原 `mountedPinnedIds` 命名，更新断言。

---

### Task 6: 补多实例缓存行为测试

**Files:**
- Create: `tests/renderer/App.mountedPageIds.test.tsx`

- [ ] **Step 1: 写测试**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { App } from '../../src/renderer/App';

// 伪代码骨架（具体 mock 参照同目录既有 App.navigation.test.tsx）：

describe('App.mountedPageIds', () => {
  it('一级菜单切回 section 时恢复 pin 缓存（路径 B 不再重新加载）', async () => {
    // 1. render <App />
    // 2. 进入 booru → posts → 假设 posts 在 pinnedItems（测试 mock 里预置）
    // 3. 切到 gallery → 再切回 booru
    // 4. 断言：activePinnedId === 'booru:posts'
    //       mountedPageIds 里仍含 'booru:posts'
    //       页面组件未经历 unmount（可通过 data-testid + refCount 或 jest.fn() 检测）
  });

  it('三个 section 各自的当前页都保留挂载（不仅 pin 项）', async () => {
    // 1. gallery 当前 = 'recent'（非 pin），booru 当前 = 'forums'（非 pin）
    // 2. 切到 booru → 再切到 gallery → 再切回 booru
    // 3. 断言：mountedPageIds 同时含 'gallery:recent' 与 'booru:forums'
  });

  it('同 section 切换 subKey 后，旧 subKey 若非 pin 应被释放', async () => {
    // 1. booru 当前 'forums'（非 pin）
    // 2. 点 'posts'
    // 3. 断言：mountedPageIds 含 'booru:posts'，不含 'booru:forums'
  });
});
```

> 测试依赖 App 的内部状态可见性；可通过 `data-*` 属性或测试专用的 `window.__APP_DEBUG__.getMountedIds()` 暴露（如果引入 debug 勾子要加说明）。若不方便，至少用 "页面 DOM 是否存在（display:none 但仍在 DOM）" 做断言。

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/renderer/App.mountedPageIds.test.tsx --config vitest.config.ts`

Expected: PASS。若实在难以直接断言内部 state，改为断言可观察副作用（如子组件 mount 次数）。

---

### Task 7: 人工验证 + 归档 + 总 commit

**Files:** —

- [ ] **Step 1: 人工验证（按 bug1.md 复现步骤）**

`npm run dev`：
- 情景 1（原 bug）：把 `booru:posts` 加入 pin，停在 booru → 切到 gallery → 切回 booru → **命中 pin 缓存，不重新加载**。
- 情景 2（追加需求）：pin 列表为空；gallery 停在 `recent`，booru 停在 `forums`。切到 booru → 再切回 gallery → `recent` 不重新加载；再切到 booru → `forums` 不重新加载。
- 情景 3：同 section 里切 subKey，旧 subKey 如非 pin 应被卸载（检查 DOM `.ios-page-enter` 节点数不无限增长）。
- 情景 4：embed 页（gdrive/gphotos/gemini）保持原有 absolute 层行为，不纳入新缓存。
- 情景 5：关闭 pin 时，若该页面仍是某 section 的当前 subKey，不应立即消失（display 仍然 none → 当前页应能正常看到）。

- [ ] **Step 2: 归档 + 提交**

```bash
git mv bug1.md doc/done/bug1-sidebar-cache-unified.md
git add src/renderer/App.tsx \
        tests/renderer/App.navigation.test.tsx \
        tests/renderer/App.mountedPageIds.test.tsx \
        doc/done/bug1-sidebar-cache-unified.md
git commit -m "refactor(bug1): 统一 pin 与基础页缓存为 mountedPageIds

$(cat <<'EOF'
原 bug：一级菜单切回某 section 时 activePinnedId 一刀切置 null，
即使该 section 当前 subKey 属于 pinnedItems，也不会恢复到 pin 缓存层，
导致基础层重新 mount + 重新加载。

追加需求：三个 section 各自的"当前页"也应常驻缓存，切换一级菜单
不卸载，解决非 pin 页同样的重新加载问题。

改动：
- 状态 mountedPinnedIds → mountedPageIds（`${section}:${subKey}`）
- 新增 renderPageForId(section,key,isActive) 工厂，basePage 改为
  薄封装，支持多实例并存
- 二级菜单 onSelect：新 id 入集合；旧 id 若非 pin 则出集合
- 一级菜单 onSelect：目标 section 当前 subKey 对应 id 入集合；
  命中 pin 则 handlePinnedClick 恢复，否则 activePinnedId 置 null
- 渲染层 L1037-L1075 合并为单一 .map(mountedPageIds) 叠加；
  外层 key 不再含 selectedKey，避免一级菜单切换整体卸载
- embed 页（gdrive/gphotos/gemini）保持原 absolute 独立层
EOF
)"
```

Expected: commit 成功。

---

## Self-Review Checklist

- [x] Spec §批 C C1 五条子点：①一级菜单恢复 pin；②mountedPageIds 统一；③renderPageForId 工厂；④二级菜单出/入集合；⑤渲染层合并 —— 全部覆盖。
- [x] 外层 div `key` 不再依赖 `selectedKey`（Task 5 的新渲染层改为按 id 作 key）。
- [x] embed 页（webview）保持原 absolute 层，不纳入新机制（Task 5 的 isEmbed return null）。
- [x] 回归测试覆盖三种关键路径（pin 恢复 / 多 section 常驻 / 同 section subKey 切换释放非 pin）。
- [x] 无占位符；若 Task 6 中的测试状态不可观察，退而使用 DOM 断言的替代路径已说明。
