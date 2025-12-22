import { Image, Tag } from '../../shared/types.js';
import { getDatabase, run, get, all } from './database.js';
import path from 'path';
import fs from 'fs/promises';
import { generateThumbnail } from './thumbnailService.js';
import { getConfig } from './config.js';

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
    const searchTerm = `%${query.toLowerCase()}%`;
    const offset = (page - 1) * pageSize;

    // 定义SQL查询结果的临时类型
    interface ImageQueryResult extends Omit<Image, 'tags'> {
      tags?: string;
    }

    // 查询总数
    const countResult = await get<{ count: number }>(
      db,
      `
        SELECT COUNT(DISTINCT i.id) as count
        FROM images i
        LEFT JOIN image_tags it ON i.id = it.imageId
        LEFT JOIN tags t ON it.tagId = t.id
        WHERE LOWER(i.filename) LIKE ? OR LOWER(t.name) LIKE ?
      `,
      [searchTerm, searchTerm]
    );
    const total = countResult?.count || 0;

    const images = await all<ImageQueryResult>(
      db,
      `
        SELECT
          i.*,
          GROUP_CONCAT(t.name) as tags
        FROM images i
        LEFT JOIN image_tags it ON i.id = it.imageId
        LEFT JOIN tags t ON it.tagId = t.id
        WHERE LOWER(i.filename) LIKE ? OR LOWER(t.name) LIKE ?
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
 * 删除图片
 */
export async function deleteImage(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();
    await run(db, 'DELETE FROM images WHERE id = ?', [id]);
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
    const searchTerm = `%${query.toLowerCase()}%`;
    const tags = await all<Tag>(
      db,
      'SELECT * FROM tags WHERE LOWER(name) LIKE ? ORDER BY name ASC',
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
        ORDER BY i.updatedAt DESC
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
 * 按文件夹获取图片
 * @param folderPath 文件夹路径
 * @param page 页码
 * @param pageSize 每页数量
 */
export async function getImagesByFolder(
  folderPath: string,
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

    // 查询该文件夹下的图片（包含子目录）
    const images = await all<ImageQueryResult>(
      db,
      `
        SELECT
          i.*,
          GROUP_CONCAT(t.name) as tags
        FROM images i
        LEFT JOIN image_tags it ON i.id = it.imageId
        LEFT JOIN tags t ON it.tagId = t.id
        WHERE i.filepath LIKE ?
        GROUP BY i.id
        ORDER BY i.updatedAt DESC
        LIMIT ? OFFSET ?
      `,
      [`${folderPath}%`, pageSize, offset]
    );

    // 查询总数
    const countResult = await get<{ count: number }>(
      db,
      'SELECT COUNT(*) as count FROM images WHERE filepath LIKE ?',
      [`${folderPath}%`]
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
    console.error('Error getting images by folder:', errorMessage);
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
 */
export async function scanAndImportFolder(
  folderPath: string,
  extensions: string[] = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
  recursive: boolean = true
): Promise<{ success: boolean; data?: { imported: number; skipped: number }; error?: string }> {
  try {
    const files = await scanDirectory(folderPath, recursive);
    const imported: any[] = [];
    let skipped = 0;

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (extensions.includes(ext)) {
        try {
          // 检查是否已存在（避免重复导入）
          const db = await getDatabase();
          const existing = await get<{ id: number }>(
            db,
            'SELECT id FROM images WHERE filepath = ?',
            [file]
          );

          if (!existing) {
            // 导入新图片
            const imageInfo = await getImageInfo(file);
            if (imageInfo) {
              const result = await addImage(imageInfo);
              if (result.success && result.data) {
                imported.push({ ...imageInfo, id: result.data });
                
                // 自动生成缩略图（如果配置启用了自动生成）
                try {
                  const config = getConfig();
                  if (config.app.autoScan) {
                    // 异步生成缩略图，不阻塞导入流程
                    generateThumbnail(file).catch(error => {
                      console.error(`自动生成缩略图失败 ${file}:`, error);
                    });
                  }
                } catch (error) {
                  // 缩略图生成失败不影响导入
                  console.error(`自动生成缩略图失败 ${file}:`, error);
                }
              }
            }
          } else {
            skipped++;
          }
        } catch (error) {
          console.error(`Failed to process image ${file}:`, error);
        }
      }
    }

    return {
      success: true,
      data: {
        imported: imported.length,
        skipped
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
 */
async function scanDirectory(dirPath: string, recursive: boolean = true): Promise<string[]> {
  const files: string[] = [];
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory() && recursive) {
        const subFiles = await scanDirectory(fullPath, recursive);
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
