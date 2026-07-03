import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟内部依赖
const getMock = vi.fn();
const runMock = vi.fn();
const allMock = vi.fn();
const deleteThumbnailMock = vi.fn(async () => {});
const unlinkMock = vi.fn(async () => {});
const emitGalleryImagesChangedMock = vi.fn();
const emitGalleryGalleriesChangedMock = vi.fn();

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
  all: (...args: any[]) => allMock(...args),
}));
vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  deletePreview: vi.fn(async () => ({ success: true })),
  cancelThumbnailGeneration: vi.fn(),
  enqueueThumbnailGeneration: vi.fn(),
  deleteThumbnail: (...args: any[]) => deleteThumbnailMock(...args),
}));
vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryImagesChanged: (...args: any[]) => emitGalleryImagesChangedMock(...args),
  // galleryStats 共享 helper（statsUpdated 事件）经由此发布器发出
  emitGalleryGalleriesChanged: (...args: any[]) => emitGalleryGalleriesChangedMock(...args),
}));
vi.mock('fs/promises', () => ({
  default: { unlink: (...args: any[]) => unlinkMock(...args) },
}));

describe('imageService.deleteImage', () => {
  beforeEach(() => {
    getMock.mockReset();
    runMock.mockReset();
    allMock.mockReset();
    deleteThumbnailMock.mockReset();
    unlinkMock.mockReset();
    emitGalleryImagesChangedMock.mockReset();
    emitGalleryGalleriesChangedMock.mockReset();
    getMock.mockResolvedValue({ filepath: '/tmp/a.jpg' });
    runMock.mockResolvedValue(undefined);
    allMock.mockResolvedValue([]);
    // 保持 async 默认返回 Promise，避免 .catch 调用报错
    deleteThumbnailMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
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

  // —— 图集归属：改用 gallery_images 成员表反查（Phase 2B）——
  // 不再用 folderPath 前缀匹配，而是 SELECT galleryId FROM gallery_images WHERE imageId = ?。
  // 修复轮 U12：读出全部归属（不 LIMIT 1），删除后逐图集回写 imageCount 并发 statsUpdated
  //（与 848887a 对 invalidImageService.reportInvalidImage 的多归属修复对齐，共用 galleryStats helper）。
  describe('图集归属匹配（gallery_images 反查）', () => {
    /**
     * 按 SQL 分派 mock：
     *  - allMock：成员反查 SELECT 返回全部归属行；
     *  - getMock：filepath SELECT 返回图片行；COUNT(gallery_images) 返回 { cnt }。
     */
    function wireLookup(
      filepath: string | undefined,
      membershipRows: Array<{ galleryId: number }>,
      cnt: number = 0
    ): void {
      getMock.mockImplementation(async (_db: any, sql: string) => {
        const s = String(sql);
        if (/COUNT\(\*\)/i.test(s) && /gallery_images/i.test(s)) {
          return { cnt };
        }
        return filepath === undefined ? undefined : { filepath };
      });
      allMock.mockImplementation(async (_db: any, sql: string) => {
        if (/gallery_images/i.test(String(sql))) {
          return membershipRows;
        }
        return [];
      });
    }

    /** 执行 deleteImage 并返回 emitGalleryImagesChanged 收到的事件 payload */
    async function deleteAndGetPayload(
      filepath: string,
      membershipRows: Array<{ galleryId: number }>
    ): Promise<{ galleryId: number | null; affectedGalleryIds?: number[] }> {
      wireLookup(filepath, membershipRows);
      const { deleteImage } = await import('../../../src/main/services/imageService.js');
      const result = await deleteImage(1);
      expect(result.success).toBe(true);
      expect(emitGalleryImagesChangedMock).toHaveBeenCalledTimes(1);
      return emitGalleryImagesChangedMock.mock.calls[0][0];
    }

    it('反查 SQL 应按 imageId 查询 gallery_images 全部成员行（不 LIMIT 1）', async () => {
      wireLookup('/pics/cats/img.jpg', [{ galleryId: 7 }]);
      const { deleteImage } = await import('../../../src/main/services/imageService.js');
      await deleteImage(42);

      // 成员反查走 all（读全部归属），断言 SQL 与参数
      const membershipCall = allMock.mock.calls.find(([, sql]) => /gallery_images/i.test(String(sql)));
      expect(membershipCall).toBeTruthy();
      expect(String(membershipCall![1])).toMatch(/SELECT\s+galleryId\s+FROM\s+gallery_images\s+WHERE\s+imageId\s*=\s*\?/i);
      expect(String(membershipCall![1])).not.toMatch(/LIMIT/i);
      // 第三个参数是绑定参数数组，应携带 imageId
      expect(membershipCall![2]).toEqual([42]);
    });

    it('成员行存在时事件应携带首个归属作代表 galleryId', async () => {
      const payload = await deleteAndGetPayload('/pics/cats/img.jpg', [{ galleryId: 7 }]);
      expect(payload.galleryId).toBe(7);
      expect(payload.affectedGalleryIds).toEqual([7]);
    });

    it('无成员行时事件 galleryId 应为 null，且不回写统计、不发 statsUpdated', async () => {
      const payload = await deleteAndGetPayload('/pics/cats/img.jpg', []);
      expect(payload.galleryId).toBeNull();
      expect(payload.affectedGalleryIds).toBeUndefined();
      // 无归属：不应出现 imageCount 回写，也不应发 statsUpdated
      const updateCall = runMock.mock.calls.find(([, sql]) => /UPDATE\s+galleries\s+SET\s+imageCount/i.test(String(sql)));
      expect(updateCall).toBeUndefined();
      expect(emitGalleryGalleriesChangedMock).not.toHaveBeenCalled();
    });

    it('图片记录不存在时不应反查成员表', async () => {
      // filepath SELECT 返回 undefined → row 为空 → 跳过反查
      getMock.mockResolvedValue(undefined);
      const { deleteImage } = await import('../../../src/main/services/imageService.js');
      const result = await deleteImage(999);
      expect(result.success).toBe(true);
      const membershipCall = allMock.mock.calls.find(([, sql]) => /gallery_images/i.test(String(sql)));
      expect(membershipCall).toBeUndefined();
    });

    // —— 修复轮 U12：多归属删除后的统计刷新与事件覆盖 ——
    it('多归属时 affectedGalleryIds 覆盖全部归属，逐图集回写 imageCount 并发 statsUpdated', async () => {
      wireLookup('/pics/shared.jpg', [{ galleryId: 3 }, { galleryId: 9 }], 5);
      const { deleteImage } = await import('../../../src/main/services/imageService.js');
      const result = await deleteImage(1);
      expect(result.success).toBe(true);

      // images-changed：代表 galleryId 取首个归属，affectedGalleryIds 覆盖全部归属
      const payload = emitGalleryImagesChangedMock.mock.calls[0][0];
      expect(payload.galleryId).toBe(3);
      expect(payload.affectedGalleryIds).toEqual([3, 9]);

      // 删除后逐图集以 COUNT(gallery_images) 回写 imageCount
      const updateCalls = runMock.mock.calls.filter(([, sql]) => /UPDATE\s+galleries\s+SET\s+imageCount/i.test(String(sql)));
      expect(updateCalls.map(call => call[2])).toEqual([[5, 3], [5, 9]]);

      // 逐图集发 statsUpdated 统计变更事件
      expect(emitGalleryGalleriesChangedMock.mock.calls.map(([arg]) => arg)).toEqual([
        { action: 'statsUpdated', galleryId: 3, affectedCount: 1 },
        { action: 'statsUpdated', galleryId: 9, affectedCount: 1 },
      ]);
    });
  });
});
