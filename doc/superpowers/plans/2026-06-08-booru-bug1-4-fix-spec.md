# Booru Bug1-4 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `doc/Bug记录.md` 中 Bug1-Bug4：黑名单菜单状态、详情页旧图残留、列表 loading 分页消失、原图缓存完成后偶发不刷新。

**Architecture:** 保持小范围修复，不把 Bug5 的全局事件重构混入本轮。Renderer 侧用本页状态、request id 和稳定占位修复可见问题；main 侧用临时文件 + 原子 rename 建立缓存完整性边界；测试以 Vitest 定向覆盖每个回归点。

**Tech Stack:** Electron IPC, React 18, TypeScript, Ant Design, Vitest/jsdom, Node fs streams.

---

## 0. 当前代码证据

- Bug1：`src/renderer/components/BooruPostDetails/TagsSection.tsx` 已维护 `favoritedTags`，但黑名单菜单项固定为 `加入黑名单`；preload 已暴露 `getBlacklistedTags`、`addBlacklistedTag`、`removeBlacklistedTag`。
- Bug2：`src/renderer/pages/BooruPostDetailsPage.tsx` 的原图加载 effect 只在 `!open || !currentPost` 时清空 `imageUrl`，切换到新图并进入缓存下载分支时会继续显示上一张 `imageUrl`；该 effect 没有 request id / cancelled 守卫。
- Bug3：`src/renderer/pages/BooruPage.tsx` 在 `loading` 时只渲染 `SkeletonGrid`，`PaginationControl` 和 `BooruGridLayout` 都在 `!loading && posts.length > 0` 分支内。
- Bug4：`src/main/services/imageCacheService.ts` 用 `createWriteStream(cachePath)` 直接写最终缓存路径，`getCachedImagePath` 只用 `fs.access(cachePath)` 判断存在；下载中 partial final file 可能被当作可用缓存。

## 1. 非目标

- 不在本轮实现全局 Booru 领域通知；黑名单变更跨窗口同步留给 Bug5 方案。
- 不重写 Booru 列表虚拟滚动、瀑布流布局或下载队列。
- 不改变 Booru 站点适配层请求协议。
- 不压缩原图、不改变缓存质量、不降低图片展示清晰度。

## 2. 文件结构

- Modify: `src/renderer/components/BooruPostDetails/TagsSection.tsx`
  - 负责加载当前站点黑名单标签、维护 `tagName -> BlacklistedTag` 映射、在菜单中切换加入/移除黑名单。
- Modify: `src/renderer/pages/BooruPostDetailsPage.tsx`
  - 负责详情页原图加载状态、旧请求隔离、空占位、同 URL 完成态重新挂载图片。
- Modify: `src/main/services/imageCacheService.ts`
  - 负责缓存下载写入完整性，改为 `.part` 临时文件完成后原子 rename。
- Modify: `src/renderer/pages/BooruPage.tsx`
  - 负责 Booru 列表 loading shell，加载期间保留分页和网格占位。
- Test: `tests/renderer/components/TagsSection.blacklist.test.tsx`
  - 覆盖黑名单菜单文案、加入成功后状态切换、移除时使用黑名单 id。
- Test: `tests/renderer/pages/BooruPostDetailsPage.imageLoading.test.tsx`
  - 覆盖切换未缓存新图时不显示上一张图、旧请求不能回写、同 URL 缓存完成会重建图片元素。
- Test: `tests/main/services/imageCacheService.atomic.test.ts`
  - 覆盖缓存下载只在 pipeline 完成后暴露最终文件，失败时清理临时文件。
- Test: `tests/renderer/pages/BooruPage.loadingPagination.test.tsx`
  - 覆盖 loading 期间分页仍存在，元数据返回后卡片接管缩略图逐张加载。

## 3. 修复策略总览

