import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟内部依赖
const getMock = vi.fn();
const runMock = vi.fn();
const deleteThumbnailMock = vi.fn(async () => {});
const unlinkMock = vi.fn(async () => {});

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
}));
vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  deleteThumbnail: (...args: any[]) => deleteThumbnailMock(...args),
}));
vi.mock('fs/promises', () => ({
  default: { unlink: (...args: any[]) => unlinkMock(...args) },
}));

describe('imageService.deleteImage', () => {
  beforeEach(() => {
    getMock.mockReset();
    runMock.mockReset();
    deleteThumbnailMock.mockReset();
    unlinkMock.mockReset();
    getMock.mockResolvedValue({ filepath: '/tmp/a.jpg' });
    runMock.mockResolvedValue(undefined);
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
});
