# 无效图片管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当源文件被外部删除后，图库自动检测并将无效图片迁移到独立管理区，用户可浏览、删除或清空无效项。

**Architecture:** 在已有的缩略图加载路径中增加源文件缺失检测（懒检测），将无效图片从 `images` 表迁移到新建的 `invalid_images` 表。侧边栏新增"无效项"菜单入口，专用页面使用瀑布流展示缩略图、文件名、原路径，支持单项删除和全部清空（此时才删除缩略图文件）。

**Tech Stack:** Electron (main process SQLite + fs), React + Ant Design (renderer), IPC contextBridge

---

## File Structure

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| Create | `src/main/services/invalidImageService.ts` | 无效图片的数据库 CRUD（迁移、查询、删除、清空） |
| Create | `src/renderer/pages/InvalidImagesPage.tsx` | 无效项页面（瀑布流展示 + 操作） |
| Modify | `src/main/services/database.ts` | 新建 `invalid_images` 表和索引 |
| Modify | `src/main/ipc/handlers.ts` | 注册 4 个新 IPC handler |
| Modify | `src/preload/index.ts` | 暴露 4 个新 gallery API + 类型声明 |
| Modify | `src/renderer/components/ImageGrid.tsx` | 缩略图加载时检测 missing 标记并上报 |
| Modify | `src/renderer/App.tsx` | 侧边栏新增"无效项"菜单 + 路由到新页面 |
| Modify | `src/renderer/locales/zh-CN.ts` | 中文翻译 |
| Modify | `src/renderer/locales/en-US.ts` | 英文翻译 |
| Modify | `src/renderer/styles/tokens.ts` | 新增 `invalidImages` 图标颜色 |
| Modify | `src/main/ipc/handlers.ts:269-296` | `image:get-thumbnail` handler 增加 `missing` 标记 |
| Modify | `src/shared/types.ts` | 新增 `InvalidImage` 类型 |

---

### Task 1: 数据库 — 新建 invalid_images 表

**Files:**
- Modify: `src/main/services/database.ts` (在 `initDatabase` 函数中，约 line 535 性能优化索引之前)
- Modify: `src/shared/types.ts` (追加 InvalidImage 接口)

- [ ] **Step 1: 在 `src/shared/types.ts` 末尾追加 InvalidImage 类型**

在文件末尾添加：

```typescript
export interface InvalidImage {
  id: number;
  originalImageId: number;
  filename: string;
  filepath: string;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  thumbnailPath: string | null;
  detectedAt: string;
  galleryId: number | null;
}
```

- [ ] **Step 2: 在 `src/main/services/database.ts` 的 `initDatabase` 函数中添加建表语句**

在 `// === 性能优化索引 ===` 注释（line 516）之前插入：

```typescript
    // === 无效图片表 ===
    console.log('[database] 开始创建无效图片表...');

    await run(database, `
      CREATE TABLE IF NOT EXISTS invalid_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        originalImageId INTEGER NOT NULL,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        fileSize INTEGER,
        width INTEGER,
        height INTEGER,
        format TEXT,
        thumbnailPath TEXT,
        detectedAt TEXT NOT NULL,
        galleryId INTEGER,
        FOREIGN KEY (galleryId) REFERENCES galleries(id) ON DELETE SET NULL
      )
    `);

    await new Promise<void>((resolve, reject) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_invalid_images_detectedAt ON invalid_images(detectedAt DESC);
        CREATE INDEX IF NOT EXISTS idx_invalid_images_galleryId ON invalid_images(galleryId);
        CREATE INDEX IF NOT EXISTS idx_invalid_images_originalImageId ON invalid_images(originalImageId);
      `, (err) => err ? reject(err) : resolve());
    });

    console.log('[database] 无效图片表创建成功');
```

- [ ] **Step 3: 运行 `npm run dev` 验证应用启动无报错，控制台可见建表日志**

Run: `npm run dev`
Expected: 控制台输出 `[database] 无效图片表创建成功`

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/main/services/database.ts
git commit -m "feat: add invalid_images table and InvalidImage type"
```

---

### Task 2: 无效图片服务 — 主进程 CRUD

**Files:**
- Create: `src/main/services/invalidImageService.ts`

- [ ] **Step 1: 创建 `src/main/services/invalidImageService.ts`**