1. Bug1 用局部 `Map<string, BlacklistedTag>` 解决菜单状态，不等待全局事件总线。
2. Bug2 在详情页切换帖子时立即让旧 `imageUrl` 失效，并为每次加载分配 request id；所有 async 分支、`finally` 和 `onError` 都必须确认仍是当前请求。
3. Bug4 在 main cache service 层保证未完成文件不会出现在最终路径；renderer 再用 `imageVersion` / `key` 避免同 URL 不刷新。
4. Bug3 将“页面元数据请求中”和“缩略图加载中”分离：元数据请求中显示分页 + skeleton cards；元数据返回后立即挂载 `BooruGridLayout`，由 `BooruImageCard` 的 per-card skeleton 和 `onLoad` 淡入接手。

## 4. 任务清单

### Task 1: Bug1 标签黑名单菜单状态

**Files:**
- Modify: `src/renderer/components/BooruPostDetails/TagsSection.tsx`
- Test: `tests/renderer/components/TagsSection.blacklist.test.tsx`

- [ ] **Step 1: 写失败测试**

新增测试文件，核心用例必须覆盖这三件事：

```tsx
/** @vitest-environment jsdom */

import React from 'react';
import { App as AntdApp } from 'antd';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagsSection } from '../../../src/renderer/components/BooruPostDetails/TagsSection';

const getTagsCategories = vi.fn();
const getFavoriteTags = vi.fn();
const getBlacklistedTags = vi.fn();
const addBlacklistedTag = vi.fn();
const removeBlacklistedTag = vi.fn();

const site = { id: 1, name: 'Yande', type: 'moebooru', url: 'https://yande.re', enabled: true } as any;
const post = { id: 10, postId: 100, siteId: 1, tags: 'sunpe ass', rating: 'safe' } as any;

function renderTags() {
  return render(
    <AntdApp>
      <TagsSection post={post} site={site} />
    </AntdApp>
  );
}

describe('TagsSection blacklist menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTagsCategories.mockResolvedValue({ success: true, data: { sunpe: 'artist', ass: 'general' } });
    getFavoriteTags.mockResolvedValue({ success: true, data: { items: [] } });
    getBlacklistedTags.mockResolvedValue({
      success: true,
      data: { items: [{ id: 7, siteId: 1, tagName: 'sunpe', isActive: true }] },
    });
    addBlacklistedTag.mockResolvedValue({
      success: true,
      data: { id: 8, siteId: 1, tagName: 'ass', isActive: true },
    });
    removeBlacklistedTag.mockResolvedValue({ success: true });
    (window as any).electronAPI = {
      booru: {
        getTagsCategories,
        getFavoriteTags,
        getBlacklistedTags,
        addBlacklistedTag,
        removeBlacklistedTag,
        addFavoriteTag: vi.fn(),
        removeFavoriteTagByName: vi.fn(),
      },
    };
  });

  afterEach(() => cleanup());

  it('已在黑名单的标签右键菜单应显示移除黑名单并调用 removeBlacklistedTag(id)', async () => {
    renderTags();
    await waitFor(() => expect(getBlacklistedTags).toHaveBeenCalledWith({ siteId: 1, limit: 0 }));
    fireEvent.contextMenu(await screen.findByText('sunpe'));
    fireEvent.click(await screen.findByText('移除黑名单'));
    await waitFor(() => expect(removeBlacklistedTag).toHaveBeenCalledWith(7));
  });

  it('加入黑名单成功后同一标签菜单应切换为移除黑名单', async () => {
    renderTags();
    fireEvent.contextMenu(await screen.findByText('ass'));
    fireEvent.click(await screen.findByText('加入黑名单'));
    await waitFor(() => expect(addBlacklistedTag).toHaveBeenCalledWith('ass', 1));
    fireEvent.contextMenu(await screen.findByText('ass'));
    expect(await screen.findByText('移除黑名单')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run --config vitest.config.ts tests/renderer/components/TagsSection.blacklist.test.tsx
```

Expected: 至少一个断言失败，原因是当前菜单没有 `移除黑名单`，且 `getBlacklistedTags` 未被 `TagsSection` 调用。

