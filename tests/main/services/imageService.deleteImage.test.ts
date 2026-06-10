import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

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

  // —— 图集归属：边界精确的路径前缀匹配（修复 SQL LIKE 误配） ——
  describe('图集归属匹配', () => {
    // 用 path.join 构造平台原生分隔符的路径，与入库格式一致
    const p = (...segs: string[]) => path.join(path.sep + 'pics', ...segs);

    /** 执行 deleteImage 并返回 emitGalleryImagesChanged 收到的 galleryId */
    async function deleteAndGetGalleryId(
      filepath: string,
      galleries: Array<{ id: number; folderPath: string }>
    ): Promise<number | null> {
      getMock.mockResolvedValue({ filepath });
      allMock.mockResolvedValue(galleries);
      const { deleteImage } = await import('../../../src/main/services/imageService.js');
      const result = await deleteImage(1);
      expect(result.success).toBe(true);
      expect(emitGalleryImagesChangedMock).toHaveBeenCalledTimes(1);
      return emitGalleryImagesChangedMock.mock.calls[0][0].galleryId;
    }

    it('图片在图集目录内时应正确归属', async () => {
      const galleryId = await deleteAndGetGalleryId(
        p('cats', 'img.jpg'),
        [{ id: 7, folderPath: p('cats') }]
      );
      expect(galleryId).toBe(7);
    });

    it('兄弟前缀目录不应误配（cats2 不属于 cats）', async () => {
      const galleryId = await deleteAndGetGalleryId(
        p('cats2', 'img.jpg'),
        [{ id: 7, folderPath: p('cats') }]
      );
      expect(galleryId).toBeNull();
    });

    it('folderPath 中的 LIKE 元字符（_ 和 %）不应产生假匹配', async () => {
      // 旧实现中 'ca_s' 的 '_' 会匹配 'cats' 中的 't'，'%' 会匹配任意子串
      const galleryId = await deleteAndGetGalleryId(
        p('cats', 'img.jpg'),
        [
          { id: 1, folderPath: p('ca_s') },
          { id: 2, folderPath: p('%') },
        ]
      );
      expect(galleryId).toBeNull();
    });

    it('嵌套图集应取 folderPath 最长（最深）的匹配', async () => {
      const galleryId = await deleteAndGetGalleryId(
        p('cats', 'kittens', 'img.jpg'),
        [
          { id: 1, folderPath: p() },
          { id: 2, folderPath: p('cats') },
          { id: 3, folderPath: p('dogs') },
        ]
      );
      expect(galleryId).toBe(2);
    });

    it.runIf(process.platform === 'win32')('win32 下路径比较应大小写不敏感', async () => {
      const galleryId = await deleteAndGetGalleryId(
        path.join(path.sep + 'Pics', 'Cats', 'img.jpg'),
        [{ id: 9, folderPath: p('cats') }]
      );
      expect(galleryId).toBe(9);
    });
  });
});
