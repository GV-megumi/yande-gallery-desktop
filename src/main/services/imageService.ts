import { Image, Tag } from '../../shared/types.js';
import { getDatabase, run, get, all, runInTransaction } from './database.js';
import path from 'path';
import fs from 'fs/promises';
import { normalizePath, isSubPath } from '../utils/path.js';
import { enqueueThumbnailGeneration, deleteThumbnail } from './thumbnailService.js';
import { getConfig } from './config.js';
import { emitBuiltRendererAppEvent } from './rendererEventBus.js';
import { emitGalleryImagesChanged } from './appEventPublisher.js';

/**
 * 图片服务 - 数据库操作实现
 */

/**
 * 初始化数据库
 */
export async function initDatabase(): Promise<{ success: boolean; error?: string }> {
  const { initDatabase: dbInit } = await import('./database.js');
  return dbInit();
}

/**
 * 获取图片列表（分页）
 */
export async function getImages(page: number = 1, pageSize: number = 50): Promise<{ success: boolean; data?: Image[]; error?: string }> {
  try {
    const db = await getDatabase();
    const offset = (page - 1) * pageSize;

    console.log(`[getImages] 查询参数: page=${page}, pageSize=${pageSize}, offset=${offset}`);

    // 定义SQL查询结果的临时类型
    interface ImageQueryResult extends Omit<Image, 'tags'> {
      tags?: string;
    }

    const images = await all<ImageQueryResult>(
      db,
      `
        SELECT
          i.*,
          GROUP_CONCAT(t.name) as tags
        FROM images i
        LEFT JOIN image_tags it ON i.id = it.imageId
        LEFT JOIN tags t ON it.tagId = t.id
        GROUP BY i.id
        ORDER BY i.updatedAt DESC
        LIMIT ? OFFSET ?
      `,
      [pageSize, offset]
    );

    console.log(`[getImages] 实际查询返回数量: ${images.length}`);

    // 转换tags字符串为Tag数组
    const result = images.map(image => {
      const imageData: Image = {
        ...image,
        tags: image.tags && typeof image.tags === 'string' ? image.tags.split(',').map((tag: string) => ({
          id: 0, // 这里简化处理，实际应该查询标签ID
          name: tag,
          createdAt: image.createdAt
        })) : []
      };
      return imageData;
    });

    console.log(`[getImages] 最终返回数量: ${result.length}`);
    return { success: true, data: result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error getting images:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 添加图片
 * - 对于本地扫描的图片：使用文件系统的创建/修改时间
 * - 对于其他来源（例如网络下载）：如果未提供时间，则使用当前时间
 */
export async function addImage(
  image: Omit<Image, 'id'> & { tags?: string[] }
): Promise<{ success: boolean; data?: number; error?: string }> {
  try {
    const db = await getDatabase();

    // 插入图片数据
    const sql = `
      INSERT INTO images (filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const now = new Date().toISOString();

    const createdAt = image.createdAt ?? now;
    const updatedAt = image.updatedAt ?? now;

    await run(db, sql, [
      image.filename,
      image.filepath,
      image.fileSize,
      image.width,
      image.height,
      image.format,
      createdAt,
      updatedAt
    ]);

    // 获取插入的图片ID
    const result = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
    const imageId = result?.id;

    if (!imageId) {
      throw new Error('Failed to get inserted image ID');
    }

    // 如果有标签，添加标签关联
    if (image.tags && image.tags.length > 0) {
      await addTagsToImage(imageId, image.tags);
    }

    return { success: true, data: imageId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error adding image:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 搜索图片（支持分页）
 */
export async function searchImages(
  query: string,
  page: number = 1,
  pageSize: number = 50
): Promise<{ success: boolean; data?: Image[]; total?: number; error?: string }> {
  try {
    const db = await getDatabase();
    // SQLite LIKE 默认对 ASCII 字符大小写不敏感，无需 toLowerCase()
    const searchTerm = `%${query}%`;
    const offset = (page - 1) * pageSize;

    // 定义SQL查询结果的临时类型
    interface ImageQueryResult extends Omit<Image, 'tags'> {
      tags?: string;
    }

    // 使用 EXISTS 子查询代替 JOIN + WHERE，避免 GROUP_CONCAT 在 WHERE 阶段参与
    // SQLite LIKE 默认对 ASCII 字符大小写不敏感，无需 LOWER()
    const countResult = await get<{ count: number }>(
      db,
      `
        SELECT COUNT(*) as count
        FROM images i
        WHERE i.filename LIKE ?
          OR EXISTS (
            SELECT 1 FROM image_tags it
            JOIN tags t ON it.tagId = t.id
            WHERE it.imageId = i.id AND t.name LIKE ?
          )
      `,
      [searchTerm, searchTerm]
    );
    const total = countResult?.count || 0;

    // 先筛选匹配的图片 ID，再 JOIN 获取标签（避免 WHERE 中的 JOIN 扩大扫描范围）
    const images = await all<ImageQueryResult>(
      db,
      `
        SELECT
          i.*,
          GROUP_CONCAT(t2.name) as tags
        FROM images i
        LEFT JOIN image_tags it2 ON i.id = it2.imageId
        LEFT JOIN tags t2 ON it2.tagId = t2.id
        WHERE i.filename LIKE ?
          OR EXISTS (
            SELECT 1 FROM image_tags it
            JOIN tags t ON it.tagId = t.id
            WHERE it.imageId = i.id AND t.name LIKE ?
          )
        GROUP BY i.id
        ORDER BY i.updatedAt DESC
        LIMIT ? OFFSET ?
      `,
      [searchTerm, searchTerm, pageSize, offset]
    );

    // 转换tags字符串为Tag数组（简化处理）
    const result = images.map(image => {
      const tagsArray = (image.tags && typeof image.tags === 'string' ? image.tags.split(',') : [])
        .map((tag: string) => ({
          id: 0,
          name: tag,
          createdAt: image.createdAt
        }));
      return {
        ...image,
        tags: tagsArray
      };
    });

    return { success: true, data: result, total };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error searching images:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 获取单张图片
 */
export async function getImageById(id: number): Promise<{ success: boolean; data?: Image; error?: string }> {
  try {
    const db = await getDatabase();

    // 定义SQL查询结果的临时类型
    interface ImageQueryResult extends Omit<Image, 'tags'> {
      tags?: string;
    }

    const image = await get<ImageQueryResult>(
      db,
      `
        SELECT
          i.*,
          GROUP_CONCAT(t.name) as tags
        FROM images i
        LEFT JOIN image_tags it ON i.id = it.imageId
        LEFT JOIN tags t ON it.tagId = t.id
        WHERE i.id = ?
        GROUP BY i.id
      `,
      [id]
    );

    if (!image) {
      return { success: false, error: 'Image not found' };
    }

    // 转换tags字符串为Tag数组
    const result: Image = {
      ...image,
      tags: image.tags && typeof image.tags === 'string' ? image.tags.split(',').map((tag: string) => ({
        id: 0,
        name: tag,
        createdAt: image.createdAt
      })) : []
    };

    return { success: true, data: result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error getting image by ID:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 反查图片所属图集 ID（用于删除事件的 galleryId 归属）。
 *
 * Phase 2B：图集归属改用显式成员表 gallery_images，不再做 folderPath 前缀匹配。
 * 成员表由所有写入路径维护（新建图集 / 扫描 / Booru 下载），归属语义更准确，
 * 也不受路径形态（兄弟目录、LIKE 元字符、大小写）影响。
 *
 * 一张图片可同属多个图集（成员主键为 galleryId+imageId），删除事件只需一个
 * 代表性的 galleryId，取第一条（LIMIT 1）即可。
 */
async function findGalleryIdForImage(
  db: Awaited<ReturnType<typeof getDatabase>>,
  imageId: number
): Promise<{ id: number } | null> {
  const row = await get<{ galleryId: number }>(
    db,
    'SELECT galleryId FROM gallery_images WHERE imageId = ? LIMIT 1',
    [imageId]
  );
  return row ? { id: row.galleryId } : null;
}

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
    // 图集归属：用 gallery_images 成员表反查（Phase 2B）。
    // 必须在 DELETE FROM images 之前查询——删 images 行会 CASCADE 清掉其成员行。
    const gallery = row
      ? await findGalleryIdForImage(db, id)
      : null;

    // 删除数据库记录（images 行被删时 gallery_images 成员行随 FK CASCADE 一并清理）
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

    if (row) {
      emitGalleryImagesChanged({
        action: 'deleted',
        imageId: id,
        galleryId: gallery?.id ?? null,
        affectedGalleryIds: gallery ? [gallery.id] : undefined,
        affectedImageIds: [id],
        affectedCount: 1,
        reason: 'userDelete',
        filepath: row.filepath,
      });
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error deleting image:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 更新图片标签
 */
export async function updateImageTags(imageId: number, tags: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();

    // 先删除原有标签关联
    await run(db, 'DELETE FROM image_tags WHERE imageId = ?', [imageId]);

    // 添加新标签
    if (tags.length > 0) {
      await addTagsToImage(imageId, tags);
    }

    // 更新updatedAt
    await run(db, 'UPDATE images SET updatedAt = ? WHERE id = ?', [new Date().toISOString(), imageId]);

    emitGalleryImagesChanged({
      action: 'tagsUpdated',
      imageId,
      affectedImageIds: [imageId],
      affectedCount: 1,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error updating image tags:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 添加标签到图片
 */
async function addTagsToImage(imageId: number, tagNames: string[]): Promise<void> {
  const db = await getDatabase();

  // 使用事务批量处理标签，避免每个标签 3-4 次独立数据库操作
  await runInTransaction(db, async () => {
    for (const tagName of tagNames) {
      // 检查标签是否存在
      let tag = await get<{ id: number }>(
        db,
        'SELECT id FROM tags WHERE LOWER(name) = LOWER(?)',
        [tagName]
      );

      // 如果不存在，创建新标签
      if (!tag) {
        await run(db, 'INSERT INTO tags (name, createdAt) VALUES (?, ?)', [tagName, new Date().toISOString()]);
        const result = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
        if (result) {
          tag = result;
        }
      }

      // 添加关联
      if (tag) {
        await run(db, 'INSERT OR IGNORE INTO image_tags (imageId, tagId) VALUES (?, ?)', [imageId, tag.id]);
      }
    }
  });
}

/**
 * 获取所有标签
 */
export async function getAllTags(): Promise<{ success: boolean; data?: Tag[]; error?: string }> {
  try {
    const db = await getDatabase();
    const tags = await all<Tag>(
      db,
      'SELECT * FROM tags ORDER BY name ASC'
    );
    return { success: true, data: tags };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error getting tags:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 搜索标签
 */
export async function searchTags(query: string): Promise<{ success: boolean; data?: Tag[]; error?: string }> {
  try {
    const db = await getDatabase();
    // SQLite LIKE 默认对 ASCII 字符大小写不敏感，无需 LOWER()
    const searchTerm = `%${query}%`;
    const tags = await all<Tag>(
      db,
      'SELECT * FROM tags WHERE name LIKE ? ORDER BY name ASC',
      [searchTerm]
    );
    return { success: true, data: tags };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error searching tags:', errorMessage);
    return { success: false, error: errorMessage };
  }
}


/**
 * 获取最近的图片（按更新时间降序）
 */
export async function getRecentImages(count: number = 100): Promise<{ success: boolean; data?: Image[]; error?: string }> {
  try {
    const db = await getDatabase();

    // 定义SQL查询结果的临时类型
    interface ImageQueryResult extends Omit<Image, 'tags'> {
      tags?: string;
    }

    const images = await all<ImageQueryResult>(
      db,
      `
        SELECT
          i.*,
          GROUP_CONCAT(t.name) as tags
        FROM images i
        LEFT JOIN image_tags it ON i.id = it.imageId
        LEFT JOIN tags t ON it.tagId = t.id
        GROUP BY i.id
        ORDER BY i.updatedAt DESC, i.id DESC
        LIMIT ?
      `,
      [count]
    );

    // 转换tags字符串为Tag数组（简化处理）
    const result = images.map(image => {
      const tagsArray = (image.tags && typeof image.tags === 'string' ? image.tags.split(',') : [])
        .map((tag: string) => ({
          id: 0,
          name: tag,
          createdAt: image.createdAt
        }));
      return {
        ...image,
        tags: tagsArray
      };
    });

    return { success: true, data: result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error getting recent images:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 获取比当前最近页顶部游标更新的图片。
 * 用于缓存页恢复时的轻量增量刷新，避免重新加载并重排已有瀑布流块。
 */
export async function getRecentImagesAfter(
  updatedAt: string,
  id: number,
  limit: number = 200,
  beforeUpdatedAt?: string,
  beforeId?: number
): Promise<{ success: boolean; data?: Image[]; error?: string }> {
  try {
    const db = await getDatabase();

    interface ImageQueryResult extends Omit<Image, 'tags'> {
      tags?: string;
    }

    const hasBeforeCursor = !!beforeUpdatedAt && typeof beforeId === 'number';
    const beforeCursorClause = hasBeforeCursor
      ? 'AND (i.updatedAt < ? OR (i.updatedAt = ? AND i.id < ?))'
      : '';
    const params: Array<string | number> = [updatedAt, updatedAt, id];
    if (hasBeforeCursor) {
      params.push(beforeUpdatedAt!, beforeUpdatedAt!, beforeId!);
    }
    params.push(limit);

    const images = await all<ImageQueryResult>(
      db,
      `
        SELECT
          i.*,
          GROUP_CONCAT(t.name) as tags
        FROM images i
        LEFT JOIN image_tags it ON i.id = it.imageId
        LEFT JOIN tags t ON it.tagId = t.id
        WHERE (i.updatedAt > ? OR (i.updatedAt = ? AND i.id > ?))
          ${beforeCursorClause}
        GROUP BY i.id
        ORDER BY i.updatedAt DESC, i.id DESC
        LIMIT ?
      `,
      params
    );

    const result = images.map(image => {
      const tagsArray = (image.tags && typeof image.tags === 'string' ? image.tags.split(',') : [])
        .map((tag: string) => ({
          id: 0,
          name: tag,
          createdAt: image.createdAt
        }));
      return {
        ...image,
        tags: tagsArray
      };
    });

    return { success: true, data: result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error getting recent images after cursor:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 按图集成员表读取图片（Phase 2B）
 *
 * 图片归属来源是显式 join gallery_images 成员表（不用 filepath 前缀匹配）。
 * 成员表由所有写入路径维护（新建图集 / 扫描 / Booru 下载），语义更准确
 * （图集与文件夹解耦后不依赖路径形态）。row→Image 映射与分页返回形状与其它图片读取一致。
 *
 * @param galleryId 图集 ID
 * @param page 页码
 * @param pageSize 每页数量
 */
export async function getImagesByGallery(
  galleryId: number,
  page: number = 1,
  pageSize: number = 50
): Promise<{ success: boolean; data?: Image[]; total?: number; error?: string }> {
  try {
    const db = await getDatabase();
    const offset = (page - 1) * pageSize;

    // 定义SQL查询结果的临时类型
    interface ImageQueryResult extends Omit<Image, 'tags'> {
      tags?: string;
    }

    // 查询该图集成员图片（显式成员表 join，不做 filepath 前缀匹配）
    const images = await all<ImageQueryResult>(
      db,
      `
        SELECT
          i.*,
          GROUP_CONCAT(t.name) as tags
        FROM gallery_images gi
        JOIN images i ON i.id = gi.imageId
        LEFT JOIN image_tags it ON i.id = it.imageId
        LEFT JOIN tags t ON it.tagId = t.id
        WHERE gi.galleryId = ?
        GROUP BY i.id
        ORDER BY i.updatedAt DESC
        LIMIT ? OFFSET ?
      `,
      [galleryId, pageSize, offset]
    );

    // 查询总数
    const countResult = await get<{ count: number }>(
      db,
      'SELECT COUNT(*) as count FROM gallery_images WHERE galleryId = ?',
      [galleryId]
    );
    const total = countResult?.count || 0;

    // 转换tags字符串为Tag数组（简化处理）
    const result = images.map(image => {
      const tagsArray = (image.tags && typeof image.tags === 'string' ? image.tags.split(',') : [])
        .map((tag: string) => ({
          id: 0,
          name: tag,
          createdAt: image.createdAt
        }));
      return {
        ...image,
        tags: tagsArray
      };
    });

    return { success: true, data: result, total };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error getting images by gallery:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 获取所有文件夹列表（去重）
 */
export async function getAllFolders(): Promise<{ success: boolean; data?: string[]; error?: string }> {
  try {
    const db = await getDatabase();

    const folders = await all<{ folder: string }>(
      db,
      `
        SELECT DISTINCT SUBSTR(filepath, 1, LENGTH(filepath) - LENGTH(filename) - 1) as folder
        FROM images
        ORDER BY folder ASC
      `
    );

    const result = folders.map(f => f.folder).filter(Boolean);

    return { success: true, data: result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error getting folders:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 递归扫描并导入文件夹中的图片
 *
 * @param excludeDirs 排除目录（黑名单整棵子树跳过，修复轮 U05）：递归遍历时命中
 *   其中任一目录（或其后代）即整棵剪枝，不深入、不导入。调用方（galleryService.
 *   scanFolderIntoGallery）传入忽略名单中位于扫描根内部的条目，防止「删除图集
 *   自动拉黑」的子树被父级重扫整棵复活。
 */
export async function scanAndImportFolder(
  folderPath: string,
  extensions: string[] = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
  recursive: boolean = true,
  excludeDirs: string[] = []
): Promise<{
  success: boolean;
  data?: { imported: number; skipped: number; importedIds?: number[] };
  error?: string;
}> {
  try {
    // 排除目录先归一化，遍历时与 normalizePath 后的候选目录做前缀判定
    const normalizedExcludes = excludeDirs.map(dir => normalizePath(dir));
    if (normalizedExcludes.length > 0) {
      console.log(`[scanAndImportFolder] 携带排除目录 ${normalizedExcludes.length} 个（命中即整棵剪枝）`);
    }
    const files = await scanDirectory(folderPath, recursive, normalizedExcludes);
    const db = await getDatabase();

    // 只保留符合扩展名的文件
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return extensions.includes(ext);
    });

    console.log(`[scanAndImportFolder] 扫描到 ${imageFiles.length} 个图片文件`);

    // 批量检查已存在的文件路径（每批 500 个，避免 SQL 参数过多）
    const existingPaths = new Set<string>();
    const batchSize = 500;
    for (let i = 0; i < imageFiles.length; i += batchSize) {
      const batch = imageFiles.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const rows = await all<{ filepath: string }>(
        db,
        `SELECT filepath FROM images WHERE filepath IN (${placeholders})`,
        batch
      );
      for (const row of rows) {
        existingPaths.add(row.filepath);
      }
    }

    const skipped = existingPaths.size;
    const newFiles = imageFiles.filter(f => !existingPaths.has(f));
    console.log(`[scanAndImportFolder] 已存在 ${skipped} 个，需导入 ${newFiles.length} 个`);

    const imported: any[] = [];
    const config = getConfig();
    const autoThumbnail = config.app.autoScan;

    for (const file of newFiles) {
      try {
        const imageInfo = await getImageInfo(file);
        if (imageInfo) {
          const result = await addImage(imageInfo);
          if (result.success && result.data) {
            imported.push({ ...imageInfo, id: result.data });

            // 扫描导入只提交后台任务；可见图片请求会在缩略图队列中获得更高优先级。
            if (autoThumbnail) {
              enqueueThumbnailGeneration(file);
            }
          }
        }
      } catch (error) {
        console.error(`Failed to process image ${file}:`, error);
      }
    }

    if (imported.length > 0) {
      emitBuiltRendererAppEvent({
        type: 'gallery:images-imported',
        source: 'imageService',
        payload: {
          folderPath,
          imported: imported.length,
          skipped,
          recursive,
          reason: 'scanAndImportFolder',
        },
      });
    }

    return {
      success: true,
      data: {
        imported: imported.length,
        skipped,
        // 本次真正新导入的图片 id（修复轮 U08）：供 galleryService.scanFolderIntoGallery
        // 在目标图集被并发删除（成员写入 FK 失败）时精确兜底回收，避免零归属僵尸行
        importedIds: imported.map((img) => img.id as number),
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error scanning folder:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 辅助函数：递归扫描目录
 *
 * @param excludeDirs 已归一化的排除目录：子目录命中其中任一条目（或位于其内部，
 *   isSubPath 对相等路径也返回 true）即整棵剪枝——不 readdir、不收集其文件。
 */
async function scanDirectory(dirPath: string, recursive: boolean = true, excludeDirs: string[] = []): Promise<string[]> {
  const files: string[] = [];
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory() && recursive) {
        // 黑名单整棵剪枝：命中排除目录或其后代即跳过整棵子树
        if (excludeDirs.length > 0) {
          const normalizedFull = normalizePath(fullPath);
          if (excludeDirs.some(excluded => isSubPath(excluded, normalizedFull))) {
            console.log(`[scanDirectory] 命中排除目录，整棵子树跳过: ${normalizedFull}`);
            continue;
          }
        }
        const subFiles = await scanDirectory(fullPath, recursive, excludeDirs);
        files.push(...subFiles);
      } else if (item.isFile()) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }

  return files;
}

/**
 * 辅助函数：获取图片信息
 */
async function getImageInfo(filePath: string): Promise<Omit<Image, 'id' | 'tags'> | null> {
  try {
    const stats = await fs.stat(filePath);

    // 简化版本，不实际读取图片内容
    const ext = path.extname(filePath).toLowerCase();
    const format = ext.replace('.', '');

    // 模拟图片尺寸（实际项目中应该使用sharp获取真实尺寸）
    const mockDimensions: Record<string, { width: number; height: number }> = {
      'jpg': { width: 1920, height: 1080 },
      'jpeg': { width: 1920, height: 1080 },
      'png': { width: 1920, height: 1080 },
      'gif': { width: 400, height: 300 },
      'webp': { width: 1920, height: 1080 },
      'bmp': { width: 1920, height: 1080 }
    };

    const dimensions = mockDimensions[format] || { width: 800, height: 600 };

    return {
      filename: path.basename(filePath),
      filepath: filePath,
      fileSize: stats.size,
      width: dimensions.width,
      height: dimensions.height,
      format: format,
      // 使用文件系统时间：创建时间 & 最后修改时间
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString()
    };
  } catch (error) {
    console.error(`Failed to get image info for ${filePath}:`, error);
    return null;
  }
}