- [ ] **Step 3: 实现黑名单状态映射**

在 `TagsSection.tsx` 中把类型导入改为：

```ts
import { BlacklistedTag, BooruPost, BooruSite } from '../../../shared/types';
```

新增状态和加载函数：

```ts
const [blacklistedTagsByName, setBlacklistedTagsByName] = useState<Map<string, BlacklistedTag>>(new Map());

useEffect(() => {
  if (!site) {
    setBlacklistedTagsByName(new Map());
    return;
  }

  let cancelled = false;
  const loadBlacklistStatus = async () => {
    try {
      const result = await window.electronAPI.booru.getBlacklistedTags({ siteId: site.id, limit: 0 });
      if (cancelled) return;
      if (result.success && result.data) {
        const items = result.data.items ?? [];
        setBlacklistedTagsByName(new Map(items.map((tag: BlacklistedTag) => [tag.tagName, tag])));
      }
    } catch (error) {
      if (!cancelled) console.error('[TagsSection] 加载黑名单标签状态失败:', error);
    }
  };

  loadBlacklistStatus();
  return () => { cancelled = true; };
}, [site]);
```

用 `toggleBlacklistTag` 替换 `addToBlacklist`：

```ts
const toggleBlacklistTag = useCallback(async (tagName: string) => {
  if (!site) return;
  const existing = blacklistedTagsByName.get(tagName);

  try {
    if (existing) {
      const result = await window.electronAPI.booru.removeBlacklistedTag(existing.id);
      if (result.success) {
        setBlacklistedTagsByName(prev => {
          const next = new Map(prev);
          next.delete(tagName);
          return next;
        });
        message.success(`已移除黑名单: ${tagName.replace(/_/g, ' ')}`);
      } else {
        message.error('操作失败: ' + result.error);
      }
      return;
    }

    const result = await window.electronAPI.booru.addBlacklistedTag(tagName, site.id);
    if (result.success && result.data) {
      setBlacklistedTagsByName(prev => new Map(prev).set(tagName, result.data));
      message.success(`已加入黑名单: ${tagName.replace(/_/g, ' ')}`);
    } else if (result.error?.includes('UNIQUE constraint')) {
      const reload = await window.electronAPI.booru.getBlacklistedTags({ siteId: site.id, limit: 0 });
      if (reload.success && reload.data) {
        setBlacklistedTagsByName(new Map(reload.data.items.map((tag: BlacklistedTag) => [tag.tagName, tag])));
      }
      message.warning(`标签已在黑名单中: ${tagName.replace(/_/g, ' ')}`);
    } else {
      message.error('操作失败: ' + result.error);
    }
  } catch (error) {
    console.error('[TagsSection] 切换黑名单标签失败:', error);
    message.error('操作失败');
  }
}, [site, blacklistedTagsByName, message]);
```

菜单项根据状态渲染：

```ts
const blacklistedTag = blacklistedTagsByName.get(tag);
{
  key: 'blacklist',
  label: blacklistedTag ? '移除黑名单' : '加入黑名单',
  icon: <StopOutlined style={{ color: '#FF3B30' }} />,
  onClick: () => toggleBlacklistTag(tag),
}
```

- [ ] **Step 4: 运行定向测试和构建**

Run:

```bash
npx vitest run --config vitest.config.ts tests/renderer/components/TagsSection.blacklist.test.tsx
npm run build
```

Expected: 定向测试 PASS；`npm run build` exit code 0。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/BooruPostDetails/TagsSection.tsx tests/renderer/components/TagsSection.blacklist.test.tsx
git commit -m "fix: 修复标签黑名单菜单状态"
```

### Task 2: Bug2 详情页切换新图时不显示上一张

**Files:**
- Modify: `src/renderer/pages/BooruPostDetailsPage.tsx`
- Test: `tests/renderer/pages/BooruPostDetailsPage.imageLoading.test.tsx`

- [ ] **Step 1: 写失败测试**

新增测试聚焦 image 状态机；如果完整页面渲染过重，先抽取实际 helper 到 `src/renderer/utils/booruDetailImageState.ts`，再用 helper 驱动组件改造。helper 的目标行为如下：

```ts
import { describe, expect, it } from 'vitest';

