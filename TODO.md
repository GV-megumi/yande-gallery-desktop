# Booru 标签页打磨 + 设置检查更新 — 执行计划

> **执行方式：** 使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐任务推进。步骤用 `- [ ]` 复选框追踪。
> **对应设计文档：** [docs/superpowers/specs/2026-04-11-booru-tag-pages-polish-design.md](docs/superpowers/specs/2026-04-11-booru-tag-pages-polish-design.md)

**目标：** 解决 Booru 收藏标签页 / 黑名单页的 7 个打磨问题，并在设置的关于 Tab 增加"检查更新"入口。

**架构方针：** 服务端新增搜索 + 分页能力，两个页面切到服务端驱动的 Table；抽出 `<BatchTagAddModal>` 和 `<ImportTagsDialog>` 两个共用组件；服务层加 `updateService` 走 GitHub Releases API；所有外部网络调用都在主进程。

**技术栈：** Electron 39 + React 18 + TypeScript + antd 5 + sqlite3 + vitest；renderer 走 `window.electronAPI` → preload contextBridge → main `ipcMain.handle`。

---

## 文件结构总览

**新建：**
- `src/renderer/components/BatchTagAddModal.tsx` — 共用批量添加对话框
- `src/renderer/components/ImportTagsDialog.tsx` — 共用导入对话框（两阶段：选站点 → 预览确认）
- `src/main/services/updateService.ts` — GitHub Releases 版本检查
- `tests/main/services/updateService.test.ts`
- `tests/renderer/components/BatchTagAddModal.test.tsx`
- `tests/renderer/components/ImportTagsDialog.test.tsx`

**修改：**
- `src/shared/types.ts` — 新增 `ListQueryParams` / `PaginatedResult` / `FavoriteTagImportRecord` / `BlacklistedTagImportRecord` / `UpdateCheckResult`
- `src/main/services/booruService.ts` — 改签名 `getFavoriteTags` / `getFavoriteTagsWithDownloadState` / `getBlacklistedTags`；扩展 `updateFavoriteTag` 接受 siteId；新增 `addFavoriteTagsBatch` / `importFavoriteTagsPickFile` / `importFavoriteTagsCommit` / `importBlacklistedTagsPickFile` / `importBlacklistedTagsCommit`；删除旧的一步 `importFavoriteTags` 和 `importBlacklistedTags`
- `src/main/ipc/channels.ts` — 新增 6 个 channel，删除旧 2 个
- `src/main/ipc/handlers.ts` — 更新 3 个 list handler 的参数；新增 6 个 handler；删除旧 2 个
- `src/preload/index.ts` — 同步签名
- `src/renderer/pages/FavoriteTagsPage.tsx` — 删快速搜索区、加工具栏搜索框、服务端分页、操作列 fixed:right、编辑弹窗 siteId 字段、批量添加按钮、接入 ImportTagsDialog
- `src/renderer/pages/BlacklistedTagsPage.tsx` — 加工具栏搜索框、服务端分页、迁移到 BatchTagAddModal、接入 ImportTagsDialog
- `src/renderer/pages/SettingsPage.tsx` — 关于 Tab 加检查更新按钮
- `tests/main/services/booruService.integration.test.ts` — 覆盖新的分页 / 搜索 / 批量添加 / updateFavoriteTag 校验

---

## Task 1: 共享类型扩展

**Files:**
- Modify: `src/shared/types.ts`（末尾追加）

- [ ] **Step 1：在 `src/shared/types.ts` 末尾追加新类型**

```typescript
// ========== 列表查询 / 分页 ==========

export interface ListQueryParams {
  /** undefined = 不过滤站点；null = 只查全局；number = 过滤该站点（含全局） */
  siteId?: number | null;
  /** 空字符串或 undefined 不搜索；非空走 COLLATE NOCASE 模糊匹配 */
  keyword?: string;
  /** 默认 0 */
  offset?: number;
  /** 默认 50；传 0 或不传 = 不分页但内部兜底 1000 */
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

// ========== 导入 ==========

export interface FavoriteTagImportRecord {
  tagName: string;
  /** 文件里显式包含的 siteId；undefined 代表未指定，由对话框兜底 */
  siteId?: number | null;
  labels?: string[];
  notes?: string;
  queryType?: 'tag' | 'raw' | 'list';
}

export interface BlacklistedTagImportRecord {
  tagName: string;
  siteId?: number | null;
  reason?: string;
}

export interface ImportPickFileResult<T> {
  /** 用户取消时为 true；其它字段无效 */
  cancelled: boolean;
  fileName?: string;
  records?: T[];
}

// ========== 更新检查 ==========

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  /** 拉取失败时的可读错误；成功时 null */
  error: string | null;
  /** 本次检查时刻 ISO 8601 */
  checkedAt: string;
}
```

- [ ] **Step 2：类型检查**

```bash
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.preload.json --noEmit
```
预期：无 error。

- [ ] **Step 3：提交**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add ListQueryParams, PaginatedResult, import and update types"
```

---

## Task 2: `getBlacklistedTags` 改为分页 + 搜索

**Files:**
- Modify: `src/main/services/booruService.ts:2358-2385`
- Test: `tests/main/services/booruService.integration.test.ts`

**背景：** 当前签名 `getBlacklistedTags(siteId?: number | null): Promise<BlacklistedTag[]>`。改成接受 `ListQueryParams`，返回 `PaginatedResult<BlacklistedTag>`，并 SQL 层加 `LIKE` 和 `LIMIT/OFFSET`。

- [ ] **Step 1：写失败的单测**

在 `tests/main/services/booruService.integration.test.ts` 的合适位置（和其它 getBlacklistedTags 测试相邻）追加：

```typescript
import { getBlacklistedTags } from '../../../src/main/services/booruService';
// 确保 state.blacklistedTags 在 mock 中存在，参考现有模式

describe('getBlacklistedTags — 分页与搜索', () => {
  beforeEach(() => {
    // 假设测试基础设施已 mock getDatabase + all，见文件头部
    state.blacklistedTags = [
      { id: 1, siteId: 1, tagName: 'aotsu_karin', reason: null, isActive: 1, createdAt: '2026-04-01' },
      { id: 2, siteId: 1, tagName: 'muku_apupop', reason: null, isActive: 1, createdAt: '2026-04-01' },
      { id: 3, siteId: null, tagName: 'kawaii_chibi', reason: null, isActive: 1, createdAt: '2026-04-01' },
      { id: 4, siteId: 2, tagName: 'another_site', reason: null, isActive: 1, createdAt: '2026-04-01' },
    ];
  });

  it('默认参数返回所有行和 total', async () => {
    const res = await getBlacklistedTags({});
    expect(res.total).toBe(4);
    expect(res.items.length).toBe(4);
  });

  it('keyword 模糊匹配且大小写不敏感', async () => {
    const res = await getBlacklistedTags({ keyword: 'MUKU' });
    expect(res.total).toBe(1);
    expect(res.items[0].tagName).toBe('muku_apupop');
  });

  it('siteId=1 过滤只返回该站点及全局行', async () => {
    const res = await getBlacklistedTags({ siteId: 1 });
    const names = res.items.map(t => t.tagName).sort();
    expect(names).toEqual(['aotsu_karin', 'kawaii_chibi', 'muku_apupop']);
    expect(res.total).toBe(3);
  });

  it('offset 和 limit 正确分页 total 不受影响', async () => {
    const res = await getBlacklistedTags({ offset: 1, limit: 2 });
    expect(res.total).toBe(4);
    expect(res.items.length).toBe(2);
  });

  it('keyword + siteId 组合过滤', async () => {
    const res = await getBlacklistedTags({ siteId: 1, keyword: 'karin' });
    expect(res.total).toBe(1);
    expect(res.items[0].tagName).toBe('aotsu_karin');
  });
});
```

- [ ] **Step 2：运行失败**

```bash
npx vitest run tests/main/services/booruService.integration.test.ts -t "分页与搜索"
```
预期：失败（新签名尚未实现）。

- [ ] **Step 3：实现**

替换 [src/main/services/booruService.ts:2358-2385](src/main/services/booruService.ts#L2358-L2385)：

```typescript
import type { ListQueryParams, PaginatedResult } from '../../shared/types';
// ↑ 如果文件头部 import 没有这两个类型，加上

