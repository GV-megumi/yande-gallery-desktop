# Bug10 — 图集详情 "返回" 后仍自动恢复到旧图集

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 "返回" 按钮显式清除磁盘上持久化的 `selectedGalleryId`，避免 250ms 防抖被 `subTab` 切换打断后旧值残留、水合分支再次自动打开图集详情。

**Architecture:**
1. 让 `rebuildPagePreferences` 对 `selectedGalleryId = null`（显式清空）识别为 "删除字段"，而不是被 `?? current` fallback。
2. `GalleryPage` "返回" 按钮 onClick 内 `await persistPreferences({ galleries: { ..., selectedGalleryId: null } })` 同步落盘，绕过 250ms 防抖。

**Tech Stack:** React、TypeScript、Node.js、vitest

---

## File Structure

- 修改：`src/main/services/config.ts:884-889`（rebuildPagePreferences 对 `selectedGalleryId` 的合并语义）
- 修改：`src/shared/types.ts`（若 `GalleriesSubTabPreferences.selectedGalleryId` 当前是 `number | undefined`，允许 `number | null | undefined`）
- 修改：`src/renderer/pages/GalleryPage.tsx:1078-1086`（返回按钮 onClick）
- 新建：`tests/main/services/config.pagePreferences.test.ts`（或扩展现有 config 测试文件）

---

### Task 1: rebuildPagePreferences 支持 `null` 显式删除

**Files:**
- Modify: `src/main/services/config.ts:882-891`
- Modify: `src/shared/types.ts`（如需）

- [ ] **Step 1: 允许 `selectedGalleryId: null`**

打开 `src/shared/types.ts`，定位 `GalleriesSubTabPreferences`（或相似名）接口里的 `selectedGalleryId` 字段。若当前是：

```ts
selectedGalleryId?: number;
```

改为：

```ts
/** null 表示"显式清空"，undefined 表示"不修改"（合并时保留旧值） */
selectedGalleryId?: number | null;
```

- [ ] **Step 2: 写失败测试**

Create: `tests/main/services/config.pagePreferences.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { normalizeConfigSaveInput } from '../../../src/main/services/config.js';
import type { AppConfig } from '../../../src/main/services/config.js';

function baseConfig(): AppConfig {
  return {
    dataPath: '/tmp',
    database: { path: '/tmp/db', logging: false },
    downloads: { path: '/tmp/dl', createSubfolders: false, subfolderFormat: '' },
    galleries: { folders: [] },
    thumbnails: { cachePath: '', maxWidth: 1, maxHeight: 1, quality: 1, format: 'jpg' },
    app: { recentImagesCount: 1, pageSize: 1, defaultViewMode: 'grid', showImageInfo: false, autoScan: false, autoScanInterval: 0 },
    yande: { apiUrl: '', pageSize: 1, downloadTimeout: 1, maxConcurrentDownloads: 1 },
    logging: { level: 'info', filePath: '', consoleOutput: false, maxFileSize: 1, maxFiles: 1 },
    network: { proxy: {} as any },
    ui: {
      pagePreferences: {
        galleryBySubTab: {
          galleries: { selectedGalleryId: 42 },
        },
      },
    },
  } as any;
}

describe('config.rebuildPagePreferences - selectedGalleryId null = 显式删除', () => {
  it('传 null 应把 selectedGalleryId 从合并结果中去掉', () => {
    const current = baseConfig();
    const merged = normalizeConfigSaveInput(current, {
      ui: {
        pagePreferences: {
          galleryBySubTab: {
            galleries: { selectedGalleryId: null as any },
          },
        },
      },
    } as any);
    const result = merged.ui?.pagePreferences?.galleryBySubTab?.galleries?.selectedGalleryId;
    expect(result).toBeUndefined();
  });

  it('传 undefined（字段缺失）应保留旧值', () => {
    const current = baseConfig();
    const merged = normalizeConfigSaveInput(current, {
      ui: {
        pagePreferences: {
          galleryBySubTab: {
            galleries: { gallerySortKey: 'name' as any },
          },
        },
      },
    } as any);
    expect(merged.ui?.pagePreferences?.galleryBySubTab?.galleries?.selectedGalleryId).toBe(42);
  });

  it('传 number 应覆盖旧值', () => {
    const current = baseConfig();
    const merged = normalizeConfigSaveInput(current, {
      ui: {
        pagePreferences: {
          galleryBySubTab: {
            galleries: { selectedGalleryId: 99 },
          },
        },
      },
    } as any);
    expect(merged.ui?.pagePreferences?.galleryBySubTab?.galleries?.selectedGalleryId).toBe(99);
  });
});
```

