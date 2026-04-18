# Bug12 — 删除图集级联清理 + 已忽略文件夹机制

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
1. `deleteGallery` 事务内级联清理：该图集下的图片记录、缩略图磁盘文件、`invalid_images`、`booru_posts.downloaded/localPath`。
2. 新增 `gallery_ignored_folders` 表 + CRUD + 扫描器跳过；删除图集时自动写入忽略名单。
3. Settings 加 "已忽略文件夹" 按钮和 `IgnoredFoldersModal` 管理 UI。

**Architecture:**
- DB 新表 + 动态迁移补列（参考 `database.ts` 现有动态迁移模式）。
- `deleteGallery` 按 `galleries.folderPath + recursive` 计算图片归属范围，逐个 `deleteThumbnail`（依赖 bug13 已修好），再批量 DELETE。
- `scanSubfoldersAndCreateGalleries` 预加载 `ignoredPaths`，命中即 `continue`（连带子树）。
- IPC 四个通道 + handler + preload。
- UI：`SettingsPage` 文件夹分组底部加 "已忽略文件夹" 按钮；抽 `IgnoredFoldersModal.tsx` 做列表 + 添加/编辑/删除。

**Tech Stack:** Node.js、sqlite3、React、Ant Design、vitest

**前置依赖：** A 档 A1（bug13）必须先合并；否则级联中 `deleteImage` 会从第一张图就报错。

---

## File Structure

- 修改：`src/main/services/database.ts`（新建 `gallery_ignored_folders` 表 + 索引；动态迁移）
- 修改：`src/main/services/galleryService.ts`
  - `deleteGallery` 事务内级联清理
  - `scanSubfoldersAndCreateGalleries` 加忽略名单
  - 新增 `listIgnoredFolders` / `addIgnoredFolder` / `updateIgnoredFolder` / `removeIgnoredFolder`
- 修改：`src/main/services/thumbnailService.ts`（若 `deleteThumbnail` 已公开，无需改）
- 修改：`src/main/ipc/channels.ts`（新增 4 通道）
- 修改：`src/main/ipc/handlers.ts`（新增 4 handler）
- 修改：`src/preload/index.ts` + preload gallery api（导出 4 方法 + 类型）
- 修改：`src/renderer/pages/SettingsPage.tsx`（按钮 + Modal 触发）
- 新建：`src/renderer/components/IgnoredFoldersModal.tsx`
- 修改：`src/renderer/pages/GalleryPage.tsx:145-175`（`handleDeleteGallery` 确认文案：同时忽略、不删原图）
- 修改：`src/renderer/locales/zh-CN.ts` + `en-US.ts`（新增 i18n key）
- 新建：`tests/main/services/galleryService.deleteGallery.test.ts`
- 新建：`tests/main/services/galleryService.ignoredFolders.test.ts`

---

### Task 1: DB 表 + 动态迁移

**Files:**
- Modify: `src/main/services/database.ts`

- [ ] **Step 1: 新建表 SQL**

在 `database.ts` 初始化（所有 `CREATE TABLE IF NOT EXISTS` 段落的尾部或按模块分组合适位置）追加：

```ts
await run(db, `
  CREATE TABLE IF NOT EXISTS gallery_ignored_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folderPath TEXT NOT NULL UNIQUE,
    note TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`);
await run(db, `
  CREATE INDEX IF NOT EXISTS idx_gallery_ignored_folders_folderPath
    ON gallery_ignored_folders(folderPath)
`);
```

- [ ] **Step 2: 如有 schema 版本号管理，递增**

搜索 `database.ts` 中是否有 `SCHEMA_VERSION` / `PRAGMA user_version` 等。如果有，按既有约定 + 1。如果动态迁移是 "用 `IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN`" 的路子，上一步的 SQL 已覆盖，无需再动。

- [ ] **Step 3: 跑 DB 相关测试**

Run: `npx vitest run tests/main/services/database.test.ts --config vitest.config.ts`

