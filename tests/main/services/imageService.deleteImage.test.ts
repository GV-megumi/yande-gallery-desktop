import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟内部依赖
const getMock = vi.fn();
const runMock = vi.fn();
const allMock = vi.fn();
const deleteThumbnailMock = vi.fn(async () => {});
const unlinkMock = vi.fn(async () => {});
const emitGalleryImagesChangedMock = vi.fn();

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
  all: (...args: any[]) => allMock(...args),
}));
vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  enqueueThumbnailGeneration: vi.fn(),
  deleteThumbnail: (...args: any[]) => deleteThumbnailMock(...args),
}));
vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryImagesChanged: (...args: any[]) => emitGalleryImagesChangedMock(...args),
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
  // 不再用 folderPath 前缀匹配，而是 SELECT galleryId FROM gallery_images WHERE imageId = ? LIMIT 1。
  describe('图集归属匹配（gallery_images 反查）', () => {
    /**
     * 让 getMock 按 SQL 分派：filepath SELECT 返回图片行，
     * gallery_images SELECT 返回成员行（或 undefined）。
     */
    function wireLookup(filepath: string | undefined, membershipRow: { galleryId: number } | undefined): void {
      getMock.mockImplementation(async (_db: any, sql: string) => {
        if (/gallery_images/i.test(String(sql))) {
          return membershipRow;
        }
        return filepath === undefined ? undefined : { filepath };
      });
    }

    /** 执行 deleteImage 并返回 emitGalleryImagesChanged 收到的 galleryId */
    async function deleteAndGetGalleryId(
      filepath: string,
      membershipRow: { galleryId: number } | undefined
    ): Promise<number | null> {
      wireLookup(filepath, membershipRow);
      const { deleteImage } = await import('../../../src/main/services/imageService.js');
      const result = await deleteImage(1);
      expect(result.success).toBe(true);
      expect(emitGalleryImagesChangedMock).toHaveBeenCalledTimes(1);
      return emitGalleryImagesChangedMock.mock.calls[0][0].galleryId;
    }

    it('反查 SQL 应按 imageId 查询 gallery_images 成员表', async () => {
      wireLookup('/pics/cats/img.jpg', { galleryId: 7 });
      const { deleteImage } = await import('../../../src/main/services/imageService.js');
      await deleteImage(42);

      // 找到针对 gallery_images 的那次 get 调用，断言 SQL 与参数
      const membershipCall = getMock.mock.calls.find(([, sql]) => /gallery_images/i.test(String(sql)));
      expect(membershipCall).toBeTruthy();
      expect(String(membershipCall![1])).toMatch(/SELECT\s+galleryId\s+FROM\s+gallery_images\s+WHERE\s+imageId\s*=\s*\?/i);
      // 第三个参数是绑定参数数组，应携带 imageId
      expect(membershipCall![2]).toEqual([42]);
    });

    it('成员行存在时事件应携带其 galleryId', async () => {
      const galleryId = await deleteAndGetGalleryId('/pics/cats/img.jpg', { galleryId: 7 });
      expect(galleryId).toBe(7);
    });

    it('无成员行时事件 galleryId 应为 null', async () => {
      const galleryId = await deleteAndGetGalleryId('/pics/cats/img.jpg', undefined);
      expect(galleryId).toBeNull();
    });

    it('图片记录不存在时不应反查成员表', async () => {
      // filepath SELECT 返回 undefined → row 为空 → 跳过反查
      getMock.mockResolvedValue(undefined);
      const { deleteImage } = await import('../../../src/main/services/imageService.js');
      const result = await deleteImage(999);
      expect(result.success).toBe(true);
      const membershipCall = getMock.mock.calls.find(([, sql]) => /gallery_images/i.test(String(sql)));
      expect(membershipCall).toBeUndefined();
    });
  });
});