- [ ] **Step 3: 跑测试确认 FAIL**

Run: `npx vitest run tests/main/services/config.pagePreferences.test.ts --config vitest.config.ts`

Expected: 第一条 "null = 删除" **FAIL**（当前 `?? current` 把 null 也 fallback）。

- [ ] **Step 4: 修 rebuildPagePreferences**

把 `src/main/services/config.ts:882-892` 的 `galleryBySubTab.galleries` 内层 `selectedGalleryId` 那一行替换，并在 galleries 分支前提取入参变量，便于判定 "是否显式传了 null"：

```ts
    galleryBySubTab: incomingPagePreferences?.galleryBySubTab
      ? {
          all: incomingPagePreferences.galleryBySubTab.all
            ? {
                searchQuery: incomingPagePreferences.galleryBySubTab.all.searchQuery ?? currentPagePreferences?.galleryBySubTab?.all?.searchQuery,
                isSearchMode: incomingPagePreferences.galleryBySubTab.all.isSearchMode ?? currentPagePreferences?.galleryBySubTab?.all?.isSearchMode,
                allPage: incomingPagePreferences.galleryBySubTab.all.allPage ?? currentPagePreferences?.galleryBySubTab?.all?.allPage,
                searchPage: incomingPagePreferences.galleryBySubTab.all.searchPage ?? currentPagePreferences?.galleryBySubTab?.all?.searchPage,
              }
            : currentPagePreferences?.galleryBySubTab?.all,
          galleries: incomingPagePreferences.galleryBySubTab.galleries
            ? (() => {
                const inGalleries = incomingPagePreferences.galleryBySubTab.galleries!;
                const curGalleries = currentPagePreferences?.galleryBySubTab?.galleries;
                // selectedGalleryId: null = 显式删除；undefined = 保留旧值；number = 覆盖
                const resolvedSelectedGalleryId = inGalleries.selectedGalleryId === null
                  ? undefined
                  : (inGalleries.selectedGalleryId ?? curGalleries?.selectedGalleryId);
                return {
                  gallerySearchQuery: inGalleries.gallerySearchQuery ?? curGalleries?.gallerySearchQuery,
                  gallerySortKey: inGalleries.gallerySortKey ?? curGalleries?.gallerySortKey,
                  gallerySortOrder: inGalleries.gallerySortOrder ?? curGalleries?.gallerySortOrder,
                  selectedGalleryId: resolvedSelectedGalleryId,
                  gallerySort: inGalleries.gallerySort ?? curGalleries?.gallerySort,
                };
              })()
            : currentPagePreferences?.galleryBySubTab?.galleries,
        }
      : currentPagePreferences?.galleryBySubTab,
```

- [ ] **Step 5: 跑测试确认 PASS**

Run: `npx vitest run tests/main/services/config.pagePreferences.test.ts --config vitest.config.ts`

Expected: 3 条 PASS。

- [ ] **Step 6: 回归 config 相关测试**

Run: `npx vitest run tests/main/services/config.test.ts tests/main/services/configUi.test.ts --config vitest.config.ts`

（如这些测试文件不存在则忽略。）

Expected: 全 PASS。

---

### Task 2: "返回" 按钮显式同步清空

**Files:**
- Modify: `src/renderer/pages/GalleryPage.tsx:1078-1086`

