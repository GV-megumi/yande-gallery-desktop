import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * bug12 — deleteGallery 级联清理反模式守卫
 *
 * 原 deleteGallery 只删 galleries 一行，遗留 images / 缩略图 /
 * invalid_images / booru_posts.downloaded。本测试确保：
 *
 * 1. SELECT 按 folderPath 范围查到该图集下的 images；
 * 2. 每张图调用 deleteThumbnail(filepath) 清理磁盘缩略图；
 * 3. DELETE image_tags / images / invalid_images / galleries；
 * 4. INSERT OR REPLACE 写入 gallery_ignored_folders（避免下次扫描重建）。
 */

const getMock = vi.fn();
const runMock = vi.fn();
const allMock = vi.fn();
const deleteThumbnailMock = vi.fn(async () => ({ success: true }));

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
  all: (...args: any[]) => allMock(...args),
}));

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  deleteThumbnail: (...args: any[]) => deleteThumbnailMock(...args),
}));

vi.mock('../../../src/main/utils/path.js', () => ({
  normalizePath: (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, ''),
}));

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(async () => ({ success: true, data: { imported: 0, skipped: 0 } })),
}));

describe('galleryService.deleteGallery — 级联清理', () => {
  beforeEach(() => {
    getMock.mockReset();
    runMock.mockReset();
    allMock.mockReset();
    deleteThumbnailMock.mockReset();
    deleteThumbnailMock.mockResolvedValue({ success: true });
    runMock.mockResolvedValue(undefined);
  });

  it('成功路径应按 folderPath 查 images → 清缩略图 → DELETE 子表 → 写忽略名单', async () => {
    // 1. SELECT galleries.id / folderPath / recursive
    getMock.mockResolvedValueOnce({ id: 1, folderPath: 'D:/pics', recursive: 0 });
    // 2. SELECT images WHERE filepath LIKE ...
    allMock.mockResolvedValueOnce([
      { id: 10, filepath: 'D:/pics/a.jpg' },
      { id: 11, filepath: 'D:/pics/b.jpg' },
    ]);

    const { deleteGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await deleteGallery(1);

    expect(result.success).toBe(true);

    // 缩略图逐个清（bug12 第 1 条反模式守卫）
    expect(deleteThumbnailMock).toHaveBeenCalledTimes(2);
    expect(deleteThumbnailMock).toHaveBeenCalledWith('D:/pics/a.jpg');
    expect(deleteThumbnailMock).toHaveBeenCalledWith('D:/pics/b.jpg');

    const sqls = runMock.mock.calls.map(c => String(c[1]));
    // images / image_tags 必须显式清
    expect(sqls.some(s => /DELETE FROM images WHERE id IN/i.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM image_tags WHERE imageId IN/i.test(s))).toBe(true);
    // invalid_images 按 galleryId
    expect(sqls.some(s => /DELETE FROM invalid_images WHERE galleryId/i.test(s))).toBe(true);
    // booru_posts 的 downloaded/localPath 清理
    expect(sqls.some(s => /UPDATE booru_posts[\s\S]*downloaded = 0[\s\S]*localPath = NULL/i.test(s))).toBe(true);
    // 图集行
    expect(sqls.some(s => /DELETE FROM galleries WHERE id/i.test(s))).toBe(true);
    // 自动写入忽略名单（bug12 第 2 条反模式守卫一部分）
    expect(sqls.some(s => /INSERT OR REPLACE INTO gallery_ignored_folders/i.test(s))).toBe(true);
  });

  it('图集不存在时应返回 success:false 且不触任何清理', async () => {
    getMock.mockResolvedValueOnce(undefined);

    const { deleteGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await deleteGallery(999);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(deleteThumbnailMock).not.toHaveBeenCalled();
    // 不应进入任何 DELETE 阶段
    const sqls = runMock.mock.calls.map(c => String(c[1]));
    expect(sqls.some(s => /DELETE FROM/i.test(s))).toBe(false);
  });

  it('图集下没有图片时不调用 deleteThumbnail，但仍写忽略名单 + 删 gallery 行', async () => {
    getMock.mockResolvedValueOnce({ id: 2, folderPath: '/tmp/empty', recursive: 1 });
    allMock.mockResolvedValueOnce([]); // 无图

    const { deleteGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await deleteGallery(2);

    expect(result.success).toBe(true);
    expect(deleteThumbnailMock).not.toHaveBeenCalled();

    const sqls = runMock.mock.calls.map(c => String(c[1]));
    expect(sqls.some(s => /DELETE FROM galleries WHERE id/i.test(s))).toBe(true);
    expect(sqls.some(s => /INSERT OR REPLACE INTO gallery_ignored_folders/i.test(s))).toBe(true);
  });

  it('deleteThumbnail 抛错应被吞（best-effort），其余清理仍继续', async () => {
    getMock.mockResolvedValueOnce({ id: 3, folderPath: '/x', recursive: 0 });
    allMock.mockResolvedValueOnce([{ id: 1, filepath: '/x/a.jpg' }]);
    deleteThumbnailMock.mockRejectedValueOnce(new Error('fs EACCES'));

    const { deleteGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await deleteGallery(3);

    expect(result.success).toBe(true);
    const sqls = runMock.mock.calls.map(c => String(c[1]));
    expect(sqls.some(s => /DELETE FROM galleries WHERE id/i.test(s))).toBe(true);
  });
});