export async function getBlacklistedTags(params: ListQueryParams = {}): Promise<PaginatedResult<BlacklistedTag>> {
  const { siteId, keyword, offset = 0, limit = 50 } = params;
  const effectiveLimit = (!limit || limit <= 0) ? 1000 : limit;
  console.log('[booruService] 获取黑名单标签列表:', { siteId, keyword, offset, limit: effectiveLimit });
  try {
    const db = await getDatabase();
    const where: string[] = [];
    const sqlParams: any[] = [];

    if (siteId !== undefined) {
      if (siteId === null) {
        where.push('siteId IS NULL');
      } else {
        where.push('(siteId = ? OR siteId IS NULL)');
        sqlParams.push(siteId);
      }
    }

    if (keyword && keyword.trim().length > 0) {
      where.push('tagName LIKE ? COLLATE NOCASE');
      sqlParams.push(`%${keyword.trim()}%`);
    }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

    const countRow = await get<{ cnt: number }>(
      db,
      `SELECT COUNT(*) as cnt FROM booru_blacklisted_tags${whereSql}`,
      sqlParams
    );
    const total = countRow?.cnt ?? 0;

    const rows = await all<any>(
      db,
      `SELECT * FROM booru_blacklisted_tags${whereSql} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
      [...sqlParams, effectiveLimit, Math.max(0, offset)]
    );

    const items = rows.map((tag: any) => ({ ...tag, isActive: Boolean(tag.isActive) }));
    console.log('[booruService] 获取到', items.length, '/', total, '个黑名单标签');
    return { items, total };
  } catch (error) {
    console.error('[booruService] 获取黑名单标签列表失败:', error);
    throw error;
  }
}
```

- [ ] **Step 4：同步更新所有内部调用点**

```bash
Grep: getBlacklistedTags\(
```
在 main / shared 下找到的每个调用点都要改成传对象。把 `getBlacklistedTags(siteId)` 改成 `(await getBlacklistedTags({ siteId, limit: 0 })).items` 或接受新返回结构。典型点：
- `src/main/ipc/handlers.ts` 的 2068 附近（BOORU_GET_BLACKLISTED_TAGS handler）
- `src/main/ipc/handlers.ts` 的 2967 附近（导出黑名单使用全量）
- `src/main/services/booruService.ts` 内部的 `getActiveBlacklistTagNames`（它是独立 SQL 不走这个函数，无需改）

对"需要全量"的场景（比如导出）改成：
```typescript
const { items: tags } = await booruService.getBlacklistedTags({ siteId, limit: 0 });
```

- [ ] **Step 5：运行测试通过**

```bash
npx vitest run tests/main/services/booruService.integration.test.ts
npx tsc -p tsconfig.main.json --noEmit
```
预期：全部通过，无类型错误。

- [ ] **Step 6：提交**

```bash
git add src/main/services/booruService.ts src/main/ipc/handlers.ts tests/main/services/booruService.integration.test.ts
git commit -m "feat(booruService): paginated getBlacklistedTags with keyword search"
```

---

## Task 3: `getFavoriteTags` 改为分页 + 搜索

**Files:**
- Modify: `src/main/services/booruService.ts:1550-1582`
- Test: `tests/main/services/booruService.integration.test.ts`

- [ ] **Step 1：写失败的单测**

```typescript
import { getFavoriteTags } from '../../../src/main/services/booruService';

describe('getFavoriteTags — 分页与搜索', () => {
  beforeEach(() => {
    state.favoriteTags = [
      { id: 1, siteId: 1, tagName: 'aoi_chizuru', labels: '[]', queryType: 'tag', notes: null, sortOrder: 1, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
      { id: 2, siteId: 1, tagName: 'gin', labels: '[]', queryType: 'tag', notes: null, sortOrder: 2, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
      { id: 3, siteId: null, tagName: 'hatsune_miku', labels: '[]', queryType: 'tag', notes: null, sortOrder: 3, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
      { id: 4, siteId: 2, tagName: 'eryuhe', labels: '[]', queryType: 'tag', notes: null, sortOrder: 4, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
    ];
  });

  it('默认参数返回所有行和 total', async () => {
    const res = await getFavoriteTags({});
    expect(res.total).toBe(4);
    expect(res.items.length).toBe(4);
  });

  it('keyword 搜索大小写不敏感', async () => {
    const res = await getFavoriteTags({ keyword: 'AOI' });
    expect(res.total).toBe(1);
    expect(res.items[0].tagName).toBe('aoi_chizuru');
  });

  it('siteId=1 含全局', async () => {
    const res = await getFavoriteTags({ siteId: 1 });
    expect(res.total).toBe(3);
  });

  it('siteId=null 只含全局', async () => {
    const res = await getFavoriteTags({ siteId: null });
    expect(res.total).toBe(1);
    expect(res.items[0].tagName).toBe('hatsune_miku');
  });

  it('分页切片正确', async () => {
    const res = await getFavoriteTags({ offset: 1, limit: 2 });
    expect(res.total).toBe(4);
    expect(res.items.length).toBe(2);
  });
});
```

- [ ] **Step 2：运行失败**

```bash
npx vitest run tests/main/services/booruService.integration.test.ts -t "getFavoriteTags — 分页"
```
预期：失败。

- [ ] **Step 3：实现**

替换 [src/main/services/booruService.ts:1550-1582](src/main/services/booruService.ts#L1550-L1582)：

```typescript
export async function getFavoriteTags(params: ListQueryParams = {}): Promise<PaginatedResult<FavoriteTag>> {
  const { siteId, keyword, offset = 0, limit = 50 } = params;
  const effectiveLimit = (!limit || limit <= 0) ? 1000 : limit;
  console.log('[booruService] 获取收藏标签列表:', { siteId, keyword, offset, limit: effectiveLimit });
  try {
    const db = await getDatabase();
    const where: string[] = [];
    const sqlParams: any[] = [];

    if (siteId !== undefined) {
      if (siteId === null) {
        where.push('siteId IS NULL');
      } else {
        where.push('(siteId = ? OR siteId IS NULL)');
        sqlParams.push(siteId);
      }
    }

    if (keyword && keyword.trim().length > 0) {
      where.push('tagName LIKE ? COLLATE NOCASE');
      sqlParams.push(`%${keyword.trim()}%`);
    }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

    const countRow = await get<{ cnt: number }>(
      db,
      `SELECT COUNT(*) as cnt FROM booru_favorite_tags${whereSql}`,
      sqlParams
    );
    const total = countRow?.cnt ?? 0;

    const rows = await all<any>(
      db,
      `SELECT * FROM booru_favorite_tags${whereSql} ORDER BY sortOrder ASC, createdAt DESC LIMIT ? OFFSET ?`,
      [...sqlParams, effectiveLimit, Math.max(0, offset)]
    );

    const items: FavoriteTag[] = rows.map(row => ({
      ...row,
      labels: row.labels ? JSON.parse(row.labels) : undefined,
    }));

    console.log('[booruService] 获取到', items.length, '/', total, '个收藏标签');
    return { items, total };
  } catch (error) {
    console.error('[booruService] 获取收藏标签列表失败:', error);
    throw error;
  }
}
```

- [ ] **Step 4：修复所有内部调用点**

```bash
Grep: getFavoriteTags\(
```
需要改的典型位置：
- `src/main/services/booruService.ts:1606` 的 `exportFavoriteTags` —— 改成 `const { items: favoriteTags } = await getFavoriteTags({ siteId, limit: 0 });`
- `src/main/services/booruService.ts:1766`（getFavoriteTagsWithDownloadState 内部）—— Task 4 会整体重写，先按新签名调用 `const { items: tags } = await getFavoriteTags({ siteId, limit: 0 });`
- `src/main/services/booruService.ts:1922`（copyFavoriteTagDownloadBindingsFromGlobalToSite 类似批量函数）—— 同上，全量拉时传 `limit: 0`
- `src/main/ipc/handlers.ts:1624` —— 下一个 Task (Task 5) 会改，先保证过渡代码不报错：`const result = await booruService.getFavoriteTags({ siteId, limit: 0 });`
- `src/main/ipc/handlers.ts:2825`（BOORU_EXPORT_FAVORITE_TAGS handler）—— `const { items: tags } = await booruService.getFavoriteTags({ siteId, limit: 0 });`
- `src/main/ipc/handlers.ts:2905`（`existingTags` 查重）—— `const { items: existingTags } = await booruService.getFavoriteTags({ limit: 0 });`

- [ ] **Step 5：运行测试通过**

```bash
npx vitest run tests/main/services/booruService.integration.test.ts
npx tsc -p tsconfig.main.json --noEmit
```
预期：全部通过。

- [ ] **Step 6：提交**

```bash
git add src/main/services/booruService.ts src/main/ipc/handlers.ts tests/main/services/booruService.integration.test.ts
git commit -m "feat(booruService): paginated getFavoriteTags with keyword search"
```

---

## Task 4: `getFavoriteTagsWithDownloadState` 改为分页 + 搜索

**Files:**
- Modify: `src/main/services/booruService.ts:1763`

**背景：** 这个函数内部调 `getFavoriteTags(siteId)` 然后给每行补下载状态。Task 3 改了签名后它当前是破的。这里让它直接接 `ListQueryParams` 透传给底层，并把返回改成 `PaginatedResult<FavoriteTagWithDownloadState>`。

- [ ] **Step 1：写失败的单测**

在 integration test 中追加：

```typescript
describe('getFavoriteTagsWithDownloadState — 分页与搜索透传', () => {
  beforeEach(() => {
    state.favoriteTags = [
      { id: 1, siteId: 1, tagName: 'aoi_chizuru', labels: '[]', queryType: 'tag', notes: null, sortOrder: 1, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
      { id: 2, siteId: 1, tagName: 'gin', labels: '[]', queryType: 'tag', notes: null, sortOrder: 2, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
    ];
    state.bindings = [];
  });

  it('返回 PaginatedResult 结构', async () => {
    const res = await getFavoriteTagsWithDownloadState({});
    expect(res).toHaveProperty('items');
    expect(res).toHaveProperty('total');
    expect(Array.isArray(res.items)).toBe(true);
    expect(res.total).toBe(2);
  });

  it('keyword 过滤', async () => {
    const res = await getFavoriteTagsWithDownloadState({ keyword: 'aoi' });
    expect(res.total).toBe(1);
    expect(res.items[0].tagName).toBe('aoi_chizuru');
  });

  it('分页不影响 binding 富化', async () => {
    state.bindings = [
      { id: 1, favoriteTagId: 1, galleryId: null, downloadPath: '', enabled: 1, lastStatus: 'idle' } as any,
    ];
    const res = await getFavoriteTagsWithDownloadState({ limit: 1, offset: 0 });
    expect(res.items.length).toBe(1);
    expect(res.items[0].id).toBe(1);
    expect(res.items[0].downloadBinding).toBeDefined();
  });
});
```

- [ ] **Step 2：运行失败**

```bash
npx vitest run tests/main/services/booruService.integration.test.ts -t "getFavoriteTagsWithDownloadState"
```
预期：失败。

- [ ] **Step 3：实现（修改 [src/main/services/booruService.ts:1763](src/main/services/booruService.ts#L1763)）**

把函数签名改成：

```typescript
export async function getFavoriteTagsWithDownloadState(params: ListQueryParams = {}): Promise<PaginatedResult<FavoriteTagWithDownloadState>> {
  console.log('[booruService] 获取收藏标签及下载状态:', params);
  try {
    const paginated = await getFavoriteTags(params);
    const { items: tags, total } = paginated;
    if (tags.length === 0) {
      return { items: [], total };
    }

    // ↓ 以下是原函数 body 从 "const db = await getDatabase()" 一直到最后 "return tags.map(..."
    //    把末尾的 return 换成 return { items: enriched, total }
    //    保留所有现有的 binding 富化 / runtime 状态 / gallery 绑定一致性检查逻辑
```

具体改动要点：
1. 函数第一行 `const tags = await getFavoriteTags(siteId);` 替换成 `const paginated = await getFavoriteTags(params); const { items: tags, total } = paginated;`
2. 函数底部的 `return tags.map(tag => { ... });` 改成先把 map 结果存到常量，然后 `return { items: enriched, total };`

完整示例（展示头和尾，中间不变）：

```typescript
export async function getFavoriteTagsWithDownloadState(params: ListQueryParams = {}): Promise<PaginatedResult<FavoriteTagWithDownloadState>> {
  console.log('[booruService] 获取收藏标签及下载状态:', params);
  try {
    const paginated = await getFavoriteTags(params);
    const { items: tags, total } = paginated;
    if (tags.length === 0) {
      return { items: [], total };
    }

    const db = await getDatabase();
    /* ...所有现有的 binding / gallery / runtime 富化逻辑保持不变... */

    const enriched: FavoriteTagWithDownloadState[] = tags.map(tag => {
      const bindingRow = bindingMap.get(tag.id);
      const binding = parseFavoriteTagDownloadBinding(bindingRow);
      /* ...现有富化字段计算... */
      return {
        ...tag,
        downloadBinding: binding,
        /* ...其它字段... */
      };
    });

    return { items: enriched, total };
  } catch (error) {
    console.error('[booruService] 获取收藏标签及下载状态失败:', error);
    throw error;
  }
}
```

- [ ] **Step 4：修复调用点**

```bash
Grep: getFavoriteTagsWithDownloadState
```
- `src/main/ipc/handlers.ts:1635` 由 Task 5 处理，此处暂改 `const result = await booruService.getFavoriteTagsWithDownloadState({ siteId, limit: 0 });`
- `src/main/services/booruService.ts:1922`（如果在用）同样传对象

- [ ] **Step 5：测试通过**

```bash
npx vitest run tests/main/services/booruService.integration.test.ts
npx tsc -p tsconfig.main.json --noEmit
```

- [ ] **Step 6：提交**

```bash
git add src/main/services/booruService.ts src/main/ipc/handlers.ts tests/main/services/booruService.integration.test.ts
git commit -m "feat(booruService): paginated getFavoriteTagsWithDownloadState"
```

---

## Task 5: 更新 3 个 list IPC handlers + preload 签名

**Files:**
- Modify: `src/main/ipc/handlers.ts:1624,1635,2068`
- Modify: `src/preload/index.ts`

- [ ] **Step 1：改 handler（`src/main/ipc/handlers.ts`）**

找到并替换三个 handler：

```typescript
// 1624 附近：BOORU_GET_FAVORITE_TAGS
ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS, async (_event, params: any = {}) => {
  console.log('[IPC] 获取收藏标签列表:', params);
  try {
    const result = await booruService.getFavoriteTags(params);
    return { success: true, data: result };
  } catch (error) {
    console.error('[IPC] 获取收藏标签列表失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// 1635 附近：BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE
ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE, async (_event, params: any = {}) => {
  console.log('[IPC] 获取收藏标签及下载状态:', params);
  try {
    const result = await booruService.getFavoriteTagsWithDownloadState(params);
    return { success: true, data: result };
  } catch (error) {
    console.error('[IPC] 获取收藏标签及下载状态失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// 2068 附近：BOORU_GET_BLACKLISTED_TAGS
ipcMain.handle(IPC_CHANNELS.BOORU_GET_BLACKLISTED_TAGS, async (_event, params: any = {}) => {
  console.log('[IPC] 获取黑名单标签列表:', params);
  try {
    const result = await booruService.getBlacklistedTags(params);
    return { success: true, data: result };
  } catch (error) {
    console.error('[IPC] 获取黑名单标签列表失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
```

- [ ] **Step 2：改 preload（`src/preload/index.ts`）**

找到 `getFavoriteTags` / `getFavoriteTagsWithDownloadState` / `getBlacklistedTags` 三个 booru 域的方法，替换签名。例：

```typescript
// booru 域内
getFavoriteTags: (params: import('../shared/types').ListQueryParams = {}) =>
  ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS, params),

getFavoriteTagsWithDownloadState: (params: import('../shared/types').ListQueryParams = {}) =>
  ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE, params),

getBlacklistedTags: (params: import('../shared/types').ListQueryParams = {}) =>
  ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_BLACKLISTED_TAGS, params),
```

同步更新 `declare global { interface Window { electronAPI: { ... } } }` 的类型声明区（`src/preload/index.ts` 末尾附近）：

```typescript
getFavoriteTags: (params?: import('../shared/types').ListQueryParams) => Promise<{ success: boolean; data?: import('../shared/types').PaginatedResult<FavoriteTag>; error?: string }>;
getFavoriteTagsWithDownloadState: (params?: import('../shared/types').ListQueryParams) => Promise<{ success: boolean; data?: import('../shared/types').PaginatedResult<FavoriteTagWithDownloadState>; error?: string }>;
getBlacklistedTags: (params?: import('../shared/types').ListQueryParams) => Promise<{ success: boolean; data?: import('../shared/types').PaginatedResult<BlacklistedTag>; error?: string }>;
```

- [ ] **Step 3：类型检查**

```bash
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.preload.json --noEmit
```
预期：main / preload 无 error。Renderer 会有 error（两个页面还在用旧签名），这些 error 在 Task 17 / 22 修复。

- [ ] **Step 4：提交**

```bash
git add src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "feat(ipc): list handlers accept ListQueryParams and return PaginatedResult"
```

---

## Task 6: `updateFavoriteTag` 支持修改 siteId + 校验

**Files:**
- Modify: `src/main/services/booruService.ts:2048-2095`
- Test: `tests/main/services/booruService.integration.test.ts`

- [ ] **Step 1：写失败的单测**

```typescript
import { updateFavoriteTag } from '../../../src/main/services/booruService';

describe('updateFavoriteTag — siteId 修改规则', () => {
  beforeEach(() => {
    state.favoriteTags = [
      { id: 1, siteId: null, tagName: 'global_tag', labels: '[]', queryType: 'tag', notes: null, sortOrder: 1, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
      { id: 2, siteId: 1, tagName: 'site1_tag', labels: '[]', queryType: 'tag', notes: null, sortOrder: 2, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
    ];
  });

  it('global (siteId=null) 可以升级到具体站点', async () => {
    await expect(updateFavoriteTag(1, { siteId: 1 })).resolves.not.toThrow();
    expect(state.favoriteTags.find(t => t.id === 1)!.siteId).toBe(1);
  });

  it('已绑定站点的不可改到另一个站点', async () => {
    await expect(updateFavoriteTag(2, { siteId: 3 })).rejects.toThrow(/不允许修改站点/);
  });

  it('已绑定站点的不可改回 global', async () => {
    await expect(updateFavoriteTag(2, { siteId: null })).rejects.toThrow(/不允许修改站点/);
  });

  it('updates 不含 siteId 时走原路径 (仅改 notes)', async () => {
    await expect(updateFavoriteTag(2, { notes: 'hello' })).resolves.not.toThrow();
    expect(state.favoriteTags.find(t => t.id === 2)!.notes).toBe('hello');
    expect(state.favoriteTags.find(t => t.id === 2)!.siteId).toBe(1);
  });

  it('global → global 是 no-op 成功', async () => {
    await expect(updateFavoriteTag(1, { siteId: null })).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2：运行失败**

```bash
npx vitest run tests/main/services/booruService.integration.test.ts -t "updateFavoriteTag — siteId"
```

- [ ] **Step 3：实现（修改 [src/main/services/booruService.ts:2048](src/main/services/booruService.ts#L2048)）**

把函数签名和头部校验改成：

```typescript
export async function updateFavoriteTag(
  id: number,
  updates: Partial<Pick<FavoriteTag, 'tagName' | 'labels' | 'queryType' | 'notes' | 'sortOrder' | 'siteId'>>
): Promise<void> {
  console.log('[booruService] 更新收藏标签:', id, updates);
  try {
    const db = await getDatabase();

    // ========== siteId 修改规则校验 ==========
    if (updates.siteId !== undefined) {
      const current = await get<{ siteId: number | null }>(
        db,
        'SELECT siteId FROM booru_favorite_tags WHERE id = ?',
        [id]
      );
      if (!current) {
        throw new Error('收藏标签不存在');
      }
      // 已绑定站点的标签不允许改站点（包括改回 null）
      if (current.siteId !== null && current.siteId !== updates.siteId) {
        throw new Error('已指派到具体站点的收藏标签不允许修改站点');
      }
      // global → global 是 no-op，删掉这个字段避免 UPDATE 语句空转
      if (current.siteId === null && updates.siteId === null) {
        delete (updates as any).siteId;
      }
    }

    const now = new Date().toISOString();
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.tagName !== undefined) {
      fields.push('tagName = ?'); values.push(updates.tagName);
    }
    if (updates.labels !== undefined) {
      fields.push('labels = ?'); values.push(JSON.stringify(updates.labels));
    }
    if (updates.queryType !== undefined) {
      fields.push('queryType = ?'); values.push(updates.queryType);
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?'); values.push(updates.notes);
    }
    if (updates.sortOrder !== undefined) {
      fields.push('sortOrder = ?'); values.push(updates.sortOrder);
    }
    if (updates.siteId !== undefined) {
      fields.push('siteId = ?'); values.push(updates.siteId);
    }

    if (fields.length === 0) {
      console.warn('[booruService] 没有需要更新的字段');
      return;
    }

    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);

    await run(db, `UPDATE booru_favorite_tags SET ${fields.join(', ')} WHERE id = ?`, values);
    console.log('[booruService] 更新收藏标签成功:', id);
  } catch (error) {
    console.error('[booruService] 更新收藏标签失败:', id, error);
    throw error;
  }
}
```

- [ ] **Step 4：测试通过**

```bash
npx vitest run tests/main/services/booruService.integration.test.ts
```

- [ ] **Step 5：提交**

```bash
git add src/main/services/booruService.ts tests/main/services/booruService.integration.test.ts
git commit -m "feat(booruService): updateFavoriteTag supports siteId with null-only gate"
```

---

## Task 7: `addFavoriteTagsBatch` 新服务函数

**Files:**
- Modify: `src/main/services/booruService.ts`（在 `addFavoriteTag` 附近追加）
- Test: `tests/main/services/booruService.integration.test.ts`

- [ ] **Step 1：写失败的单测**

```typescript
import { addFavoriteTagsBatch } from '../../../src/main/services/booruService';

describe('addFavoriteTagsBatch', () => {
  beforeEach(() => {
    state.favoriteTags = [
      { id: 1, siteId: 1, tagName: 'existing_tag', labels: '[]', queryType: 'tag', notes: null, sortOrder: 1, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
    ];
  });

  it('换行分隔的输入', async () => {
    const res = await addFavoriteTagsBatch('new_a\nnew_b\nnew_c', 1);
    expect(res).toEqual({ added: 3, skipped: 0 });
  });

  it('换行 + 逗号混合', async () => {
    const res = await addFavoriteTagsBatch('a, b\nc,d', 1);
    expect(res.added).toBe(4);
  });

  it('已存在跳过', async () => {
    const res = await addFavoriteTagsBatch('existing_tag\nnew_tag', 1);
    expect(res).toEqual({ added: 1, skipped: 1 });
  });

  it('输入内部重复只计一次', async () => {
    const res = await addFavoriteTagsBatch('new_x\nnew_x\nnew_y', 1);
    expect(res.added).toBe(2);
  });

  it('空输入 added=0', async () => {
    const res = await addFavoriteTagsBatch('   \n,  ,', 1);
    expect(res).toEqual({ added: 0, skipped: 0 });
  });

  it('siteId=null 添加为全局', async () => {
    await addFavoriteTagsBatch('global_tag', null);
    const added = state.favoriteTags.find(t => t.tagName === 'global_tag');
    expect(added).toBeDefined();
    expect(added!.siteId).toBeNull();
  });

  it('labels 字符串按逗号拆分传到每条记录', async () => {
    await addFavoriteTagsBatch('a\nb', 1, '角色, 风格');
    const a = state.favoriteTags.find(t => t.tagName === 'a');
    expect(JSON.parse(a!.labels as any)).toEqual(['角色', '风格']);
  });
});
```

- [ ] **Step 2：运行失败**

```bash
npx vitest run tests/main/services/booruService.integration.test.ts -t "addFavoriteTagsBatch"
```

- [ ] **Step 3：实现（在 `src/main/services/booruService.ts` 的 `addFavoriteTag` 函数之后追加）**

```typescript
export async function addFavoriteTagsBatch(
  tagString: string,
  siteId: number | null,
  labelsString?: string,
): Promise<{ added: number; skipped: number }> {
  console.log('[booruService] 批量添加收藏标签:', { siteId });
  const rawTags = tagString.split(/[\n,]/).map(s => s.trim()).filter(s => s.length > 0);
  const tags = Array.from(new Set(rawTags));
  const labels = labelsString
    ? labelsString.split(',').map(l => l.trim()).filter(Boolean)
    : undefined;

  let added = 0;
  let skipped = 0;

  for (const tagName of tags) {
    try {
      const exists = await isFavoriteTag(siteId, tagName);
      if (exists) {
        skipped += 1;
        continue;
      }
      await addFavoriteTag(siteId, tagName, { labels });
      added += 1;
    } catch (error) {
      console.error('[booruService] 批量添加收藏标签单条失败:', tagName, error);
      skipped += 1;
    }
  }

  console.log('[booruService] 批量添加完成:', { added, skipped });
  return { added, skipped };
}
```

同时在文件末尾的 `export { ... }` 聚合对象里加上 `addFavoriteTagsBatch`（参考现有 2644 附近）。

- [ ] **Step 4：测试通过**

```bash
npx vitest run tests/main/services/booruService.integration.test.ts
```

- [ ] **Step 5：提交**

```bash
git add src/main/services/booruService.ts tests/main/services/booruService.integration.test.ts
git commit -m "feat(booruService): addFavoriteTagsBatch for bulk favorites add"
```

---

## Task 8: IPC + preload 接入 `addFavoriteTagsBatch`

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1：加 channel**

`src/main/ipc/channels.ts` 在 `BOORU_*` 区块追加：

```typescript
BOORU_ADD_FAVORITE_TAGS_BATCH: 'booru:add-favorite-tags-batch',
```

- [ ] **Step 2：加 handler**

`src/main/ipc/handlers.ts` 在 `BOORU_ADD_FAVORITE_TAG` handler 附近追加：

```typescript
ipcMain.handle(IPC_CHANNELS.BOORU_ADD_FAVORITE_TAGS_BATCH, async (_event, tagString: string, siteId: number | null, labels?: string) => {
  console.log('[IPC] 批量添加收藏标签');
  try {
    const result = await booruService.addFavoriteTagsBatch(tagString, siteId, labels);
    return { success: true, data: result };
  } catch (error) {
    console.error('[IPC] 批量添加收藏标签失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
```

- [ ] **Step 3：加 preload 方法 + 类型声明**

`src/preload/index.ts` 在 booru 域的 `addFavoriteTag` 之后追加：

```typescript
addFavoriteTagsBatch: (tagString: string, siteId: number | null, labels?: string) =>
  ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_FAVORITE_TAGS_BATCH, tagString, siteId, labels),
```

在 `declare global` 的类型区域的 booru 域追加：

```typescript
addFavoriteTagsBatch: (tagString: string, siteId: number | null, labels?: string) => Promise<{ success: boolean; data?: { added: number; skipped: number }; error?: string }>;
```

- [ ] **Step 4：类型检查 + 提交**

```bash
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.preload.json --noEmit
git add src/main/ipc/channels.ts src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "feat(ipc): expose addFavoriteTagsBatch to renderer"
```

---

## Task 9: `importFavoriteTagsPickFile` + `importFavoriteTagsCommit` 服务函数

**Files:**
- Modify: `src/main/services/booruService.ts`（删除旧 `importFavoriteTags` 的 payload 版本保留作为 commit 基础；实际可以直接改写）
- Test: `tests/main/services/booruService.integration.test.ts`

**背景：** 旧流程是一个 handler 里 `dialog.showOpenDialog` → 读文件 → 解析 → commit（见 `src/main/ipc/handlers.ts:2879`）。拆成：
- `importFavoriteTagsPickFile()` — 弹文件对话框、读文件、解析、返回记录数组（不入库）
- `importFavoriteTagsCommit({ records, fallbackSiteId })` — 入库

现有 `booruService.importFavoriteTags(payload)` 签名已经是"接受记录数组"的 commit 形态。本 Task 的 Commit 函数其实就是它的封装。

- [ ] **Step 1：写 commit 的失败单测**

```typescript
import { importFavoriteTagsCommit } from '../../../src/main/services/booruService';

describe('importFavoriteTagsCommit', () => {
  beforeEach(() => {
    state.favoriteTags = [];
    state.favoriteTagLabels = [];
  });

  it('文件里显式 siteId 优先于 fallbackSiteId', async () => {
    const result = await importFavoriteTagsCommit({
      records: [
        { tagName: 'with_site', siteId: 2 },
        { tagName: 'without_site' },
      ],
      fallbackSiteId: 1,
    });
    expect(result.imported).toBe(2);
    const withSite = state.favoriteTags.find(t => t.tagName === 'with_site');
    const withoutSite = state.favoriteTags.find(t => t.tagName === 'without_site');
    expect(withSite!.siteId).toBe(2);
    expect(withoutSite!.siteId).toBe(1);
  });

  it('fallbackSiteId=null 时未指定的记录进全局', async () => {
    const result = await importFavoriteTagsCommit({
      records: [{ tagName: 'a' }, { tagName: 'b' }],
      fallbackSiteId: null,
    });
    expect(result.imported).toBe(2);
    expect(state.favoriteTags.every(t => t.siteId === null)).toBe(true);
  });

  it('已存在计入 skipped', async () => {
    state.favoriteTags = [{ id: 1, siteId: null, tagName: 'dup', labels: '[]', queryType: 'tag', notes: null, sortOrder: 1, createdAt: '2026-04-01', updatedAt: '2026-04-01' }];
    const result = await importFavoriteTagsCommit({
      records: [{ tagName: 'dup' }, { tagName: 'new' }],
      fallbackSiteId: null,
    });
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('records 为空返回 0/0', async () => {
    const result = await importFavoriteTagsCommit({ records: [], fallbackSiteId: null });
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
  });
});
```

- [ ] **Step 2：运行失败**

```bash
npx vitest run tests/main/services/booruService.integration.test.ts -t "importFavoriteTagsCommit"
```

- [ ] **Step 3：在 `src/main/services/booruService.ts` 追加 `importFavoriteTagsCommit`**

在现有 `importFavoriteTags` 函数之后（或替换它）追加：

```typescript
export async function importFavoriteTagsCommit(params: {
  records: FavoriteTagImportRecord[];
  fallbackSiteId: number | null;
}): Promise<{ imported: number; skipped: number }> {
  const { records, fallbackSiteId } = params;
  console.log('[booruService] importFavoriteTagsCommit 开始:', records.length, 'records, fallback:', fallbackSiteId);

  let imported = 0;
  let skipped = 0;

  for (const record of records) {
    try {
      const siteId = record.siteId !== undefined ? record.siteId : fallbackSiteId;
      const exists = await isFavoriteTag(siteId, record.tagName);
      if (exists) {
        skipped += 1;
        continue;
      }
      await addFavoriteTag(siteId, record.tagName, {
        labels: record.labels,
        queryType: record.queryType,
        notes: record.notes,
      });
      imported += 1;
    } catch (error) {
      console.error('[booruService] 导入单条失败:', record.tagName, error);
      skipped += 1;
    }
  }

  console.log('[booruService] importFavoriteTagsCommit 完成:', { imported, skipped });
  return { imported, skipped };
}
```

确保文件头 `import` 包含 `FavoriteTagImportRecord` from `../../shared/types`。

- [ ] **Step 4：追加 `importFavoriteTagsPickFile`**

这个函数要用到 electron `dialog` 和 node `fs/promises`。参考 [src/main/ipc/handlers.ts:2879-2879](src/main/ipc/handlers.ts#L2879) 现有实现的解析逻辑，搬到服务层：

```typescript
import { dialog } from 'electron';
import fs from 'fs/promises';
// ↑ 如文件头已 import 跳过

export async function importFavoriteTagsPickFile(): Promise<ImportPickFileResult<FavoriteTagImportRecord>> {
  console.log('[booruService] importFavoriteTagsPickFile 打开文件对话框');
  const result = await dialog.showOpenDialog({
    title: '选择收藏标签导入文件',
    filters: [
      { name: '支持的文件', extensions: ['json', 'txt'] },
      { name: 'JSON 文件', extensions: ['json'] },
      { name: '文本文件', extensions: ['txt'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || !result.filePaths.length) {
    return { cancelled: true };
  }

  const filePath = result.filePaths[0];
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  const content = await fs.readFile(filePath, 'utf-8');

  const records = parseFavoriteTagImportContent(content, filePath.toLowerCase().endsWith('.txt'));
  console.log('[booruService] 解析到', records.length, '条收藏标签记录');
  return { cancelled: false, fileName, records };
}

/** 内部辅助：解析文件内容为 FavoriteTagImportRecord[] */
function parseFavoriteTagImportContent(content: string, isTxt: boolean): FavoriteTagImportRecord[] {
  if (isTxt) {
    return content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#') && !l.startsWith('//'))
      .map(tagName => ({ tagName }));
  }

  const json = JSON.parse(content);
  const rawTags = Array.isArray(json)
    ? json
    : (json?.data?.favoriteTags ?? json?.favoriteTags ?? json?.tags ?? []);

  if (!Array.isArray(rawTags)) {
    throw new Error('JSON 文件格式不支持，需要顶层数组或 { favoriteTags: [...] } / { tags: [...] }');
  }

  return rawTags
    .map((raw: any): FavoriteTagImportRecord | null => {
      const tagName = typeof raw === 'string' ? raw : raw?.tagName ?? raw?.name;
      if (!tagName || typeof tagName !== 'string') return null;
      const record: FavoriteTagImportRecord = { tagName };
      if (raw && typeof raw === 'object') {
        if (raw.siteId !== undefined) record.siteId = raw.siteId;
        if (Array.isArray(raw.labels)) record.labels = raw.labels;
        if (typeof raw.notes === 'string') record.notes = raw.notes;
        if (raw.queryType === 'tag' || raw.queryType === 'raw' || raw.queryType === 'list') {
          record.queryType = raw.queryType;
        }
      }
      return record;
    })
    .filter((r): r is FavoriteTagImportRecord => r !== null);
}
```

- [ ] **Step 5：补充 parse 的单测**

```typescript
describe('parseFavoriteTagImportContent (indirect via importFavoriteTagsCommit)', () => {
  // 由于 parse 是 module-private，通过端到端测 pickFile 或单独 export 用于测试
  // 这里追加一个 export: export { parseFavoriteTagImportContent } 然后直接单测
});
```

在 service 文件末尾加：`export { parseFavoriteTagImportContent };` 专供测试。

测试：

```typescript
import { parseFavoriteTagImportContent } from '../../../src/main/services/booruService';

describe('parseFavoriteTagImportContent', () => {
  it('txt 按行解析跳过注释', () => {
    const result = parseFavoriteTagImportContent('tag_a\n# comment\n// comment\n\n  tag_b  ', true);
    expect(result).toEqual([{ tagName: 'tag_a' }, { tagName: 'tag_b' }]);
  });

  it('json 顶层数组', () => {
    const json = JSON.stringify([
      { tagName: 'a', siteId: 1, labels: ['x'] },
      { tagName: 'b' },
    ]);
    const result = parseFavoriteTagImportContent(json, false);
    expect(result).toEqual([
      { tagName: 'a', siteId: 1, labels: ['x'] },
      { tagName: 'b' },
    ]);
  });

  it('json { favoriteTags: [...] } 包装', () => {
    const json = JSON.stringify({ favoriteTags: [{ tagName: 'a' }] });
    const result = parseFavoriteTagImportContent(json, false);
    expect(result).toEqual([{ tagName: 'a' }]);
  });

  it('json 带 queryType', () => {
    const json = JSON.stringify([{ tagName: 'a', queryType: 'raw' }]);
    const result = parseFavoriteTagImportContent(json, false);
    expect(result[0].queryType).toBe('raw');
  });

  it('json 非法顶层抛错', () => {
    expect(() => parseFavoriteTagImportContent(JSON.stringify({ foo: 'bar' }), false))
      .toThrow(/格式不支持/);
  });
});
```

- [ ] **Step 6：运行所有测试通过**

```bash
npx vitest run tests/main/services/booruService.integration.test.ts
```

- [ ] **Step 7：提交**

```bash
git add src/main/services/booruService.ts tests/main/services/booruService.integration.test.ts
git commit -m "feat(booruService): split favorite tag import into pickFile + commit"
```

---

## Task 10: `importBlacklistedTagsPickFile` + `importBlacklistedTagsCommit`

**Files:**
- Modify: `src/main/services/booruService.ts`
- Test: `tests/main/services/booruService.integration.test.ts`

- [ ] **Step 1：写失败的单测**

```typescript
import { importBlacklistedTagsCommit, parseBlacklistedTagImportContent } from '../../../src/main/services/booruService';

describe('importBlacklistedTagsCommit', () => {
  beforeEach(() => { state.blacklistedTags = []; });

  it('fallbackSiteId 作用于未指定 siteId 的记录', async () => {
    const result = await importBlacklistedTagsCommit({
      records: [
        { tagName: 'a' },
        { tagName: 'b', siteId: 2 },
      ],
      fallbackSiteId: 1,
    });
    expect(result.imported).toBe(2);
    expect(state.blacklistedTags.find(t => t.tagName === 'a')!.siteId).toBe(1);
    expect(state.blacklistedTags.find(t => t.tagName === 'b')!.siteId).toBe(2);
  });

  it('records 的 reason 传到入库', async () => {
    await importBlacklistedTagsCommit({
      records: [{ tagName: 'a', reason: '不喜欢' }],
      fallbackSiteId: null,
    });
    expect(state.blacklistedTags[0].reason).toBe('不喜欢');
  });
});

describe('parseBlacklistedTagImportContent', () => {
  it('txt 按行解析', () => {
    expect(parseBlacklistedTagImportContent('tag_a\ntag_b', true))
      .toEqual([{ tagName: 'tag_a' }, { tagName: 'tag_b' }]);
  });

  it('json 顶层数组带 reason', () => {
    const json = JSON.stringify([{ tagName: 'a', reason: 'bad' }, { tagName: 'b' }]);
    expect(parseBlacklistedTagImportContent(json, false))
      .toEqual([{ tagName: 'a', reason: 'bad' }, { tagName: 'b' }]);
  });
});
```

- [ ] **Step 2：运行失败 → 实现 → 运行通过**

在 `src/main/services/booruService.ts` 追加：

```typescript
import type { BlacklistedTagImportRecord } from '../../shared/types';

export async function importBlacklistedTagsPickFile(): Promise<ImportPickFileResult<BlacklistedTagImportRecord>> {
  console.log('[booruService] importBlacklistedTagsPickFile 打开文件对话框');
  const result = await dialog.showOpenDialog({
    title: '选择黑名单导入文件',
    filters: [
      { name: '支持的文件', extensions: ['json', 'txt'] },
      { name: 'JSON 文件', extensions: ['json'] },
      { name: '文本文件', extensions: ['txt'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { cancelled: true };

  const filePath = result.filePaths[0];
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  const content = await fs.readFile(filePath, 'utf-8');
  const records = parseBlacklistedTagImportContent(content, filePath.toLowerCase().endsWith('.txt'));
  return { cancelled: false, fileName, records };
}

export function parseBlacklistedTagImportContent(content: string, isTxt: boolean): BlacklistedTagImportRecord[] {
  if (isTxt) {
    return content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#') && !l.startsWith('//'))
      .map(tagName => ({ tagName }));
  }
  const json = JSON.parse(content);
  const rawTags = Array.isArray(json) ? json : (json?.blacklistedTags ?? json?.tags ?? []);
  if (!Array.isArray(rawTags)) {
    throw new Error('JSON 文件格式不支持，需要顶层数组或 { blacklistedTags: [...] } / { tags: [...] }');
  }
  return rawTags
    .map((raw: any): BlacklistedTagImportRecord | null => {
      const tagName = typeof raw === 'string' ? raw : raw?.tagName ?? raw?.name;
      if (!tagName || typeof tagName !== 'string') return null;
      const record: BlacklistedTagImportRecord = { tagName };
      if (raw && typeof raw === 'object') {
        if (raw.siteId !== undefined) record.siteId = raw.siteId;
        if (typeof raw.reason === 'string') record.reason = raw.reason;
      }
      return record;
    })
    .filter((r): r is BlacklistedTagImportRecord => r !== null);
}

export async function importBlacklistedTagsCommit(params: {
  records: BlacklistedTagImportRecord[];
  fallbackSiteId: number | null;
}): Promise<{ imported: number; skipped: number }> {
  const { records, fallbackSiteId } = params;
  console.log('[booruService] importBlacklistedTagsCommit 开始:', records.length);
  let imported = 0;
  let skipped = 0;
  for (const record of records) {
    try {
      const siteId = record.siteId !== undefined ? record.siteId : fallbackSiteId;
      await addBlacklistedTag(record.tagName, siteId, record.reason);
      imported += 1;
    } catch (error: any) {
      if (error?.message?.includes('UNIQUE constraint')) {
        skipped += 1;
      } else {
        console.error('[booruService] 导入黑名单单条失败:', record.tagName, error);
        skipped += 1;
      }
    }
  }
  console.log('[booruService] importBlacklistedTagsCommit 完成:', { imported, skipped });
  return { imported, skipped };
}
```

把新函数加到文件末尾 export 聚合。`ImportPickFileResult` 从 shared/types 导入（Task 1 已定义）。

```bash
npx vitest run tests/main/services/booruService.integration.test.ts
git add src/main/services/booruService.ts tests/main/services/booruService.integration.test.ts
git commit -m "feat(booruService): split blacklist import into pickFile + commit"
```

---

## Task 11: IPC + preload 接入新 import，删除旧 handler

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1：`channels.ts` 新增 4 个、删除 2 个**

新增：
```typescript
BOORU_IMPORT_FAVORITE_TAGS_PICK_FILE: 'booru:import-favorite-tags-pick-file',
BOORU_IMPORT_FAVORITE_TAGS_COMMIT: 'booru:import-favorite-tags-commit',
BOORU_IMPORT_BLACKLISTED_TAGS_PICK_FILE: 'booru:import-blacklisted-tags-pick-file',
BOORU_IMPORT_BLACKLISTED_TAGS_COMMIT: 'booru:import-blacklisted-tags-commit',
```

删除：
```typescript
BOORU_IMPORT_FAVORITE_TAGS: 'booru:import-favorite-tags',
BOORU_IMPORT_BLACKLISTED_TAGS: 'booru:import-blacklisted-tags',
```

- [ ] **Step 2：`handlers.ts` 删除旧 handler + 新增 4 个**

删除 [src/main/ipc/handlers.ts:2879](src/main/ipc/handlers.ts#L2879) 的 `BOORU_IMPORT_FAVORITE_TAGS` handler 和 [src/main/ipc/handlers.ts:3010](src/main/ipc/handlers.ts#L3010) 的 `BOORU_IMPORT_BLACKLISTED_TAGS` handler。

在相近位置追加：

```typescript
ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_PICK_FILE, async () => {
  try {
    const result = await booruService.importFavoriteTagsPickFile();
    return { success: true, data: result };
  } catch (error) {
    console.error('[IPC] 选择导入文件失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_COMMIT, async (_event, payload: { records: any[]; fallbackSiteId: number | null }) => {
  try {
    const result = await booruService.importFavoriteTagsCommit(payload);
    return { success: true, data: result };
  } catch (error) {
    console.error('[IPC] 导入收藏标签失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_BLACKLISTED_TAGS_PICK_FILE, async () => {
  try {
    const result = await booruService.importBlacklistedTagsPickFile();
    return { success: true, data: result };
  } catch (error) {
    console.error('[IPC] 选择黑名单导入文件失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_BLACKLISTED_TAGS_COMMIT, async (_event, payload: { records: any[]; fallbackSiteId: number | null }) => {
  try {
    const result = await booruService.importBlacklistedTagsCommit(payload);
    return { success: true, data: result };
  } catch (error) {
    console.error('[IPC] 导入黑名单失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
```

- [ ] **Step 3：`preload/index.ts` 替换**

删除旧的 `importFavoriteTags` / `importBlacklistedTags` 两个 preload 方法及类型声明，新增：

```typescript
// booru 域方法
importFavoriteTagsPickFile: () =>
  ipcRenderer.invoke(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_PICK_FILE),
importFavoriteTagsCommit: (payload: { records: import('../shared/types').FavoriteTagImportRecord[]; fallbackSiteId: number | null }) =>
  ipcRenderer.invoke(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_COMMIT, payload),
importBlacklistedTagsPickFile: () =>
  ipcRenderer.invoke(IPC_CHANNELS.BOORU_IMPORT_BLACKLISTED_TAGS_PICK_FILE),
importBlacklistedTagsCommit: (payload: { records: import('../shared/types').BlacklistedTagImportRecord[]; fallbackSiteId: number | null }) =>
  ipcRenderer.invoke(IPC_CHANNELS.BOORU_IMPORT_BLACKLISTED_TAGS_COMMIT, payload),
```

`declare global` 类型区加对应声明：

```typescript
importFavoriteTagsPickFile: () => Promise<{ success: boolean; data?: import('../shared/types').ImportPickFileResult<import('../shared/types').FavoriteTagImportRecord>; error?: string }>;
importFavoriteTagsCommit: (payload: { records: import('../shared/types').FavoriteTagImportRecord[]; fallbackSiteId: number | null }) => Promise<{ success: boolean; data?: { imported: number; skipped: number }; error?: string }>;
importBlacklistedTagsPickFile: () => Promise<{ success: boolean; data?: import('../shared/types').ImportPickFileResult<import('../shared/types').BlacklistedTagImportRecord>; error?: string }>;
importBlacklistedTagsCommit: (payload: { records: import('../shared/types').BlacklistedTagImportRecord[]; fallbackSiteId: number | null }) => Promise<{ success: boolean; data?: { imported: number; skipped: number }; error?: string }>;
```

- [ ] **Step 4：类型检查 + 提交**

```bash
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.preload.json --noEmit
git add src/main/ipc/channels.ts src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "feat(ipc): split import handlers into pickFile + commit pair"
```

---

## Task 12: `updateService` 新文件 + 单测

**Files:**
- Create: `src/main/services/updateService.ts`
- Create: `tests/main/services/updateService.test.ts`

**背景：** 拉 GitHub Releases latest，比对版本。不走代理配置（保持简单），但走主进程 fetch（CLAUDE.md 第 1 条）。带 60s 缓存和 10s 超时。

- [ ] **Step 1：写 `tests/main/services/updateService.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkForUpdate, __resetCacheForTest, compareSemver } from '../../../src/main/services/updateService';

// mock app.getVersion
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.1' },
}));

describe('compareSemver', () => {
  it('数字段比较', () => {
    expect(compareSemver('0.0.2', '0.0.1')).toBeGreaterThan(0);
    expect(compareSemver('0.1.0', '0.0.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareSemver('0.0.1', '0.0.1')).toBe(0);
    expect(compareSemver('0.0.1', '0.0.2')).toBeLessThan(0);
  });

  it('去掉 v 前缀', () => {
    expect(compareSemver('v0.0.2', '0.0.1')).toBeGreaterThan(0);
  });

  it('补齐位数', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
  });
});

describe('checkForUpdate', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch as any;
    mockFetch.mockReset();
    __resetCacheForTest();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('发现新版本', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v0.0.2',
        name: 'Release 0.0.2',
        html_url: 'https://github.com/GV-megumi/yande-gallery-desktop/releases/tag/v0.0.2',
        published_at: '2026-04-11T12:00:00Z',
      }),
    });
    const result = await checkForUpdate();
    expect(result.currentVersion).toBe('0.0.1');
    expect(result.latestVersion).toBe('0.0.2');
    expect(result.hasUpdate).toBe(true);
    expect(result.releaseUrl).toContain('releases/tag/v0.0.2');
    expect(result.error).toBeNull();
  });

  it('已是最新', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v0.0.1',
        name: 'Release 0.0.1',
        html_url: 'https://github.com/GV-megumi/yande-gallery-desktop/releases/tag/v0.0.1',
        published_at: '2026-04-01T12:00:00Z',
      }),
    });
    const result = await checkForUpdate();
    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe('0.0.1');
  });

  it('404 网络错误', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not Found' }),
    });
    const result = await checkForUpdate();
    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('fetch 抛出异常', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ENETUNREACH'));
    const result = await checkForUpdate();
    expect(result.error).toContain('ENETUNREACH');
    expect(result.hasUpdate).toBe(false);
  });

  it('60 秒缓存：第二次不实际调 fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v0.0.2',
        name: 'Release 0.0.2',
        html_url: 'https://example.com',
        published_at: '2026-04-11T12:00:00Z',
      }),
    });
    await checkForUpdate();
    await checkForUpdate();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2：运行失败**

```bash
npx vitest run tests/main/services/updateService.test.ts
```
预期：找不到模块。

- [ ] **Step 3：实现 `src/main/services/updateService.ts`**

```typescript
import { app } from 'electron';
import type { UpdateCheckResult } from '../../shared/types';

const REPO_OWNER = 'GV-megumi';
const REPO_NAME = 'yande-gallery-desktop';
const CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;

let cachedResult: UpdateCheckResult | null = null;
let cachedAt = 0;

/** 测试用：重置缓存 */
export function __resetCacheForTest(): void {
  cachedResult = null;
  cachedAt = 0;
}

/**
 * 比较两个版本字符串。
 * 返回 > 0 表示 a > b，< 0 表示 a < b，0 表示相等。
 * 只支持 数字.数字.数字[.数字...] 的形态。v 前缀会被去掉。
 * 位数不同时补零。
 */
export function compareSemver(a: string, b: string): number {
  const norm = (s: string) => s.replace(/^v/i, '').split('.').map(p => parseInt(p, 10) || 0);
  const aa = norm(a);
  const bb = norm(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    const ai = aa[i] ?? 0;
    const bi = bb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const now = Date.now();
  if (cachedResult && (now - cachedAt) < CACHE_TTL_MS) {
    console.log('[updateService] 返回缓存的检查结果');
    return cachedResult;
  }

  const currentVersion = app.getVersion();
  const checkedAt = new Date().toISOString();
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'yande-gallery-desktop',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errorMsg = `GitHub API ${response.status}`;
      console.error('[updateService] 拉取 release 失败:', errorMsg);
      const result: UpdateCheckResult = {
        currentVersion,
        latestVersion: null,
        hasUpdate: false,
        releaseUrl: null,
        releaseName: null,
        publishedAt: null,
        error: errorMsg,
        checkedAt,
      };
      cachedResult = result;
      cachedAt = now;
      return result;
    }

    const json = await response.json() as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      published_at?: string;
    };

    const latestVersion = json.tag_name ? json.tag_name.replace(/^v/i, '') : null;
    const hasUpdate = latestVersion ? compareSemver(latestVersion, currentVersion) > 0 : false;

    const result: UpdateCheckResult = {
      currentVersion,
      latestVersion,
      hasUpdate,
      releaseUrl: json.html_url ?? null,
      releaseName: json.name ?? null,
      publishedAt: json.published_at ?? null,
      error: null,
      checkedAt,
    };
    cachedResult = result;
    cachedAt = now;
    console.log('[updateService] 检查完成:', { latestVersion, hasUpdate });
    return result;
  } catch (error: any) {
    clearTimeout(timer);
    const errorMsg = error?.name === 'AbortError' ? '请求超时' : (error?.message || String(error));
    console.error('[updateService] 检查更新失败:', errorMsg);
    const result: UpdateCheckResult = {
      currentVersion,
      latestVersion: null,
      hasUpdate: false,
      releaseUrl: null,
      releaseName: null,
      publishedAt: null,
      error: errorMsg,
      checkedAt,
    };
    cachedResult = result;
    cachedAt = now;
    return result;
  }
}
```

- [ ] **Step 4：测试通过**

```bash
npx vitest run tests/main/services/updateService.test.ts
```

- [ ] **Step 5：提交**

```bash
git add src/main/services/updateService.ts tests/main/services/updateService.test.ts
git commit -m "feat(updateService): GitHub Releases based update check with cache"
```

---

## Task 13: IPC + preload 接入 `checkForUpdate`

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1：加 channel**

`src/main/ipc/channels.ts` 在 `SYSTEM_*` 区块追加：
```typescript
SYSTEM_CHECK_FOR_UPDATE: 'system:check-for-update',
```

- [ ] **Step 2：加 handler**

在 `src/main/ipc/handlers.ts` 文件头部 import：
```typescript
import * as updateService from '../services/updateService';
```

在适合的位置追加：
```typescript
ipcMain.handle(IPC_CHANNELS.SYSTEM_CHECK_FOR_UPDATE, async () => {
  try {
    const result = await updateService.checkForUpdate();
    return { success: true, data: result };
  } catch (error) {
    console.error('[IPC] 检查更新失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
```

- [ ] **Step 3：加 preload 方法**

在 `src/preload/index.ts` 的 system 域追加：
```typescript
checkForUpdate: () =>
  ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_CHECK_FOR_UPDATE),
```

`declare global` 的 system 类型追加：
```typescript
checkForUpdate: () => Promise<{ success: boolean; data?: import('../shared/types').UpdateCheckResult; error?: string }>;
```

- [ ] **Step 4：类型检查 + 提交**

```bash
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.preload.json --noEmit
git add src/main/ipc/channels.ts src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "feat(ipc): expose system.checkForUpdate to renderer"
```

---

## Task 14: 共用组件 `<BatchTagAddModal>`

**Files:**
- Create: `src/renderer/components/BatchTagAddModal.tsx`
- Create: `tests/renderer/components/BatchTagAddModal.test.tsx`

- [ ] **Step 1：写失败的组件测试**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BatchTagAddModal } from '../../../src/renderer/components/BatchTagAddModal';

const sites = [
  { id: 1, name: 'yande' },
  { id: 2, name: 'danbooru' },
];

describe('BatchTagAddModal', () => {
  it('open=false 不渲染', () => {
    const { container } = render(
      <BatchTagAddModal
        open={false}
        title="批量添加"
        sites={sites}
        onCancel={() => {}}
        onSubmit={async () => {}}
      />
    );
    expect(container.querySelector('.ant-modal')).toBeNull();
  });

  it('open=true 渲染标题和三个字段', () => {
    render(
      <BatchTagAddModal
        open
        title="批量添加收藏标签"
        sites={sites}
        extraField={{ name: 'labels', label: '分组', placeholder: '例如: 角色' }}
        onCancel={() => {}}
        onSubmit={async () => {}}
      />
    );
    expect(screen.getByText('批量添加收藏标签')).toBeInTheDocument();
    expect(screen.getByLabelText(/所属站点/)).toBeInTheDocument();
    expect(screen.getByLabelText(/标签/)).toBeInTheDocument();
    expect(screen.getByLabelText(/分组/)).toBeInTheDocument();
  });

  it('空 tagNames 阻止提交', async () => {
    const onSubmit = vi.fn();
    render(
      <BatchTagAddModal open title="批量添加" sites={sites} onCancel={() => {}} onSubmit={onSubmit} />
    );
    await userEvent.click(screen.getByRole('button', { name: /保存/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/请至少输入一个标签/)).toBeInTheDocument();
  });

  it('提交后收到正确参数', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <BatchTagAddModal open title="批量添加" sites={sites} onCancel={() => {}} onSubmit={onSubmit} />
    );
    const textarea = screen.getByLabelText(/标签/);
    await userEvent.type(textarea, 'aoi\ngin');
    await userEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        tagNames: 'aoi\ngin',
        siteId: null,
      }));
    });
  });

  it('onSubmit pending 期间保存按钮 loading', async () => {
    let resolveSubmit: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>(r => { resolveSubmit = r; }));
    render(
      <BatchTagAddModal open title="批量添加" sites={sites} onCancel={() => {}} onSubmit={onSubmit} />
    );
    await userEvent.type(screen.getByLabelText(/标签/), 'a');
    await userEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /保存/ });
      expect(btn.querySelector('.ant-btn-loading-icon')).toBeTruthy();
    });
    resolveSubmit();
  });
});
```

- [ ] **Step 2：运行失败**

```bash
npx vitest run tests/renderer/components/BatchTagAddModal.test.tsx
```

- [ ] **Step 3：实现 `src/renderer/components/BatchTagAddModal.tsx`**

```typescript
import React, { useState } from 'react';
import { Modal, Form, Select, Input } from 'antd';