interface MockPost {
  postId: number;
  siteId?: number;
  md5?: string;
  fileExt?: string;
  fileUrl?: string;
  sampleUrl?: string;
  previewUrl?: string;
  localPath?: string;
}

function createImageRequestKey(post: MockPost): string {
  return `${post.siteId ?? 'unknown'}:${post.postId}:${post.md5 ?? post.fileUrl ?? ''}`;
}

function shouldCommitImageResult(activeKey: string, resultKey: string, cancelled: boolean): boolean {
  return !cancelled && activeKey === resultKey;
}

describe('BooruPostDetailsPage image request state', () => {
  it('切换帖子后旧请求结果不能回写当前 imageUrl', () => {
    const oldKey = createImageRequestKey({ siteId: 1, postId: 10, md5: 'old' });
    const newKey = createImageRequestKey({ siteId: 1, postId: 11, md5: 'new' });
    expect(shouldCommitImageResult(newKey, oldKey, false)).toBe(false);
    expect(shouldCommitImageResult(newKey, newKey, false)).toBe(true);
    expect(shouldCommitImageResult(newKey, newKey, true)).toBe(false);
  });
});
```

组件级回归测试要模拟：

```tsx
it('新图缓存 pending 时不应继续渲染上一张图片 src', async () => {
  // 1. 渲染 postA，getCachedImageUrl resolve app://cache/a.jpg。
  // 2. rerender 到 postB，cacheImage 保持 pending。
  // 3. 断言 img[src="app://cache/a.jpg"] 不存在，页面显示加载占位。
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run --config vitest.config.ts tests/renderer/pages/BooruPostDetailsPage.imageLoading.test.tsx
```

Expected: 状态机或组件测试失败，暴露旧请求可提交或旧 `imageUrl` 仍存在。

- [ ] **Step 3: 增加 request id、清空旧 URL、稳定占位**

在 `BooruPostDetailsPage.tsx` 中新增：

```ts
const imageRequestIdRef = useRef(0);
const [imageVersion, setImageVersion] = useState(0);

const currentImageKey = useMemo(() => {
  if (!currentPost) return '';
  return `${site?.id ?? currentPost.siteId ?? 'unknown'}:${currentPost.postId}:${currentPost.md5 ?? currentPost.fileUrl ?? ''}`;
}, [site?.id, currentPost]);
```

改造原图加载 effect：

```ts
useEffect(() => {
  const requestId = ++imageRequestIdRef.current;
  let cancelled = false;

  const commitImageUrl = (url: string) => {
    if (cancelled || requestId !== imageRequestIdRef.current) return;
    setImageUrl(url);
    setImageVersion(version => version + 1);
  };

  const commitCaching = (next: boolean) => {
    if (cancelled || requestId !== imageRequestIdRef.current) return;
    setIsCaching(next);
  };

  if (!open || !currentPost) {
    setImageUrl('');
    setIsCaching(false);
    return () => { cancelled = true; };
  }

  setImageUrl('');
  setImageVersion(version => version + 1);
  setIsCaching(false);

  const loadOriginalImage = async () => {
    // 保留现有 localPath、no fileUrl、video、missing md5/fileExt 分支；
    // 所有 setImageUrl(...) 改为 commitImageUrl(...)；
    // 所有 setIsCaching(...) 改为 commitCaching(...)。
  };

  loadOriginalImage();
  return () => { cancelled = true; };
}, [open, currentImageKey]);
```

渲染图片时加 `key`，没有 URL 时显示空黑底占位：

```tsx
{imageUrl ? (
  <img
    key={`${currentImageKey}:${imageVersion}`}
    src={imageUrl}
    alt={`Post ${currentPost?.postId || ''}`}
    onError={(event) => {
      if (imageRequestIdRef.current === 0) return;
      // 回退逻辑只使用当前 currentPost，且通过 setImageVersion 强制重建。
    }}
  />
) : (
  <div style={{ width: '100%', minHeight: 320, background: '#000' }} />
)}
```

- [ ] **Step 4: 运行定向测试**

Run:

```bash
npx vitest run --config vitest.config.ts tests/renderer/pages/BooruPostDetailsPage.imageLoading.test.tsx tests/renderer/pages/BooruPostDetailsPage.video.test.ts
```

Expected: 新测试 PASS；现有视频帖子逻辑测试 PASS，视频仍直接使用 `fileUrl` 不走缓存。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/pages/BooruPostDetailsPage.tsx tests/renderer/pages/BooruPostDetailsPage.imageLoading.test.tsx
git commit -m "fix: 修复详情页切图旧图残留"
```

### Task 3: Bug4 原图缓存完整性和完成后刷新

**Files:**
- Modify: `src/main/services/imageCacheService.ts`
- Modify: `src/renderer/pages/BooruPostDetailsPage.tsx`
- Test: `tests/main/services/imageCacheService.atomic.test.ts`
- Test: `tests/renderer/pages/BooruPostDetailsPage.imageLoading.test.tsx`

- [ ] **Step 1: 写失败测试**

新增原子写入纯逻辑测试，先锁定 `.part` 路径和完成态语义：

```ts
import { describe, expect, it } from 'vitest';

function createPartPath(cachePath: string): string {
  return `${cachePath}.part`;
}

function shouldExposeCachedFile(pathExists: boolean, partExists: boolean): boolean {
  return pathExists && !partExists;
}

describe('image cache atomic write contract', () => {
  it('下载中只有 part 文件时不应暴露缓存', () => {
    expect(shouldExposeCachedFile(false, true)).toBe(false);
  });

  it('final 文件存在且没有 part 文件时才暴露缓存', () => {
    expect(shouldExposeCachedFile(true, false)).toBe(true);
  });

  it('part 路径必须与 final 路径不同', () => {
    const finalPath = 'G:\\cache\\ab\\abcdef.jpg';
    expect(createPartPath(finalPath)).not.toBe(finalPath);
    expect(createPartPath(finalPath)).toBe('G:\\cache\\ab\\abcdef.jpg.part');
  });
});
```

- [ ] **Step 2: 运行测试确认失败或确认当前服务缺少该契约**

Run:

```bash
npx vitest run --config vitest.config.ts tests/main/services/imageCacheService.atomic.test.ts
```

Expected: 初始可用纯逻辑测试 PASS；随后按 Step 3 把 helper 接入实际服务，再补一个 service-level mock 测试，确认当前直接写 final path 的实现无法满足 “下载中 final 不存在”。

- [ ] **Step 3: 改为临时文件 + 原子 rename**

在 `imageCacheService.ts` 中新增 helper：

```ts
function getCachePartFilePath(cachePath: string): string {
  return `${cachePath}.part`;
}
```

改造 `doCacheImage`：

```ts
const cachePath = getCacheFilePath(md5, extension);
const partPath = getCachePartFilePath(cachePath);
const cacheDir = path.dirname(cachePath);

await fs.mkdir(cacheDir, { recursive: true });
await fs.unlink(partPath).catch(() => undefined);

const writer = fsSync.createWriteStream(partPath);
await pipeline(response.data, writer);
await fs.rename(partPath, cachePath);
console.log(`[imageCacheService] 图片缓存成功: ${cachePath}`);
```

失败清理必须删 `.part`，不删已存在的完整 final 文件：

```ts
} catch (error) {
  try {
    await fs.unlink(partPath);
  } catch {
    // 忽略临时文件清理失败
  }
  throw error;
}
```

`getCachedImagePath` 保持只认 final path；如果为了防御旧版本遗留 `.part`，不要因为 `.part` 存在而否定已经存在的 final path。

- [ ] **Step 4: 确认 renderer 同 URL 也会刷新**

复用 Task 2 的 `imageVersion`。当 `cacheImage` 成功返回的 URL 与之前 `imageUrl` 字符串相同，也必须执行：

```ts
commitImageUrl(cacheResult.data);
```

因为 `commitImageUrl` 内部会 `setImageVersion(version => version + 1)`，图片 `key` 会变化，浏览器会创建新的 `<img>` 加载周期。

- [ ] **Step 5: 运行缓存和详情页测试**

Run:

```bash
npx vitest run --config vitest.config.ts tests/main/services/imageCacheService.atomic.test.ts tests/main/services/imageCacheService.test.ts
npx vitest run --config vitest.config.ts tests/renderer/pages/BooruPostDetailsPage.imageLoading.test.tsx
```

Expected: 缓存路径、原子写入契约、详情页同 URL 重建图片测试全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/main/services/imageCacheService.ts src/renderer/pages/BooruPostDetailsPage.tsx tests/main/services/imageCacheService.atomic.test.ts tests/renderer/pages/BooruPostDetailsPage.imageLoading.test.tsx
git commit -m "fix: 修复原图缓存完成后偶发不刷新"
```

### Task 4: Bug3 Booru 列表 loading 保留分页和逐卡片渲染

**Files:**
- Modify: `src/renderer/pages/BooruPage.tsx`
- Test: `tests/renderer/pages/BooruPage.loadingPagination.test.tsx`

- [ ] **Step 1: 写失败测试**

新增页面测试，模拟 `getPosts` pending 时页面仍应有分页壳：

```tsx
/** @vitest-environment jsdom */

import React from 'react';
import { App as AntdApp } from 'antd';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BooruPage } from '../../../src/renderer/pages/BooruPage';

const getSites = vi.fn();
const getPosts = vi.fn();
const getActiveBlacklistTagNames = vi.fn();
const getBooruAppearancePreferences = vi.fn();
const saveBooruAppearancePreferences = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => { resolve = innerResolve; });
  return { promise, resolve };
}