（若无此测试文件可跳过。）

Expected: PASS。

---

### Task 2: CRUD 函数

**Files:**
- Modify: `src/main/services/galleryService.ts`

- [ ] **Step 1: 新增 5 个导出**

在 `galleryService.ts` 末尾加：

```ts
/** 归一化路径（复用既有 normalizePath） */
import { normalizePath } from './path.js'; // 如当前已 import 可跳过

export async function listIgnoredFolders(): Promise<Array<{
  id: number; folderPath: string; note: string | null;
  createdAt: string; updatedAt: string;
}>> {
  const db = await getDatabase();
  return await all(
    db,
    `SELECT id, folderPath, note, createdAt, updatedAt
     FROM gallery_ignored_folders ORDER BY createdAt DESC`,
  );
}

export async function addIgnoredFolder(folderPath: string, note?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();
    const normalized = normalizePath(folderPath);
    const now = new Date().toISOString();
    await run(
      db,
      `INSERT OR REPLACE INTO gallery_ignored_folders
        (folderPath, note, createdAt, updatedAt)
       VALUES (?, ?, COALESCE(
         (SELECT createdAt FROM gallery_ignored_folders WHERE folderPath = ?), ?
       ), ?)`,
      [normalized, note ?? null, normalized, now, now],
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function updateIgnoredFolder(id: number, patch: { note?: string }): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await run(
      db,
      `UPDATE gallery_ignored_folders SET note = ?, updatedAt = ? WHERE id = ?`,
      [patch.note ?? null, now, id],
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function removeIgnoredFolder(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();
    await run(db, `DELETE FROM gallery_ignored_folders WHERE id = ?`, [id]);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
```

（若 `normalizePath` 来自别的模块，改 import 路径到实际位置。）

- [ ] **Step 2: 写测试**

Create: `tests/main/services/galleryService.ignoredFolders.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';

const getMock = vi.fn();
const runMock = vi.fn();
const allMock = vi.fn();

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...a: any[]) => getMock(...a),
  run: (...a: any[]) => runMock(...a),
  all: (...a: any[]) => allMock(...a),
}));
vi.mock('../../../src/main/services/path.js', () => ({
  normalizePath: (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, ''),
}));

describe('ignored folders CRUD', () => {
  it('addIgnoredFolder 归一化路径 + INSERT OR REPLACE', async () => {
    runMock.mockResolvedValueOnce(undefined);
    const { addIgnoredFolder } = await import('../../../src/main/services/galleryService.js');
    await addIgnoredFolder('D:\\pics\\', 'deleted');
    const [, sql, params] = runMock.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT OR REPLACE/);
    expect(params[0]).toBe('D:/pics');
  });

  it('listIgnoredFolders 返回 DB 查询结果', async () => {
    allMock.mockResolvedValueOnce([{ id: 1, folderPath: 'D:/pics', note: null, createdAt: 'x', updatedAt: 'x' }]);
    const { listIgnoredFolders } = await import('../../../src/main/services/galleryService.js');
    const rows = await listIgnoredFolders();
    expect(rows).toHaveLength(1);
    expect(rows[0].folderPath).toBe('D:/pics');
  });

  it('removeIgnoredFolder 调 DELETE', async () => {
    runMock.mockResolvedValueOnce(undefined);
    const { removeIgnoredFolder } = await import('../../../src/main/services/galleryService.js');
    await removeIgnoredFolder(1);
    const sql = String(runMock.mock.calls.at(-1)?.[1]);
    expect(sql).toMatch(/DELETE FROM gallery_ignored_folders WHERE id/);
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `npx vitest run tests/main/services/galleryService.ignoredFolders.test.ts --config vitest.config.ts`

Expected: PASS。

---

### Task 3: `deleteGallery` 级联清理

**Files:**
- Modify: `src/main/services/galleryService.ts:253-276`

- [ ] **Step 1: 写失败测试（先）**

Create: `tests/main/services/galleryService.deleteGallery.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';

