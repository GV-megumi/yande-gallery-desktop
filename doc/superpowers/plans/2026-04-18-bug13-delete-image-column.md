# Bug13 — `deleteImage` SELECT 不存在的列导致崩溃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `src/main/services/imageService.ts` 中 `deleteImage` 对 `images` 表 SELECT `thumbnailPath` 导致的 `SQLITE_ERROR: no such column: thumbnailPath`，并改走 `thumbnailService.deleteThumbnail(filepath)` 正确清理磁盘缩略图。

**Architecture:** 去掉错误的列引用，改调现有 `thumbnailService.deleteThumbnail(imagePath)`（该函数按图片路径 hash 反推缩略图路径并容错 ENOENT）。这是 A 档单点修复，不涉及任何 DB schema / IPC / UI 改动。

**Tech Stack:** Node.js、TypeScript、sqlite3、vitest

---

## File Structure

- 修改：`src/main/services/imageService.ts`（`deleteImage` 函数 L262-L303）
- 新建：`tests/main/services/imageService.deleteImage.test.ts`（回归测试：验证 SELECT 不包含 `thumbnailPath`、`deleteThumbnail` 被调用）

---

### Task 1: 为 `deleteImage` 写回归测试

**Files:**
- Create: `tests/main/services/imageService.deleteImage.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟内部依赖
const getMock = vi.fn();
const runMock = vi.fn();
const deleteThumbnailMock = vi.fn(async () => {});
const unlinkMock = vi.fn(async () => {});

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
}));
vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  deleteThumbnail: (...args: any[]) => deleteThumbnailMock(...args),
}));
vi.mock('fs/promises', () => ({
  default: { unlink: (...args: any[]) => unlinkMock(...args) },
}));

describe('imageService.deleteImage', () => {
  beforeEach(() => {
    getMock.mockReset();
    runMock.mockReset();
    deleteThumbnailMock.mockReset();
    unlinkMock.mockReset();
    getMock.mockResolvedValue({ filepath: '/tmp/a.jpg' });
    runMock.mockResolvedValue(undefined);
  });

  it('SELECT 语句不应引用 thumbnailPath 列', async () => {
    const { deleteImage } = await import('../../../src/main/services/imageService.js');
    await deleteImage(42);
    expect(getMock).toHaveBeenCalled();
    const sql = String(getMock.mock.calls[0][1]);
    expect(sql).not.toMatch(/thumbnailPath/);
    expect(sql).toMatch(/SELECT\s+filepath\s+FROM\s+images/i);
  });

  it('成功路径应调用 thumbnailService.deleteThumbnail(filepath)', async () => {
    const { deleteImage } = await import('../../../src/main/services/imageService.js');
    const result = await deleteImage(42);
    expect(result.success).toBe(true);
    expect(deleteThumbnailMock).toHaveBeenCalledWith('/tmp/a.jpg');
  });

  it('当记录不存在（filepath 为空）时不调用 deleteThumbnail', async () => {
    getMock.mockResolvedValueOnce(undefined);
    const { deleteImage } = await import('../../../src/main/services/imageService.js');
    const result = await deleteImage(999);
    expect(result.success).toBe(true);
    expect(deleteThumbnailMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `npx vitest run tests/main/services/imageService.deleteImage.test.ts --config vitest.config.ts`

Expected: 第一条断言 `sql not to match /thumbnailPath/` **FAIL**（当前实现带 `thumbnailPath`）；第二条也会 FAIL（未调用 `deleteThumbnail`）。

---

### Task 2: 修 `deleteImage` 的 SELECT 和磁盘清理

**Files:**
- Modify: `src/main/services/imageService.ts:262-303`

- [ ] **Step 1: 确认顶部 import 已含 `deleteThumbnail`**

查看 `src/main/services/imageService.ts` 开头 import 段。若未 import，追加：

```ts
import { deleteThumbnail } from './thumbnailService.js';
```

- [ ] **Step 2: 替换整个 `deleteImage` 函数**

将 `src/main/services/imageService.ts:262-303` 整段替换为：

```ts
/**
 * 删除图片
 * 注意：普通 images 的缩略图路径不在 DB 里，由 thumbnailService 按图片路径反推，
 *      因此只查 filepath，并通过 deleteThumbnail(filepath) 清理缩略图文件。
 */
export async function deleteImage(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();

    // 先查出文件路径，用于删除磁盘文件和缩略图
    const row = await get<{ filepath: string }>(
      db, 'SELECT filepath FROM images WHERE id = ?', [id]
    );

    // 删除数据库记录
    await run(db, 'DELETE FROM image_tags WHERE imageId = ?', [id]);
    await run(db, 'DELETE FROM images WHERE id = ?', [id]);

    // 删除磁盘原图 + 缩略图（best-effort）
    if (row?.filepath) {
      try {
        await fs.unlink(row.filepath);
        console.log(`[imageService] 已删除磁盘文件: ${row.filepath}`);
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.warn(`[imageService] 删除磁盘文件失败: ${row.filepath}`, err.message);
        }
      }
      // deleteThumbnail 内部已对 ENOENT 容错
      await deleteThumbnail(row.filepath).catch((err: any) => {
        console.warn(`[imageService] 删除缩略图失败: ${row.filepath}`, err?.message ?? err);
      });
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error deleting image:', errorMessage);
    return { success: false, error: errorMessage };
  }
}
```

- [ ] **Step 3: 跑测试确认 PASS**

Run: `npx vitest run tests/main/services/imageService.deleteImage.test.ts --config vitest.config.ts`

Expected: 三条全部 PASS。

- [ ] **Step 4: 跑相关测试套件确认无回归**

Run: `npx vitest run tests/main/services/imageService.test.ts tests/main/services/thumbnailService.test.ts --config vitest.config.ts`

Expected: 全部 PASS。

---

### Task 3: 类型检查 + 提交

**Files:** —（仅验证 + git）

- [ ] **Step 1: 跑主进程 TS 编译**

Run: `npx tsc -p tsconfig.main.json --noEmit`

Expected: 无错误。

- [ ] **Step 2: 归档 bug13 文档**

```bash
git mv bug13.md doc/done/bug13-delete-image-column.md
```

- [ ] **Step 3: 提交**

```bash
git add src/main/services/imageService.ts \
        tests/main/services/imageService.deleteImage.test.ts \
        doc/done/bug13-delete-image-column.md
git commit -m "fix(bug13): deleteImage 去掉不存在的 thumbnailPath 列

$(cat <<'EOF'
images 表没有 thumbnailPath 列（该字段只存在于 invalid_images），
原 SELECT 会抛 SQLITE_ERROR 导致删除单张图片完全不可用。
改为只查 filepath，缩略图清理改走 thumbnailService.deleteThumbnail
(按图片路径 hash 反推，已对 ENOENT 容错)。

新增回归测试覆盖：
- SELECT SQL 不包含 thumbnailPath
- 成功路径调用 deleteThumbnail(filepath)
- 记录不存在时不调用 deleteThumbnail
EOF
)"
```

Expected: commit 成功；`git status` 干净。

---

## Self-Review Checklist

- [x] Spec §批 A A1 的所有要求：SELECT 去 `thumbnailPath`、改调 `deleteThumbnail(filepath)`，均被 Task 2 实现。
- [x] 测试先于实现（Task 1 先写测试且确认 FAIL，Task 2 改完再 PASS）。
- [x] 文件路径、行号、命令均为实际可执行。
- [x] 无占位符、无 TODO。