describe('BooruPage loading shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSites.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Yande', enabled: true }] });
    getActiveBlacklistTagNames.mockResolvedValue({ success: true, data: [] });
    getBooruAppearancePreferences.mockResolvedValue({
      success: true,
      data: { itemsPerPage: 20, gridSize: 240, spacing: 16, paginationPosition: 'both' },
    });
    (window as any).electronAPI = {
      booru: { getSites, getPosts, getActiveBlacklistTagNames },
      pagePreferences: {
        booruAppearance: {
          get: getBooruAppearancePreferences,
          save: saveBooruAppearancePreferences,
        },
      },
    };
  });

  afterEach(() => cleanup());

  it('帖子请求 pending 时仍保留分页控件和 skeleton 网格', async () => {
    const pending = deferred<any>();
    getPosts.mockReturnValue(pending.promise);

    render(<AntdApp><BooruPage active /></AntdApp>);

    await waitFor(() => expect(getPosts).toHaveBeenCalled());
    expect(screen.getAllByText(/第 1 页|1/).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-testid="booru-skeleton-card"]').length).toBeGreaterThan(0);

    pending.resolve({ success: true, data: [{ postId: 101, tags: '', rating: 'safe', previewUrl: 'https://img/1.jpg' }] });
    await waitFor(() => expect(screen.queryAllByTestId('booru-skeleton-card').length).toBe(0));
  });
});
```

如果 `SkeletonGrid` 当前没有稳定 test id，在实现中为骨架卡片加：

```tsx
data-testid="booru-skeleton-card"
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run --config vitest.config.ts tests/renderer/pages/BooruPage.loadingPagination.test.tsx
```

Expected: 当前实现因 loading 分支只渲染 `SkeletonGrid`，分页断言失败。

- [ ] **Step 3: 拆分 loading shell**

在 `BooruPage.tsx` 中新增请求目标页状态：

```ts
const [pendingPage, setPendingPage] = useState<number | null>(null);
const displayPage = pendingPage ?? currentPage;
```

在 `loadPosts` / `searchPosts` 开始时：

```ts
setPendingPage(page);
setLoading(true);
```

成功后：

```ts
setPosts(data);
setCurrentPage(page);
setPendingPage(null);
```

失败和 finally 中确保：

```ts
setPendingPage(null);
setLoading(false);
```

抽出分页渲染函数，loading 时按钮禁用：

```tsx
const renderPagination = (position: 'top' | 'bottom') => (
  <PaginationControl
    currentPage={displayPage}
    currentCount={posts.length}
    itemsPerPage={appearanceConfig.itemsPerPage}
    paginationPosition={appearanceConfig.paginationPosition}
    position={position}
    disabled={loading}
    onPrevious={() => {
      const next = Math.max(1, currentPage - 1);
      isSearchMode ? searchPosts(searchQuery, next) : loadPosts(next);
    }}
    onNext={() => {
      const next = currentPage + 1;
      isSearchMode ? searchPosts(searchQuery, next) : loadPosts(next);
    }}
    onPageChange={(page) => {
      isSearchMode ? searchPosts(searchQuery, page) : loadPosts(page);
    }}
  />
);
```

如果 `PaginationControl` 还没有 `disabled` prop，新增：

```ts
interface PaginationControlProps {
  disabled?: boolean;
}
```

并把 `disabled` 传给上一页、下一页、页码按钮和跳转输入触发。

- [ ] **Step 4: 改造渲染分支**

把现有 `loading` / `empty` / `posts` 三分支改为：

```tsx
{(loading || posts.length > 0) && renderPagination('top')}