export interface BatchTagAddModalProps {
  open: boolean;
  title: string;
  sites: Array<{ id: number; name: string }>;
  extraField?: {
    name: string;
    label: string;
    placeholder?: string;
  };
  onCancel: () => void;
  onSubmit: (values: {
    tagNames: string;
    siteId: number | null;
    extra?: string;
  }) => Promise<void>;
}

export const BatchTagAddModal: React.FC<BatchTagAddModalProps> = ({
  open,
  title,
  sites,
  extraField,
  onCancel,
  onSubmit,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const handleCancel = () => {
    if (submitting) return;
    form.resetFields();
    onCancel();
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      try {
        await onSubmit({
          tagNames: values.tagNames,
          siteId: values.siteId ?? null,
          extra: extraField ? values[extraField.name] : undefined,
        });
        form.resetFields();
      } finally {
        setSubmitting(false);
      }
    } catch {
      // validateFields 失败：antd 会自动显示错误
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      width={480}
      onCancel={handleCancel}
      onOk={handleOk}
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      maskClosable={!submitting}
      keyboard={!submitting}
    >
      <Form form={form} layout="vertical" initialValues={{ siteId: null }}>
        <Form.Item name="siteId" label="所属站点">
          <Select
            options={[
              { label: '全局', value: null },
              ...sites.map(s => ({ label: s.name, value: s.id })),
            ]}
          />
        </Form.Item>
        <Form.Item
          name="tagNames"
          label="标签"
          rules={[
            {
              validator: async (_, value) => {
                const count = (value ?? '')
                  .split(/[\n,]/)
                  .map((s: string) => s.trim())
                  .filter(Boolean).length;
                if (count === 0) throw new Error('请至少输入一个标签');
              },
            },
          ]}
        >
          <Input.TextArea
            rows={6}
            placeholder={'支持换行或英文逗号分隔\n例如：\nhatsune miku\nrem, ram'}
          />
        </Form.Item>
        {extraField && (
          <Form.Item name={extraField.name} label={extraField.label}>
            <Input placeholder={extraField.placeholder} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
};
```

- [ ] **Step 4：测试通过**

```bash
npx vitest run tests/renderer/components/BatchTagAddModal.test.tsx
```

- [ ] **Step 5：提交**

```bash
git add src/renderer/components/BatchTagAddModal.tsx tests/renderer/components/BatchTagAddModal.test.tsx
git commit -m "feat(components): add shared BatchTagAddModal for favorites and blacklist"
```

---

## Task 15: 共用组件 `<ImportTagsDialog>`

**Files:**
- Create: `src/renderer/components/ImportTagsDialog.tsx`
- Create: `tests/renderer/components/ImportTagsDialog.test.tsx`

- [ ] **Step 1：写失败的组件测试**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportTagsDialog } from '../../../src/renderer/components/ImportTagsDialog';

const sites = [
  { id: 1, name: 'yande' },
  { id: 2, name: 'danbooru' },
];

describe('ImportTagsDialog', () => {
  it('初始未选站点时"选择文件"按钮禁用', () => {
    render(
      <ImportTagsDialog
        open
        title="导入收藏标签"
        sites={sites}
        onCancel={() => {}}
        onPickFile={vi.fn()}
        onCommit={vi.fn()}
        onImported={vi.fn()}
      />
    );
    const pickBtn = screen.getByRole('button', { name: /选择文件/ });
    expect(pickBtn).toBeDisabled();
  });

  it('选站点后按钮可用', async () => {
    render(
      <ImportTagsDialog
        open
        title="导入收藏标签"
        sites={sites}
        onCancel={() => {}}
        onPickFile={vi.fn()}
        onCommit={vi.fn()}
        onImported={vi.fn()}
      />
    );
    await userEvent.click(screen.getByLabelText(/兜底站点/));
    await userEvent.click(screen.getByText('全局'));
    expect(screen.getByRole('button', { name: /选择文件/ })).not.toBeDisabled();
  });

  it('pickFile 成功进入阶段 B 显示文件名和统计', async () => {
    const onPickFile = vi.fn().mockResolvedValue({
      success: true,
      data: {
        cancelled: false,
        fileName: 'tags.txt',
        records: [{ tagName: 'a' }, { tagName: 'b' }],
      },
    });
    render(
      <ImportTagsDialog
        open
        title="导入收藏标签"
        sites={sites}
        onCancel={() => {}}
        onPickFile={onPickFile}
        onCommit={vi.fn()}
        onImported={vi.fn()}
      />
    );
    await userEvent.click(screen.getByLabelText(/兜底站点/));
    await userEvent.click(screen.getByText('全局'));
    await userEvent.click(screen.getByRole('button', { name: /选择文件/ }));
    await waitFor(() => {
      expect(screen.getByText(/tags\.txt/)).toBeInTheDocument();
      expect(screen.getByText(/2.*条/)).toBeInTheDocument();
    });
  });

  it('pickFile 取消保持在阶段 A', async () => {
    const onPickFile = vi.fn().mockResolvedValue({
      success: true,
      data: { cancelled: true },
    });
    render(
      <ImportTagsDialog
        open
        title="导入"
        sites={sites}
        onCancel={() => {}}
        onPickFile={onPickFile}
        onCommit={vi.fn()}
        onImported={vi.fn()}
      />
    );
    await userEvent.click(screen.getByLabelText(/兜底站点/));
    await userEvent.click(screen.getByText('全局'));
    await userEvent.click(screen.getByRole('button', { name: /选择文件/ }));
    await waitFor(() => {
      expect(screen.queryByText(/条记录/)).toBeNull();
    });
  });

  it('commit 成功调 onImported 并关闭', async () => {
    const onPickFile = vi.fn().mockResolvedValue({
      success: true,
      data: { cancelled: false, fileName: 'a.txt', records: [{ tagName: 'a' }] },
    });
    const onCommit = vi.fn().mockResolvedValue({
      success: true,
      data: { imported: 1, skipped: 0 },
    });
    const onImported = vi.fn();
    render(
      <ImportTagsDialog
        open
        title="导入"
        sites={sites}
        onCancel={() => {}}
        onPickFile={onPickFile}
        onCommit={onCommit}
        onImported={onImported}
      />
    );
    await userEvent.click(screen.getByLabelText(/兜底站点/));
    await userEvent.click(screen.getByText('全局'));
    await userEvent.click(screen.getByRole('button', { name: /选择文件/ }));
    await waitFor(() => screen.getByText(/a\.txt/));
    await userEvent.click(screen.getByRole('button', { name: /确认导入/ }));
    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith({ imported: 1, skipped: 0 });
    });
  });
});
```

- [ ] **Step 2：运行失败**

```bash
npx vitest run tests/renderer/components/ImportTagsDialog.test.tsx
```

- [ ] **Step 3：实现 `src/renderer/components/ImportTagsDialog.tsx`**

```typescript
import React, { useMemo, useState } from 'react';
import { Modal, Select, Button, Alert, Space, Table } from 'antd';
import type { FavoriteTagImportRecord, BlacklistedTagImportRecord, ImportPickFileResult } from '../../shared/types';

type AnyRecord = FavoriteTagImportRecord | BlacklistedTagImportRecord;

export interface ImportTagsDialogProps<T extends AnyRecord = AnyRecord> {
  open: boolean;
  title: string;
  sites: Array<{ id: number; name: string }>;
  onCancel: () => void;
  onPickFile: () => Promise<{
    success: boolean;
    data?: ImportPickFileResult<T>;
    error?: string;
  }>;
  onCommit: (params: {
    records: T[];
    fallbackSiteId: number | null;
  }) => Promise<{
    success: boolean;
    data?: { imported: number; skipped: number };
    error?: string;
  }>;
  onImported: (result: { imported: number; skipped: number }) => void;
}

type Stage = 'pickSite' | 'preview';

export function ImportTagsDialog<T extends AnyRecord>({
  open,
  title,
  sites,
  onCancel,
  onPickFile,
  onCommit,
  onImported,
}: ImportTagsDialogProps<T>) {
  const [stage, setStage] = useState<Stage>('pickSite');
  const [fallbackSiteId, setFallbackSiteId] = useState<number | null | undefined>(undefined);
  const [fileName, setFileName] = useState<string>('');
  const [records, setRecords] = useState<T[]>([]);
  const [picking, setPicking] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStage('pickSite');
    setFallbackSiteId(undefined);
    setFileName('');
    setRecords([]);
    setError(null);
    setPicking(false);
    setCommitting(false);
  };

  const handleCancel = () => {
    if (committing) return;
    reset();
    onCancel();
  };

  const handlePickFile = async () => {
    setError(null);
    setPicking(true);
    try {
      const res = await onPickFile();
      if (!res.success) {
        setError(res.error || '选择文件失败');
        return;
      }
      if (!res.data || res.data.cancelled) {
        return;
      }
      setFileName(res.data.fileName || '');
      setRecords((res.data.records || []) as T[]);
      setStage('preview');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setPicking(false);
    }
  };

  const handleCommit = async () => {
    setError(null);
    setCommitting(true);
    try {
      const res = await onCommit({
        records,
        fallbackSiteId: (fallbackSiteId ?? null) as number | null,
      });
      if (!res.success) {
        setError(res.error || '导入失败');
        return;
      }
      if (res.data) {
        onImported(res.data);
      }
      reset();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setCommitting(false);
    }
  };

  const { withFileSiteId, usingFallback } = useMemo(() => {
    let a = 0;
    let b = 0;
    for (const r of records) {
      if (r.siteId !== undefined) a += 1;
      else b += 1;
    }
    return { withFileSiteId: a, usingFallback: b };
  }, [records]);

  const fallbackName = fallbackSiteId === null
    ? '全局'
    : (sites.find(s => s.id === fallbackSiteId)?.name ?? '未选择');

  return (
    <Modal
      open={open}
      title={title}
      width={560}
      onCancel={handleCancel}
      footer={null}
      maskClosable={!committing}
      keyboard={!committing}
    >
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />}

      {stage === 'pickSite' && (
        <div>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="未指定 siteId 的记录将被分配到所选站点。文件中显式包含 siteId 的记录会保留其原值。"
          />
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 6 }}>兜底站点</label>
            <Select
              style={{ width: '100%' }}
              placeholder="必须选择"
              value={fallbackSiteId as any}
              onChange={(v) => setFallbackSiteId(v)}
              options={[
                { label: '全局', value: null },
                ...sites.map(s => ({ label: s.name, value: s.id })),
              ]}
            />
          </div>
          <Space style={{ marginTop: 8 }}>
            <Button onClick={handleCancel}>取消</Button>
            <Button
              type="primary"
              loading={picking}
              disabled={fallbackSiteId === undefined}
              onClick={handlePickFile}
            >
              选择文件
            </Button>
          </Space>
        </div>
      )}

      {stage === 'preview' && (
        <div>
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 12 }}
            message={`已读取文件 ${fileName}`}
            description={`将导入 ${records.length} 条标签（其中 ${withFileSiteId} 条来自文件自带 siteId，${usingFallback} 条使用兜底站点 "${fallbackName}"）`}
          />
          <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 4, marginBottom: 12 }}>
            <Table
              size="small"
              rowKey={(r: any, idx) => `${r.tagName}-${idx}`}
              pagination={false}
              dataSource={records.slice(0, 100) as any}
              columns={[
                { title: '标签', dataIndex: 'tagName', key: 'tagName' },
                {
                  title: '站点',
                  key: 'siteId',
                  render: (_, r: any) => {
                    const sid = r.siteId;
                    if (sid === undefined) return <span style={{ color: '#999' }}>兜底: {fallbackName}</span>;
                    if (sid === null) return '全局';
                    return sites.find(s => s.id === sid)?.name ?? `#${sid}`;
                  },
                },
              ]}
            />
          </div>
          <Space>
            <Button onClick={() => setStage('pickSite')} disabled={committing}>返回</Button>
            <Button type="primary" loading={committing} onClick={handleCommit}>确认导入</Button>
          </Space>
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4：测试通过**