```typescript
import { getDatabase, run, get, all, runInTransaction } from './database.js';
import { getThumbnailIfExists, deleteThumbnail } from './thumbnailService.js';
import { InvalidImage } from '../../shared/types.js';
import fs from 'fs/promises';

/**
 * 上报无效图片：从 images 表迁移到 invalid_images 表
 * - 查询 images 记录
 * - 查询所属 gallery
 * - 获取缩略图路径
 * - 事务内：插入 invalid_images、删除 images 记录、更新 gallery 封面和计数
 */
export async function reportInvalidImage(imageId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();

    // 检查是否已经上报过
    const existing = await get<{ id: number }>(db,
      'SELECT id FROM invalid_images WHERE originalImageId = ?', [imageId]);
    if (existing) {
      return { success: true }; // 已上报，跳过
    }

    // 查询原始图片信息
    const image = await get<{
      id: number; filename: string; filepath: string;
      fileSize: number; width: number; height: number; format: string;
    }>(db, 'SELECT id, filename, filepath, fileSize, width, height, format FROM images WHERE id = ?', [imageId]);

    if (!image) {
      return { success: false, error: '图片记录不存在' };
    }

    // 确认源文件确实不存在（双重校验，避免误删）
    try {
      await fs.access(image.filepath);
      // 文件存在，不应标记为无效
      return { success: false, error: '源文件仍然存在' };
    } catch {
      // 文件不存在，继续
    }

    // 查找所属 gallery（通过 filepath 前缀匹配 galleries.folderPath）
    const gallery = await get<{ id: number; coverImageId: number | null }>(db,
      `SELECT id, coverImageId FROM galleries
       WHERE ? LIKE folderPath || '%'
       ORDER BY LENGTH(folderPath) DESC LIMIT 1`,
      [image.filepath]);

    // 获取缩略图路径
    const thumbnailPath = await getThumbnailIfExists(image.filepath);

    const now = new Date().toISOString();

    await runInTransaction(db, async () => {
      // 插入无效图片记录
      await run(db, `
        INSERT INTO invalid_images (originalImageId, filename, filepath, fileSize, width, height, format, thumbnailPath, detectedAt, galleryId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [image.id, image.filename, image.filepath, image.fileSize, image.width, image.height, image.format, thumbnailPath, now, gallery?.id ?? null]);

      // 如果该图片是 gallery 的封面，清除封面
      if (gallery && gallery.coverImageId === image.id) {
        await run(db, 'UPDATE galleries SET coverImageId = NULL WHERE id = ?', [gallery.id]);
      }

      // 从 images 表删除（ON DELETE CASCADE 会自动清理 image_tags）
      await run(db, 'DELETE FROM images WHERE id = ?', [image.id]);

      // 更新 gallery 的 imageCount
      if (gallery) {
        const countResult = await get<{ cnt: number }>(db,
          `SELECT COUNT(*) as cnt FROM images WHERE filepath LIKE ? || '%'`,
          [await getGalleryFolderPath(db, gallery.id)]);
        if (countResult) {
          await run(db, 'UPDATE galleries SET imageCount = ? WHERE id = ?', [countResult.cnt, gallery.id]);
        }
      }
    });

    console.log(`[invalidImageService] 已迁移无效图片: ${image.filename} (ID: ${imageId})`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[invalidImageService] 上报无效图片失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/** 辅助：获取 gallery 的 folderPath */
async function getGalleryFolderPath(db: any, galleryId: number): Promise<string> {
  const row = await get<{ folderPath: string }>(db, 'SELECT folderPath FROM galleries WHERE id = ?', [galleryId]);
  return row?.folderPath ?? '';
}

/**
 * 获取无效图片列表（分页）
 */
export async function getInvalidImages(
  page: number = 1,
  pageSize: number = 200
): Promise<{ success: boolean; data?: InvalidImage[]; total?: number; error?: string }> {
  try {
    const db = await getDatabase();
    const offset = (page - 1) * pageSize;

    const totalRow = await get<{ cnt: number }>(db, 'SELECT COUNT(*) as cnt FROM invalid_images');
    const total = totalRow?.cnt ?? 0;

    const rows = await all<InvalidImage>(db,
      'SELECT * FROM invalid_images ORDER BY detectedAt DESC LIMIT ? OFFSET ?',
      [pageSize, offset]);

    return { success: true, data: rows, total };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[invalidImageService] 获取无效图片列表失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 获取无效图片总数（用于侧边栏 badge）
 */
export async function getInvalidImageCount(): Promise<{ success: boolean; data?: number; error?: string }> {
  try {
    const db = await getDatabase();
    const row = await get<{ cnt: number }>(db, 'SELECT COUNT(*) as cnt FROM invalid_images');
    return { success: true, data: row?.cnt ?? 0 };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, data: 0, error: errorMessage };
  }
}

/**
 * 删除单个无效项（同时删除缩略图文件）
 */
export async function deleteInvalidImage(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();
    const row = await get<{ filepath: string; thumbnailPath: string | null }>(db,
      'SELECT filepath, thumbnailPath FROM invalid_images WHERE id = ?', [id]);

    if (!row) {
      return { success: false, error: '无效项不存在' };
    }

    // 删除缩略图文件
    if (row.filepath) {
      await deleteThumbnail(row.filepath);
    }

    // 删除数据库记录
    await run(db, 'DELETE FROM invalid_images WHERE id = ?', [id]);

    console.log(`[invalidImageService] 已删除无效项: ID ${id}`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[invalidImageService] 删除无效项失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 清空所有无效项（逐个删除缩略图后清空表）
 */
export async function clearInvalidImages(): Promise<{ success: boolean; data?: { deleted: number }; error?: string }> {
  try {
    const db = await getDatabase();

    // 查询所有需要删除缩略图的 filepath
    const rows = await all<{ filepath: string }>(db,
      'SELECT filepath FROM invalid_images WHERE filepath IS NOT NULL');

    // 逐个删除缩略图（忽略失败）
    for (const row of rows) {
      try {
        await deleteThumbnail(row.filepath);
      } catch {
        // 忽略单个缩略图删除失败
      }
    }

    // 清空表
    await run(db, 'DELETE FROM invalid_images');

    console.log(`[invalidImageService] 已清空所有无效项，共 ${rows.length} 个`);
    return { success: true, data: { deleted: rows.length } };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[invalidImageService] 清空无效项失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/invalidImageService.ts
git commit -m "feat: add invalidImageService with CRUD operations"
```

---

### Task 3: IPC 层 — 注册 handler + 暴露 preload API

**Files:**
- Modify: `src/main/ipc/handlers.ts:1` (import) and after line 427 (gallery handlers 结尾)
- Modify: `src/preload/index.ts:180-199` (gallery API) and `src/preload/index.ts:700-711` (类型声明)

- [ ] **Step 1: 在 `src/main/ipc/handlers.ts` 顶部添加 import**

在现有的 galleryService import（约 line 22-30）附近追加：

```typescript
import {
  reportInvalidImage,
  getInvalidImages,
  getInvalidImageCount,
  deleteInvalidImage,
  clearInvalidImages
} from '../services/invalidImageService.js';
```

- [ ] **Step 2: 在 `src/main/ipc/handlers.ts` 的 gallery handlers 区域后（约 line 427 `gallery:update-gallery-stats` 之后，`// ===== 配置管理 =====` 之前）添加 4 个新 handler**

```typescript
  // ===== 无效图片管理 =====
  ipcMain.handle('gallery:report-invalid-image', async (_event: IpcMainInvokeEvent, imageId: number) => {
    try {
      return await reportInvalidImage(imageId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:get-invalid-images', async (_event: IpcMainInvokeEvent, page: number = 1, pageSize: number = 200) => {
    try {
      return await getInvalidImages(page, pageSize);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:get-invalid-image-count', async (_event: IpcMainInvokeEvent) => {
    try {
      return await getInvalidImageCount();
    } catch (error) {
      return { success: false, data: 0, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:delete-invalid-image', async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await deleteInvalidImage(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:clear-invalid-images', async (_event: IpcMainInvokeEvent) => {
    try {
      return await clearInvalidImages();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
```

- [ ] **Step 3: 修改 `image:get-thumbnail` handler（line 269-296），在生成缩略图失败时增加 `missing` 标记**

将现有的 `image:get-thumbnail` handler 中的 `generateThumbnail` 失败分支修改为：

找到这段代码（约 line 282-285）：
```typescript
          console.error(`[IPC] 缩略图生成失败: ${generateResult.error}`);
          return { success: false, error: generateResult.error || '生成缩略图失败' };
```

替换为：
```typescript
          console.error(`[IPC] 缩略图生成失败: ${generateResult.error}`);
          // 如果错误信息包含"原图不存在"，标记为 missing 以便渲染进程上报
          const isMissing = generateResult.error?.includes('原图不存在') ?? false;
          return { success: false, error: generateResult.error || '生成缩略图失败', missing: isMissing };
```

- [ ] **Step 4: 在 `src/preload/index.ts` 的 gallery 实现区域（line 199 `scanSubfolders` 之后）追加新 API**

在 `scanSubfolders` 方法后追加：

```typescript
    reportInvalidImage: (imageId: number) =>
      ipcRenderer.invoke('gallery:report-invalid-image', imageId),
    getInvalidImages: (page?: number, pageSize?: number) =>
      ipcRenderer.invoke('gallery:get-invalid-images', page, pageSize),
    getInvalidImageCount: () =>
      ipcRenderer.invoke('gallery:get-invalid-image-count'),
    deleteInvalidImage: (id: number) =>
      ipcRenderer.invoke('gallery:delete-invalid-image', id),
    clearInvalidImages: () =>
      ipcRenderer.invoke('gallery:clear-invalid-images'),
```

- [ ] **Step 5: 在 `src/preload/index.ts` 的 gallery 类型声明区域（line 711 `scanSubfolders` 类型之后）追加类型**

在 `scanSubfolders` 类型声明后追加：

```typescript
        reportInvalidImage: (imageId: number) => Promise<{ success: boolean; error?: string }>;
        getInvalidImages: (page?: number, pageSize?: number) => Promise<{ success: boolean; data?: any[]; total?: number; error?: string }>;
        getInvalidImageCount: () => Promise<{ success: boolean; data?: number; error?: string }>;
        deleteInvalidImage: (id: number) => Promise<{ success: boolean; error?: string }>;
        clearInvalidImages: () => Promise<{ success: boolean; data?: { deleted: number }; error?: string }>;
```

- [ ] **Step 6: 验证编译通过**

Run: `npm run dev`
Expected: 无编译错误

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "feat: add IPC handlers and preload API for invalid images"
```

---

### Task 4: 渲染层检测 — ImageGrid 缩略图加载时上报无效图片

**Files:**
- Modify: `src/renderer/components/ImageGrid.tsx:284-325` (loadThumbnails 中的批量加载逻辑)

- [ ] **Step 1: 修改 `ImageGrid.tsx` 的 `loadThumbnails` 函数**

找到 `loadThumbnails` 内部的 `batch.map` 回调（约 line 297-310）。当前代码：

```typescript
          batch.map(async (image) => {
            if (!image.filepath || cancelled) return;
            try {
              const result = await window.electronAPI.image.getThumbnail(image.filepath);
              if (cancelled) return;
              if (result.success && result.data) {
                thumbnails[image.id] = result.data;
              } else {
                thumbnails[image.id] = null;
              }
            } catch (error) {
              thumbnails[image.id] = null;
            }
          })
```

替换为：

```typescript
          batch.map(async (image) => {
            if (!image.filepath || cancelled) return;
            try {
              const result = await window.electronAPI.image.getThumbnail(image.filepath);
              if (cancelled) return;
              if (result.success && result.data) {
                thumbnails[image.id] = result.data;
              } else {
                thumbnails[image.id] = null;
                // 源文件丢失：异步上报为无效图片
                if ((result as any).missing && image.id) {
                  console.log(`[ImageGrid] 检测到源文件丢失，上报无效图片: ${image.filename} (ID: ${image.id})`);
                  window.electronAPI.gallery.reportInvalidImage(image.id).catch(() => {});
                }
              }
            } catch (error) {
              thumbnails[image.id] = null;
            }
          })
```

- [ ] **Step 2: 验证开发模式下，删除一个源文件后刷新图库，控制台可见上报日志**

手动测试：
1. `npm run dev` 启动应用
2. 在图库中找到一张图片，记住其文件路径
3. 在文件管理器中删除该文件
4. 在应用中切换到其他页面再切回图库，触发重新加载
5. Expected: 开发者工具控制台输出 `[ImageGrid] 检测到源文件丢失，上报无效图片: xxx`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ImageGrid.tsx
git commit -m "feat: detect missing source files during thumbnail loading and report as invalid"
```

---

### Task 5: 侧边栏 — 新增"无效项"菜单

**Files:**
- Modify: `src/renderer/App.tsx:1` (import WarningOutlined), `src/renderer/App.tsx:140-146` (buildGallerySubMenuItems)
- Modify: `src/renderer/App.tsx:614-620` (renderBasePage gallery case)
- Modify: `src/renderer/App.tsx:584-612` (renderPageForPin gallery case)
- Modify: `src/renderer/App.tsx:24` (lazy import)
- Modify: `src/renderer/styles/tokens.ts:367-386` (iconColors)
- Modify: `src/renderer/locales/zh-CN.ts` and `en-US.ts`

- [ ] **Step 1: 在 `src/renderer/styles/tokens.ts` 的 `iconColors` 对象中追加**

在 `gphotos: '#FBBC04',` 后追加：

```typescript
  invalidImages: '#F97316',
```

- [ ] **Step 2: 在 `src/renderer/App.tsx` 顶部 import 中追加 `WarningOutlined`**

找到 import 行（line 14-21），在已有图标列表中追加 `WarningOutlined`：

```typescript
import {
  PictureOutlined, SettingOutlined, ClockCircleOutlined,
  AppstoreOutlined, CloudOutlined, BookOutlined,
  CloudDownloadOutlined, StarOutlined, FolderOutlined,
  SunOutlined, MoonOutlined, StopOutlined,
  FireOutlined, DatabaseOutlined, HeartOutlined,
  SearchOutlined, SmileOutlined, MessageOutlined,
  HddOutlined, CameraOutlined, UserOutlined, WarningOutlined
} from '@ant-design/icons';
```

- [ ] **Step 3: 在 `src/renderer/App.tsx` 顶部添加 lazy import**

在 GalleryPage lazy import（line 24）附近追加：

```typescript
const InvalidImagesPage = React.lazy(() => import('./pages/InvalidImagesPage').then(m => ({ default: m.InvalidImagesPage })));
```

- [ ] **Step 4: 修改 `buildGallerySubMenuItems` 函数（line 140-146）**

在 `galleries` 条目后追加 `invalid-images` 条目：

```typescript
function buildGallerySubMenuItems(t: (path: string) => string): MenuItem[] {
  return [
    { key: 'recent', icon: <DotIcon color={iconColors.recent} icon={<ClockCircleOutlined />} />, label: t('menu.recent') },
    { key: 'all', icon: <DotIcon color={iconColors.all} icon={<AppstoreOutlined />} />, label: t('menu.all') },
    { key: 'galleries', icon: <DotIcon color={iconColors.galleries} icon={<FolderOutlined />} />, label: t('menu.galleries') },
    { key: 'invalid-images', icon: <DotIcon color={iconColors.invalidImages} icon={<WarningOutlined />} />, label: t('menu.invalidImages') }
  ];
}
```

- [ ] **Step 5: 修改 `renderBasePage`（line 614-620）的 gallery case**

在 `if (selectedSubKey === 'settings')` 之后、`return <GalleryPage ...>` 之前，添加无效项判断：

```typescript
      case 'gallery':
        if (selectedSubKey === 'settings') return <SettingsPage />;
        if (selectedSubKey === 'invalid-images') return <InvalidImagesPage />;
        return <GalleryPage subTab={selectedSubKey as "recent" | "all" | "galleries" | undefined} />;
```

- [ ] **Step 6: 修改 `renderPageForPin`（line 584-612）的 gallery case**

在 `if (key === 'settings')` 之后追加：

```typescript
      if (key === 'invalid-images') return <InvalidImagesPage />;
```

- [ ] **Step 7: 在 `src/renderer/locales/zh-CN.ts` 的 `menu` 对象中追加**

在 `galleries: '图集',` 后追加：

```typescript
    invalidImages: '无效项',
```

- [ ] **Step 8: 在 `src/renderer/locales/en-US.ts` 的 `menu` 对象中追加**

在 `galleries: 'Albums',` 后追加：

```typescript
    invalidImages: 'Invalid',
```

- [ ] **Step 9: Commit**

```bash
git add src/renderer/App.tsx src/renderer/styles/tokens.ts src/renderer/locales/zh-CN.ts src/renderer/locales/en-US.ts
git commit -m "feat: add 'Invalid Images' sidebar menu entry and routing"
```

---

### Task 6: 无效项页面 — 创建 InvalidImagesPage

**Files:**
- Create: `src/renderer/pages/InvalidImagesPage.tsx`

- [ ] **Step 1: 创建 `src/renderer/pages/InvalidImagesPage.tsx`**

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Button, Empty, message, Modal, Tooltip } from 'antd';
import { DeleteOutlined, ClearOutlined, FolderOpenOutlined, CopyOutlined, WarningOutlined } from '@ant-design/icons';
import { localPathToAppUrl } from '../utils/url';
import { colors, spacing, radius, fontSize, zIndex, shadows } from '../styles/tokens';
import { ContextMenu } from '../components/ContextMenu';
import { LazyLoadFooter } from '../components/LazyLoadFooter';

interface InvalidImage {
  id: number;
  originalImageId: number;
  filename: string;
  filepath: string;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  thumbnailPath: string | null;
  detectedAt: string;
  galleryId: number | null;
}

const PAGE_SIZE = 200;

export const InvalidImagesPage: React.FC = () => {
  const [images, setImages] = useState<InvalidImage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadImages = useCallback(async (pageNum: number, append: boolean = false) => {
    if (!window.electronAPI) return;
    setLoading(true);
    try {
      const result = await window.electronAPI.gallery.getInvalidImages(pageNum, PAGE_SIZE);
      if (result.success) {
        const data = result.data || [];
        setImages(prev => append ? [...prev, ...data] : data);
        setTotal(result.total ?? 0);
        setHasMore(data.length >= PAGE_SIZE);
        setPage(pageNum);
      } else {
        message.error('加载无效图片失败: ' + result.error);
      }
    } catch (error) {
      message.error('加载无效图片失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadImages(1);
  }, [loadImages]);

  const handleLoadMore = useCallback(() => {
    if (!loading && hasMore) {
      loadImages(page + 1, true);
    }
  }, [loading, hasMore, page, loadImages]);

  const handleDelete = useCallback(async (id: number) => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.gallery.deleteInvalidImage(id);
      if (result.success) {
        setImages(prev => prev.filter(img => img.id !== id));
        setTotal(prev => prev - 1);
        message.success('已删除');
      } else {
        message.error('删除失败: ' + result.error);
      }
    } catch {
      message.error('删除失败');
    }
  }, []);

  const handleClearAll = useCallback(() => {
    Modal.confirm({
      title: '清空所有无效项',
      content: `确定要删除全部 ${total} 个无效项及其缩略图吗？此操作不可恢复。`,
      okText: '清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        if (!window.electronAPI) return;
        try {
          const result = await window.electronAPI.gallery.clearInvalidImages();
          if (result.success) {
            setImages([]);
            setTotal(0);
            setHasMore(false);
            message.success(`已清空 ${result.data?.deleted ?? 0} 个无效项`);
          } else {
            message.error('清空失败: ' + result.error);
          }
        } catch {
          message.error('清空失败');
        }
      },
    });
  }, [total]);

  const getImageUrl = (filePath: string | null): string | null => {
    if (!filePath) return null;
    if (filePath.startsWith('app://')) return filePath;
    return localPathToAppUrl(filePath);
  };

  if (!loading && images.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Empty
          description="没有无效图片"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    );
  }

  return (
    <div>
      {/* 顶部操作栏 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.lg,
      }}>
        <span style={{ color: colors.textSecondary, fontSize: fontSize.sm }}>
          共 {total} 项无效图片
        </span>
        {total > 0 && (
          <Button
            danger
            icon={<ClearOutlined />}
            onClick={handleClearAll}
          >
            清空所有
          </Button>
        )}
      </div>

      {/* 瀑布流布局 */}
      <div style={{ columnWidth: 220, columnGap: 12 }}>
        {images.map(img => (
          <InvalidImageCard
            key={img.id}
            image={img}
            thumbnailUrl={getImageUrl(img.thumbnailPath)}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {/* 懒加载底部 */}
      {hasMore && (
        <LazyLoadFooter
          loading={loading}
          hasMore={hasMore}
          onLoadMore={handleLoadMore}
        />
      )}
    </div>
  );
};

/** 单个无效图片卡片 */
const InvalidImageCard: React.FC<{
  image: InvalidImage;
  thumbnailUrl: string | null;
  onDelete: (id: number) => void;
}> = React.memo(({ image, thumbnailUrl, onDelete }) => {
  const aspectRatio = image.width && image.height
    ? (image.height / image.width) * 100
    : 75;

  const contextItems = [
    {
      key: 'copyPath',
      label: '复制原路径',
      icon: <CopyOutlined />,
      onClick: () => {
        navigator.clipboard.writeText(image.filepath);
        message.success('已复制文件路径');
      },
    },
    { type: 'divider' as const },
    {
      key: 'delete',
      label: '删除此项',
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => onDelete(image.id),
    },
  ];

  return (
    <ContextMenu items={contextItems}>
      <div
        className="card-ios-hover"
        style={{
          breakInside: 'avoid',
          marginBottom: 12,
          borderRadius: radius.md,
          overflow: 'hidden',
          boxShadow: shadows.card,
          background: colors.bgBase,
          border: `1px solid ${colors.borderCard}`,
          position: 'relative',
          cursor: 'default',
        }}
      >
        {/* 缩略图区域 */}
        <div style={{ width: '100%', position: 'relative', overflow: 'hidden' }}>
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={image.filename}
              style={{ width: '100%', height: 'auto', display: 'block', opacity: 0.6 }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                paddingBottom: `${aspectRatio}%`,
                backgroundColor: colors.bgDark,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              <WarningOutlined style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: 32,
                color: colors.textQuaternary,
              }} />
            </div>
          )}

          {/* 右上角删除按钮 */}
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(image.id);
            }}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(8px)',
              color: '#FFFFFF',
              zIndex: zIndex.sticky,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
            }}
          />
        </div>

        {/* 信息区域 */}
        <div style={{ padding: `${spacing.sm}px ${spacing.sm}px`, lineHeight: 1.4 }}>
          <div style={{
            fontSize: fontSize.sm,
            fontWeight: 600,
            color: colors.textPrimary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {image.filename}
          </div>
          <Tooltip title={image.filepath} placement="bottom">
            <div style={{
              fontSize: 11,
              color: colors.textTertiary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 2,
            }}>
              {image.filepath}
            </div>
          </Tooltip>
          <div style={{
            fontSize: 11,
            color: colors.textQuaternary,
            marginTop: 2,
          }}>
            {new Date(image.detectedAt).toLocaleString()}
          </div>
        </div>
      </div>
    </ContextMenu>
  );
});

InvalidImageCard.displayName = 'InvalidImageCard';
```

- [ ] **Step 2: 验证页面渲染**

Run: `npm run dev`
1. 启动应用
2. 侧边栏 → 图库 → 无效项
3. Expected: 显示"没有无效图片"空状态

- [ ] **Step 3: Commit**

```bash
git add src/renderer/pages/InvalidImagesPage.tsx
git commit -m "feat: create InvalidImagesPage with waterfall layout and delete/clear actions"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 完整流程测试**

1. `npm run dev` 启动应用
2. 在图库"最近"中确认能看到图片
3. 在文件管理器中删除一张源文件
4. 切换到其他页面再切回"最近"，触发缩略图重新加载
5. Expected:
   - 控制台输出 `[ImageGrid] 检测到源文件丢失`
   - 控制台输出 `[invalidImageService] 已迁移无效图片`
   - 该图片从"最近"列表中消失（下次加载时不再出现）
6. 点击侧边栏"无效项"
7. Expected: 看到刚才删除的图片，显示缩略图、文件名、原路径、检测时间
8. 右键 → 复制原路径 → 粘贴确认路径正确
9. 点击卡片右上角 × 删除该项
10. Expected: 卡片消失，总数减少
11. 如有多个无效项，点击"清空所有" → 确认
12. Expected: 全部清空，显示空状态

- [ ] **Step 2: 最终 Commit**

```bash
git add -A
git commit -m "feat: invalid images management - detect missing files, migrate to dedicated table, browsing and cleanup UI"
```

---

## 实现注意事项

1. **`reportInvalidImage` 的双重校验**：主进程收到上报后，会用 `fs.access` 再次确认源文件确实不存在，避免因缩略图生成的临时失败导致误删。

2. **事务安全**：迁移操作（插入 invalid_images + 删除 images + 更新 gallery）在 `runInTransaction` 内执行，任一步骤失败全部回滚。

3. **gallery 封面处理**：如果被迁移的图片恰好是某个 gallery 的 `coverImageId`，事务内会将其设为 NULL。

4. **缩略图生命周期**：检测时只迁移数据库记录，缩略图保留用于无效项页面展示；只有用户手动删除或清空时才删除缩略图文件。

5. **性能影响**：检测逻辑嵌入已有的缩略图加载路径，`missing` 标记由主进程 `generateThumbnailInternal` 的现有文件检查（line 131-137）产生，不引入额外 I/O。上报调用是 fire-and-forget（`.catch(() => {})`），不阻塞 UI。
