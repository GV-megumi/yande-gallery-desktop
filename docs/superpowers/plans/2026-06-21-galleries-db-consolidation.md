# 图库存储归一到数据库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 SQLite `galleries` 表成为本地图库的唯一来源，移除 `config.yaml` 的 `galleries.folders` 双写，并修复 `app://` 白名单与备份对它的隐藏依赖。

**Architecture:** DB 侧的图库 CRUD（`createGallery`/`updateGallery`/`deleteGallery`/`getGalleries`）与 IPC 通道已完整存在，本次不重写它们。改动集中在四处「仍依赖 config.folders」的边界：① 新增一个进程内同步的"图库根路径登记表"（`galleryRootRegistry`）供 `app://` 协议白名单同步读取；② 启动时把旧 `config.galleries.folders` 一次性迁移进 DB 并装载登记表；③ 设置页"图库文件夹"从写 config 改为对 DB 做 CRUD（删除时弹窗让用户在「彻底删除」与「仅停止监视」之间二选一）；④ 备份改为直接收录 `galleries` 表，并移除配置层的 `galleries` 字段。

**Tech Stack:** Electron 主进程（TypeScript, ESM, `.js` 导入后缀）、sqlite3、React 18 + Ant Design 渲染层、Vitest。

**关键 UX 取舍（评审时可调整）:** 迁移后设置页"图库文件夹"列表显示**全部 DB 图库**（`getGalleries()`，与图库页一致），而非仅"根目录"。DB 没有"根 vs 子相册"的区分；若要只显示根，需另引入 `isRoot` 概念，属后续扩展，不在本计划内。

---

## File Structure

| 文件 | 职责 | 本计划动作 |
|------|------|-----------|
| `src/main/services/galleryRootRegistry.ts` | 进程内同步缓存"所有图库根路径"，供协议白名单 O(1) 同步读取 | **新建** |
| `src/main/services/galleryService.ts` | 图库 DB CRUD；在 create/delete 后同步登记表 | 修改 |
| `src/main/index.ts` | `app://` 协议白名单根来源 | 修改（改读登记表） |
| `src/main/services/init.ts` | 启动迁移 + 装载登记表 | 修改 |
| `src/renderer/pages/SettingsPage.tsx` | 图库管理 UI | 修改（改为 DB CRUD + 删除弹窗） |
| `src/main/services/config.ts` | 配置 schema | 修改（删除 `galleries` 块及相关函数） |
| `src/main/ipc/handlers/configHandlers.ts` | `config:update-gallery-folders` 处理器 | 修改（删除该处理器） |
| `src/main/ipc/channels.ts` | IPC 通道常量 | 修改（删除 `CONFIG_UPDATE_GALLERY_FOLDERS`） |
| `src/preload/index.ts` | 渲染层暴露面 | 修改（删除 `config.updateGalleryFolders`） |
| `src/main/services/backupService.ts` | 备份/恢复 | 修改（`galleries` 表入备份，去 `config.galleries` 投影） |
| `config.example.yaml` | 示例配置 | 修改（删 `galleries` 块） |
| `doc/注意事项/配置项清单与存储分布.md` 等 | 文档 | 修改 |

---

## Task 1: 新增图库根路径登记表（galleryRootRegistry）

进程内同步缓存，避免 `app://` 协议处理器每次请求都异步查 sqlite。

**Files:**
- Create: `src/main/services/galleryRootRegistry.ts`
- Test: `tests/main/services/galleryRootRegistry.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/main/services/galleryRootRegistry.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadGalleryRoots,
  addGalleryRoot,
  removeGalleryRoot,
  getGalleryRootsSnapshot,
} from '../../../src/main/services/galleryRootRegistry.js';

describe('galleryRootRegistry', () => {
  beforeEach(() => {
    loadGalleryRoots([]);
  });

  it('loadGalleryRoots 用给定列表整体替换缓存', () => {
    loadGalleryRoots(['M:/a', 'M:/b']);
    expect(getGalleryRootsSnapshot().sort()).toEqual(['M:/a', 'M:/b']);
  });

  it('addGalleryRoot 增量加入且去重', () => {
    loadGalleryRoots(['M:/a']);
    addGalleryRoot('M:/b');
    addGalleryRoot('M:/b');
    expect(getGalleryRootsSnapshot().sort()).toEqual(['M:/a', 'M:/b']);
  });

  it('removeGalleryRoot 移除指定根，不存在时静默', () => {
    loadGalleryRoots(['M:/a', 'M:/b']);
    removeGalleryRoot('M:/a');
    removeGalleryRoot('M:/not-there');
    expect(getGalleryRootsSnapshot()).toEqual(['M:/b']);
  });

  it('getGalleryRootsSnapshot 返回副本，外部修改不影响内部', () => {
    loadGalleryRoots(['M:/a']);
    const snap = getGalleryRootsSnapshot();
    snap.push('M:/hacked');
    expect(getGalleryRootsSnapshot()).toEqual(['M:/a']);
  });

  it('忽略空字符串/undefined', () => {
    loadGalleryRoots(['M:/a', '', undefined as unknown as string]);
    addGalleryRoot('');
    expect(getGalleryRootsSnapshot()).toEqual(['M:/a']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --config vitest.config.ts tests/main/services/galleryRootRegistry.test.ts`