{loading && (
  <SkeletonGrid count={appearanceConfig.itemsPerPage} cardWidth={appearanceConfig.gridSize} gap={appearanceConfig.spacing} />
)}

{!loading && posts.length === 0 && (
  <Empty description={isSearchMode ? '未找到匹配的图片' : '暂无图片'} />
)}

{!loading && posts.length > 0 && (
  <BooruGridLayout
    posts={filteredSortedPosts}
    gridSize={appearanceConfig.gridSize}
    spacing={appearanceConfig.spacing}
    borderRadius={appearanceConfig.borderRadius}
    selectedSite={selectedSite || null}
    onPreview={handlePreview}
    onDownload={handleDownload}
    onToggleFavorite={handleToggleFavorite}
    favorites={favorites}
    getPreviewUrl={getPreviewUrl}
    onTagClick={handleTagClick}
    onToggleServerFavorite={selectedSite?.username ? handleToggleServerFavorite : undefined}
    serverFavorites={serverFavorites}
    selectionMode={selectionMode}
    selectedPostIds={selectedPostIds}
    onToggleSelect={(post) => setSelectedPostIds((current) => toggleSelectedPost(current, post.postId))}
  />
)}

{(loading || posts.length > 0) && renderPagination('bottom')}
```

`BooruImageCard` 已有 `loading="lazy"`、`imageLoaded` 和 `onLoad` 淡入；本任务不要把缩略图下载集中到页面级状态。

- [ ] **Step 5: 运行定向测试**

Run:

```bash
npx vitest run --config vitest.config.ts tests/renderer/pages/BooruPage.loadingPagination.test.tsx tests/renderer/components/PaginationControl.test.ts tests/renderer/components/BooruImageCard.test.ts
```

Expected: loading shell 测试 PASS；分页纯逻辑测试 PASS；卡片图片懒加载逻辑测试 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/pages/BooruPage.tsx src/renderer/components/PaginationControl.tsx src/renderer/components/SkeletonGrid.tsx tests/renderer/pages/BooruPage.loadingPagination.test.tsx
git commit -m "fix: 保留Booru加载期间分页"
```