```bash
npx vitest run tests/renderer/components/ImportTagsDialog.test.tsx
```

- [ ] **Step 5：提交**

```bash
git add src/renderer/components/ImportTagsDialog.tsx tests/renderer/components/ImportTagsDialog.test.tsx
git commit -m "feat(components): add shared ImportTagsDialog with site picker"
```

---

## Task 16: `FavoriteTagsPage` 删快速搜索区 + 搜索框 + 服务端分页 + fixed 列

**Files:**
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx`

**背景：** 本 Task 把页面切到服务端数据模式，同时完成 TODO 第 1、2 项。为减少 diff 难度，分成 4 个 commit。

- [ ] **Step 1：加新 state + 重写 `loadFavoriteTags`**

在 `useState` 区域追加：

```typescript
const [keyword, setKeyword] = useState('');
const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState(20);
const [total, setTotal] = useState(0);
```

把现有的 `loadFavoriteTags` 函数替换为：

```typescript
const loadFavoriteTags = useCallback(async () => {
  setLoading(true);
  try {
    const offset = (page - 1) * pageSize;
    const result = await window.electronAPI.booru.getFavoriteTagsWithDownloadState({
      siteId: filterSiteId,
      keyword: keyword.trim() || undefined,
      offset,
      limit: pageSize,
    });
    if (result.success && result.data) {
      setFavoriteTags(result.data.items);
      setTotal(result.data.total);
      console.log('[FavoriteTagsPage] 加载收藏标签:', result.data.items.length, '/', result.data.total);
    } else {
      message.error(`${t('common.failed')}: ${result.error}`);
    }
  } catch (error) {
    console.error('[FavoriteTagsPage] 加载收藏标签失败:', error);
    message.error(t('common.failed'));
  } finally {
    setLoading(false);
  }
}, [filterSiteId, keyword, page, pageSize, t]);
```

在 `useEffect` 中让 `loadFavoriteTags` 的依赖触发重载：

```typescript
useEffect(() => {
  loadFavoriteTags();
}, [loadFavoriteTags]);
```

- [ ] **Step 2：工具栏加搜索框，删掉快速搜索 Card**

找到 [src/renderer/pages/FavoriteTagsPage.tsx:855-866](src/renderer/pages/FavoriteTagsPage.tsx#L855-L866) 的"快速搜索" Card（`<Card size="small" ... title={t('favoriteTags.quickSearch')}>`），**整块删除**。

在工具栏 Card 内的站点筛选 Select 之后加搜索框（用 `Input.Search` 或普通 `Input` + icon）：

```typescript
<Input
  placeholder={t('favoriteTags.searchPlaceholder') || '搜索标签'}
  allowClear
  prefix={<SearchOutlined />}
  value={keyword}
  onChange={(e) => {
    setKeyword(e.target.value);
    setPage(1);
  }}
  style={{ width: 240 }}