Expected: FAIL（`Cannot find module '.../galleryRootRegistry.js'`）

- [ ] **Step 3: 写最小实现**

```typescript
// src/main/services/galleryRootRegistry.ts
/**
 * 图库根路径登记表（进程内同步缓存）
 *
 * 为什么需要它：app:// 协议处理器对每个本地图片请求都要同步判定路径是否在受控根内
 * （见 index.ts getControlledAppProtocolRoots / resolveAppProtocolFilePath），
 * 不能每次请求都异步查 sqlite。因此用一个内存 Set 缓存所有图库的 folderPath，
 * 启动时由 init.ts 从 DB 装载（loadGalleryRoots），之后由 galleryService 在
 * 创建/删除图库时增量维护（addGalleryRoot / removeGalleryRoot）。
 *
 * 存入的字符串应与 DB galleries.folderPath 一致（均经 normalizePath 处理）；
 * index.ts 取出后会再过一遍 normalizeControlledRoot（resolve + win32 小写），
 * 归一化职责仍留在 index.ts，本登记表只负责"有哪些根"。
 */
const galleryRoots = new Set<string>();

/** 启动时整体装载（清空后写入），传入 DB 中所有图库的 folderPath */
export function loadGalleryRoots(paths: string[]): void {
  galleryRoots.clear();
  for (const p of paths) {
    if (p) {
      galleryRoots.add(p);
    }
  }
}

/** 新建图库后调用 */
export function addGalleryRoot(folderPath: string): void {
  if (folderPath) {
    galleryRoots.add(folderPath);
  }
}

/** 删除图库后调用 */
export function removeGalleryRoot(folderPath: string): void {
  if (folderPath) {
    galleryRoots.delete(folderPath);
  }
}

/** 同步读取当前所有图库根路径（返回副本） */
export function getGalleryRootsSnapshot(): string[] {
  return Array.from(galleryRoots);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --config vitest.config.ts tests/main/services/galleryRootRegistry.test.ts`
Expected: PASS（5 passed）

- [ ] **Step 5: 提交**

```bash
git add src/main/services/galleryRootRegistry.ts tests/main/services/galleryRootRegistry.test.ts
git commit -m "feat: 新增图库根路径登记表，为 app:// 白名单提供同步缓存"
```

---

## Task 2: galleryService 在 create/delete 后维护登记表

`createGallery`（galleryService.ts:149）与 `deleteGallery`（galleryService.ts:279）是唯一改变"图库根集合"的两个操作（`updateGallery` 只改 name/isWatching/recursive，不变路径）。在它们已有的 `emitGalleryGalleriesChanged` 调用旁增量维护登记表。

**Files:**
- Modify: `src/main/services/galleryService.ts`（顶部 import；`createGallery` ~200；`deleteGallery` ~399）
- Test: `tests/main/services/galleryService.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `tests/main/services/galleryService.test.ts` 末尾、最后一个顶层 `describe` 之后追加：

```typescript
import {
  getGalleryRootsSnapshot,
  loadGalleryRoots,
} from '../../../src/main/services/galleryRootRegistry.js';

