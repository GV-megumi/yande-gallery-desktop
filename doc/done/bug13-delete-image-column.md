# Bug 13: 删除图片报 `SQLITE_ERROR: no such column: thumbnailPath`

## 现象

在图库页面对单张图片执行删除操作时，前端直接弹出：

```
删除失败: SQLITE_ERROR: no such column: thumbnailPath
```

DB 记录、磁盘文件、缩略图都不会被清理。

## 根因

[src/main/services/imageService.ts:262-303](src/main/services/imageService.ts#L262-L303) `deleteImage` 里的 SELECT 语句引用了 `images` 表上**不存在**的列：

```ts
const row = await get<{ filepath: string; thumbnailPath?: string }>(
  db,
  'SELECT filepath, thumbnailPath FROM images WHERE id = ?',   // ← thumbnailPath 不在 images 表
  [id],
);
```

`images` 表 DDL ([database.ts:58-70](src/main/services/database.ts#L58-L70)) **没有** `thumbnailPath` 字段：

```sql
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL UNIQUE,
  fileSize INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  format TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
```

`thumbnailPath` 列**只存在**于 `invalid_images` 表（[database.ts:520-534](src/main/services/database.ts#L520-L534)，[L529](src/main/services/database.ts#L529)）。SQLite 直接报 `no such column`，整个 `deleteImage` 进入 catch，返回失败。

普通 images 的缩略图并不存在 DB 字段里，而是由 [thumbnailService.ts:219-225](src/main/services/thumbnailService.ts#L219-L225) `getThumbnailPath(imagePath)` **按图片路径哈希**计算出来的——也就是说"通过 SELECT 拿 thumbnailPath"这套路对普通 images 表来说从一开始就是错的。

整个 `deleteImage` 的逻辑只需要 `filepath`，`thumbnailPath` 分支里 [L289-L295](src/main/services/imageService.ts#L289-L295) 的 `fs.unlink(row.thumbnailPath)` 其实也从来执行不到（即便 SQL 不报错，查出来也总是 `undefined`）。

## 修复方案

两件事一起改：

### 1. SELECT 不要再查不存在的列

[imageService.ts:267-269](src/main/services/imageService.ts#L267-L269) 改为：

```ts
const row = await get<{ filepath: string }>(
  db,
  'SELECT filepath FROM images WHERE id = ?',
  [id],
);
```

对应把类型定义和后续分支里对 `row?.thumbnailPath` 的引用一并删掉。

### 2. 清缩略图走 `thumbnailService.deleteThumbnail`

不要自己 `fs.unlink` 一个不存在的字段，改用已封装好的清理函数（[thumbnailService.ts:285-294](src/main/services/thumbnailService.ts#L285-L294) `deleteThumbnail(imagePath)`，按图片路径反推缩略图路径再 `fs.unlink`，并吞掉 ENOENT）。完整函数大致长这样：

```ts
import { deleteThumbnail } from './thumbnailService.js';

export async function deleteImage(id: number) {
  try {
    const db = await getDatabase();

    const row = await get<{ filepath: string }>(
      db, 'SELECT filepath FROM images WHERE id = ?', [id],
    );

    await run(db, 'DELETE FROM image_tags WHERE imageId = ?', [id]);
    await run(db, 'DELETE FROM images WHERE id = ?', [id]);

    if (row?.filepath) {
      // 原图
      try { await fs.unlink(row.filepath); }
      catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.warn(`[imageService] 删除磁盘文件失败: ${row.filepath}`, err.message);
        }
      }
      // 缩略图（按 hash(filepath) 反推）
      await deleteThumbnail(row.filepath).catch(() => { /* best-effort */ });
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error deleting image:', errorMessage);
    return { success: false, error: errorMessage };
  }
}
```

> `deleteThumbnail` 已经对"缩略图不存在"做了容错（吞 ENOENT）；不需要再在上层加 try/catch。

## 检查清单（同类问题）

在同一次修改里顺带 grep 一遍其它地方，避免同类再爆：

- [invalidImageService.ts:143-144](src/main/services/invalidImageService.ts#L143-L144) 对 `invalid_images` 表 SELECT `thumbnailPath` 是合法的（这张表**有**该字段），**不用改**。
- [imageService.ts](src/main/services/imageService.ts) 其它查 `images` 的 SELECT 是否都只取存在的字段，重点看 `updatedAt`、`fileSize` 等；当前 grep 没看到同类漏洞。
- 未来若需要真的把缩略图路径落库，应当走数据库迁移 `ALTER TABLE images ADD COLUMN thumbnailPath TEXT`（并在 [database.ts](src/main/services/database.ts) 初始化里动态补列），并把 [thumbnailService.ts](src/main/services/thumbnailService.ts) 的生成 / 失效逻辑一起更新；但本 Bug 不需要走这条路——用 `deleteThumbnail(imagePath)` 就够了。

## 与其它 Bug 的关系

- [bug12.md](bug12.md) 建议在 `deleteGallery` 里按图片一条条调 `thumbnailService.deleteThumbnail(filepath)` 清磁盘缓存——前提是 `deleteImage` 这条单图清理链是正确可用的。本 Bug 不修，`deleteGallery` 若内部调用 `deleteImage`，整个清理链会从第一张图就报错退出。建议先修本 Bug，再做 bug12。

## 影响

- **功能直接失效**：当前"删除单张图片"入口完全不可用，用户每次点都报错。
- **"图库懒加载/去重/扫描"链路被污染**：用户无法从 UI 删掉已识别为垃圾或误加的图片；只能走数据库清理或重新扫描。
- **误导性报错**：错误消息把内部 SQL 暴露给用户，观感上像是严重故障；实际只是一行 SELECT 写错了列名。