/>
```

站点筛选 Select 的 onChange 也改成 `setPage(1)`：

```typescript
<Select
  value={filterSiteId}
  onChange={(v) => { setFilterSiteId(v); setPage(1); }}
  /* ...其它 props 不变... */
/>
```

- [ ] **Step 3：Table 改为服务端分页 + 操作列 fixed:right + scroll.x**

找到 [src/renderer/pages/FavoriteTagsPage.tsx:900-908](src/renderer/pages/FavoriteTagsPage.tsx#L900-L908) 的 `<Table>` 配置，替换为：

```typescript
<Table
  dataSource={favoriteTags}
  columns={columns}
  rowKey="id"
  loading={loading}
  scroll={{ x: 1600 }}
  pagination={{
    current: page,
    pageSize,
    total,
    showSizeChanger: true,
    pageSizeOptions: ['20', '50', '100'],
    onChange: (p, ps) => { setPage(p); setPageSize(ps); },
  }}
  locale={{ emptyText: <Empty description={t('favoriteTags.noTags')} /> }}
  components={{ body: { row: SortableRow } }}
/>
```

找到 `columns` 定义（搜 `const columns: TableColumnsType`），给最后一个列（操作列）加：

```typescript
{
  title: t('common.operation'),
  key: 'operation',
  fixed: 'right',  // ← 新增
  width: 240,       // ← 新增（根据实际图标数调整）
  render: (_: any, record: FavoriteTagWithDownloadState) => (
    /* 现有的操作 icon 组 */
  ),
}
```

- [ ] **Step 4：搜索框 debounce**

为了避免每按一个字符就请求一次，把 `keyword` 的变化走 300ms debounce：

```typescript
// state 区加一个 debounced 版本
const [debouncedKeyword, setDebouncedKeyword] = useState('');