- [ ] **Step 1: 替换返回按钮**

把 `src/renderer/pages/GalleryPage.tsx:1078-1086` 的 `<Button onClick={...}>返回</Button>`（含 onClick 体）替换为：

```tsx
                    <Button onClick={async () => {
                      console.log('[GalleryPage] 返回图集列表');
                      galleryDetailRequestRunIdRef.current += 1;
                      setSelectedGallery(null);
                      setGalleryImages([]);
                      setDetailSourceFavoriteTags([]);
                      // 显式同步落盘 selectedGalleryId=null，避免 250ms 防抖被 subTab 切换取消
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

（依赖的局部变量 `gallerySearchQuery` / `gallerySortKey` / `gallerySortOrder` / `gallerySort` 必须已在上层闭包可见。按当前文件 L713-L776 的保存 effect 中所列字段保持一致。）

- [ ] **Step 2: TS 编译**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: 无错误（若 `selectedGalleryId` 的类型已在 Task 1 放宽，这里 null 能通过）。

---

### Task 3: 补一条 GalleryPage 行为测试（可选但推荐）

**Files:**
- 扩展：`tests/renderer/pages/GalleryPage.test.tsx`

- [ ] **Step 1: 写回归测试**

在 `tests/renderer/pages/GalleryPage.test.tsx` 合适的 describe 里追加：

```tsx
it('点击返回按钮时应 persistPreferences 带 selectedGalleryId=null', async () => {
  // 按该文件既有模式：mock window.electronAPI.pagePreferences.gallery.save / get
  // render GalleryPage subTab="galleries"，模拟选中一个图集 → 看到详情
  // 点击"返回" → 断言 save 被调，参数 payload.galleries.selectedGalleryId === null
});
```

（骨架给出即可，具体 render / mock 依照文件既有约定补齐。）

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/renderer/pages/GalleryPage.test.tsx --config vitest.config.ts`

Expected: PASS。

---

### Task 4: 人工验证 + 归档 + 提交

**Files:** —

- [ ] **Step 1: 人工验证**

`npm run dev` → 图库 → 图集 → 打开任一图集详情 → 点 "返回" → 立刻点 "全部图片" → 再点 "图集"。

- 预期：落到图集列表（不再自动进入先前那个图集的详情）
- 重启应用后再次进入 "图集" 仍然是列表态（因为 selectedGalleryId 已磁盘清空）

- [ ] **Step 2: 归档 + 提交**

```bash
git mv bug10.md doc/done/bug10-gallery-detail-return.md
git add src/main/services/config.ts \
        src/shared/types.ts \
        src/renderer/pages/GalleryPage.tsx \
        tests/main/services/config.pagePreferences.test.ts \
        tests/renderer/pages/GalleryPage.test.tsx \
        doc/done/bug10-gallery-detail-return.md
git commit -m "fix(bug10): 图集详情返回后清除 selectedGalleryId 持久化

$(cat <<'EOF'
原"返回"按钮只清内存 selectedGalleryId，磁盘落盘靠 useEffect
内 250ms 防抖的 persistPreferences，用户返回后立刻切二级菜单
时防抖被 clearTimeout 取消，磁盘上旧值残留，下次进入"图集"
又被自动打开。

- rebuildPagePreferences 识别 selectedGalleryId=null 为"显式删除"，
  null=删、undefined=保留旧值、number=覆盖；类型放宽为 number|null|undefined。
- GalleryPage 返回按钮 onClick 改为 await persistPreferences
  {galleries:{...,selectedGalleryId:null}}，同步落盘绕过防抖。
EOF
)"
```

Expected: commit 成功。

---

## Self-Review Checklist

- [x] Spec §批 B B3 要求：持久化 null 语义对齐 + 返回按钮同步落盘，均覆盖。
- [x] 合并语义文档化（代码注释 + 类型层）：null=删、undefined=保留、值=覆盖。
- [x] 其它字段（gallerySearchQuery 等）合并语义保持不变，无回归风险。
- [x] 无占位符。
