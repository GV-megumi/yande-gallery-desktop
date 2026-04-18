import { Image } from '../../shared/types.js';
import path from 'path';
import { getDatabase, run, get, all, runInTransaction } from './database.js';
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
 * 删除图库（bug12：级联清理 + 自动加入忽略名单）
 *
 * 清理顺序：
 * 1. 校验 galleries 行存在，读出 folderPath + recursive（事务外，只读）；
 * 2. 按归一化 folderPath 前缀 LIKE 查出所有 images（事务外，只读）；
 * 3. 对每张图尽力清理磁盘缩略图（事务外 best-effort，失败只告警）；
 *    —— 磁盘 IO 不进事务：即便事务后续回滚，磁盘缩略图先删也可接受；
 *       放进事务里反而会拖长事务持锁时间。
 * 4. 事务内原子级联（bug12 I1：之前这一段没包事务，中途失败会留半残）：
 *    a. DELETE image_tags / images；
 *    b. DELETE invalid_images WHERE galleryId（显式，虽然 FK 设 SET NULL 也可容忍）；
 *    c. UPDATE booru_posts 把对应 localPath 的 downloaded/localPath 重置，
 *       避免"已下载"状态错乱；
 *    d. DELETE galleries 本行；
 *    e. INSERT OR REPLACE 写入 gallery_ignored_folders，下次扫描不再重建。
 *    任一条失败 → ROLLBACK。
 *
 * 注意：原图文件不删，仅清数据库记录与缩略图缓存。
 */