useEffect(() => {
  const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
  return () => clearTimeout(timer);
}, [keyword]);
```

`loadFavoriteTags` 的依赖和 URL 里用 `debouncedKeyword` 替代 `keyword`：

```typescript
const result = await window.electronAPI.booru.getFavoriteTagsWithDownloadState({
  siteId: filterSiteId,
  keyword: debouncedKeyword.trim() || undefined,
  offset,
  limit: pageSize,
});
// useCallback 依赖替换
}, [filterSiteId, debouncedKeyword, page, pageSize, t]);
```

- [ ] **Step 5：类型检查 + dev 冒烟**

```bash
npx tsc -p tsconfig.renderer.json --noEmit
# 无 renderer tsconfig 时用 npx tsc -p tsconfig.json --noEmit
npm run dev
```

手动验证：
- 窗口宽度 1251px 下操作列始终贴右可见
- 快速搜索 chip 区消失
- 搜索框输入后过滤
- 站点筛选 → 第 1 页
- 分页切换正常

- [ ] **Step 6：提交**

```bash
git add src/renderer/pages/FavoriteTagsPage.tsx
git commit -m "feat(FavoriteTagsPage): server-side pagination + search, fixed action column"
```

---

## Task 17: `FavoriteTagsPage` 编辑弹窗支持修改 siteId

**Files:**
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx:1066-1082` (编辑 Modal)
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx:280-299` (`handleEdit`)

- [ ] **Step 1：编辑 Modal 加 siteId 字段**

找到编辑 Modal（搜 `favoriteTags.editTitle`），在 `<Form form={form} layout="vertical" onFinish={handleEdit}>` 第一个 Form.Item 之前追加：

```typescript
<Form.Item name="siteId" label={t('favoriteTags.site')}>
  {editingTag?.siteId == null ? (
    <Select
      placeholder={t('favoriteTags.sitePlaceholder')}
      allowClear={false}
      options={[
        { label: t('favoriteTags.global'), value: null },
        ...sites.map(s => ({ label: s.name, value: s.id })),
      ]}
    />
  ) : (
    <Tooltip title="已指派到具体站点，无法修改">
      <Select
        disabled
        value={editingTag.siteId}
        options={sites.map(s => ({ label: s.name, value: s.id }))}
      />
    </Tooltip>
  )}
