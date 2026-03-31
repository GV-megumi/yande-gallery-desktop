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
        const folderPath = await getGalleryFolderPath(db, gallery.id);
        const countResult = await get<{ cnt: number }>(db,
          `SELECT COUNT(*) as cnt FROM images WHERE filepath LIKE ? || '%'`,
          [folderPath]);
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
