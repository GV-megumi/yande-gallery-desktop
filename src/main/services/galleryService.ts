import { Image } from '../../shared/types.js';
import path from 'path';
import { getDatabase, run, runWithChanges, get, all, runInTransaction } from './database.js';
import { normalizePath, escapeLike } from '../utils/path.js';
import { scanAndImportFolder } from './imageService.js';
import { emitBuiltRendererAppEvent } from './rendererEventBus.js';
import {
  emitGalleryGalleriesChanged,
  emitGalleryIgnoredFoldersChanged,
} from './appEventPublisher.js';
import { addGalleryRoot, removeGalleryRoot } from './galleryRootRegistry.js';

// 默认图片扩展名（绑定/扫描未显式指定 extensions 时的回退值）
const DEFAULT_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

// 孤儿回收批大小：IN(...) 占位符按此分批，避免大图集超过 SQLite 变量上限
// （部分构建为 999；UPDATE booru_posts 一条语句带两组占位符，故每条 ≤ 2×500=1000，仍安全）。
const ORPHAN_GC_BATCH = 500;

/** 把数组按固定大小切片（用于 IN(...) 占位符分批） */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// 图库类型
// Phase 8A：图集与文件夹解耦后，folderPath/recursive/extensions 归 gallery_folders（按文件夹），
// 不再是图集级属性；isWatching 改名为 autoScan（是否自动扫描）。
export interface Gallery {
  id: number;
  name: string;
  coverImageId?: number;
  imageCount: number;
  lastScannedAt?: string;
  autoScan: boolean;
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
      name: row.name,
      coverImageId: row.coverImageId,
      imageCount: row.imageCount,
      lastScannedAt: row.lastScannedAt,
      autoScan: Boolean(row.autoScan),
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
      name: row.name,
      coverImageId: row.coverImageId,
      imageCount: row.imageCount,
      lastScannedAt: row.lastScannedAt,
      autoScan: Boolean(row.autoScan),
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
 * 读取全部图集绑定文件夹（去重、非空）——Phase 4 的 app:// 白名单装载来源。
 *
 * 取代旧的 `getGalleries().data.map(g => g.folderPath)`：后者只反映 galleries 旧列
 * （= 图集创建时的原始文件夹），不含 bindFolder 追加或 changeFolderPath 重定位后的
 * 文件夹。gallery_folders 才是当前绑定集合的 source of truth，故白名单必须从它装载，
 * 否则绑定/重定位的文件夹在重启后会从 app:// 白名单丢失，导致其图片无法加载。
 */
export async function getAllGalleryFolderPaths(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await all<{ folderPath: string }>(
    db,
    "SELECT DISTINCT folderPath FROM gallery_folders WHERE folderPath IS NOT NULL AND folderPath <> ''"
  );
  return rows.map(r => r.folderPath).filter(Boolean);
}

/**
 * 读取某图集的全部绑定文件夹（Phase 4）——供 booru 下载路径校验与多文件夹扫描使用。
 * 返回 gallery_folders 中该 galleryId 的 folderPath 列表（绑定表存的是归一化路径）。
 */
export async function getGalleryFolderPaths(galleryId: number): Promise<string[]> {
  const db = await getDatabase();
  const rows = await all<{ folderPath: string }>(
    db,
    'SELECT folderPath FROM gallery_folders WHERE galleryId = ?',
    [galleryId]
  );
  return rows.map(r => r.folderPath).filter(Boolean);
}

/**
 * 读取某图集的全部绑定文件夹（含 recursive / extensions）——Phase 7B 的「图集信息」
 * 多文件夹管理对话框渲染来源。
 *
 * 与 getGalleryFolderPaths（只返回 folderPath 字符串数组）不同，本函数返回结构化行：
 *   { folderPath, recursive(boolean), extensions(string[]) }，按 folderPath 升序。
 * recursive 由 0/1 映射为 boolean；extensions 为 JSON 字符串，解析失败或为 NULL 时回退 []。
 */
export async function getGalleryFolders(
  galleryId: number
): Promise<{ success: boolean; data?: Array<{ folderPath: string; recursive: boolean; extensions: string[] }>; error?: string }> {
  try {
    const db = await getDatabase();
    const rows = await all<{ folderPath: string; recursive: number; extensions: string | null }>(
      db,
      'SELECT folderPath, recursive, extensions FROM gallery_folders WHERE galleryId = ? ORDER BY folderPath',
      [galleryId]
    );

    const data = rows.map(row => {
      let extensions: string[] = [];
      if (row.extensions) {
        try {
          const parsed = JSON.parse(row.extensions);
          if (Array.isArray(parsed)) {
            extensions = parsed;
          }
        } catch {
          // 损坏的 extensions JSON：回退空数组（不阻断整次读取）
          extensions = [];
        }
      }
      return {
        folderPath: row.folderPath,
        recursive: Boolean(row.recursive),
        extensions,
      };
    });

    return { success: true, data };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryService] 读取图集绑定文件夹失败:', errorMessage);
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

    // 检查是否已存在：以真实绑定（gallery_folders）为准——一个文件夹「被占用」当且仅当它已被某图集绑定。
    // 旧实现查 galleries.folderPath 旧列，会被「陈旧旧列 / 重定位后残留」误判；gallery_folders 才是真相。
    // 注：契约期已彻底移除 galleries.folderPath 列，下方事务只写图集元数据，folderPath 落在 gallery_folders 绑定行。
    const existing = await get<{ galleryId: number }>(
      db,
      'SELECT galleryId FROM gallery_folders WHERE folderPath = ?',
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

    // Phase 8A：galleries 只存图集元数据 + autoScan；folderPath/recursive/extensions 归 gallery_folders。
    const sql = `
      INSERT INTO galleries
      (name, autoScan, createdAt, updatedAt)
      VALUES (?, ?, ?, ?)
    `;

    const now = new Date().toISOString();
    const autoScan = galleryData.isWatching ?? true; // CreateGalleryDto 仍用 isWatching 命名
    const recursive = galleryData.recursive ?? true;
    const extensionsJson = JSON.stringify(extensions);

    // 原子写：galleries 元数据行 + gallery_folders 绑定行（folderPath/recursive/extensions 落在绑定行）。
    let galleryId: number | undefined;
    await runInTransaction(db, async () => {
      await run(db, sql, [
        galleryData.name,
        autoScan ? 1 : 0,
        now,
        now
      ]);

      const inserted = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
      galleryId = inserted?.id;

      await run(
        db,
        `INSERT INTO gallery_folders
           (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [galleryId, folderPath, recursive ? 1 : 0, extensionsJson, now, now]
      );
    });

    addGalleryRoot(folderPath);
    emitGalleryGalleriesChanged({ galleryId, action: 'created', folderPath });

    return { success: true, data: galleryId };
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
  updates: Partial<Pick<Gallery, 'name' | 'autoScan'>>
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();

    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }

    // Phase 8A：isWatching→autoScan；recursive 不再是图集级属性（归 gallery_folders），故移除。
    if (updates.autoScan !== undefined) {
      setClauses.push('autoScan = ?');
      values.push(updates.autoScan ? 1 : 0);
    }

    if (setClauses.length === 0) {
      return { success: false, error: 'No updates provided' };
    }

    setClauses.push('updatedAt = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const sql = `UPDATE galleries SET ${setClauses.join(', ')} WHERE id = ?`;
    await run(db, sql, values);

    emitGalleryGalleriesChanged({ galleryId: id, action: 'updated' });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error updating gallery:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 回收"孤儿图片"：给定一批候选 imageId（其在某图集的成员关系刚被移除），
 * 删除其中已无任何 gallery_images 成员行的图片。
 *
 * Phase 3：这是 deleteGallery / unbindFolder 等"移除成员"后统一的回收入口。
 * 复用 deleteGallery 的逐图清理动作，但作用域是孤儿 imageId 集合（而非
 * folderPath 前缀）——关键区别：仍被其他图集引用的图片不会被删，
 * 修复了多归属误删。
 *
 * 清理顺序（与 deleteGallery 一致）：
 * 1. 判定孤儿：id IN(candidates) AND id NOT IN (SELECT imageId FROM gallery_images)；
 * 2. 事务外 best-effort deleteThumbnail(filepath)（失败只告警，不进事务避免拖长持锁）；
 * 3. 事务内：UPDATE booru_posts 重置 downloaded/localPath（按 localImageId 或 localPath 命中）
 *    → DELETE images（FK CASCADE 连带清掉 image_tags 与任何残留 gallery_images）。
 *
 * @returns 实际删除的孤儿数量。空输入或无孤儿时返回 0（no-op）。
 */
export async function cleanupOrphanImages(
  db: Awaited<ReturnType<typeof getDatabase>>,
  imageIds: number[]
): Promise<number> {
  if (!imageIds || imageIds.length === 0) {
    return 0;
  }

  // 去重，避免占位符冗余
  const candidateIds = Array.from(new Set(imageIds));

  // 1. 判定孤儿：候选集中、当前在 gallery_images 已无任何成员行的图片。
  //    候选可能很多（大图集），按批查询避免单条 IN(...) 超过 SQLite 变量上限。
  const orphans: Array<{ id: number; filepath: string }> = [];
  for (const batch of chunkArray(candidateIds, ORPHAN_GC_BATCH)) {
    const placeholders = batch.map(() => '?').join(',');
    const batchOrphans = await all<{ id: number; filepath: string }>(
      db,
      `SELECT id, filepath FROM images
         WHERE id IN (${placeholders})
           AND id NOT IN (SELECT imageId FROM gallery_images)`,
      batch
    );
    orphans.push(...batchOrphans);
  }

  if (orphans.length === 0) {
    return 0;
  }

  const orphanIds = orphans.map(o => o.id);
  const orphanFilepaths = orphans.map(o => o.filepath);

  // 2. best-effort 清缩略图（事务外；与 deleteGallery 一致依赖 deleteThumbnail 按 filepath 行为）
  const { deleteThumbnail } = await import('./thumbnailService.js');
  for (const orphan of orphans) {
    try {
      await deleteThumbnail(orphan.filepath);
    } catch (err: any) {
      console.warn(
        `[galleryService] 清理孤儿缩略图失败: ${orphan.filepath}`,
        err?.message ?? err
      );
    }
  }

  // 3. 事务内原子清理：重置 booru → DELETE images（FK CASCADE 清 image_tags / 残留 gallery_images）。
  //    同样按批处理占位符：每批 ≤ ORPHAN_GC_BATCH 个 id（booru UPDATE 带两组占位符，≤ 2×批）。
  await runInTransaction(db, async () => {
    const idBatches = chunkArray(orphanIds, ORPHAN_GC_BATCH);
    const pathBatches = chunkArray(orphanFilepaths, ORPHAN_GC_BATCH);

    // booru_posts 重置：localImageId 命中（外键 SET NULL 只清引用、不改 downloaded）或 localPath 命中。
    // id 与 filepath 批一一对应（同一批的 orphans 切出来的，下标对齐）。
    for (let i = 0; i < idBatches.length; i++) {
      const idBatch = idBatches[i];
      const pathBatch = pathBatches[i];
      const idPlaceholders = idBatch.map(() => '?').join(',');
      const pathPlaceholders = pathBatch.map(() => '?').join(',');
      await run(
        db,
        `UPDATE booru_posts
            SET downloaded = 0, localPath = NULL
            WHERE localImageId IN (${idPlaceholders})
               OR localPath IN (${pathPlaceholders})`,
        [...idBatch, ...pathBatch]
      );
    }

    // 删图片：FK CASCADE 连带清掉 image_tags 以及任何仍残留的 gallery_images 行。
    for (const idBatch of idBatches) {
      const idPlaceholders = idBatch.map(() => '?').join(',');
      await run(db, `DELETE FROM images WHERE id IN (${idPlaceholders})`, idBatch);
    }
  });

  return orphans.length;
}

/**
 * 删除图库（Phase 3：按成员删除 + 孤儿回收，取代旧的 folderPath 前缀级联）。
 *
 * 公开契约保持不变：返回 { success, error? }；图集不存在返回 success:false；
 * 发出 gallery:galleries-changed{action:'deleted'} 与 gallery:ignored-folders-changed{action:'created'}；
 * 每个绑定文件夹写入 gallery_ignored_folders（拉黑，下次扫描不重建）；原图文件不删。
 *
 * 清理顺序：
 * 1. 校验 galleries 行存在（folderPath 旧列仅用于 deleted 事件载荷，向后兼容）；
 * 2. 读 gallery_images 成员 imageId 与 gallery_folders 绑定文件夹（只读）；
 * 3. 事务内：
 *    a. DELETE invalid_images WHERE galleryId（须在删 galleries 前，避免 FK SET NULL 后丢失定位）；
 *    b. DELETE galleries 本行（FK CASCADE 连带删 gallery_folders / gallery_images）；
 *    c. 每个绑定文件夹 INSERT OR REPLACE 写入 gallery_ignored_folders；
 *    任一条失败 → ROLLBACK；
 * 4. cleanupOrphanImages(成员 imageId)：此时本图集成员行已被 CASCADE 删除，
 *    仅本图集独占的图片成为孤儿被删（清缩略图 + 重置 booru.downloaded/localPath）；
 *    仍被其他图集引用的图片保留——修复旧前缀级联的多归属误删；
 * 5. 逐个绑定文件夹 removeGalleryRoot + 发事件。
 *
 * 注意：cleanupOrphanImages 自带事务，故置于删图集事务之后，避免同库嵌套 runInTransaction。
 */
export async function deleteGallery(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();

    // 1. 校验图集存在。Phase 8A：galleries 不再有 folderPath 列；deleted 事件的 folderPath
    //    载荷改用首个绑定文件夹（下方 boundFolders[0]）。
    const existing = await get<{ id: number }>(
      db,
      'SELECT id FROM galleries WHERE id = ?',
      [id]
    );

    if (!existing) {
      return { success: false, error: 'Gallery not found' };
    }

    // 2. 读成员图片 id 与绑定文件夹（按成员表 / 绑定表，而非 folderPath 前缀）。
    const memberRows = await all<{ imageId: number }>(
      db,
      'SELECT imageId FROM gallery_images WHERE galleryId = ?',
      [id]
    );
    const memberImageIds = memberRows.map(r => r.imageId);

    const folderRows = await all<{ folderPath: string }>(
      db,
      'SELECT folderPath FROM gallery_folders WHERE galleryId = ?',
      [id]
    );
    // 绑定表存的是 normalized 路径；再过一遍 normalizePath 兜底，保证拉黑/登记键一致。
    const boundFolders = folderRows.map(r => normalizePath(r.folderPath));

    // deleted 事件 folderPath 字段：用首个绑定文件夹（图集可能无绑定文件夹，回退空串）。
    const eventFolderPath = boundFolders[0] ?? '';

    // 3. 事务内：删图集行（FK CASCADE 连带删 gallery_folders / gallery_images）
    //    + 清 invalid_images（表定义 ON DELETE SET NULL，这里显式删更干净，避免孤儿行）
    //    + 每个绑定文件夹写入忽略名单（INSERT OR REPLACE 保留 createdAt）。
    //    任一写失败整体 ROLLBACK，外层 catch 返回 success:false。
    const now = new Date().toISOString();
    await runInTransaction(db, async () => {
      // 3a. invalid_images 按 galleryId 显式清（须在删 galleries 前，否则 FK SET NULL 后无法按 galleryId 定位）
      await run(db, `DELETE FROM invalid_images WHERE galleryId = ?`, [id]);

      // 3b. 删图集行：FK CASCADE 连带清掉本图集的 gallery_folders / gallery_images 成员行
      await run(db, 'DELETE FROM galleries WHERE id = ?', [id]);

      // 3c. 逐个绑定文件夹拉黑（下次扫描不重建）
      for (const folder of boundFolders) {
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
          [folder, '删除图集自动忽略', folder, now, now]
        );
      }
    });

    // 4. 回收孤儿（自带事务，置于删图集事务之后）：
    //    此时本图集的 gallery_images 已被 CASCADE 删除，成员图片中仅被本图集独占的
    //    成为孤儿被删（清缩略图 + 重置 booru）；仍被其他图集引用的图片保留——
    //    这修复了旧前缀级联的多归属误删。
    await cleanupOrphanImages(db, memberImageIds);

    // 5. app:// 白名单移除每个根 + 事件
    for (const folder of boundFolders) {
      removeGalleryRoot(folder);
    }
    emitGalleryGalleriesChanged({ galleryId: id, action: 'deleted', folderPath: eventFolderPath });
    for (const folder of boundFolders) {
      emitGalleryIgnoredFoldersChanged({ action: 'created', folderPath: folder, affectedCount: 1 });
    }

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

    emitGalleryGalleriesChanged({ galleryId: id, action: 'statsUpdated' });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error updating gallery stats:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 写入某文件夹范围内的图片成员到 gallery_images（按 recursive 感知前缀匹配）。
 *
 * Phase 2A：所有写路径都要保证 gallery_images 成员与现状（folderPath 前缀匹配）一致，
 * 以便后续把读路径切到成员表时数据齐全。本函数是这一致性的统一入口。
 *
 * 前缀匹配规则必须与 selectImageIdsCoveredByFolder / database.backfillGalleryImages
 * 字面一致（normalized = normalizePath(folderPath)，likePrefix = normalized + path.sep）：
 *   - recursive=true ：filepath LIKE likePrefix+'%' ESCAPE '\' OR filepath = normalized
 *   - recursive=false：filepath LIKE likePrefix+'%' ESCAPE '\' AND filepath NOT LIKE likePrefix+'%'+sep+'%' ESCAPE '\'
 *
 * 用单条集合式 INSERT OR IGNORE ... SELECT 完成，幂等（成员复合主键 + OR IGNORE）。
 * 注：likePrefix（含 path.sep）经 escapeLike 转义，配套 ESCAPE '\'——否则路径里的
 * _/% 会被当通配符，使兄弟目录（如 ...gal_1 误命中 ...galA1）被错误写入成员。
 *
 * @returns 本次新写入的成员行数（changes）。重复执行时已存在的成员被 OR IGNORE，返回 0。
 */
export async function ensureMembershipForFolder(
  db: Awaited<ReturnType<typeof getDatabase>>,
  galleryId: number,
  folderPath: string,
  recursive: boolean
): Promise<number> {
  const normalized = normalizePath(folderPath);
  const likePrefix = normalized + path.sep;
  const escapedPrefix = escapeLike(likePrefix);
  const now = new Date().toISOString();

  const result = recursive
    ? await runWithChanges(
        db,
        `INSERT OR IGNORE INTO gallery_images (galleryId, imageId, addedAt)
           SELECT ?, id, ? FROM images
            WHERE filepath LIKE ? ESCAPE '\\' OR filepath = ?`,
        [galleryId, now, escapedPrefix + '%', normalized]
      )
    : await runWithChanges(
        db,
        `INSERT OR IGNORE INTO gallery_images (galleryId, imageId, addedAt)
           SELECT ?, id, ? FROM images
            WHERE filepath LIKE ? ESCAPE '\\' AND filepath NOT LIKE ? ESCAPE '\\'`,
        [galleryId, now, escapedPrefix + '%', escapedPrefix + '%' + escapeLike(path.sep) + '%']
      );

  return result.changes;
}

/**
 * 扫描某文件夹并把结果落到指定图集：导入图片 + 写成员 + 更新统计。
 *
 * Phase 2A 统一写入口：
 *   1. scanAndImportFolder(folderPath, extensions, recursive) —— 复用已有扫描导入；
 *   2. ensureMembershipForFolder —— 把该文件夹范围内的 images 写入 gallery_images；
 *   3. COUNT(*) gallery_images WHERE galleryId —— 以成员表为准统计图片数；
 *   4. updateGalleryStats —— 写回 galleries.imageCount / lastScannedAt；
 *   5. imported>0 时发出 gallery:images-imported（与 syncGalleryFolder 行为一致）。
 *
 * 注意：本阶段读路径未切换，imageCount 改以成员表 COUNT 为准只影响"统计数字"，
 * 与旧 folderPath 前缀 COUNT 在数据正确时等价（成员由同一前缀规则写入）。
 *
 * @returns { imported, skipped, imageCount }，扫描失败时 success:false 且不写成员/不更新统计。
 */
export async function scanFolderIntoGallery(
  galleryId: number,
  folderPath: string,
  recursive: boolean,
  extensions: string[]
): Promise<{ success: boolean; data?: { imported: number; skipped: number; imageCount: number }; error?: string }> {
  // 1. 复用已有扫描导入逻辑（filesystem → images 表）
  const importResult = await scanAndImportFolder(folderPath, extensions, recursive);
  if (!importResult.success || !importResult.data) {
    return { success: false, error: importResult.error || '扫描导入失败' };
  }

  const db = await getDatabase();

  // 2. 写 gallery_images 成员（按 recursive 前缀，幂等）
  await ensureMembershipForFolder(db, galleryId, folderPath, recursive);

  // 3. 以成员表为准统计图片数
  const countRow = await get<{ cnt: number }>(
    db,
    'SELECT COUNT(*) as cnt FROM gallery_images WHERE galleryId = ?',
    [galleryId]
  );
  const imageCount = countRow?.cnt ?? 0;
  const now = new Date().toISOString();

  // 4. 写回图集统计
  await updateGalleryStats(galleryId, imageCount, now);

  // 5. 与 syncGalleryFolder 一致：仅在确有新增时发事件，载荷形状保持不变
  if (importResult.data.imported > 0) {
    emitBuiltRendererAppEvent({
      type: 'gallery:images-imported',
      source: 'galleryService',
      payload: {
        folderPath,
        galleryId,
        imported: importResult.data.imported,
        skipped: importResult.data.skipped,
        recursive,
        imageCount,
        lastScannedAt: now,
        reason: 'scanFolderIntoGallery',
      },
    });
  }

  return {
    success: true,
    data: {
      imported: importResult.data.imported,
      skipped: importResult.data.skipped,
      imageCount,
    },
  };
}

/**
 * 给已存在的图集加绑一个文件夹并扫描入成员（Phase 3：「+添加文件夹」/同名合并）。
 *
 * - 归一化 folderPath；
 * - 若该 folderPath 已存在于 gallery_folders（全局 UNIQUE）→ 拒绝，给出清晰 error
 *   （一个文件夹只能属于一个图集）；
 * - 短事务只插入 gallery_folders 绑定行（经 runInTransaction 排队，避免这条 INSERT
 *   落进其它并发事务的开放窗口、随对方 ROLLBACK 一并丢失）；
 * - 事务外执行 scanFolderIntoGallery（全量磁盘扫描 + 逐文件导入 + 写成员 + 更新统计）。
 *   大目录（NAS/HDD 万张级）扫描可达分钟级，绝不能包进事务：否则期间所有
 *   runInTransaction 调用方（收藏落库、批量下载记录、标签写入等）都会在事务队列上
 *   阻塞到扫描结束。scanAndImportFolder 逐文件幂等（filepath 查重），失败后重试可
 *   自愈，与 applyScanPlan create 路径的无事务扫描行为一致；
 * - 扫描失败（返回失败或抛错）→ 补偿回滚：复用 unbindFolder 既有语义（删除绑定行 +
 *   重叠感知移除成员 + 孤儿 GC），保证失败后无残留绑定。changeFolderPath 的
 *   "先绑新后解旧"安全性因此不变（新侧失败 → 补偿删新绑定 → 旧绑定原样）；
 * - addGalleryRoot(folderPath)（app:// 白名单增量维护）；
 * - emit gallery:galleries-changed{action:'updated'}。
 *
 * 返回 data.imported/skipped 为本次绑定扫描导入计数（供 applyScanPlan 等批量入口累加；
 * 历史调用方只读 success/error，新增可选 data 字段不破坏其契约）。
 */
export async function bindFolder(
  galleryId: number,
  folderPath: string,
  recursive: boolean = true,
  extensions?: string[]
): Promise<{ success: boolean; data?: { imported: number; skipped: number }; error?: string }> {
  try {
    const db = await getDatabase();
    const normalized = normalizePath(folderPath);
    const effectiveExtensions = extensions ?? DEFAULT_IMAGE_EXTENSIONS;

    // 全局唯一校验：一个文件夹只能绑定到一个图集
    const existing = await get<{ galleryId: number }>(
      db,
      'SELECT galleryId FROM gallery_folders WHERE folderPath = ?',
      [normalized]
    );
    if (existing) {
      return {
        success: false,
        error: `文件夹已被图集 ${existing.galleryId} 绑定，无法重复绑定: ${normalized}`,
      };
    }

    // 短事务只写绑定行：磁盘扫描不在事务内（见函数头注释——长事务会阻塞全应用事务队列）
    const now = new Date().toISOString();
    await runInTransaction(db, async () => {
      await run(
        db,
        `INSERT INTO gallery_folders
           (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [galleryId, normalized, recursive ? 1 : 0, JSON.stringify(effectiveExtensions), now, now]
      );
    });

    // 事务外执行全量扫描导入。抛错与业务失败同待遇：统一走下方补偿解绑，
    // 否则异常直落外层 catch 会跳过补偿、残留绑定行。
    let scanResult: Awaited<ReturnType<typeof scanFolderIntoGallery>>;
    try {
      scanResult = await scanFolderIntoGallery(galleryId, normalized, recursive, effectiveExtensions);
    } catch (scanError) {
      scanResult = {
        success: false,
        error: scanError instanceof Error ? scanError.message : String(scanError),
      };
    }

    if (!scanResult.success) {
      // 补偿回滚：复用 unbindFolder（删绑定行 + 重叠感知移除成员 + 孤儿 GC）。
      // 扫描中途已导入的 images 行（无成员、图集不可见）不在此清理，
      // 留待下次重试被 scanAndImportFolder 幂等吸收——与 applyScanPlan create 路径失败行为一致。
      console.warn(
        `[galleryService] bindFolder 扫描失败，补偿解绑该绑定: ${normalized}, error=${scanResult.error}`
      );
      const compensation = await unbindFolder(galleryId, normalized);
      if (!compensation.success) {
        console.error(
          `[galleryService] bindFolder 扫描失败后的补偿解绑亦失败（可能残留绑定行）: ${normalized}, ${compensation.error}`
        );
      }
      return { success: false, error: scanResult.error || '扫描文件夹失败' };
    }

    addGalleryRoot(normalized);
    emitGalleryGalleriesChanged({ galleryId, action: 'updated' });

    return {
      success: true,
      data: { imported: scanResult.data?.imported ?? 0, skipped: scanResult.data?.skipped ?? 0 },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryService] 绑定文件夹失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 查询某文件夹（按 recursive 感知前缀）覆盖到的图片 id 集合。
 * 谓词与 ensureMembershipForFolder / backfillGalleryImages 字面一致，保证
 * "覆盖判定"与"成员写入"用同一规则：
 *   - recursive=true ：filepath LIKE 'F{sep}%' ESCAPE '\' OR filepath = 'F'
 *   - recursive=false：filepath LIKE 'F{sep}%' ESCAPE '\' AND filepath NOT LIKE 'F{sep}%{sep}%' ESCAPE '\'
 * 字面前缀 F{sep} 经 escapeLike 转义（_/% 不当通配符），与成员写入侧保持一致，
 * 否则解绑/孤儿回收时"覆盖判定"会与"成员写入"分叉，误判兄弟目录图片归属。
 */
async function selectImageIdsCoveredByFolder(
  db: Awaited<ReturnType<typeof getDatabase>>,
  folderPath: string,
  recursive: boolean
): Promise<number[]> {
  const normalized = normalizePath(folderPath);
  const likePrefix = normalized + path.sep;
  const escapedPrefix = escapeLike(likePrefix);
  const rows = recursive
    ? await all<{ id: number }>(
        db,
        `SELECT id FROM images WHERE filepath LIKE ? ESCAPE '\\' OR filepath = ?`,
        [escapedPrefix + '%', normalized]
      )
    : await all<{ id: number }>(
        db,
        `SELECT id FROM images WHERE filepath LIKE ? ESCAPE '\\' AND filepath NOT LIKE ? ESCAPE '\\'`,
        [escapedPrefix + '%', escapedPrefix + '%' + escapeLike(path.sep) + '%']
      );
  return rows.map(r => r.id);
}

/**
 * 解绑图集的一个文件夹（Phase 3）。保留图集记录，不写忽略名单（与 deleteGallery 区分）。
 *
 * - 归一化；移除 (galleryId, folderPath) 的 gallery_folders 行；
 * - 重算成员归属：该图集当前成员中，凡其 filepath 不再被任一"剩余绑定文件夹"覆盖的，
 *   删除对应 gallery_images(galleryId,imageId) 行，并收集这些 imageId；
 *   覆盖判定用 selectImageIdsCoveredByFolder（与 ensureMembershipForFolder 同一前缀谓词）；
 * - cleanupOrphanImages(收集到的 imageId)：其中已无任何成员的图片被回收（多归属图片保留）；
 * - removeGalleryRoot(folderPath)；以 COUNT(gallery_images) 更新统计；emit updated。
 *
 * 注意：cleanupOrphanImages 自带事务，故放在解绑事务之外，避免同库嵌套 runInTransaction。
 */
export async function unbindFolder(
  galleryId: number,
  folderPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();
    const normalized = normalizePath(folderPath);

    // 1. 移除目标绑定行 + 重算未覆盖成员并删其成员行（原子）
    const removedMemberIds: number[] = [];
    await runInTransaction(db, async () => {
      await run(
        db,
        'DELETE FROM gallery_folders WHERE galleryId = ? AND folderPath = ?',
        [galleryId, normalized]
      );

      // 剩余绑定文件夹（移除后）
      const remainingFolders = await all<{ folderPath: string; recursive: number }>(
        db,
        'SELECT folderPath, recursive FROM gallery_folders WHERE galleryId = ?',
        [galleryId]
      );

      // 当前成员
      const currentMembers = await all<{ imageId: number }>(
        db,
        'SELECT imageId FROM gallery_images WHERE galleryId = ?',
        [galleryId]
      );
      const currentMemberIds = currentMembers.map(m => m.imageId);

      // 仍被任一剩余文件夹覆盖的 imageId 集合
      const coveredIds = new Set<number>();
      for (const f of remainingFolders) {
        const isRecursive = f.recursive === 1 || (f.recursive as unknown as boolean) === true;
        const ids = await selectImageIdsCoveredByFolder(db, f.folderPath, isRecursive);
        for (const id of ids) coveredIds.add(id);
      }

      // 不再被覆盖的成员 → 删成员行并收集
      const toRemove = currentMemberIds.filter(id => !coveredIds.has(id));
      if (toRemove.length > 0) {
        const placeholders = toRemove.map(() => '?').join(',');
        await run(
          db,
          `DELETE FROM gallery_images WHERE galleryId = ? AND imageId IN (${placeholders})`,
          [galleryId, ...toRemove]
        );
        removedMemberIds.push(...toRemove);
      }
    });

    // 2. 回收孤儿（自带事务，置于解绑事务外）；仍归属其他图集的图片会被保留
    await cleanupOrphanImages(db, removedMemberIds);

    // 3. app:// 白名单移除该根 + 以成员表 COUNT 更新统计
    removeGalleryRoot(normalized);
    const countRow = await get<{ cnt: number }>(
      db,
      'SELECT COUNT(*) as cnt FROM gallery_images WHERE galleryId = ?',
      [galleryId]
    );
    await updateGalleryStats(galleryId, countRow?.cnt ?? 0, new Date().toISOString());

    emitGalleryGalleriesChanged({ galleryId, action: 'updated' });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryService] 解绑文件夹失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 改图集某绑定文件夹的路径（Phase 3）= bindFolder(new) 成功后再 unbindFolder(old)。
 *
 * 关键顺序：先绑新、再解旧。旧实现是先解旧再绑新，若绑新失败（新路径已被别处
 * 绑定 / 不可读 / 扫描失败），旧绑定与成员已被删除（图片可能已被孤儿回收），
 * 造成不可恢复的数据丢失。改为先绑新：
 *   - 新旧路径归一化后相同：no-op 成功（避免对同一路径 bind 触发 UNIQUE 自冲突）；
 *   - bindFolder(new) 失败：立即返回其错误，完全不动旧绑定（旧状态原样保留）；
 *   - bindFolder(new) 成功后再 unbindFolder(old)：移除旧绑定 + 其成员 + 回收孤儿。
 *     若解旧失败，返回错误并说明此刻新旧两者都已绑定（可人工恢复，无数据丢失），
 *     不尝试回滚已成功的新绑定。
 * 图集记录与 id 始终不变。
 */
export async function changeFolderPath(
  galleryId: number,
  oldPath: string,
  newPath: string,
  recursive: boolean = true,
  extensions?: string[]
): Promise<{ success: boolean; error?: string }> {
  // 新旧路径相同：无需重绑（对已绑定路径再 bindFolder 会撞 UNIQUE）。直接 no-op 成功，
  // 保留现有绑定与成员不变。
  if (normalizePath(newPath) === normalizePath(oldPath)) {
    return { success: true };
  }

  // 1. 先绑新。失败则原样保留旧绑定与成员，立即返回错误（无任何数据丢失）。
  const bindResult = await bindFolder(galleryId, newPath, recursive, extensions);
  if (!bindResult.success) {
    return { success: false, error: bindResult.error };
  }

  // 2. 新绑定已成功，再解旧（移除旧绑定 + 其成员 + 回收孤儿）。
  //    若解旧失败：新旧此刻都已绑定，可人工恢复，不回滚已成功的新绑定。
  const unbindResult = await unbindFolder(galleryId, oldPath);
  if (!unbindResult.success) {
    return {
      success: false,
      error: `新文件夹已绑定，但解绑旧文件夹失败（新旧文件夹当前均已绑定，可人工修正）: ${unbindResult.error}`,
    };
  }

  return { success: true };
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

    emitGalleryGalleriesChanged({ galleryId: id, action: 'coverChanged', affectedCount: 1 });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error setting gallery cover:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

// planScanFolder 的分类结果项类型（Phase 6B）
export interface PlanScanNewFolder {
  folderPath: string;
  name: string;
}
export interface PlanScanCollision {
  folderPath: string;
  name: string;
  existingGalleryId: number;
  existingGalleryName: string;
}
export interface PlanScanSkipped {
  folderPath: string;
  name: string;
  reason: 'alreadyBound' | 'ignored' | 'noImages';
}
export interface PlanScanResult {
  newFolders: PlanScanNewFolder[];
  collisions: PlanScanCollision[];
  skipped: PlanScanSkipped[];
}

/**
 * 规划「扫描入库」：只读分析 rootPath 的一级子文件夹（+ rootPath 自身），不建图集、不写库（Phase 6B）。
 *
 * 这是两步式 plan→apply API 的第一步：UI 拿到本结果后展示同名碰撞对话框，再带用户的逐项选择
 * 调 applyScanPlan。修正了旧 scanSubfoldersAndCreateGalleries 的两个问题：
 *   - 扫描深度：候选只取**一级**子目录（不深递归创建图集）；
 *   - 同名碰撞：发现已有同名图集时不再自动改名，而是列入 collisions 交给用户决定（合并/新建）。
 *
 * 候选集合 = fs.readdir(rootPath, {withFileTypes}) 中的目录（仅一级）+ rootPath 本身。
 * 对每个候选 F（folderPath 归一化，name = basename）：
 *   1. checkFolderHasImages(F, extensions) 为 false（无直接图片）→ skipped: noImages（不建图集）；
 *   2. normalize(F) 已在 gallery_folders.folderPath → skipped: alreadyBound；
 *   3. 否则 normalize(F) 在 gallery_ignored_folders.folderPath → skipped: ignored；
 *   4. 否则存在 name == basename(F) 的图集 → collisions（带其 id+name）；
 *   5. 否则 → newFolders。
 *
 * @returns 分类结果（newFolders / collisions / skipped）。根文件夹不存在时 success:false。
 */
export async function planScanFolder(
  rootPath: string,
  extensions: string[] = DEFAULT_IMAGE_EXTENSIONS
): Promise<{ success: boolean; data?: PlanScanResult; error?: string }> {
  try {
    const fs = await import('fs/promises');
    const normalizedRoot = normalizePath(rootPath);

    // 根文件夹必须存在
    try {
      await fs.access(normalizedRoot);
    } catch {
      return { success: false, error: 'Root folder does not exist' };
    }

    // 候选 = rootPath 本身 + 一级子目录（仅目录，不深递归）
    const candidates: string[] = [normalizedRoot];
    try {
      const entries = await fs.readdir(normalizedRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidates.push(normalizePath(path.join(normalizedRoot, entry.name)));
        }
      }
    } catch (err) {
      // 读取根目录失败：无法枚举一级子文件夹，直接报错
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `读取根文件夹失败: ${msg}` };
    }

    // 预加载分类所需的库状态（只读）：绑定文件夹集合 / 忽略名单 / 图集名→id 映射
    const db = await getDatabase();
    const boundRows = await all<{ folderPath: string }>(db, 'SELECT folderPath FROM gallery_folders');
    const boundPaths = new Set(boundRows.map(r => r.folderPath));
    const ignoredRows = await all<{ folderPath: string }>(db, 'SELECT folderPath FROM gallery_ignored_folders');
    const ignoredPaths = new Set(ignoredRows.map(r => r.folderPath));

    const newFolders: PlanScanNewFolder[] = [];
    const collisions: PlanScanCollision[] = [];
    const skipped: PlanScanSkipped[] = [];

    for (const folderPath of candidates) {
      const name = path.basename(folderPath);

      // 1. 无直接图片 → noImages（不建图集）
      const hasImages = await checkFolderHasImages(folderPath, extensions);
      if (!hasImages) {
        skipped.push({ folderPath, name, reason: 'noImages' });
        continue;
      }

      // 2. 已被某图集绑定 → alreadyBound
      if (boundPaths.has(folderPath)) {
        skipped.push({ folderPath, name, reason: 'alreadyBound' });
        continue;
      }

      // 3. 在忽略名单 → ignored
      if (ignoredPaths.has(folderPath)) {
        skipped.push({ folderPath, name, reason: 'ignored' });
        continue;
      }

      // 4. 存在同名图集 → collisions（带现有图集 id+name）
      const sameName = await get<{ id: number; name: string }>(
        db,
        'SELECT id, name FROM galleries WHERE name = ? LIMIT 1',
        [name]
      );
      if (sameName) {
        collisions.push({
          folderPath,
          name,
          existingGalleryId: sameName.id,
          existingGalleryName: sameName.name,
        });
        continue;
      }

      // 5. 否则 → 新文件夹
      newFolders.push({ folderPath, name });
    }

    return { success: true, data: { newFolders, collisions, skipped } };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryService] planScanFolder 失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

// applyScanPlan 的入参决议类型（Phase 6B）
export interface ApplyScanResolution {
  // 新建图集：每项新建一个 recursive=true 的图集并扫描该文件夹入成员
  create: Array<{ folderPath: string; name: string }>;
  // 合并到现有图集：每项把文件夹加绑到指定图集并扫描入成员
  merge: Array<{ folderPath: string; galleryId: number }>;
  extensions?: string[];
}

/**
 * 应用「扫描入库」决议（Phase 6B plan→apply 的第二步）。
 *
 * 按 planScanFolder 给出、并经用户在碰撞对话框确认的决议逐项执行：
 *   - create：createGallery({folderPath,name,isWatching:true,recursive:true,extensions})
 *     → scanFolderIntoGallery(newId, folderPath, true, extensions)。recursive=true 是深度修复的关键：
 *     新建的图集本身包含其嵌套图片（不再为每层子目录单独建图集）。累加 created + imported/skipped；
 *   - merge：bindFolder(galleryId, folderPath, true, extensions)（加绑文件夹 + 扫描入成员，
 *     bindFolder 透传扫描计数）。累加 merged + imported/skipped。
 *
 * 单项失败收集并继续，不因一个坏文件夹中止整批（失败项计入 skipped，good 项仍落库）。
 * 整体返回 success:true（除非发生非预期异常）；逐项失败通过 skipped 计数反映。
 *
 * @returns { created, merged, imported, skipped }。
 */
export async function applyScanPlan(
  resolution: ApplyScanResolution
): Promise<{ success: boolean; data?: { created: number; merged: number; imported: number; skipped: number }; error?: string }> {
  try {
    const extensions = resolution.extensions ?? DEFAULT_IMAGE_EXTENSIONS;

    let created = 0;
    let merged = 0;
    let imported = 0;
    let skipped = 0;

    // create：逐项新建图集（recursive=true）+ 扫描入成员；单项失败收集并继续
    for (const item of resolution.create ?? []) {
      try {
        const createResult = await createGallery({
          folderPath: item.folderPath,
          name: item.name,
          isWatching: true,
          recursive: true,
          extensions,
        });
        if (!createResult.success || !createResult.data) {
          console.warn(`[galleryService] applyScanPlan 新建图集失败: ${item.folderPath}, error=${createResult.error}`);
          skipped++;
          continue;
        }

        const newId = createResult.data;
        const scanResult = await scanFolderIntoGallery(newId, item.folderPath, true, extensions);
        if (!scanResult.success || !scanResult.data) {
          // 图集已建但扫描失败：仍计 created，导入计 0，并告警
          console.warn(`[galleryService] applyScanPlan 新图集扫描失败: ${item.folderPath}, error=${scanResult.error}`);
          created++;
          continue;
        }

        created++;
        imported += scanResult.data.imported;
        skipped += scanResult.data.skipped;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[galleryService] applyScanPlan 新建项异常: ${item.folderPath}, ${msg}`);
        skipped++;
      }
    }

    // merge：逐项加绑到现有图集 + 扫描入成员；单项失败收集并继续
    for (const item of resolution.merge ?? []) {
      try {
        const bindResult = await bindFolder(item.galleryId, item.folderPath, true, extensions);
        if (!bindResult.success) {
          console.warn(`[galleryService] applyScanPlan 合并绑定失败: ${item.folderPath}, error=${bindResult.error}`);
          skipped++;
          continue;
        }
        merged++;
        imported += bindResult.data?.imported ?? 0;
        skipped += bindResult.data?.skipped ?? 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[galleryService] applyScanPlan 合并项异常: ${item.folderPath}, ${msg}`);
        skipped++;
      }
    }

    console.log(
      `[galleryService] applyScanPlan 完成: created=${created}, merged=${merged}, imported=${imported}, skipped=${skipped}`
    );

    return { success: true, data: { created, merged, imported, skipped } };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryService] applyScanPlan 失败:', errorMessage);
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
 * 同步图集文件夹：重新扫描指定图集**全部绑定文件夹**，导入新增图片并更新统计信息。
 *
 * Phase 4：扫描源从 galleries 旧列 folderPath（= 图集原始单文件夹）切到 gallery_folders 的
 * 全部绑定行——否则 bindFolder 追加 / changeFolderPath 重定位的文件夹永远不会被同步进来。
 *
 * 行为：
 *   1. 校验图集存在（保留"图集不存在"错误契约）；
 *   2. 读 gallery_folders 该图集的全部绑定行（folderPath / recursive / extensions）；
 *   3. 逐个 scanFolderIntoGallery（各自的 recursive / extensions），累加 imported / skipped；
 *      每个文件夹由 scanFolderIntoGallery 各自发一条 gallery:images-imported 事件（不再额外补发）；
 *   4. 以成员表 COUNT(gallery_images) 为准统计 imageCount（多文件夹取并集）；
 *   5. 无任何绑定文件夹（无文件夹图集）→ 返回零导入 + 当前 imageCount，不报错。
 *
 * 公开返回形状保持不变：{ imported, skipped, imageCount, lastScannedAt }。
 *
 * @param id 图集ID
 * @returns 同步结果（新导入数、跳过数、当前图片总数、扫描时间）
 */
export async function syncGalleryFolder(id: number): Promise<{
  success: boolean;
  data?: { imported: number; skipped: number; imageCount: number; lastScannedAt: string };
  error?: string;
}> {
  console.log('[galleryService] 同步图集文件夹:', id);

  // 1. 校验图集存在（保留原"图集不存在"错误契约）
  const galleryResult = await getGallery(id);
  if (!galleryResult.success || !galleryResult.data) {
    return { success: false, error: galleryResult.error || '图集不存在' };
  }

  const db = await getDatabase();
  const lastScannedAt = new Date().toISOString();

  // 2. 读该图集全部绑定文件夹（绑定表是当前文件夹集合的 source of truth）
  const folderRows = await all<{ folderPath: string; recursive: number; extensions: string | null }>(
    db,
    'SELECT folderPath, recursive, extensions FROM gallery_folders WHERE galleryId = ?',
    [id]
  );

  // 5. 无文件夹图集：不扫描、不报错，仅以当前成员表 COUNT 回报
  if (folderRows.length === 0) {
    const countRow = await get<{ cnt: number }>(
      db,
      'SELECT COUNT(*) as cnt FROM gallery_images WHERE galleryId = ?',
      [id]
    );
    const imageCount = countRow?.cnt ?? 0;
    console.log(`[galleryService] 同步完成（无绑定文件夹）: galleryId=${id}, imageCount=${imageCount}`);
    return { success: true, data: { imported: 0, skipped: 0, imageCount, lastScannedAt } };
  }

  // 3. 逐个绑定文件夹扫描导入并累加（scanFolderIntoGallery 各自写成员/更新统计/发事件）
  const defaultExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  let totalImported = 0;
  let totalSkipped = 0;
  for (const folder of folderRows) {
    const isRecursive = folder.recursive === 1 || (folder.recursive as unknown as boolean) === true;
    // 绑定行 extensions 存的是 JSON 字符串；解析失败或为空时回退默认扩展名
    let folderExtensions = defaultExtensions;
    if (folder.extensions) {
      try {
        const parsed = JSON.parse(folder.extensions);
        if (Array.isArray(parsed) && parsed.length > 0) {
          folderExtensions = parsed;
        }
      } catch {
        // 损坏的 extensions JSON：回退默认，仅记录告警
        console.warn(`[galleryService] 绑定文件夹 extensions 解析失败，回退默认: ${folder.folderPath}`);
      }
    }

    const scanResult = await scanFolderIntoGallery(id, folder.folderPath, isRecursive, folderExtensions);
    if (!scanResult.success || !scanResult.data) {
      return { success: false, error: scanResult.error || '同步失败' };
    }
    totalImported += scanResult.data.imported;
    totalSkipped += scanResult.data.skipped;
  }

  // 4. 以成员表 COUNT 为准统计当前图片总数（多文件夹并集）
  const countRow = await get<{ cnt: number }>(
    db,
    'SELECT COUNT(*) as cnt FROM gallery_images WHERE galleryId = ?',
    [id]
  );
  const imageCount = countRow?.cnt ?? 0;

  console.log(
    `[galleryService] 同步完成: galleryId=${id}, folders=${folderRows.length}, imported=${totalImported}, skipped=${totalSkipped}, imageCount=${imageCount}`
  );

  // 公开返回形状保持不变：{ imported, skipped, imageCount, lastScannedAt }
  return {
    success: true,
    data: {
      imported: totalImported,
      skipped: totalSkipped,
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
    const row = await get<{ id: number }>(
      db,
      'SELECT id FROM gallery_ignored_folders WHERE folderPath = ?',
      [normalized]
    );
    emitGalleryIgnoredFoldersChanged({
      action: 'created',
      ignoredFolderId: row?.id,
      folderPath: normalized,
      affectedCount: 1,
    });
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
    emitGalleryIgnoredFoldersChanged({ action: 'updated', ignoredFolderId: id, affectedCount: 1 });
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
    const row = await get<{ folderPath: string }>(
      db,
      'SELECT folderPath FROM gallery_ignored_folders WHERE id = ?',
      [id]
    );
    await run(db, `DELETE FROM gallery_ignored_folders WHERE id = ?`, [id]);
    emitGalleryIgnoredFoldersChanged({
      action: 'deleted',
      ignoredFolderId: id,
      folderPath: row?.folderPath,
      affectedCount: 1,
    });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryService] 删除忽略文件夹失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