</Form.Item>
```

- [ ] **Step 2：`handleEdit` 改造，只在 siteId 升级场景下传 siteId**

替换 [src/renderer/pages/FavoriteTagsPage.tsx:280-299](src/renderer/pages/FavoriteTagsPage.tsx#L280-L299) 的 `handleEdit`：

```typescript
const handleEdit = async (values: any) => {
  if (!editingTag) return;
  try {
    const updates: any = {
      notes: values.notes || undefined,
      labels: values.labels
        ? values.labels.split(',').map((l: string) => l.trim()).filter(Boolean)
        : undefined,
    };
    // 只有当前是 global 且选了具体站点时才传 siteId
    if (editingTag.siteId == null && values.siteId != null) {
      updates.siteId = values.siteId;
    }
    const result = await window.electronAPI.booru.updateFavoriteTag(editingTag.id, updates);
    if (result.success) {
      message.success(t('favoriteTags.updateSuccess'));
      setEditingTag(null);
      form.resetFields();
      loadFavoriteTags();
    } else {
      message.error(`${t('common.failed')}: ${result.error}`);
    }
  } catch (error) {
    console.error('[FavoriteTagsPage] 编辑收藏标签失败:', error);
    message.error(t('common.failed'));
  }
};
```

找到打开编辑弹窗的地方（搜 `setEditingTag(` 行级操作里），确保 Form 初始值设置了 siteId：

```typescript
{
  icon: <EditOutlined />,
  title: t('common.edit'),
  onClick: () => {
    setEditingTag(record);
    form.setFieldsValue({
      labels: record.labels?.join(', '),
      notes: record.notes,
      siteId: record.siteId,
    });
  },
}
```

- [ ] **Step 3：类型检查 + 冒烟**

```bash
npx tsc -p tsconfig.json --noEmit
npm run dev
```

手动验证：
- 全局标签编辑：siteId Select 可选，选择后保存成功，表格该行所属站点变化
- 已有站点的标签编辑：siteId Select 禁用，显示当前站点
- 已有站点的标签点编辑后提交：不会触发 siteId 相关的后端校验（因为 updates 不含 siteId）

- [ ] **Step 4：提交**

```bash
git add src/renderer/pages/FavoriteTagsPage.tsx
git commit -m "feat(FavoriteTagsPage): edit modal supports promoting global tags to a site"
```

---

## Task 18: `FavoriteTagsPage` 批量添加按钮 + 接入 BatchTagAddModal

**Files:**
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx`

- [ ] **Step 1：引入组件 + 新增 state**

在文件头 import 区追加：

```typescript
import { BatchTagAddModal } from '../components/BatchTagAddModal';
```

state 区追加：

```typescript
const [batchAddModalOpen, setBatchAddModalOpen] = useState(false);
```

- [ ] **Step 2：工具栏按钮组追加"批量添加"按钮**

在现有"添加收藏"按钮之后：

```typescript
<Button
  icon={<PlusOutlined />}
  onClick={() => setBatchAddModalOpen(true)}
>
  批量添加
</Button>
```

- [ ] **Step 3：在 return 的 Modal 区追加 `<BatchTagAddModal>`**

```typescript
<BatchTagAddModal
  open={batchAddModalOpen}
  title="批量添加收藏标签"
  sites={sites}
  extraField={{
    name: 'labels',
    label: '分组（逗号分隔）',
    placeholder: '例如: 角色, 风格',
  }}
  onCancel={() => setBatchAddModalOpen(false)}
  onSubmit={async (values) => {
    const result = await window.electronAPI.booru.addFavoriteTagsBatch(
      values.tagNames,
      values.siteId,
      values.extra || undefined
    );
    if (result.success && result.data) {
      message.success(`已添加 ${result.data.added} 个标签，跳过 ${result.data.skipped} 个`);
      setBatchAddModalOpen(false);
      loadFavoriteTags();
    } else {
      message.error(`${t('common.failed')}: ${result.error}`);
      throw new Error(result.error || 'failed');
    }
  }}
/>
```

- [ ] **Step 4：类型检查 + 冒烟 + 提交**

```bash
npx tsc -p tsconfig.json --noEmit
npm run dev
```

手动验证：点击"批量添加"打开对话框，输入多行 tag + 站点 + 分组，保存后 toast 显示 added/skipped 数字，表格刷新。

```bash
git add src/renderer/pages/FavoriteTagsPage.tsx
git commit -m "feat(FavoriteTagsPage): batch add button wiring BatchTagAddModal"
```

---

## Task 19: `FavoriteTagsPage` 接入 `<ImportTagsDialog>`

**Files:**
- Modify: `src/renderer/pages/FavoriteTagsPage.tsx`

**背景：** 替换掉现有的 import 按钮行为 + 旧的 `importPreviewVisible` Modal + drag-drop/paste 流程统一走新对话框。

- [ ] **Step 1：import 组件 + 加 state**

```typescript
import { ImportTagsDialog } from '../components/ImportTagsDialog';

// state 区
const [importDialogOpen, setImportDialogOpen] = useState(false);
```

- [ ] **Step 2：改"导入"按钮 onClick**

找到工具栏"导入"按钮（搜 `t('common.import')` 附近），把 onClick 从调 `importFavoriteTags()` 改成：

```typescript
<Button
  icon={<ImportOutlined />}
  onClick={() => setImportDialogOpen(true)}
>
  {t('common.import')}
</Button>
```

- [ ] **Step 3：渲染 `<ImportTagsDialog>`**

```typescript
<ImportTagsDialog
  open={importDialogOpen}
  title="导入收藏标签"
  sites={sites}
  onCancel={() => setImportDialogOpen(false)}
  onPickFile={() => window.electronAPI.booru.importFavoriteTagsPickFile()}
  onCommit={(payload) => window.electronAPI.booru.importFavoriteTagsCommit(payload)}
  onImported={(result) => {
    message.success(`已导入 ${result.imported} 个标签，跳过 ${result.skipped} 个`);
    setImportDialogOpen(false);
    loadFavoriteTags();
  }}
/>
```

- [ ] **Step 4：删除旧的 import 预览 Modal 和相关 state**

删除 [src/renderer/pages/FavoriteTagsPage.tsx:1085-1130](src/renderer/pages/FavoriteTagsPage.tsx#L1085-L1130) 的 `importPreviewVisible` Modal 整块；删除相关 state：

```typescript
// 删除：
const [importPreviewVisible, setImportPreviewVisible] = useState(false);
const [importPreviewTags, setImportPreviewTags] = useState<string[]>([]);
const [importCheckedTags, setImportCheckedTags] = useState(new Set<string>());
const [importing, setImporting] = useState(false);
```

删除 `handleImportSelected` 函数（[src/renderer/pages/FavoriteTagsPage.tsx:390-412](src/renderer/pages/FavoriteTagsPage.tsx#L390-L412)）。

删除 `parseTagsFromContent`、`showImportPreview`、drag/drop handlers、paste effect —— **除非**你要保留 drag-drop/paste 功能。

**本计划的方案：保留 drag-drop / paste，但它们统一走新对话框。** 修改它们的行为：

```typescript
const handleDrop = useCallback(async (e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  setIsDragging(false);
  // 不再直接解析，改为打开 ImportTagsDialog 由用户重新选文件
  // 或者：保留旧行为直接解析内容并跳到预览阶段 —— 需要 ImportTagsDialog 暴露 "pre-seed" 能力
  // 为 YAGNI，本次直接打开对话框，用户重新选文件
  setImportDialogOpen(true);
}, []);
```

paste effect 同理简化为"打开对话框"。

**决策：** drag-drop/paste 不再自动解析内容，点击后统一打开 import 对话框让用户显式选站点 + 选文件。这和"第 5 项"的核心诉求一致。

删除 `parseTagsFromContent` / `showImportPreview`（不再使用）。

- [ ] **Step 5：类型检查 + 冒烟 + 提交**

```bash
npx tsc -p tsconfig.json --noEmit
npm run dev
```

手动验证：
- 点击"导入"按钮 → 新对话框出现 → 未选站点时"选择文件"禁用 → 选"全局"后按钮可用 → 选 txt 文件 → 预览 → 确认 → 列表刷新
- 选"yande"站点 + txt 文件 → 导入结果里标签全在 yande 下
- 选 json 文件（包含部分带 siteId 的记录）→ 预览里显示"兜底 X 条 / 文件 Y 条" → 确认后带 siteId 的进自己的站点

```bash
git add src/renderer/pages/FavoriteTagsPage.tsx
git commit -m "feat(FavoriteTagsPage): replace legacy import flow with ImportTagsDialog"
```

---

## Task 20: `BlacklistedTagsPage` 工具栏搜索框 + 服务端分页

**Files:**
- Modify: `src/renderer/pages/BlacklistedTagsPage.tsx`

- [ ] **Step 1：加 state + 重写 loadBlacklistedTags**

```typescript
const [keyword, setKeyword] = useState('');
const [debouncedKeyword, setDebouncedKeyword] = useState('');
const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState(20);
const [total, setTotal] = useState(0);

useEffect(() => {
  const t = setTimeout(() => setDebouncedKeyword(keyword), 300);
  return () => clearTimeout(t);
}, [keyword]);

const loadBlacklistedTags = useCallback(async () => {
  setLoading(true);
  try {
    const offset = (page - 1) * pageSize;
    const result = await window.electronAPI.booru.getBlacklistedTags({
      siteId: filterSiteId,
      keyword: debouncedKeyword.trim() || undefined,
      offset,
      limit: pageSize,
    });
    if (result.success && result.data) {
      setBlacklistedTags(result.data.items);
      setTotal(result.data.total);
    }
  } catch (error) {
    console.error('[BlacklistedTagsPage] 加载黑名单标签失败:', error);
    message.error('加载黑名单标签失败');
  } finally {
    setLoading(false);
  }
}, [filterSiteId, debouncedKeyword, page, pageSize]);
```

- [ ] **Step 2：工具栏加搜索框**

在筛选区 Select 之后加：

```typescript
<Input
  placeholder="搜索标签"
  allowClear
  prefix={<SearchOutlined />}
  value={keyword}
  onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
  style={{ width: 240 }}
/>
```

文件头 import 加 `SearchOutlined`（如果没有）。

站点筛选 onChange 改成 `(v) => { setFilterSiteId(v); setPage(1); }`。

- [ ] **Step 3：Table 切服务端分页**

找到 [src/renderer/pages/BlacklistedTagsPage.tsx:329](src/renderer/pages/BlacklistedTagsPage.tsx#L329) 的 `pagination={blacklistedTags.length > 20 ? { pageSize: 20 } : false}`，替换：

```typescript
pagination={{
  current: page,
  pageSize,
  total,
  showSizeChanger: true,
  pageSizeOptions: ['20', '50', '100'],
  onChange: (p, ps) => { setPage(p); setPageSize(ps); },
}}
```

- [ ] **Step 4：类型检查 + 冒烟 + 提交**

```bash
npx tsc -p tsconfig.json --noEmit
npm run dev
```

手动验证：搜索框按标签名过滤（服务端），分页切换正常。

```bash
git add src/renderer/pages/BlacklistedTagsPage.tsx
git commit -m "feat(BlacklistedTagsPage): server-side pagination + keyword search"
```

---

## Task 21: `BlacklistedTagsPage` 迁移到 `<BatchTagAddModal>`

**Files:**
- Modify: `src/renderer/pages/BlacklistedTagsPage.tsx`

- [ ] **Step 1：import 组件 + 新增 state**

```typescript
import { BatchTagAddModal } from '../components/BatchTagAddModal';

const [batchAddModalOpen, setBatchAddModalOpen] = useState(false);
```

- [ ] **Step 2：删除 `batchAddMode` 共用 Modal 的逻辑**

找到 `batchAddMode` state（`src/renderer/pages/BlacklistedTagsPage.tsx:18`）和"批量添加"按钮在共用 Modal 的切换逻辑（搜 `batchAddMode`）。做如下改造：
- 删除 `batchAddMode` state
- 工具栏"批量添加"按钮的 onClick 改为 `() => setBatchAddModalOpen(true)`
- 现有"添加"Modal 只保留单个添加的字段（`tagName` / `siteId` / `reason`），删除涉及 `batchAddMode` 的分支

`handleAdd` 函数只保留单个分支：

```typescript
const handleAdd = async (values: any) => {
  try {
    const result = await window.electronAPI.booru.addBlacklistedTag(
      values.tagName.trim(),
      values.siteId ?? null,
      values.reason || undefined
    );
    if (result.success) {
      message.success(`已添加黑名单: ${values.tagName}`);
      setAddModalVisible(false);
      form.resetFields();
      loadBlacklistedTags();
    } else {
      message.error('添加失败: ' + result.error);
    }
  } catch (error) {
    console.error('[BlacklistedTagsPage] 添加黑名单标签失败:', error);
    message.error('添加黑名单标签失败');
  }
};
```

- [ ] **Step 3：渲染 `<BatchTagAddModal>`**

```typescript
<BatchTagAddModal
  open={batchAddModalOpen}
  title="批量添加黑名单"
  sites={sites}
  extraField={{
    name: 'reason',
    label: '原因（可选）',
    placeholder: '例如: 不喜欢',
  }}
  onCancel={() => setBatchAddModalOpen(false)}
  onSubmit={async (values) => {
    const result = await window.electronAPI.booru.addBlacklistedTags(
      values.tagNames,
      values.siteId,
      values.extra || undefined
    );
    if (result.success && result.data) {
      message.success(`已添加 ${result.data.added} 个标签，跳过 ${result.data.skipped} 个`);
      setBatchAddModalOpen(false);
      loadBlacklistedTags();
    } else {
      message.error('添加失败: ' + result.error);
      throw new Error(result.error || 'failed');
    }
  }}
/>
```

**注意：** `addBlacklistedTags` 后端当前按 `\n` 拆分，输入里的逗号会被当成标签名一部分。为支持 BatchTagAddModal 的"换行或逗号"语义，**也需要更新 `addBlacklistedTags` 的拆分正则**。

- [ ] **Step 4：同步更新 `addBlacklistedTags` 的拆分**

回到 [src/main/services/booruService.ts:2330-2354](src/main/services/booruService.ts#L2330-L2354)，把：

```typescript
const tags = tagString.split('\n').map(t => t.trim()).filter(t => t.length > 0);
```

改为：

```typescript
const tags = Array.from(new Set(
  tagString.split(/[\n,]/).map(t => t.trim()).filter(t => t.length > 0)
));
```

- [ ] **Step 5：类型检查 + 冒烟 + 提交**

```bash
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.json --noEmit
npm run dev
```

手动验证：单个添加仍正常；批量添加打开新对话框，换行 + 逗号混合输入成功添加。

```bash
git add src/renderer/pages/BlacklistedTagsPage.tsx src/main/services/booruService.ts
git commit -m "feat(BlacklistedTagsPage): migrate batch add to shared BatchTagAddModal"
```

---

## Task 22: `BlacklistedTagsPage` 接入 `<ImportTagsDialog>`

**Files:**
- Modify: `src/renderer/pages/BlacklistedTagsPage.tsx`

- [ ] **Step 1：import + state**

```typescript
import { ImportTagsDialog } from '../components/ImportTagsDialog';

const [importDialogOpen, setImportDialogOpen] = useState(false);
```

- [ ] **Step 2：改导入按钮 onClick + 渲染对话框**

找到"导入"按钮，改 onClick：

```typescript
<Button icon={<ImportOutlined />} onClick={() => setImportDialogOpen(true)}>
  导入
</Button>
```

在组件 return 里追加：

```typescript
<ImportTagsDialog
  open={importDialogOpen}
  title="导入黑名单"
  sites={sites}
  onCancel={() => setImportDialogOpen(false)}
  onPickFile={() => window.electronAPI.booru.importBlacklistedTagsPickFile()}
  onCommit={(payload) => window.electronAPI.booru.importBlacklistedTagsCommit(payload)}
  onImported={(result) => {
    message.success(`已导入 ${result.imported} 个标签，跳过 ${result.skipped} 个`);
    setImportDialogOpen(false);
    loadBlacklistedTags();
  }}
/>
```

- [ ] **Step 3：类型检查 + 冒烟 + 提交**

```bash
npx tsc -p tsconfig.json --noEmit
npm run dev
```

手动验证：导入 txt（无 siteId）→ 选站点进对应站点；导入 json 带 siteId 的记录保留原 siteId。

```bash
git add src/renderer/pages/BlacklistedTagsPage.tsx
git commit -m "feat(BlacklistedTagsPage): replace legacy import flow with ImportTagsDialog"
```

---

## Task 23: `SettingsPage` 关于 Tab 加检查更新

**Files:**
- Modify: `src/renderer/pages/SettingsPage.tsx`

- [ ] **Step 1：加 state + handler**

在 `SettingsPage` 组件顶部追加：

```typescript
const [updateChecking, setUpdateChecking] = useState(false);
const [updateResult, setUpdateResult] = useState<import('../../shared/types').UpdateCheckResult | null>(null);

const handleCheckForUpdate = async () => {
  setUpdateChecking(true);
  try {
    const res = await window.electronAPI.system.checkForUpdate();
    if (res.success && res.data) {
      setUpdateResult(res.data);
    } else {
      setUpdateResult({
        currentVersion: '-',
        latestVersion: null,
        hasUpdate: false,
        releaseUrl: null,
        releaseName: null,
        publishedAt: null,
        error: res.error || '检查失败',
        checkedAt: new Date().toISOString(),
      });
    }
  } finally {
    setUpdateChecking(false);
  }
};
```

- [ ] **Step 2：在关于 Tab 的 GitHub 区块之前加"检查更新"**

在 [src/renderer/pages/SettingsPage.tsx:687](src/renderer/pages/SettingsPage.tsx#L687) `<SettingsGroup title="GitHub">` 之前插入：

```typescript
<SettingsGroup title="更新">
  <SettingsRow
    label="检查更新"
    description={
      updateResult?.error
        ? <span style={{ color: '#ff4d4f' }}>检查失败：{updateResult.error}</span>
        : updateResult?.hasUpdate
          ? <span style={{ color: '#52c41a' }}>发现新版本 v{updateResult.latestVersion}（当前 v{updateResult.currentVersion}）</span>
          : updateResult
            ? <span style={{ color: colors.textTertiary }}>当前已是最新版本 v{updateResult.currentVersion}</span>
            : <span style={{ color: colors.textTertiary }}>点击按钮检查是否有新版本</span>
    }
    isLast
    extra={
      updateResult?.hasUpdate && updateResult.releaseUrl ? (
        <Button
          type="primary"
          size="small"
          onClick={() => window.electronAPI?.system.openExternal(updateResult.releaseUrl!)}
        >
          查看发布页
        </Button>
      ) : (
        <Button
          size="small"
          loading={updateChecking}
          onClick={handleCheckForUpdate}
        >
          检查更新
        </Button>
      )
    }
  />
</SettingsGroup>
```

确保文件头 import 了 `Button`（antd 里）。

- [ ] **Step 3：类型检查 + 冒烟**

```bash
npx tsc -p tsconfig.json --noEmit
npm run dev
```

手动验证：
- 点击"检查更新"按钮 → 状态变 loading → 结果显示
- 如果有更新：按钮变成"查看发布页"，点击跳浏览器
- 断网情况下：显示红色错误
- 60 秒内再次点击：后端走缓存（DevTools Network 看不到新的请求）

- [ ] **Step 4：提交**

```bash
git add src/renderer/pages/SettingsPage.tsx
git commit -m "feat(SettingsPage): add update check row in About tab"
```

---

## Task 24: 最终集成验证

**Files:** 无修改

- [ ] **Step 1：全量测试**

```bash
npm run test
```
预期：新增的 updateService / booruService 测试通过；两个组件测试通过；原有测试无回归。

- [ ] **Step 2：类型检查三配置**

```bash
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.preload.json --noEmit
npx tsc -p tsconfig.json --noEmit
```
预期：全部无 error。

- [ ] **Step 3：dev 手动验证清单**

```bash
npm run dev
```

**收藏标签页：**
- [ ] 窗口宽度 1251px 下，表格横向滚动正常，"操作"列始终贴在右边可见
- [ ] 快速搜索 chip 区已经不存在
- [ ] 工具栏搜索框输入 "yande" 后表格只剩匹配行，清空后恢复
- [ ] 站点筛选切换 → 分页 reset 到第 1 页
- [ ] 分页切换（page / pageSize）正常重新拉数据
- [ ] 编辑一个全局标签：弹窗里 siteId 可选，保存后表格里该行所属站点更新
- [ ] 编辑一个已指派站点的标签：siteId 字段禁用且显示 tooltip
- [ ] "批量添加"按钮打开对话框；输入多行 tag + 选站点 + 填分组 → 成功后刷新
- [ ] "导入"按钮打开 `<ImportTagsDialog>`；未选站点时"选择文件"禁用；选完站点选 txt → 预览 → 确认 → 刷新

**黑名单页：**
- [ ] 工具栏搜索框按 tag 名模糊过滤
- [ ] 分页切换正常
- [ ] "批量添加"按钮打开对话框，字段是"原因"
- [ ] "导入"按钮打开对话框；txt / json 两种文件都能走通

**设置 - 关于 Tab：**
- [ ] "检查更新"按钮点击后状态从 loading → 结果文字
- [ ] 有更新时按钮变"查看发布页"，点击跳外部浏览器
- [ ] 断网情况下错误提示可读
- [ ] 60 秒内再次点击走缓存（DevTools 看不到新的 fetch）

- [ ] **Step 4：最终提交整合标记**

```bash
git log --oneline | head -30
```
确认所有 task 都有对应 commit。如果需要，打一个合并里程碑 tag：

```bash
git tag booru-tag-pages-polish-done
```

---

## 风险与回退

- **服务端分页破坏所有调用点：** Task 2/3/4 每一步后都做全量 `npx tsc -p tsconfig.main.json --noEmit`；如果发现漏改，补完再进入下一个 Task。
- **删除旧 import handler 后导致某个隐藏页面断裂：** `grep -r "importFavoriteTags\|importBlacklistedTags" src/renderer/` 确认只有 FavoriteTagsPage / BlacklistedTagsPage 两个调用点。
- **GitHub API 限流：** 60s 缓存已处理；对于 UI 层无需额外保护。
- **版本号比较的极端情况：** `0.0.1` vs `0.0.1-beta.1` 不是本项目会出现的格式；如果实现阶段发现 repo 里有这类 tag，需要把 `compareSemver` 里非数字的情况视为 `0` 即可。