describe('galleryService 同步维护 galleryRootRegistry', () => {
  beforeEach(() => {
    loadGalleryRoots([]);
  });

  it('createGallery 成功后把 folderPath 加入登记表', async () => {
    const fsPromises = await import('fs/promises');
    vi.spyOn(fsPromises, 'access').mockResolvedValue(undefined as any);

    const { createGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await createGallery({ folderPath: 'M:/reg-create', name: 'reg' });

    expect(result.success).toBe(true);
    expect(getGalleryRootsSnapshot()).toContain('M:/reg-create');
  });

  it('deleteGallery 成功后把 folderPath 移出登记表', async () => {
    loadGalleryRoots(['M:/reg-del']);
    const { deleteGallery } = await import('../../../src/main/services/galleryService.js');
    // 用例所在文件已 mock 了 database 层；deleteGallery 读到的 folderPath 应为 'M:/reg-del'
    await deleteGallery(1);

    expect(getGalleryRootsSnapshot()).not.toContain('M:/reg-del');
  });
});
```

> 注：`galleryService.test.ts` 已有 database mock 基础设施。若该文件的 mock 形态与上面不完全匹配（例如 `createGallery` 的 `last_insert_rowid` mock、`deleteGallery` 的 `SELECT folderPath` mock 返回值），按文件现有 mock 风格调整这两个用例的 mock 返回值，使 `createGallery` 返回 `success:true`、`deleteGallery` 读到 `folderPath='M:/reg-del'`。断言（登记表内容）保持不变。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --config vitest.config.ts tests/main/services/galleryService.test.ts -t "galleryRootRegistry"`
Expected: FAIL（登记表未被维护，`toContain` / `not.toContain` 不满足）

- [ ] **Step 3: 写实现 —— 顶部 import**

在 `galleryService.ts` 顶部已有的 import 区（`emitGalleryGalleriesChanged` 来自 `./appEventPublisher.js` 那段附近）新增：

```typescript
import { addGalleryRoot, removeGalleryRoot } from './galleryRootRegistry.js';
```

- [ ] **Step 4: 写实现 —— createGallery 加入登记表**

在 `createGallery` 中，把现有这段（约 200 行）：

```typescript
    emitGalleryGalleriesChanged({ galleryId: result?.id, action: 'created', folderPath });

    return { success: true, data: result?.id };
```

改为：

```typescript
    addGalleryRoot(folderPath);
    emitGalleryGalleriesChanged({ galleryId: result?.id, action: 'created', folderPath });

    return { success: true, data: result?.id };
```

- [ ] **Step 5: 写实现 —— deleteGallery 移出登记表**

在 `deleteGallery` 中，把现有这段（约 399 行，事务成功后）：

```typescript
    emitGalleryGalleriesChanged({ galleryId: id, action: 'deleted', folderPath: normalized });
```

改为：

```typescript
    removeGalleryRoot(normalized);
    emitGalleryGalleriesChanged({ galleryId: id, action: 'deleted', folderPath: normalized });
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run --config vitest.config.ts tests/main/services/galleryService.test.ts`
Expected: PASS（含新增 2 个用例，且原有用例不回归）

- [ ] **Step 7: 提交**

```bash
git add src/main/services/galleryService.ts tests/main/services/galleryService.test.ts
git commit -m "feat: 图库创建/删除时同步维护图库根登记表"
```

---

## Task 3: app:// 白名单改读登记表

`index.ts` 的 `getControlledAppProtocolRoots`（index.ts:89-105）当前从 `getGalleryFolders()`（config）取图库根；改为从登记表取。

**Files:**
- Modify: `src/main/index.ts`（import 段 9-17；`getControlledAppProtocolRoots` 89-96）
- Test: `tests/main/index.appProtocol.test.ts`（运行回归）

- [ ] **Step 1: 改 import**

把 `index.ts` 顶部 import（9-17 行）中的 `getGalleryFolders,` 删除：

```typescript
import {
  getCachePath,
  getDataDir,
  getDesktopConfig,
  getDownloadsPath,
  getStartupHardwareAccelerationEnabled,
  getThumbnailsPath,
} from './services/config.js';
```

并新增一行 import：

```typescript
import { getGalleryRootsSnapshot } from './services/galleryRootRegistry.js';
```

- [ ] **Step 2: 改 getControlledAppProtocolRoots**

把（89-96 行）：

```typescript
function getControlledAppProtocolRoots(): string[] {
  const roots = [
    ...getGalleryFolders().map(folder => folder.path),
    getDownloadsPath(),
    getDataDir(),
    getCachePath(),
    getThumbnailsPath(),
  ];
```

改为：

```typescript
function getControlledAppProtocolRoots(): string[] {
  const roots = [
    ...getGalleryRootsSnapshot(),
    getDownloadsPath(),
    getDataDir(),
    getCachePath(),
    getThumbnailsPath(),
  ];
```

（其余归一化逻辑 `normalizeControlledRoot` 不变。）

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 通过（`getGalleryFolders` 在 index.ts 已无引用；该函数本体将在 Task 6 删除）

- [ ] **Step 4: 运行协议测试回归**

Run: `npx vitest run --config vitest.config.ts tests/main/index.appProtocol.test.ts`
Expected: PASS。若该测试原本依赖 `getGalleryFolders` 提供白名单根，则改为在测试 setup 里调用 `loadGalleryRoots([...])`（来自 `galleryRootRegistry.js`）注入受控根；断言逻辑不变。

- [ ] **Step 5: 提交**

```bash
git add src/main/index.ts tests/main/index.appProtocol.test.ts
git commit -m "refactor: app:// 白名单改用图库根登记表，不再读 config.folders"
```

---

## Task 4: 启动迁移 + 装载登记表（init.ts）

`initGalleriesFromConfig`（init.ts:153-196）当前在 DB 为空时从 `config.galleries.folders` 建图库。保留这个"一次性迁移"语义，但：① 防御式读取旧字段（Task 6 删除类型后仍能读到老 yaml 残留的 key）；② 迁移后从内存配置删除该 key，避免回写时再持久化；③ 不论是否迁移，最后都从 DB 装载登记表。

**Files:**
- Modify: `src/main/services/init.ts`（import 1-8；`initGalleriesFromConfig` 153-196）
- Test: `tests/main/services/init.galleries.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```typescript
// tests/main/services/init.galleries.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGalleryRootsSnapshot, loadGalleryRoots } from '../../../src/main/services/galleryRootRegistry.js';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  loadGalleryRoots([]);
});

