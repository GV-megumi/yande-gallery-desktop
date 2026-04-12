import { Image } from '../../shared/types.js';
import path from 'path';
import { getDatabase, run, get, all } from './database.js';
import { normalizePath } from '../utils/path.js';
import { scanAndImportFolder } from './imageService.js';

// 图库类型
export interface Gallery {
  id: number;
  folderPath: string;
  name: string;
  coverImageId?: number;
  imageCount: number;
  lastScannedAt?: string;
  isWatching: boolean;
  recursive: boolean;
  extensions: string[];
  createdAt: string;
  updatedAt: string;
  coverImage?: Image;  // 关联的封面图
}

export interface CreateGalleryDto {
  folderPath: string;
  name: string;
  isWatching?: boolean;
  recursive?: boolean;
  extensions?: string[];
}

/**
 * 获取所有图库列表（不包含图片数据）
 */
export async function getGalleries(): Promise<{ success: boolean; data?: Gallery[]; error?: string }> {
  try {
    const db = await getDatabase();

    const query = `
      SELECT
        g.*,
        i.id as coverImageId,
        i.filename as coverFilename,
        i.filepath as coverFilepath
      FROM galleries g
      LEFT JOIN images i ON g.coverImageId = i.id
      ORDER BY g.updatedAt DESC
    `;

    const results = await all<any>(db, query);

    const galleries: Gallery[] = results.map(row => ({
      id: row.id,
      folderPath: row.folderPath,
      name: row.name,
      coverImageId: row.coverImageId,
      imageCount: row.imageCount,
      lastScannedAt: row.lastScannedAt,
      isWatching: Boolean(row.isWatching),
      recursive: Boolean(row.recursive),
      extensions: row.extensions ? JSON.parse(row.extensions) : [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      coverImage: row.coverImageId ? {
        id: row.coverImageId,
        filename: row.coverFilename,
        filepath: row.coverFilepath,
        fileSize: 0,
        width: 0,
        height: 0,
        format: '',
        createdAt: '',
        updatedAt: ''
      } : undefined
    }));

    return { success: true, data: galleries };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error getting galleries:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 根据ID获取单个图库
 */
export async function getGallery(id: number): Promise<{ success: boolean; data?: Gallery; error?: string }> {
  try {
    const db = await getDatabase();

    const query = `
      SELECT
        g.*,
        i.id as coverImageId,
        i.filename as coverFilename,
        i.filepath as coverFilepath
      FROM galleries g
      LEFT JOIN images i ON g.coverImageId = i.id
      WHERE g.id = ?
    `;

    const row = await get<any>(db, query, [id]);

    if (!row) {
      return { success: false, error: 'Gallery not found' };
    }

    const gallery: Gallery = {
      id: row.id,
      folderPath: row.folderPath,
      name: row.name,
      coverImageId: row.coverImageId,
      imageCount: row.imageCount,
      lastScannedAt: row.lastScannedAt,
      isWatching: Boolean(row.isWatching),
      recursive: Boolean(row.recursive),
      extensions: row.extensions ? JSON.parse(row.extensions) : [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      coverImage: row.coverImageId ? {
        id: row.coverImageId,
        filename: row.coverFilename,
        filepath: row.coverFilepath,
        fileSize: 0,
        width: 0,
        height: 0,
        format: '',
        createdAt: '',
        updatedAt: ''
      } : undefined
    };

    return { success: true, data: gallery };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error getting gallery:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 创建新图库
 */
export async function createGallery(galleryData: CreateGalleryDto): Promise<{ success: boolean; data?: number; error?: string }> {
  try {
    const db = await getDatabase();

    // 规范化路径
    const folderPath = normalizePath(galleryData.folderPath);

    // 检查是否已存在
    const existing = await get<{ id: number }>(
      db,
      'SELECT id FROM galleries WHERE folderPath = ?',
      [folderPath]
    );

    if (existing) {
      return { success: false, error: 'Gallery already exists for this folder' };
    }

    // 判断文件夹是否存在
    const fs = await import('fs/promises');
    try {
      await fs.access(folderPath);
    } catch {
      return { success: false, error: 'Folder does not exist' };
    }

    // 设置扩展名默认值
    const extensions = galleryData.extensions || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

    const sql = `
      INSERT INTO galleries
      (folderPath, name, isWatching, recursive, extensions, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const now = new Date().toISOString();
    const isWatching = galleryData.isWatching ?? true;
    const recursive = galleryData.recursive ?? true;

    await run(db, sql, [
      folderPath,
      galleryData.name,
      isWatching ? 1 : 0,
      recursive ? 1 : 0,
      JSON.stringify(extensions),
      now,
      now
    ]);

    const result = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');

    return { success: true, data: result?.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error creating gallery:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 更新图库
 */
export async function updateGallery(
  id: number,
  updates: Partial<Pick<Gallery, 'name' | 'isWatching' | 'recursive'>>
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();

    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }

    if (updates.isWatching !== undefined) {
      setClauses.push('isWatching = ?');
      values.push(updates.isWatching ? 1 : 0);
    }

    if (updates.recursive !== undefined) {
      setClauses.push('recursive = ?');
      values.push(updates.recursive ? 1 : 0);
    }

    if (setClauses.length === 0) {
      return { success: false, error: 'No updates provided' };
    }

    setClauses.push('updatedAt = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const sql = `UPDATE galleries SET ${setClauses.join(', ')} WHERE id = ?`;
    await run(db, sql, values);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error updating gallery:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 删除图库
 */
export async function deleteGallery(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();

    // 检查是否存在
    const existing = await get<{ id: number }>(
      db,
      'SELECT id FROM galleries WHERE id = ?',
      [id]
    );

    if (!existing) {
      return { success: false, error: 'Gallery not found' };
    }

    await run(db, 'DELETE FROM galleries WHERE id = ?', [id]);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error deleting gallery:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 图库扫描后更新统计信息
 * @param id 图库ID
 * @param imageCount 图片数量
 * @param lastScannedAt 最后扫描时间
 */
export async function updateGalleryStats(
  id: number,
  imageCount: number,
  lastScannedAt: string = new Date().toISOString()
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();

    await run(db, `
      UPDATE galleries
      SET imageCount = ?, lastScannedAt = ?, updatedAt = ?
      WHERE id = ?
    `, [imageCount, lastScannedAt, new Date().toISOString(), id]);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error updating gallery stats:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 设置图库封面
 */
export async function setGalleryCover(
  id: number,
  coverImageId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();

    // 验证图片是否存在
    const image = await get<{ id: number }>(
      db,
      'SELECT id FROM images WHERE id = ?',
      [coverImageId]
    );

    if (!image) {
      return { success: false, error: 'Cover image not found' };
    }

    await run(db, `
      UPDATE galleries
      SET coverImageId = ?, updatedAt = ?
      WHERE id = ?
    `, [coverImageId, new Date().toISOString(), id]);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error setting gallery cover:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 扫描文件夹下的所有子文件夹，为包含图片的子文件夹创建图集
 * @param rootPath 根文件夹路径
 * @param extensions 支持的图片扩展名
 * @returns 创建的图集数量
 */
export async function scanSubfoldersAndCreateGalleries(
  rootPath: string,
  extensions: string[] = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
): Promise<{
  success: boolean;
  data?: { created: number; skipped: number; imported: number; imageSkipped: number };
  error?: string;
}> {
  try {
    const fs = await import('fs/promises');
    const normalizedRoot = normalizePath(rootPath);

    // 检查根文件夹是否存在
    try {
      await fs.access(normalizedRoot);
    } catch {
      return { success: false, error: 'Root folder does not exist' };
    }

    let created = 0;
    let skipped = 0;
    let totalImported = 0;
    let totalImageSkipped = 0;

    // 预先获取所有已存在的图集路径，避免递归中逐个查询
    const db = await getDatabase();
    const existingGalleries = await all<{ folderPath: string }>(db, 'SELECT folderPath FROM galleries');
    const existingPaths = new Set(existingGalleries.map(g => g.folderPath));
    // 预先获取所有已存在的图集名称，用于快速检查重名
    const existingNames = await all<{ name: string }>(db, 'SELECT name FROM galleries');
    const usedNames = new Set(existingNames.map(g => g.name));

    // 递归扫描所有子文件夹
    async function scanSubfolders(dirPath: string): Promise<void> {
      try {
        const items = await fs.readdir(dirPath, { withFileTypes: true });

        for (const item of items) {
          const fullPath = path.join(dirPath, item.name);

          if (item.isDirectory()) {
            // 检查该文件夹是否包含图片
            const hasImages = await checkFolderHasImages(fullPath, extensions);

            if (hasImages) {
              const normalizedFullPath = normalizePath(fullPath);

              // 使用预加载的 Set 检查是否已存在（O(1) 而非 DB 查询）
              if (!existingPaths.has(normalizedFullPath)) {
                // 生成唯一名称（使用内存中的 Set 而非查 DB）
                let galleryName = item.name;
                let suffix = 1;
                while (usedNames.has(galleryName)) {
                  galleryName = `${item.name} (${suffix})`;
                  suffix++;
                }

                // 创建图集
                const result = await createGallery({
                  folderPath: fullPath,
                  name: galleryName,
                  isWatching: true,
                  recursive: false, // 子文件夹图集不需要递归
                  extensions
                });

                if (result.success && result.data) {
                  const galleryId = result.data;
                  created++;
                  // 更新内存中的 Set，避免后续重复
                  existingPaths.add(normalizedFullPath);
                  usedNames.add(galleryName);
                  console.log(`Gallery created: name=${galleryName}, folder=${fullPath}`);

                  // 同步导入该文件夹下的图片到数据库
                  const importResult = await scanAndImportFolder(fullPath, extensions, false);
                  if (importResult.success && importResult.data) {
                    totalImported += importResult.data.imported;
                    totalImageSkipped += importResult.data.skipped;
                    console.log(
                      `Images imported: folder=${fullPath}, imported=${importResult.data.imported}, skipped=${importResult.data.skipped}`
                    );

                    // 更新图集统计信息中的图片数量和最后扫描时间
                    await updateGalleryStats(
                      galleryId,
                      importResult.data.imported,
                      new Date().toISOString()
                    );
                  } else if (!importResult.success) {
                    console.warn(
                      `Import images failed: folder=${fullPath}, error=${importResult.error}`
                    );
                  }
                } else {
                  skipped++;
                  console.log(`Skip gallery: name=${galleryName}, folder=${fullPath}, reason=${result.error}`);
                }
              } else {
                skipped++;
              }
            }

            // 继续递归扫描子文件夹
            await scanSubfolders(fullPath);
          }
        }
      } catch (error) {
        console.error(`Error scanning subfolder ${dirPath}:`, error);
      }
    }

    await scanSubfolders(normalizedRoot);

    console.log(
      `Scan finished: root=${normalizedRoot}, galleriesCreated=${created}, galleriesSkipped=${skipped}, imagesImported=${totalImported}, imagesSkipped=${totalImageSkipped}`
    );

    return {
      success: true,
      data: {
        created,
        skipped,
        imported: totalImported,
        imageSkipped: totalImageSkipped
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error scanning subfolders:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 检查文件夹是否包含图片
 */
async function checkFolderHasImages(folderPath: string, extensions: string[]): Promise<boolean> {
  try {
    const fs = await import('fs/promises');
    const items = await fs.readdir(folderPath, { withFileTypes: true });

    for (const item of items) {
      if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (extensions.includes(ext)) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * 同步图集文件夹：重新扫描指定图集的文件夹，导入新增图片并更新统计信息
 * @param id 图集ID
 * @returns 同步结果（新导入数、跳过数、当前图片总数、扫描时间）
 */
export async function syncGalleryFolder(id: number): Promise<{
  success: boolean;
  data?: { imported: number; skipped: number; imageCount: number; lastScannedAt: string };
  error?: string;
}> {
  console.log('[galleryService] 同步图集文件夹:', id);

  // 1. 获取图集信息
  const galleryResult = await getGallery(id);
  if (!galleryResult.success || !galleryResult.data) {
    return { success: false, error: galleryResult.error || '图集不存在' };
  }

  const gallery = galleryResult.data;

  // 2. 使用图集配置的扩展名，无配置时使用默认值
  const extensions = gallery.extensions && gallery.extensions.length > 0
    ? gallery.extensions
    : ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

  // 3. 复用已有的扫描导入逻辑
  const importResult = await scanAndImportFolder(gallery.folderPath, extensions, gallery.recursive ?? true);
  if (!importResult.success || !importResult.data) {
    return { success: false, error: importResult.error || '同步失败' };
  }

  // 4. 查询该文件夹下的图片总数（直接 COUNT 查询，避免加载全部数据）
  const db = await getDatabase();
  const countRow = await get<{ cnt: number }>(
    db,
    'SELECT COUNT(*) as cnt FROM images WHERE filepath LIKE ?',
    [`${gallery.folderPath}${path.sep}%`]
  );
  const imageCount = countRow?.cnt ?? 0;
  const lastScannedAt = new Date().toISOString();

  // 5. 更新图集统计信息
  await updateGalleryStats(id, imageCount, lastScannedAt);

  console.log(
    `[galleryService] 同步完成: galleryId=${id}, imported=${importResult.data.imported}, skipped=${importResult.data.skipped}, imageCount=${imageCount}`
  );

  return {
    success: true,
    data: {
      imported: importResult.data.imported,
      skipped: importResult.data.skipped,
      imageCount,
      lastScannedAt,
    },
  };
}

/**
 * 生成唯一的图集名称（处理重名）
 */
async function generateUniqueGalleryName(baseName: string): Promise<string> {
  const db = await getDatabase();
  let name = baseName;
  let suffix = 1;

  while (true) {
    const existing = await get<{ id: number }>(
      db,
      'SELECT id FROM galleries WHERE name = ?',
      [name]
    );

    if (!existing) {
      return name;
    }

    name = `${baseName} (${suffix})`;
    suffix++;
  }
}
