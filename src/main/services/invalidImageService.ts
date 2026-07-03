import { getDatabase, run, get, all, runInTransaction } from './database.js';
import { getThumbnailIfExists, deleteThumbnail, deletePreview } from './thumbnailService.js';
import { InvalidImage } from '../../shared/types.js';
import { isSubPath } from '../utils/path.js';
import fs from 'fs/promises';
import {
  emitGalleryImagesChanged,
  emitGalleryInvalidImagesChanged,
} from './appEventPublisher.js';
import { recalcGalleriesImageCount, emitGalleriesStatsUpdated } from './galleryStats.js';

// 丢失文件夹防护的告警去重（仅日志层面：同一缺失文件夹下每张图都会触发一次自动上报，
// 不去重会刷屏；进程内记住已告警的文件夹即可，重定位后即便残留一条抑制也只影响日志）
const warnedMissingFolders = new Set<string>();

/**
 * 丢失文件夹防护：判断图片是否位于"整个绑定文件夹都不在磁盘上"的场景。
 *
 * 搬库/未重定位/磁盘离线时，文件缺失属于文件夹级问题而非单张图片失效——
 * 此时自动失效上报不应迁移图片（迁移是破坏性的：删 images 行连带成员/标签、
 * 删缩略图、复位 booru 下载状态），否则重定位之前浏览图集会把成员逐张蚕食。
 *
 * 判据用"绑定文件夹是否存在"而非"图片父目录是否存在"：用户手动删掉图集里的
 * 子文件夹时（绑定文件夹还在），那些图仍应正常进入无效清理。
 *
 * @returns 覆盖该图片路径的绑定文件夹全部缺失时返回缺失文件夹列表；
 *          无覆盖绑定或任一覆盖绑定仍存在时返回 null（照常迁移）。
 */
async function findAllMissingCoveringFolders(
  db: Awaited<ReturnType<typeof getDatabase>>,
  imageId: number,
  filepath: string
): Promise<string[] | null> {
  const rows = await all<{ folderPath: string }>(db,
    `SELECT DISTINCT gf.folderPath
       FROM gallery_folders gf
       JOIN gallery_images gi ON gi.galleryId = gf.galleryId
      WHERE gi.imageId = ?`,
    [imageId]);
  const covering = rows.map(r => r.folderPath).filter(folder => isSubPath(folder, filepath));
  if (covering.length === 0) {
    return null;
  }
  for (const folder of covering) {
    try {
      await fs.access(folder);
      return null; // 任一覆盖绑定文件夹仍在磁盘上：文件夹没丢，是文件真没了
    } catch {
      // 该绑定文件夹缺失，继续检查其余覆盖绑定
    }
  }
  return covering;
}

interface InvalidCandidateImage {
  id: number;
  filename: string;
  filepath: string;
  fileSize: number;
  width: number;
  height: number;
  format: string;
}

/** 数组分块（与 galleryService 的同名私有 helper 一致；避免跨服务耦合各自持有） */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** 批量迁移：单个分块事务处理的成员图片数（块间放行其它写事务，避免长期独占事务队列） */
const MIGRATE_TX_BATCH = 200;
/** 批量迁移：IN(...) 查询每批变量数（SQLite 默认变量上限 999，留足余量） */
const SQL_VAR_BATCH = 500;

/**
 * 迁移语句核心（**须在调用方事务内执行**）：读归属 → 插 invalid_images → 清封面 →
 * 复位 booru 下载状态 → 删 images 行。不含 imageCount 重算与事件——
 * 单张入口（migrateImageToInvalid）在自己的事务里随手重算；
 * 批量入口（migrateMissingFolderImages）在分块事务末尾对整块归属去重后一次性重算。
 *
 * @param thumbnailPath 事务外预先解析好的缩略图路径（fs 探测不进事务）
 * @returns 本图片的全部归属图集 id（调用方聚合统计/事件用）
 */
