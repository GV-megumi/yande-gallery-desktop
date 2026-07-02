import { getDatabase, run, get } from './database.js';
import { emitGalleryGalleriesChanged } from './appEventPublisher.js';

/**
 * 图集统计共享 helper —— 删除图片类路径的归属图集统计刷新
 *
 * 删除 images 行会 FK CASCADE 清掉该图在所有图集的 gallery_images 成员行；
 * 一张图片可同属多个图集（成员主键 galleryId+imageId），因此调用方必须在删除前
 * 读出全部归属图集（不 LIMIT 1），删除后逐个图集刷新统计并发事件，否则共同归属
 * 图集的 imageCount 与变更事件会陈旧。
 *
 * 抽取自 848887a 对 invalidImageService.reportInvalidImage 的多归属修复，
 * 现由 imageService.deleteImage 与 reportInvalidImage 两处共用，避免逻辑复制漂移。
 *
 * 与 galleryService.updateGalleryStats 的区别：那是扫描流程写入外部算好的
 * imageCount + lastScannedAt；这里是「以成员表现状为准」的重算，不动 lastScannedAt。
 */

/**
 * 逐个图集以 COUNT(gallery_images) 重算并回写 galleries.imageCount（只写库，不发事件）。
 *
 * 事件拆分为 emitGalleriesStatsUpdated 单独发出：reportInvalidImage 在 runInTransaction
 * 回调内回写计数、事务提交后才发事件，本函数需可安全地在事务内调用。
 */
export async function recalcGalleriesImageCount(
  db: Awaited<ReturnType<typeof getDatabase>>,
  galleryIds: number[]
): Promise<void> {
  for (const gid of galleryIds) {
    const countResult = await get<{ cnt: number }>(
      db,
      'SELECT COUNT(*) as cnt FROM gallery_images WHERE galleryId = ?',
      [gid]
    );
    if (countResult) {
      await run(db, 'UPDATE galleries SET imageCount = ? WHERE id = ?', [countResult.cnt, gid]);
    }
  }
}

/**
 * 逐个归属图集发 galleries-changed(statsUpdated) 统计变更事件。
 * 调用方应在数据库回写完成（事务已提交）后再调用，渲染层据此重载图集列表刷新计数。
 */
export function emitGalleriesStatsUpdated(galleryIds: number[]): void {
  for (const gid of galleryIds) {
    emitGalleryGalleriesChanged({ action: 'statsUpdated', galleryId: gid, affectedCount: 1 });
  }
}