export async function deleteGallery(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();

    // 1. 校验并取 folderPath
    const existing = await get<{ id: number; folderPath: string; recursive: number }>(
      db,
      'SELECT id, folderPath, recursive FROM galleries WHERE id = ?',
      [id]
    );

    if (!existing) {
      return { success: false, error: 'Gallery not found' };
    }

    const normalized = normalizePath(existing.folderPath);
    // LIKE 前缀使用 path.sep，与 scanDirectory/path.join 入库的 filepath 分隔符保持一致
    const likePrefix = normalized + path.sep;

    // 2. 查该图集范围内的图片
    // bug12 I2：必须按 recursive 字段区分匹配范围，否则非递归图集会误删
    // 子目录下的文件（包括可能属于其他图集的文件）。
    // - recursive=1：整棵子树（前缀 + '%'）
    // - recursive=0：仅直接子文件；SQLite LIKE 没有负字符类，用 AND NOT LIKE
    //   排除 "prefix + 任意 + sep + 任意" 的更深层路径。
    //
    // 注：path.sep 在 Windows 下是反斜杠，在 SQLite LIKE 里没有 escape 语义，
    // 按字面字符参与匹配即可；此处无需额外 escape。
    const isRecursive = existing.recursive === 1 || (existing.recursive as unknown as boolean) === true;
    const images = isRecursive
      ? await all<{ id: number; filepath: string }>(
          db,
          `SELECT id, filepath FROM images
             WHERE filepath LIKE ? OR filepath = ?`,
          [likePrefix + '%', normalized]
        )
      : await all<{ id: number; filepath: string }>(
          db,
          `SELECT id, filepath FROM images
             WHERE filepath LIKE ?
               AND filepath NOT LIKE ?`,
          [likePrefix + '%', likePrefix + '%' + path.sep + '%']
        );

    // 3. best-effort 清缩略图（事务外；依赖 bug13 已修好的 deleteThumbnail 按 filepath 行为）
    if (images.length > 0) {
      const { deleteThumbnail } = await import('./thumbnailService.js');
      for (const img of images) {
        try {
          await deleteThumbnail(img.filepath);
        } catch (err: any) {
          console.warn(
            `[galleryService] 清理缩略图失败: ${img.filepath}`,
            err?.message ?? err
          );
        }
      }
    }

    // 4. 事务内原子级联（bug12 I1：之前这一段没包事务，中途失败会留半残）
    //    任一 DB 写失败整体 ROLLBACK，外层 catch 返回 success:false
    await runInTransaction(db, async () => {
      // 4a. 批量 DELETE image_tags → images
      if (images.length > 0) {
        const idList = images.map(i => i.id);
        const placeholders = idList.map(() => '?').join(',');
        await run(db, `DELETE FROM image_tags WHERE imageId IN (${placeholders})`, idList);
        await run(db, `DELETE FROM images WHERE id IN (${placeholders})`, idList);
      }

      // 4b. invalid_images 按 galleryId 显式清（表定义是 ON DELETE SET NULL，
      //     这里直接删记录更干净，避免累积孤儿行）
      await run(db, `DELETE FROM invalid_images WHERE galleryId = ?`, [id]);

      // 4c. booru_posts 中落地到本图集目录下的帖子：重置 downloaded/localPath
      //     localImageId 已由外键 SET NULL 处理；localPath 的字符串匹配是这里的兜底。
      //
      // bug12 I2：范围必须与 images 查询一致 —— 非递归图集只匹配直接子路径，
      //           避免把子目录图集下的 booru_post 也一起打成未下载。
      if (isRecursive) {
        await run(
          db,
          `UPDATE booru_posts
              SET downloaded = 0, localPath = NULL
              WHERE localPath IS NOT NULL AND (localPath LIKE ? OR localPath = ?)`,
          [likePrefix + '%', normalized]
        );
      } else {
        await run(
          db,
          `UPDATE booru_posts
              SET downloaded = 0, localPath = NULL
              WHERE localPath IS NOT NULL
                AND localPath LIKE ?
                AND localPath NOT LIKE ?`,
          [likePrefix + '%', likePrefix + '%' + path.sep + '%']
        );
      }

      // 4d. 删图集行
      await run(db, 'DELETE FROM galleries WHERE id = ?', [id]);

      // 4e. 写入忽略名单（INSERT OR REPLACE 保留 createdAt）
      const now = new Date().toISOString();
      await run(
        db,
        `INSERT OR REPLACE INTO gallery_ignored_folders
           (folderPath, note, createdAt, updatedAt)
         VALUES (
           ?, ?,
           COALESCE(
             (SELECT createdAt FROM gallery_ignored_folders WHERE folderPath = ?),
             ?
           ),
           ?
         )`,
        [normalized, '删除图集自动忽略', normalized, now, now]
      );
    });

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
    // bug12：加载忽略名单，命中即整棵子树跳过（避免删除后被同一次扫描重建）
    const ignoredRows = await all<{ folderPath: string }>(
      db,
      'SELECT folderPath FROM gallery_ignored_folders'
    );
    const ignoredPaths = new Set(ignoredRows.map(r => r.folderPath));

    // 递归扫描所有子文件夹
    async function scanSubfolders(dirPath: string): Promise<void> {
      try {
        const items = await fs.readdir(dirPath, { withFileTypes: true });

        for (const item of items) {
          const fullPath = path.join(dirPath, item.name);
          const normalizedFullPath = normalizePath(fullPath);

          if (item.isDirectory()) {
            // bug12：命中忽略名单 → 整棵子树跳过（不 recursive、不建图集）
            if (ignoredPaths.has(normalizedFullPath)) {
              skipped++;
              console.log(`[galleryService] 忽略目录（在忽略名单）: ${fullPath}`);
              continue;
            }

            // 检查该文件夹是否包含图片
            const hasImages = await checkFolderHasImages(fullPath, extensions);

            if (hasImages) {
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

// ---------------------------------------------------------------------------
// gallery_ignored_folders CRUD（bug12）
// 记录被用户标记为"不再扫描"的文件夹路径。删除图集时会自动写入，
// 扫描器加载该集合后命中即跳过整棵子树，避免重新创建图集。
// ---------------------------------------------------------------------------

export interface IgnoredFolderRow {
  id: number;
  folderPath: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 列出全部忽略文件夹（按创建时间倒序）
 */
export async function listIgnoredFolders(): Promise<{
  success: boolean;
  data?: IgnoredFolderRow[];
  error?: string;
}> {
  try {
    const db = await getDatabase();
    const rows = await all<IgnoredFolderRow>(
      db,
      `SELECT id, folderPath, note, createdAt, updatedAt
         FROM gallery_ignored_folders
         ORDER BY createdAt DESC`
    );
    return { success: true, data: rows };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryService] 列出忽略文件夹失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 添加/更新一条忽略文件夹记录
 * - 路径先经 normalizePath 归一化（大小写保持原样，但分隔符和末尾斜杠统一）
 * - INSERT OR REPLACE：重复添加会刷新 note 与 updatedAt，但保留原 createdAt
 */
export async function addIgnoredFolder(
  folderPath: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();
    const normalized = normalizePath(folderPath);
    const now = new Date().toISOString();
    await run(
      db,
      `INSERT OR REPLACE INTO gallery_ignored_folders
         (folderPath, note, createdAt, updatedAt)
       VALUES (
         ?, ?,
         COALESCE(
           (SELECT createdAt FROM gallery_ignored_folders WHERE folderPath = ?),
           ?
         ),
         ?
       )`,
      [normalized, note ?? null, normalized, now, now]
    );
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryService] 添加忽略文件夹失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 更新忽略文件夹的备注（note 可选）
 */
export async function updateIgnoredFolder(
  id: number,
  patch: { note?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await run(
      db,
      `UPDATE gallery_ignored_folders
          SET note = ?, updatedAt = ?
          WHERE id = ?`,
      [patch.note ?? null, now, id]
    );
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryService] 更新忽略文件夹失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 删除忽略文件夹（恢复后续可被扫描）
 */
export async function removeIgnoredFolder(
  id: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();
    await run(db, `DELETE FROM gallery_ignored_folders WHERE id = ?`, [id]);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryService] 删除忽略文件夹失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