### Task 5: 全量回归和文档收口

**Files:**
- Modify: `doc/Bug记录.md`
- Modify when cache/display behavior docs change: `doc/Booru功能实现文档.md`

- [ ] **Step 1: 运行四个 bug 的定向测试集合**

Run:

```bash
npx vitest run --config vitest.config.ts \
  tests/renderer/components/TagsSection.blacklist.test.tsx \
  tests/renderer/pages/BooruPostDetailsPage.imageLoading.test.tsx \
  tests/main/services/imageCacheService.atomic.test.ts \
  tests/renderer/pages/BooruPage.loadingPagination.test.tsx
```

Expected: 4 个新增测试文件全部 PASS。

- [ ] **Step 2: 运行相关旧测试**

Run:

```bash
npx vitest run --config vitest.config.ts \
  tests/renderer/pages/BooruPostDetailsPage.video.test.ts \
  tests/main/services/imageCacheService.test.ts \
  tests/renderer/components/PaginationControl.test.ts \
  tests/renderer/components/BooruImageCard.test.ts \
  tests/renderer/pages/BlacklistedTagsPage.test.tsx
```

Expected: 现有相关测试全部 PASS。

- [ ] **Step 3: 运行构建**

Run:

```bash
npm run build
```

Expected: `build:main`、`build:preload`、`build:renderer` 全部完成，exit code 0。