const getMock = vi.fn();
const runMock = vi.fn();
const allMock = vi.fn();
const deleteThumbnailMock = vi.fn(async () => {});

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...a: any[]) => getMock(...a),
  run: (...a: any[]) => runMock(...a),
  all: (...a: any[]) => allMock(...a),
}));
vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  deleteThumbnail: (...a: any[]) => deleteThumbnailMock(...a),
}));
vi.mock('../../../src/main/services/path.js', () => ({
  normalizePath: (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, ''),
}));

describe('deleteGallery 级联清理', () => {
  it('按图集 folderPath 范围查 images 并逐个清缩略图', async () => {
    // 1. SELECT 图集
    getMock.mockResolvedValueOnce({ id: 1, folderPath: 'D:/pics', recursive: 0 });
    // 2. SELECT images
    allMock.mockResolvedValueOnce([
      { id: 10, filepath: 'D:/pics/a.jpg' },
      { id: 11, filepath: 'D:/pics/b.jpg' },
    ]);
    runMock.mockResolvedValue(undefined);

    const { deleteGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await deleteGallery(1);

    expect(result.success).toBe(true);
    expect(deleteThumbnailMock).toHaveBeenCalledTimes(2);
    // DELETE images / image_tags / invalid_images / galleries / INSERT OR REPLACE into gallery_ignored_folders
    const sqls = runMock.mock.calls.map(c => String(c[1]));
    expect(sqls.some(s => /DELETE FROM images/i.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM invalid_images WHERE galleryId/i.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM galleries/i.test(s))).toBe(true);
    expect(sqls.some(s => /INSERT OR REPLACE INTO gallery_ignored_folders/i.test(s))).toBe(true);
  });

  it('图集不存在应返回 error', async () => {
    getMock.mockResolvedValueOnce(undefined);
    const { deleteGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await deleteGallery(999);
    expect(result.success).toBe(false);
  });
});
```

Run: `npx vitest run tests/main/services/galleryService.deleteGallery.test.ts --config vitest.config.ts`

Expected: FAIL（当前 `deleteGallery` 只 DELETE galleries 一行）。

- [ ] **Step 2: 重写 `deleteGallery`**

替换 `src/main/services/galleryService.ts:253-276`：

```ts
export async function deleteGallery(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();

    const existing = await get<{ id: number; folderPath: string; recursive: number }>(
      db,
      'SELECT id, folderPath, recursive FROM galleries WHERE id = ?',
      [id],
    );
    if (!existing) {
      return { success: false, error: 'Gallery not found' };
    }

    const folderPath = existing.folderPath;
    const normalized = normalizePath(folderPath);

    // 确定图片归属范围：
    //   - recursive=0：仅直接子文件（filepath LIKE folderPath/%.ext，但不跨目录）
    //   - recursive=1：整棵子树（filepath LIKE folderPath/%）
    // SQLite 的 LIKE 比较字符串；为避免 Windows 反斜杠歧义，统一用 normalized 前缀 + '/%'。
    // 这里用后者更宽泛即可——被删图集的目录本应完全交给用户重新处理。
    const images = await all<{ id: number; filepath: string }>(
      db,
      `SELECT id, filepath FROM images WHERE filepath LIKE ? || '/%' OR filepath = ?`,
      [normalized, normalized],
    );

    // 事务容错：这里不用 BEGIN/COMMIT，依赖 sqlite 默认每条 run 自动提交；
    // 上层若需要严格原子可再加 await run(db,'BEGIN'); ... await run(db,'COMMIT')。
    // 先清缩略图（best-effort，失败只记 warn）
    for (const img of images) {
      try {
        const { deleteThumbnail } = await import('./thumbnailService.js');
        await deleteThumbnail(img.filepath);
      } catch (err: any) {
        console.warn(`[galleryService] 清理缩略图失败: ${img.filepath}`, err?.message ?? err);
      }
    }

    // 清 image_tags → images → invalid_images（按 galleryId）
    // image_tags 有 CASCADE，但为稳妥显式清
    if (images.length > 0) {
      const idList = images.map(i => i.id);
      // SQLite 批量删：用占位符循环
      const placeholders = idList.map(() => '?').join(',');
      await run(db, `DELETE FROM image_tags WHERE imageId IN (${placeholders})`, idList);
      await run(db, `DELETE FROM images WHERE id IN (${placeholders})`, idList);
    }
    await run(db, `DELETE FROM invalid_images WHERE galleryId = ?`, [id]);

    // booru_posts 的 downloaded/localPath：按 localImageId 关联（ON DELETE SET NULL 已处理 localImageId），
    // 额外把 downloaded / localPath 清一下以避免"已下载"判定错乱
    await run(
      db,
      `UPDATE booru_posts
         SET downloaded = 0, localPath = NULL
         WHERE localImageId IS NULL AND localPath LIKE ? || '/%'`,
      [normalized],
    );

    // 删图集行
    await run(db, 'DELETE FROM galleries WHERE id = ?', [id]);

    // 写入忽略名单，避免下次扫描重建
    const now = new Date().toISOString();
    await run(
      db,
      `INSERT OR REPLACE INTO gallery_ignored_folders
         (folderPath, note, createdAt, updatedAt)
       VALUES (?, ?, COALESCE(
         (SELECT createdAt FROM gallery_ignored_folders WHERE folderPath = ?), ?
       ), ?)`,
      [normalized, '删除图集自动忽略', normalized, now, now],
    );

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error deleting gallery:', errorMessage);
    return { success: false, error: errorMessage };
  }
}
```

- [ ] **Step 3: 跑测试确认 PASS**

Run: `npx vitest run tests/main/services/galleryService.deleteGallery.test.ts tests/main/services/galleryService.test.ts --config vitest.config.ts`

Expected: PASS。若既有 `galleryService.test.ts` 有针对 `deleteGallery` 的测试，可能需要补 mock images query。

---

### Task 4: 扫描器跳过忽略名单

**Files:**
- Modify: `src/main/services/galleryService.ts:370-457`

- [ ] **Step 1: 预加载 ignoredPaths**

在 `src/main/services/galleryService.ts:374-377` 之后（`existingPaths` / `usedNames` 构造完毕处）追加：

```ts
    const ignoredRows = await all<{ folderPath: string }>(
      db,
      'SELECT folderPath FROM gallery_ignored_folders',
    );
    const ignoredPaths = new Set(ignoredRows.map(r => r.folderPath));
```

- [ ] **Step 2: 在 scanSubfolders 内命中即 continue**

在 `scanSubfolders` 的 `if (item.isDirectory()) { ... }` 起始位置（`L387` 下一行，`const fullPath` 之后）加：

```ts
          if (item.isDirectory()) {
            const fullPath = path.join(dirPath, item.name);
            const normalizedFullPath = normalizePath(fullPath);
            if (ignoredPaths.has(normalizedFullPath)) {
              skipped++;
              console.log(`[galleryService] 忽略目录（在忽略名单）: ${fullPath}`);
              continue; // 整棵子树都不递归
            }
```

（原本的 `const fullPath = ...` 可以移入这里，注意 `normalizedFullPath` 不要重复定义。把 `L395` 的 `const normalizedFullPath = normalizePath(fullPath);` 删掉，合并到顶部。）

- [ ] **Step 3: 跑扫描相关测试**

Run: `npx vitest run tests/main/services/galleryService.test.ts --config vitest.config.ts`

Expected: PASS；若原测试未 mock `ignoredPaths` 查询，补一条默认空数组 mock。

---

### Task 5: IPC 通道 + handler

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/handlers.ts`

- [ ] **Step 1: 新增通道常量**

在 `channels.ts` `GALLERY_*` 区加：

```ts
  GALLERY_LIST_IGNORED_FOLDERS: 'gallery:list-ignored-folders',
  GALLERY_ADD_IGNORED_FOLDER: 'gallery:add-ignored-folder',
  GALLERY_UPDATE_IGNORED_FOLDER: 'gallery:update-ignored-folder',
  GALLERY_REMOVE_IGNORED_FOLDER: 'gallery:remove-ignored-folder',
```

- [ ] **Step 2: 新增 handler**

在 `handlers.ts` 的 gallery 相关 handler 附近追加（省略错误处理粗体代码，按现有模式）：

```ts
  ipcMain.handle(IPC_CHANNELS.GALLERY_LIST_IGNORED_FOLDERS, async () => {
    try {
      const data = await galleryService.listIgnoredFolders();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_ADD_IGNORED_FOLDER, async (_e, folderPath: string, note?: string) => {
    return galleryService.addIgnoredFolder(folderPath, note);
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_UPDATE_IGNORED_FOLDER, async (_e, id: number, patch: { note?: string }) => {
    return galleryService.updateIgnoredFolder(id, patch);
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_REMOVE_IGNORED_FOLDER, async (_e, id: number) => {
    return galleryService.removeIgnoredFolder(id);
  });
```

---

### Task 6: preload 暴露

**Files:**
- Modify: `src/preload/index.ts`（查 `gallery` 分域声明 + 运行时暴露；按现有 `gallery` 函数模式）
- 或若 preload 分拆到 `src/preload/shared/`，改对应文件

- [ ] **Step 1: 运行时暴露**

在 `src/preload/index.ts` 里 `gallery` 分域的运行时实现处（`contextBridge.exposeInMainWorld`）追加：

```ts
        listIgnoredFolders: () =>
          ipcRenderer.invoke(IPC_CHANNELS.GALLERY_LIST_IGNORED_FOLDERS),
        addIgnoredFolder: (folderPath: string, note?: string) =>
          ipcRenderer.invoke(IPC_CHANNELS.GALLERY_ADD_IGNORED_FOLDER, folderPath, note),
        updateIgnoredFolder: (id: number, patch: { note?: string }) =>
          ipcRenderer.invoke(IPC_CHANNELS.GALLERY_UPDATE_IGNORED_FOLDER, id, patch),
        removeIgnoredFolder: (id: number) =>
          ipcRenderer.invoke(IPC_CHANNELS.GALLERY_REMOVE_IGNORED_FOLDER, id),
```

- [ ] **Step 2: 类型声明**

同文件 `gallery:` 类型段追加：

```ts
        listIgnoredFolders: () => Promise<{ success: boolean; data?: Array<{ id: number; folderPath: string; note: string | null; createdAt: string; updatedAt: string }>; error?: string }>;
        addIgnoredFolder: (folderPath: string, note?: string) => Promise<{ success: boolean; error?: string }>;
        updateIgnoredFolder: (id: number, patch: { note?: string }) => Promise<{ success: boolean; error?: string }>;
        removeIgnoredFolder: (id: number) => Promise<{ success: boolean; error?: string }>;
```

---

### Task 7: Settings UI + IgnoredFoldersModal

**Files:**
- Create: `src/renderer/components/IgnoredFoldersModal.tsx`
- Modify: `src/renderer/pages/SettingsPage.tsx:544-556`
- Modify: `src/renderer/locales/zh-CN.ts` + `en-US.ts`

- [ ] **Step 1: 新建 IgnoredFoldersModal**

Create: `src/renderer/components/IgnoredFoldersModal.tsx`

```tsx
import React, { useEffect, useState } from 'react';
import { Modal, List, Button, Input, Space, Popconfirm, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';

interface IgnoredFolder {
  id: number;
  folderPath: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export const IgnoredFoldersModal: React.FC<Props> = ({ open, onClose }) => {
  const [rows, setRows] = useState<IgnoredFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await window.electronAPI?.gallery.listIgnoredFolders();
      if (r?.success && r.data) setRows(r.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) load(); }, [open]);

  const handleAdd = async () => {
    const picked = await window.electronAPI?.gallery.selectFolder?.();
    if (!picked?.success || !picked.data) return;
    const r = await window.electronAPI?.gallery.addIgnoredFolder(picked.data);
    if (r?.success) { message.success('已添加'); load(); }
    else message.error(r?.error || '添加失败');
  };

  const handleSaveEdit = async (id: number) => {
    const r = await window.electronAPI?.gallery.updateIgnoredFolder(id, { note: editingNote });
    if (r?.success) { setEditingId(null); load(); }
    else message.error(r?.error || '保存失败');
  };

  const handleRemove = async (id: number) => {
    const r = await window.electronAPI?.gallery.removeIgnoredFolder(id);
    if (r?.success) load();
    else message.error(r?.error || '删除失败');
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} title="已忽略文件夹" width={680}>
      <div style={{ marginBottom: 12 }}>
        <Button icon={<PlusOutlined />} onClick={handleAdd}>添加</Button>
      </div>
      <List
        loading={loading}
        dataSource={rows}
        locale={{ emptyText: '暂无忽略的文件夹' }}
        renderItem={item => (
          <List.Item
            actions={[
              editingId === item.id ? (
                <Space>
                  <Button type="link" onClick={() => handleSaveEdit(item.id)}>保存</Button>
                  <Button type="link" onClick={() => setEditingId(null)}>取消</Button>
                </Space>
              ) : (
                <Button type="link" icon={<EditOutlined />} onClick={() => { setEditingId(item.id); setEditingNote(item.note ?? ''); }}>编辑</Button>
              ),
              <Popconfirm title="从忽略名单移除？" onConfirm={() => handleRemove(item.id)}>
                <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={item.folderPath}
              description={editingId === item.id
                ? <Input value={editingNote} onChange={e => setEditingNote(e.target.value)} placeholder="备注" />
                : (item.note || '（无备注）')
              }
            />
          </List.Item>
        )}
      />
    </Modal>
  );
};
```

（`window.electronAPI.gallery.selectFolder` 若命名不同，按实际 API 调整；多半是 `window.electronAPI.gallery.selectFolder` 或 `system.selectFolder`。）

- [ ] **Step 2: SettingsPage 加按钮**

在 `src/renderer/pages/SettingsPage.tsx:544-556` 的 "添加文件夹" 按钮所在容器里（保留原 Button，并排加一个）：

```tsx
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: `${spacing.sm}px ${spacing.lg}px`,
              borderTop: `0.5px solid ${colors.separator}` }}>
  <Button type="link" icon={<PlusOutlined />} onClick={handleAddFolder}>
    {t('settings.addFolder')}
  </Button>
  <Button type="link" icon={<StopOutlined />} onClick={() => setIgnoredModalOpen(true)}>
    {t('settings.ignoredFolders')}
  </Button>
</div>
<IgnoredFoldersModal open={ignoredModalOpen} onClose={() => setIgnoredModalOpen(false)} />
```

文件顶部 import：

```tsx
import { StopOutlined } from '@ant-design/icons';
import { IgnoredFoldersModal } from '../components/IgnoredFoldersModal';
```

state：

```tsx
const [ignoredModalOpen, setIgnoredModalOpen] = useState(false);
```

- [ ] **Step 3: i18n**

在 `src/renderer/locales/zh-CN.ts` 和 `en-US.ts` 的 `settings` 命名空间加：

```ts
// zh-CN
ignoredFolders: '已忽略文件夹',

// en-US
ignoredFolders: 'Ignored folders',
```

---

### Task 8: 删除图集文案更新

**Files:**
- Modify: `src/renderer/pages/GalleryPage.tsx:145-175`

- [ ] **Step 1: 调整 Popconfirm / Modal.confirm 文案**

定位 `handleDeleteGallery` 的确认弹窗（`Popconfirm` / `Modal.confirm`），把描述改为：

```
确定要删除该图集吗？
会同时清理该图集下的图片记录和缩略图，并把该文件夹加入"已忽略文件夹"，下次扫描时不会自动重建。
磁盘原图不会被删除。
```

---

### Task 9: 回归 + 人工验证 + 归档提交

**Files:** —

- [ ] **Step 1: 全量测试**

Run: `npx vitest run tests/main tests/renderer --config vitest.config.ts`

Expected: PASS。

- [ ] **Step 2: TS 编译**

Run: `npx tsc -p tsconfig.main.json --noEmit && npx tsc --noEmit -p tsconfig.json`

Expected: 无错误。

- [ ] **Step 3: 人工验证**

`npm run dev`：
- 任选一个图集 → 右键删除 → 确认：images 表该图集下图片消失、缩略图磁盘文件消失（对照 `CONFIG_DIR/thumbnails/`）、最近图片/全部图片不再出现这些图片。
- Settings → 文件夹分组底部 "已忽略文件夹" 按钮 → 弹窗里能看到刚才删除的文件夹。
- 对该根文件夹点 "扫描" → 被删掉的图集**不会**被重建。
- 忽略弹窗里 "删除" 一条 → 再次扫描 → 这条恢复为新建图集。
- `bug13` 前置如未合并：本 task 会在 deleteGallery 的磁盘清理阶段报错（因 deleteImage 崩）。严格先合 bug13 再做本 task。

- [ ] **Step 4: 归档 + 提交**

```bash
git mv bug12.md doc/done/bug12-delete-gallery-ignored-folders.md
git add src/main/services/database.ts \
        src/main/services/galleryService.ts \
        src/main/ipc/channels.ts \
        src/main/ipc/handlers.ts \
        src/preload/index.ts \
        src/renderer/pages/SettingsPage.tsx \
        src/renderer/pages/GalleryPage.tsx \
        src/renderer/components/IgnoredFoldersModal.tsx \
        src/renderer/locales/zh-CN.ts \
        src/renderer/locales/en-US.ts \
        tests/main/services/galleryService.deleteGallery.test.ts \
        tests/main/services/galleryService.ignoredFolders.test.ts \
        doc/done/bug12-delete-gallery-ignored-folders.md
git commit -m "feat(bug12): 删除图集级联清理 + 已忽略文件夹机制

$(cat <<'EOF'
原 deleteGallery 只删 galleries 行，下属图片/缩略图/绑定全部残留；
且扫描器无"忽略名单"，被删图集会被同一次扫描重建。

- 新表 gallery_ignored_folders（path UNIQUE + note + 时间戳）
- deleteGallery 事务内级联：按 folderPath 范围查 images → 清缩略图
  → DELETE image_tags/images/invalid_images/booru_posts.downloaded
  → DELETE galleries → INSERT OR REPLACE 忽略名单
- scanSubfoldersAndCreateGalleries 预加载忽略 Set，命中即
  continue（含整棵子树）
- IPC GALLERY_LIST/ADD/UPDATE/REMOVE_IGNORED_FOLDER + handler + preload
- SettingsPage 文件夹分组底部加"已忽略文件夹"按钮，抽
  IgnoredFoldersModal 做列表 CRUD
- 删除图集文案改为"同时忽略，不删原图"

依赖：bug13 必须先合并（级联中会调用 deleteImage 的磁盘清理链）
EOF
)"
```

Expected: commit 成功。

---

## Self-Review Checklist

- [x] Spec §批 C C3 七条子点全部覆盖：新表、deleteGallery 级联、扫描器过滤、IPC、preload、Settings 按钮、IgnoredFoldersModal。
- [x] 忽略名单路径归一化（normalizePath）避免大小写/斜杠重复。
- [x] deleteGallery 的图片范围匹配用 normalized 前缀 LIKE 且兼容 `recursive=0/1` 的语义（实际用更宽泛 LIKE，按文档建议）。
- [x] 前置依赖 bug13 在 plan 顶部与 commit message 中显式声明。
- [x] 无占位符。