async function migrateImageToInvalidInTx(
  db: Awaited<ReturnType<typeof getDatabase>>,
  image: InvalidCandidateImage,
  thumbnailPath: string | null,
  now: string
): Promise<number[]> {
  // 查找所属 gallery（Phase 4：通过 gallery_images 成员归属，而非 galleries.folderPath 前缀匹配）。
  // 一张图可同时归属多个图集（多归属）；删除图片会 FK CASCADE 清掉它在所有图集的成员行，
  // 故必须读出全部归属图集，供调用方逐个刷新统计——否则共同归属的图集 imageCount/事件会陈旧。
  // 须在删 images 前读取——删除会触发 FK CASCADE 清掉 gallery_images 成员行。
  const memberships = await all<{ galleryId: number }>(db,
    'SELECT galleryId FROM gallery_images WHERE imageId = ?',
    [image.id]);
  // 去重（同一图集对同一图片只可能一行，这里保险去重）
  const ownerGalleryIds = Array.from(new Set(memberships.map(m => m.galleryId)));
  // invalid_images.galleryId 仍记录单个代表（首个归属，无归属则 NULL），保持单列语义不变。
  const representativeGalleryId: number | null = ownerGalleryIds[0] ?? null;
  // 代表图集的封面信息（用于"失效图是封面则清空封面"，沿用原单图集行为）。
  const gallery = representativeGalleryId != null
    ? await get<{ id: number; coverImageId: number | null }>(db,
        'SELECT id, coverImageId FROM galleries WHERE id = ?',
        [representativeGalleryId])
    : null;

  // 插入无效图片记录（galleryId 记录单个代表归属，保持单列语义）
  await run(db, `
    INSERT INTO invalid_images (originalImageId, filename, filepath, fileSize, width, height, format, thumbnailPath, detectedAt, galleryId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [image.id, image.filename, image.filepath, image.fileSize, image.width, image.height, image.format, thumbnailPath, now, representativeGalleryId]);

  // 如果该图片是代表图集的封面，清除封面
  if (gallery && gallery.coverImageId === image.id) {
    await run(db, 'UPDATE galleries SET coverImageId = NULL WHERE id = ?', [gallery.id]);
  }

  // 复位对应 booru 帖子的下载状态（对齐 cleanupOrphanImages / imageService.deleteImage）：
  // 本地文件已失效，帖子应可重新下载。必须在 DELETE images 之前——删除后 FK 仅
  // SET NULL 清 localImageId 引用，downloaded=1 与陈旧 localPath 会永久残留，
  // 按路径去重的批量下载将永远跳过该帖。丢失文件夹横幅的确认弹窗与本函数头注释
  // 历来承诺「复位 booru 下载状态」，此处兑现。
  await run(
    db,
    'UPDATE booru_posts SET downloaded = 0, localPath = NULL WHERE localImageId = ? OR localPath = ?',
    [image.id, image.filepath]
  );

  // 从 images 表删除（ON DELETE CASCADE 会自动清理 image_tags 与全部 gallery_images 成员行）
  await run(db, 'DELETE FROM images WHERE id = ?', [image.id]);

  return ownerGalleryIds;
}

/**
 * 迁移核心（单张入口）：把一张 images 行迁进 invalid_images（事务内执行语句核心、
 * 按成员表重算全部归属图集的 imageCount），可选发领域事件。
 *
 * 供两个入口共用：
 * - reportInvalidImage（自动上报，带丢失文件夹防护，逐张发事件）；
 * - migrateMissingFolderImages（用户显式批量迁移，绕过防护，聚合发事件，
 *   走分块事务直接调 migrateImageToInvalidInTx，不经本包装）。
 *
 * @returns 本图片的全部归属图集 id（调用方聚合统计/事件用）
 */
async function migrateImageToInvalid(
  db: Awaited<ReturnType<typeof getDatabase>>,
  image: InvalidCandidateImage,
  options: { emitEvents: boolean }
): Promise<number[]> {
  // 缩略图路径解析走 fs，放事务外
  const thumbnailPath = await getThumbnailIfExists(image.filepath);
  const now = new Date().toISOString();

  let ownerGalleryIds: number[] = [];
  await runInTransaction(db, async () => {
    ownerGalleryIds = await migrateImageToInvalidInTx(db, image, thumbnailPath, now);
    // 刷新全部归属图集的 imageCount（Phase 4：以 gallery_images 成员表为准）。
    // 此处已在删 images 之后，本图片在各图集的成员行已被 FK CASCADE 清掉，故各 COUNT 自然排除它。
    // 多归属时必须逐个刷新，否则共同归属的图集计数会陈旧（共享 helper，与 imageService.deleteImage 同一逻辑）。
    await recalcGalleriesImageCount(db, ownerGalleryIds);
  });

  const representativeGalleryId: number | null = ownerGalleryIds[0] ?? null;

  if (options.emitEvents) {
    emitGalleryInvalidImagesChanged({
      action: 'reported',
      originalImageId: image.id,
      galleryId: representativeGalleryId,
      affectedCount: 1,
      filepath: image.filepath,
    });
    emitGalleryImagesChanged({
      action: 'invalidated',
      imageId: image.id,
      galleryId: representativeGalleryId,
      // 覆盖全部归属图集（多归属时下游据此刷新每个图集视图）
      affectedGalleryIds: ownerGalleryIds.length > 0 ? ownerGalleryIds : undefined,
      affectedImageIds: [image.id],
      affectedCount: 1,
      reason: 'invalidReported',
      filepath: image.filepath,
    }, 'invalidImageService');
    // 逐个归属图集发统计变更事件（与单图集时一致，循环覆盖全部；事务提交后才发）
    emitGalleriesStatsUpdated(ownerGalleryIds);
  }

  return ownerGalleryIds;
}

/**
 * 上报无效图片：从 images 表迁移到 invalid_images 表
 * - 查询 images 记录
 * - 查询所属 gallery
 * - 获取缩略图路径
 * - 事务内：插入 invalid_images、删除 images 记录、更新 gallery 封面和计数
 *
 * 带丢失文件夹防护：图片归属图集的绑定文件夹整个不在磁盘上时拒绝迁移
 * （搬库/未重定位/磁盘离线场景），由图集详情页横幅引导用户显式处理。
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
    const image = await get<InvalidCandidateImage>(
      db, 'SELECT id, filename, filepath, fileSize, width, height, format FROM images WHERE id = ?', [imageId]);

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

    // 丢失文件夹防护：覆盖该图片的绑定文件夹全部缺失 → 文件夹级问题，不迁移
    const missingCovering = await findAllMissingCoveringFolders(db, image.id, image.filepath);
    if (missingCovering) {
      for (const folder of missingCovering) {
        if (!warnedMissingFolders.has(folder)) {
          warnedMissingFolders.add(folder);
          console.warn(`[invalidImageService] 跳过失效迁移：绑定文件夹整个缺失（疑似未重定位/磁盘离线）: ${folder}`);
        }
      }
      return { success: false, error: '图片所属绑定文件夹不存在（可能未重定位或磁盘离线），已跳过失效迁移' };
    }

    await migrateImageToInvalid(db, image, { emitEvents: true });
    console.log(`[invalidImageService] 已迁移无效图片: ${image.filename} (ID: ${imageId})`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[invalidImageService] 上报无效图片失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 用户显式批量迁移：把某图集里位于指定丢失文件夹下的成员图片全部迁入无效列表。
 *
 * 图集详情页「文件夹丢失」横幅的「全部迁入无效项」动作入口——用户明确选择放弃
 * 这些图片记录，故**绕过**丢失文件夹防护；仍逐张校验源文件确实不存在（防御磁盘
 * 恢复/部分存在的极端情况，存在的跳过不迁）。
 *
 * 事件聚合发送（不逐张发），避免大文件夹迁移时事件风暴；不改动绑定行本身
 * （文件夹仍绑定且缺失，用户可继续选择重定位或到图集信息里解绑）。
 */
export async function migrateMissingFolderImages(
  galleryId: number,
  folderPath: string
): Promise<{ success: boolean; data?: { migrated: number; skipped: number }; error?: string }> {
  try {
    const db = await getDatabase();

    // 校验该文件夹确实是这个图集的绑定文件夹（防误传路径整批迁错）
    const binding = await get<{ id: number }>(db,
      'SELECT id FROM gallery_folders WHERE galleryId = ? AND folderPath = ?',
      [galleryId, folderPath]);
    if (!binding) {
      return { success: false, error: '该文件夹不是此图集的绑定文件夹' };
    }

    // 枚举该图集成员中位于该文件夹下的图片（JS 侧 isSubPath 与成员谓词同语义，避免再拼 LIKE）
    const members = await all<InvalidCandidateImage>(db,
      `SELECT i.id, i.filename, i.filepath, i.fileSize, i.width, i.height, i.format
         FROM images i
         JOIN gallery_images gi ON gi.imageId = i.id
        WHERE gi.galleryId = ?`,
      [galleryId]);
    const candidates = members.filter(m => isSubPath(folderPath, m.filepath));

    // 预取已在无效列表的成员 id（幂等跳过）。原先逐张 SELECT，万张级丢失文件夹
    // 会放大为万次队列往返，这里按批 IN 查询一次性取回。
    const existingInvalidIds = new Set<number>();
    for (const idBatch of chunkArray(candidates.map(c => c.id), SQL_VAR_BATCH)) {
      const placeholders = idBatch.map(() => '?').join(',');
      const rows = await all<{ originalImageId: number }>(db,
        `SELECT originalImageId FROM invalid_images WHERE originalImageId IN (${placeholders})`,
        idBatch);
      rows.forEach(r => existingInvalidIds.add(r.originalImageId));
    }

    let migrated = 0;
    let skipped = 0;
    const affectedGalleryIds = new Set<number>();
    // 分块事务：每块一个事务、块末对整块归属去重后一次性重算 imageCount——
    // 取代逐张事务+逐张重算（万张级一次点击 = 数万次语句串行过事务队列，
    // 期间其它写操作被长期排队）。块间放行其它写事务；某块失败整块回滚并向上抛
    //（已完成块保留，与原逐张中止语义一致）：调用方返回错误、横幅保留，
    // 用户可重试（已迁成员经上面的幂等预取被跳过）。
    for (const chunk of chunkArray(candidates, MIGRATE_TX_BATCH)) {
      // 事务外过滤与缩略图路径解析（fs 探测不进事务）
      const toMigrate: Array<{ image: InvalidCandidateImage; thumbnailPath: string | null }> = [];
      for (const image of chunk) {
        // 已在无效列表的跳过（幂等）
        if (existingInvalidIds.has(image.id)) {
          skipped++;
          continue;
        }
        // 源文件仍存在的跳过（磁盘部分恢复等极端情况，不做破坏性迁移）
        try {
          await fs.access(image.filepath);
          skipped++;
          continue;
        } catch {
          // 文件确实不存在，迁移
        }
        toMigrate.push({ image, thumbnailPath: await getThumbnailIfExists(image.filepath) });
      }
      if (toMigrate.length === 0) continue;

      const now = new Date().toISOString();
      await runInTransaction(db, async () => {
        const chunkOwnerIds = new Set<number>();
        for (const { image, thumbnailPath } of toMigrate) {
          const owners = await migrateImageToInvalidInTx(db, image, thumbnailPath, now);
          owners.forEach(id => chunkOwnerIds.add(id));
        }
        // 整块一次性重算涉及图集的 imageCount（此时块内成员行都已 CASCADE 清掉）
        await recalcGalleriesImageCount(db, Array.from(chunkOwnerIds));
        chunkOwnerIds.forEach(id => affectedGalleryIds.add(id));
      });
      migrated += toMigrate.length;
    }

    if (migrated > 0) {
      const galleryIds = Array.from(affectedGalleryIds);
      // 聚合事件：不带逐张 imageId 明细，下游按图集整体刷新
      emitGalleryInvalidImagesChanged({
        action: 'reported',
        galleryId,
        affectedCount: migrated,
      });
      emitGalleryImagesChanged({
        action: 'invalidated',
        galleryId,
        affectedGalleryIds: galleryIds.length > 0 ? galleryIds : undefined,
        affectedCount: migrated,
        reason: 'invalidReported',
      }, 'invalidImageService');
      emitGalleriesStatsUpdated(galleryIds);
    }

    console.log(`[invalidImageService] 丢失文件夹批量迁移完成: galleryId=${galleryId}, folder=${folderPath}, migrated=${migrated}, skipped=${skipped}`);
    return { success: true, data: { migrated, skipped } };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[invalidImageService] 丢失文件夹批量迁移失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
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
      await deletePreview(row.filepath).catch(() => undefined);
    }

    // 删除数据库记录
    await run(db, 'DELETE FROM invalid_images WHERE id = ?', [id]);
    emitGalleryInvalidImagesChanged({
      action: 'deleted',
      invalidImageId: id,
      filepath: row.filepath,
      affectedCount: 1,
    });

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

    // 逐个删除缩略图 + 预览档（忽略失败）
    for (const row of rows) {
      try {
        await deleteThumbnail(row.filepath);
        await deletePreview(row.filepath).catch(() => undefined);
      } catch {
        // 忽略单个缩略图删除失败
      }
    }

    // 清空表
    await run(db, 'DELETE FROM invalid_images');
    emitGalleryInvalidImagesChanged({ action: 'cleared', affectedCount: rows.length });

    console.log(`[invalidImageService] 已清空所有无效项，共 ${rows.length} 个`);
    return { success: true, data: { deleted: rows.length } };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[invalidImageService] 清空无效项失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}