- [ ] **Step 4: 更新 bug 文档状态**

在 `doc/Bug记录.md` 中把 Bug1-Bug4 的状态从 `已确认` 改为 `已修复`，并在每条 `验证方式` 后追加实际通过的测试命令名。示例：

```md
- 状态：已修复
- 回归验证：`npx vitest run --config vitest.config.ts tests/renderer/components/TagsSection.blacklist.test.tsx`
```

如果实现过程中只完成其中一部分，只更新实际完成且验证通过的条目。

- [ ] **Step 5: 最终提交**

```bash
git add doc/Bug记录.md doc/Booru功能实现文档.md
git commit -m "docs: 更新Booru缺陷修复记录"
```

只在 `doc/Booru功能实现文档.md` 有实际改动时加入该文件。

## 5. 手工验收清单

- [ ] 标签详情区：对不在黑名单的标签右键，显示 `加入黑名单`；点击成功后同一标签菜单显示 `移除黑名单`。
- [ ] 标签详情区：对已在黑名单的标签右键，显示 `移除黑名单`；点击后调用对应 id 删除，不再触发重复添加。
- [ ] 图片详情页：从已缓存图片切到未缓存图片，加载期间主图区域为空黑底 / 占位，不显示上一张图。
- [ ] 图片详情页：快速 A -> B -> C 切换后，A 或 B 的晚返回请求不会覆盖 C。
- [ ] 图片详情页：原图缓存完成后，即使 URL 字符串相同，图片元素也会重新加载。
- [ ] 缓存目录：下载中只出现 `.part` 临时文件；下载完成后才出现最终文件；下载失败后 `.part` 被清理。
- [ ] Booru 列表页：加载期间顶部 / 底部分页仍可见，翻页控件处于 disabled 或明确 loading 状态。
- [ ] Booru 列表页：帖子元数据返回后立即挂载卡片，缩略图按 `BooruImageCard` 的单卡片 skeleton 和 `onLoad` 逐张淡入。

## 6. Self Review

- Spec coverage: Bug1 对应 Task 1；Bug2 对应 Task 2；Bug3 对应 Task 4；Bug4 对应 Task 3；Task 5 覆盖回归和文档收口。
- Placeholder scan: 本计划避免禁用占位词；每个任务都有明确文件、代码方向、命令和预期。
- Type consistency: `BlacklistedTag` 来自 `src/shared/types.ts`；`PaginationControl.disabled` 只在 Task 4 中新增并传递；`imageVersion` / `currentImageKey` 只在详情页内部使用。

## 7. Execution Handoff

Plan complete and saved to `doc/superpowers/plans/2026-06-08-booru-bug1-4-fix-spec.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