describe('initGalleriesFromConfig 迁移 + 装载登记表', () => {
  it('DB 已有图库时跳过迁移，但仍按 DB 装载登记表', async () => {
    vi.doMock('../../../src/main/services/config.js', () => ({
      getConfig: vi.fn(() => ({ galleries: { folders: [{ path: 'M:/seed', name: 's', autoScan: true, recursive: true, extensions: ['.jpg'] }] } })),
    }));
    const createGallery = vi.fn(async () => ({ success: true, data: 1 }));
    const getGalleries = vi.fn(async () => ({ success: true, data: [{ id: 9, folderPath: 'M:/existing' }] }));
    vi.doMock('../../../src/main/services/galleryService.js', () => ({ createGallery, getGalleries }));
    vi.doMock('../../../src/main/utils/path.js', () => ({ normalizePath: (p: string) => p }));

    const { initGalleriesFromConfig } = await import('../../../src/main/services/init.js');
    await initGalleriesFromConfig();

    expect(createGallery).not.toHaveBeenCalled();
    expect(getGalleryRootsSnapshot()).toEqual(['M:/existing']);
  });

  it('DB 为空时从旧 config.folders 迁移建库，并装载登记表', async () => {
    const cfg: any = { galleries: { folders: [{ path: 'M:/seed', name: 's', autoScan: true, recursive: true, extensions: ['.jpg'] }] } };
    vi.doMock('../../../src/main/services/config.js', () => ({ getConfig: vi.fn(() => cfg) }));
    const createGallery = vi.fn(async () => ({ success: true, data: 1 }));
    const getGalleries = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [{ id: 1, folderPath: 'M:/seed' }] });
    vi.doMock('../../../src/main/services/galleryService.js', () => ({ createGallery, getGalleries }));
    vi.doMock('../../../src/main/utils/path.js', () => ({ normalizePath: (p: string) => p }));

    const { initGalleriesFromConfig } = await import('../../../src/main/services/init.js');
    await initGalleriesFromConfig();

    expect(createGallery).toHaveBeenCalledTimes(1);
    expect(getGalleryRootsSnapshot()).toEqual(['M:/seed']);
    expect(cfg.galleries).toBeUndefined(); // 迁移后从内存配置剥离旧 key
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --config vitest.config.ts tests/main/services/init.galleries.test.ts`
Expected: FAIL（`initGalleriesFromConfig` 未导出 / 行为不符）

- [ ] **Step 3: 改 init.ts import**

把 init.ts:3：

```typescript
import { createGallery, getGalleries } from './galleryService.js';
```

改为：

```typescript
import { createGallery, getGalleries } from './galleryService.js';
import { loadGalleryRoots } from './galleryRootRegistry.js';
```

- [ ] **Step 4: 改写 initGalleriesFromConfig（并导出）**

把整个 `initGalleriesFromConfig`（153-196 行）替换为：

```typescript
/**
 * 启动时一次性迁移 + 装载图库根登记表（懒加载模式）
 * - 历史遗留：旧版把图库根写在 config.galleries.folders；现已归一到 DB galleries 表。
 *   这里仅在 DB 为空时把旧字段迁移进 DB，并从内存配置剥离该 key，避免后续回写再持久化。
 * - 不论是否迁移，最后都从 DB 装载 galleryRootRegistry，供 app:// 白名单同步读取。
 */
export async function initGalleriesFromConfig(): Promise<void> {
  try {
    // 旧字段已从 AppConfig 类型移除；老 yaml 可能仍残留该 key，故防御式读取
    const config = getConfig() as unknown as {
      galleries?: { folders?: Array<{ path: string; name: string; autoScan?: boolean; recursive?: boolean; extensions?: string[] }> };
    };

    const existingResult = await getGalleries();
    const dbEmpty = !(existingResult.success && existingResult.data && existingResult.data.length > 0);

    const legacyFolders = config.galleries?.folders ?? [];
    if (dbEmpty && legacyFolders.length > 0) {
      console.log('📂 检测到旧 config.galleries.folders，一次性迁移进数据库...');
      let createdCount = 0;
      for (const folderConfig of legacyFolders) {
        try {
          const folderPath = normalizePath(folderConfig.path);
          const result = await createGallery({
            folderPath,
            name: folderConfig.name,
            isWatching: folderConfig.autoScan,
            recursive: folderConfig.recursive,
            extensions: folderConfig.extensions,
          });
          if (result.success) {
            createdCount++;
            console.log(`✅ 迁移图库: ${folderConfig.name} (${folderPath})`);
          }
        } catch (error) {
          console.error(`❌ 迁移图库失败: ${folderConfig.name}`, error);
        }
      }
      console.log(`📝 共迁移 ${createdCount} 个图库`);
    }

    // 迁移完成后剥离旧 key，避免 config 回写时再次持久化
    if (config.galleries !== undefined) {
      delete config.galleries;
    }

    // 从 DB 装载图库根登记表（app:// 白名单的同步来源）
    const galleriesResult = await getGalleries();
    const roots = galleriesResult.success && galleriesResult.data
      ? galleriesResult.data.map(g => g.folderPath).filter(Boolean)
      : [];
    loadGalleryRoots(roots);
    console.log(`[init] 图库根登记表已装载，共 ${roots.length} 个根`);
  } catch (error) {
    console.error('❌ 初始化图库失败:', error);
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --config vitest.config.ts tests/main/services/init.galleries.test.ts`
Expected: PASS（2 passed）

- [ ] **Step 6: 类型检查**

Run: `npm run typecheck`
Expected: 通过（此时 `config.galleries` 仍在类型中，`as unknown as` 读取合法）

- [ ] **Step 7: 提交**

```bash
git add src/main/services/init.ts tests/main/services/init.galleries.test.ts
git commit -m "feat: 启动时迁移旧图库配置进数据库并装载图库根登记表"
```

---

## Task 5: 设置页改为对 DB 图库做 CRUD（含删除弹窗）

`SettingsPage.tsx` 的"图库文件夹"从 `config.galleries.folders` 改为读写 DB 图库。删除时弹窗让用户二选一：「彻底删除」（`gallery.deleteGallery`，级联清记录+缩略图）或「仅停止监视」（`gallery.updateGallery {isWatching:false}`，保留数据）。

**Files:**
- Modify: `src/renderer/pages/SettingsPage.tsx`（`GalleryFolder` 接口 17；`folders` state 155；`loadConfig` 398-407；`handleAddFolder` ~469；`handleDeleteFolder` 508-513；`saveFoldersConfig` 515-523；图库列表渲染）

> 说明：本任务以渲染层为主，难以纯单测驱动；验证以 `npm run typecheck` + 运行 `tests/renderer/pages/SettingsPage.test.tsx` 回归为准（见 Step 6）。

- [ ] **Step 1: 扩展本地图库类型，承载 DB 字段**

把 SettingsPage.tsx:17 的本地接口：

```typescript
interface GalleryFolder {
```

改名并补字段（用于显示 DB 图库行）：

```typescript
interface GalleryRow {
  id?: number;          // DB 图库 id（来自 getGalleries）
  path: string;         // 对应 DB folderPath
  name: string;
  autoScan: boolean;
  recursive: boolean;
  extensions: string[];
  imageCount?: number;
  isWatching?: boolean;
}
```

并把 state（155 行）：

```typescript
  const [folders, setFolders] = useState<GalleryFolder[]>([]);
```

改为：

```typescript
  const [folders, setFolders] = useState<GalleryRow[]>([]);
```

- [ ] **Step 2: 列表数据源改为 DB**

把 `loadConfig`（398-407 行）中这一行：

```typescript
        setFolders(config.galleries?.folders || []);
```

替换为一段从 DB 拉取的逻辑（紧随其后即可，`config` 其余字段读取保持不变）：

```typescript
        // 图库列表改为以 DB 为唯一来源
        const galleriesResult = await window.electronAPI.gallery.getGalleries();
        if (galleriesResult.success && Array.isArray(galleriesResult.data)) {
          setFolders(
            galleriesResult.data.map((g: any) => ({
              id: g.id,
              path: g.folderPath,
              name: g.name,
              autoScan: Boolean(g.isWatching),
              recursive: Boolean(g.recursive),
              extensions: Array.isArray(g.extensions) ? g.extensions : ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
              imageCount: g.imageCount,
              isWatching: Boolean(g.isWatching),
            }))
          );
        }
```

- [ ] **Step 3: 新增文件夹改为创建 DB 图库**

把 `handleAddFolder` 里"构造 newFolder + setFolders + saveFoldersConfig"那段（约 469-475 行）：

```typescript
      const newFolder: GalleryFolder = {
        path: folderPath, name: folderName, autoScan: true, recursive: true,
        extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
      };
      const updatedFolders = [...folders, newFolder];
      setFolders(updatedFolders);
      await saveFoldersConfig(updatedFolders);
```

替换为：

```typescript
      const extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      const createResult = await window.electronAPI.gallery.createGallery({
        folderPath, name: folderName, isWatching: true, recursive: true, extensions,
      });
      if (!createResult.success) {
        message.error(createResult.error || '创建图库失败');
        return;
      }
      await loadConfig(); // 重新从 DB 拉取列表
```

（其后弹出的"是否立即扫描子文件夹"`modal.confirm` 保持不变。）

- [ ] **Step 4: 删除改为弹窗二选一**

把 `handleDeleteFolder`（508-513 行）整体替换为基于 DB id 的双线删除：

```typescript
  // 删除图库：弹窗让用户在「彻底删除」与「仅停止监视」之间选择
  const handleDeleteFolder = (index: number) => {
    const target = folders[index];
    if (target?.id === undefined) {
      // 理论上 DB 来源的行都有 id；无 id 时直接从列表移除兜底
      setFolders(folders.filter((_, i) => i !== index));
      return;
    }
    const galleryId = target.id;
    modal.confirm({
      title: `删除图库 "${target.name}"`,
      content: '「彻底删除」会清除该图库的图片记录与缩略图缓存（磁盘原图保留）；「仅停止监视」保留所有数据，仅关闭自动同步。',
      okText: '彻底删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      // 第三个动作通过 footer 自定义较繁琐，这里用 onOk=彻底删除；停止监视放在列表行单独按钮
      onOk: async () => {
        const result = await window.electronAPI.gallery.deleteGallery(galleryId);
        if (!result.success) {
          message.error(result.error || '删除失败');
          return;
        }
        message.success('已删除图库');
        await loadConfig();
      },
    });
  };

  // 仅停止监视：保留数据，关闭自动同步
  const handleStopWatching = async (index: number) => {
    const target = folders[index];
    if (target?.id === undefined) return;
    const result = await window.electronAPI.gallery.updateGallery(target.id, { isWatching: false });
    if (!result.success) {
      message.error(result.error || '操作失败');
      return;
    }
    message.success('已停止监视该图库（数据保留）');
    await loadConfig();
  };
```

> 设计说明：Antd `modal.confirm` 只有 OK/Cancel 两个按钮。为表达"二选一+取消"三态，这里把「彻底删除」放在确认弹窗，「仅停止监视」作为图库列表行上的独立按钮（下一步）。这与用户选择的"双线、提示用户选择"一致：两种处置都可达，且删除前有明确说明。

- [ ] **Step 5: 列表行补「停止监视」按钮，删除 saveFoldersConfig**

在图库列表每行的操作区（删除按钮 `Popconfirm`/按钮附近），新增一个「停止监视」按钮，绑定 `handleStopWatching(index)`（仅当 `folder.isWatching` 为真时显示）。例如在该行操作单元格内加入：

```tsx
{folder.isWatching && (
  <Button size="small" onClick={() => handleStopWatching(index)} title="保留数据，仅关闭自动同步">
    停止监视
  </Button>
)}
```

并删除整个不再使用的 `saveFoldersConfig` 函数（515-523 行）。

- [ ] **Step 6: 类型检查 + 设置页测试回归**

Run: `npm run typecheck`
Expected: 通过（`window.electronAPI.config.updateGalleryFolders` 仍存在；Task 6 才移除）

Run: `npx vitest run --config vitest.config.ts tests/renderer/pages/SettingsPage.test.tsx`
Expected: PASS。若该测试覆盖了"图库文件夹增删 → 断言调用 `config.updateGalleryFolders`"，按本任务新行为改为断言调用 `gallery.createGallery` / `gallery.deleteGallery`，并为 `gallery.getGalleries` 提供 mock 返回。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/pages/SettingsPage.tsx tests/renderer/pages/SettingsPage.test.tsx
git commit -m "feat: 设置页图库管理改为对数据库 CRUD，删除支持彻底删除/仅停止监视"
```

---

## Task 6: 移除配置层的 galleries 字段与相关函数

此时已无运行时代码依赖 `config.galleries.folders`（init 防御式读取并剥离；app:// 用登记表；设置页用 DB）。删除配置 schema、getter/setter、IPC 通道、preload 暴露面。

**Files:**
- Modify: `src/main/services/config.ts`、`src/main/ipc/channels.ts`、`src/main/ipc/handlers/configHandlers.ts`、`src/preload/index.ts`

- [ ] **Step 1: config.ts —— 删除 AppConfig.galleries 与 GalleryFolder**

删除 `AppConfig` 中（144-146 行）：

```typescript
  galleries: {
    folders: GalleryFolder[];
  };
```

并删除 `GalleryFolder` 接口（229-235 行附近，完整定义）：

```typescript
export interface GalleryFolder {
  path: string;
  name: string;
  autoScan: boolean;
  recursive: boolean;
  extensions: string[];
}
```

- [ ] **Step 2: config.ts —— 删除 DEFAULT_CONFIG.galleries**

删除 DEFAULT_CONFIG 中（271 行附近）：

```typescript
  galleries: {
    // 默认无图库，由用户通过设置页添加
    folders: []
  },
```

- [ ] **Step 3: config.ts —— 删除 validateConfig 中对 galleries 的校验**

删除 `validateConfig` 中（约 829 行）这段：

```typescript
  // 仅当用户提供了图库条目时，才要求条目内字段齐全（空数组属于合法的"未配置"）
  config.galleries?.folders?.forEach((folder, index) => {
    if (!folder.path) {
      errors.push(`galleries.folders[${index}].path 不能为空`);
    }
    if (!folder.name) {
      errors.push(`galleries.folders[${index}].name 不能为空`);
    }
    if (!folder.extensions || folder.extensions.length === 0) {
      errors.push(`galleries.folders[${index}].extensions 不能为空`);
    }
  });
```

- [ ] **Step 4: config.ts —— 删除 normalizeConfigSaveInput.galleries**

删除（1140-1142 行）：

```typescript
    galleries: {
      folders: input.galleries?.folders ?? currentConfig.galleries.folders,
    },
```

- [ ] **Step 5: config.ts —— 删除 updateGalleryFolders 与 getGalleryFolders**

删除整个 `updateGalleryFolders` 函数（1329-1345 行附近）与 `getGalleryFolders` 函数（1387-1390 行附近）。

- [ ] **Step 6: channels.ts —— 删除通道常量**

删除 `src/main/ipc/channels.ts:44`：

```typescript
  CONFIG_UPDATE_GALLERY_FOLDERS: 'config:update-gallery-folders',
```

- [ ] **Step 7: configHandlers.ts —— 删除处理器与 import**

删除 `configHandlers.ts:14` 的 import 名 `updateGalleryFolders,`，并删除注册 `CONFIG_UPDATE_GALLERY_FOLDERS` 的整个 `ipcMain.handle(...)` 块（390-395 行附近）。

- [ ] **Step 8: preload/index.ts —— 删除暴露面与类型**

删除 `src/preload/index.ts:73`：

```typescript
    updateGalleryFolders: (folders: any[]) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_UPDATE_GALLERY_FOLDERS, folders),
```

并删除 `declare global` 中 417 行：

```typescript
        updateGalleryFolders: (folders: any[]) => Promise<{ success: boolean; error?: string }>;
```

- [ ] **Step 9: 类型检查**

Run: `npm run typecheck`
Expected: 通过。若报 `RendererSafeAppConfig` 仍含 `galleries`（来自 `Omit<AppConfig, ...>` 自动跟随）——无需额外处理，删除 `AppConfig.galleries` 后它自动消失。若有遗漏引用，按报错逐一删除。

- [ ] **Step 10: 提交**

```bash
git add src/main/services/config.ts src/main/ipc/channels.ts src/main/ipc/handlers/configHandlers.ts src/preload/index.ts
git commit -m "refactor: 移除 config.galleries.folders 及其 getter/IPC/preload 暴露面"
```

---

## Task 7: 备份改为收录 galleries 表，移除 config.galleries 投影

`galleries` 表当前不在 `BACKUP_TABLES`——图库此前是靠 `config.galleries.folders` 间接进备份。移除该配置后必须把 `galleries` 表纳入备份，否则图库不再被备份（行为回归）。

**Files:**
- Modify: `src/main/services/backupService.ts`（`BACKUP_TABLES` 15-27；`projectBackupSafeConfig` 参数 98 与返回 117）
- Test: `tests/main/services/backupService.test.ts`

- [ ] **Step 1: 写失败测试**

在 `backupService.test.ts` 的 `describe('backupService constants', ...)` 内追加：

```typescript
  it('备份表应包含 galleries（图库已归一到数据库）', () => {
    expect(BACKUP_TABLES).toContain('galleries');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --config vitest.config.ts tests/main/services/backupService.test.ts -t "galleries"`
Expected: FAIL（`BACKUP_TABLES` 不含 `'galleries'`）

- [ ] **Step 3: 把 galleries 加入 BACKUP_TABLES**

在 `BACKUP_TABLES`（15-27 行）数组末尾、`'booru_saved_searches',` 之后加入：

```typescript
  'galleries',
```

> 说明：`galleries.coverImageId` 外键指向 `images`，而 `images` 不在备份内——恢复后 coverImageId 可能悬空，但 `getGalleries` 用 `LEFT JOIN images` 读取，悬空封面表现为"无封面"，无副作用。`invalid_images.galleryId` 指向 galleries（FK 容忍），`invalid_images` 也不在备份内，无影响。

- [ ] **Step 4: 从 projectBackupSafeConfig 移除 galleries 投影**

`backupService.ts` 的 `projectBackupSafeConfig` 参数类型删除（98 行）：

```typescript
  galleries: AppConfig['galleries'];
```

返回对象删除（117 行）：

```typescript
    galleries: config.galleries,
```

- [ ] **Step 5: 类型检查 + 全量备份测试**

Run: `npm run typecheck`
Expected: 通过

Run: `npx vitest run --config vitest.config.ts tests/main/services/backupService.test.ts`
Expected: PASS。若有 fixture/断言仍带 `galleries: { folders: [] }` 配置块或断言 `result.galleries`，删除这些（galleries 不再是配置字段）。

- [ ] **Step 6: 提交**

```bash
git add src/main/services/backupService.ts tests/main/services/backupService.test.ts
git commit -m "feat: 备份纳入 galleries 表，移除已废弃的 config.galleries 投影"
```

---

## Task 8: 清理 config.example.yaml 与残留测试 fixture

**Files:**
- Modify: `config.example.yaml`
- Modify: 含 `galleries: { folders: ... }` 的测试 fixture（`tests/main/services/config.test.ts`、`tests/main/ipc/setupIPC.test.ts`、`tests/main/services/config.pagePreferences.test.ts`、`tests/main/services/config.apiService.test.ts` 等）

- [ ] **Step 1: 删除 config.example.yaml 的 galleries 块**

删除 `config.example.yaml` 中整个 `# -------- 图库 --------` 注释与其下的 `galleries:` 块（`folders:` 列表），并在 `database` 块后补一行注释：

```yaml
# -------- 图库 --------
# 注：本地图库已归一到数据库（gallery.db 的 galleries 表），通过应用「设置 → 图库文件夹」管理，
#     不再在此配置；旧版的 galleries.folders 会在首次启动时自动迁移进数据库。
```

- [ ] **Step 2: 删除测试 fixture 中的 galleries 配置块**

在上述测试文件中，把所有形如：

```typescript
      galleries: { folders: [] },
```

整行删除（它们是构造 `AppConfig` 的 fixture 行；`galleries` 已不在类型中，留着是多余字段）。逐文件用编辑器全局替换 `      galleries: { folders: [] },\n` → 空。

- [ ] **Step 3: 全量类型检查 + 相关测试**

Run: `npm run typecheck`
Expected: 通过

Run: `npx vitest run --config vitest.config.ts tests/main/services/config.test.ts tests/main/ipc/setupIPC.test.ts tests/main/services/config.pagePreferences.test.ts tests/main/services/config.apiService.test.ts`
Expected: PASS（若个别断言 `toEqual` 含 `galleries`，同步删除该期望字段）

- [ ] **Step 4: 提交**

```bash
git add config.example.yaml tests/
git commit -m "chore: 清理示例配置与测试中残留的 galleries.folders"
```

---

## Task 9: 全量回归（typecheck + 全部单测）

**Files:** 无（验证关）

- [ ] **Step 1: 类型检查**

Run: `npm run typecheck`
Expected: 退出码 0，无错误

- [ ] **Step 2: 全量单测**

Run: `npx vitest run --config vitest.config.ts`
Expected: 全绿。`tests/renderer/pages/SettingsPage.test.tsx` 等重型渲染测试若在满负载下偶发 30s 超时，单独重跑确认：

Run: `npx vitest run --config vitest.config.ts tests/renderer/pages/SettingsPage.test.tsx`
Expected: PASS

- [ ] **Step 3: 终检残留引用**

Run: `npx vitest run --config vitest.config.ts >/dev/null 2>&1; rg -n "updateGalleryFolders|getGalleryFolders|config\.galleries|CONFIG_UPDATE_GALLERY_FOLDERS|GalleryFolder" src/`
Expected: 无任何 `src/` 命中（渲染层 `GalleryRow` 不应再叫 `GalleryFolder`）

- [ ] **Step 4: 提交（如有零散修复）**

```bash
git add -A
git commit -m "test: 图库归一数据库后全量回归修复"
```

---

## Task 10: 更新文档

**Files:**
- Modify: `doc/注意事项/配置项清单与存储分布.md`
- Modify: `doc/开发与配置指南.md`（若其图库/配置示例提及 galleries.folders）
- Modify: `doc/图库功能文档.md`（若描述图库来源为 config）

- [ ] **Step 1: 更新配置清单文档**

在 `doc/注意事项/配置项清单与存储分布.md`：
- §二 表中删除 `galleries` 行（已移出 config.yaml）。
- §五 把"⚠ 重叠点：本地图库双写"改为"✅ 已收口：图库统一存 DB `galleries` 表，`config.galleries.folders` 已移除；旧 yaml 首启自动迁移；`app://` 白名单由 `galleryRootRegistry`（内存同步缓存，启动从 DB 装载、增删图库时维护）提供。"
- §九 第三优先「galleries.folders 双写」标记为 ✅ 已完成（2026-06），并记录：备份已改为收录 `galleries` 表。

- [ ] **Step 2: 更新开发与配置指南**

在 `doc/开发与配置指南.md` 的 config.yaml 示例/说明里删除 galleries.folders 相关内容，补一句"本地图库存数据库，经设置页管理"。

- [ ] **Step 3: 提交**

```bash
git add doc/
git commit -m "docs: 同步图库归一数据库后的配置与架构说明"
```

---

## Self-Review 结论（作者已自查）

- **Spec 覆盖**：① 全量迁移到 DB（T4 迁移 + T6 删配置）；② app:// 白名单改 DB（T1–T3）；③ 设置页 DB CRUD + 删除二选一（T5）；④ 备份不回归（T7）；⑤ 示例/测试/文档（T8/T9/T10）。均有对应任务。
- **类型一致性**：登记表函数名 `loadGalleryRoots` / `addGalleryRoot` / `removeGalleryRoot` / `getGalleryRootsSnapshot` 在 T1 定义、T2/T3/T4 一致引用；`CreateGalleryDto`（folderPath/name/isWatching/recursive/extensions）与 T5 `createGallery` 调用参数一致；`updateGallery(id, {isWatching})` 与现有签名一致。
- **占位符**：无 TODO/TBD；每个改动步骤含具体代码或具体命令。
- **已知风险点（执行时注意）**：T2/T5/T7/T8 中"按现有 mock/断言风格调整"的提示，是因为这些测试文件的内部 mock 形态需以执行时实际文件为准；断言意图已明确，调整的是脚手架而非目标。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-galleries-db-consolidation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 每个 Task 派一个全新 subagent 实现，任务之间我来 review，迭代快。
2. **Inline Execution** — 在本会话内按 executing-plans 批量执行，带检查点 review。

Which approach?
