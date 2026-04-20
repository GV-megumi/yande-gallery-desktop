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

// bug12 I1：deleteGallery 现在把 DB 级联包进 runInTransaction。
// 单测不开真实事务，只需让 fn 直接执行并把抛错向外透传，
// galleryService 的外层 catch 会把它转成 { success: false, error }。
vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
  all: (...args: any[]) => allMock(...args),
  runInTransaction: async (_db: any, fn: () => Promise<any>) => fn(),
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

  /**
   * bug12 I2 反模式守卫：recursive=0 图集不应删除子目录下图片
   *
   * 场景：图集 folderPath=/pics，recursive=0；images 表里同时存在
   * /pics/a.jpg（直接子文件，应删）和 /pics/sub/b.jpg（子目录，不应删，
   * 可能属于另一个 /pics/sub 图集）。
   *
   * 旧实现无视 recursive，images 查询始终用整棵子树 LIKE prefix + '%'，
   * 会把 /pics/sub/b.jpg 一起删掉，破坏其他图集的数据。
   *
   * 修复：recursive=0 分支在 LIKE 基础上追加 AND NOT LIKE '<prefix>%<sep>%'
   * 排除更深层路径，仅保留直接子文件。UPDATE booru_posts 的范围同步。
   *
   * 反模式证据：把 galleryService.ts 的 recursive=0 分支回退成整棵子树查询，
   * 本条 FAIL（DELETE images WHERE id IN (...) 参数会包含 /pics/sub/b.jpg 的 id）。
   */
  it('recursive=0 图集不应删除子目录下图片（bug12 I2 反模式守卫）', async () => {
    // 图集 /pics 是非递归；images 表里同时存在直接子文件和更深层文件
    getMock.mockResolvedValueOnce({ id: 7, folderPath: '/pics', recursive: 0 });
    // 预期 SQL 已经过滤过 sub/ 下的 b.jpg，这里只返回直接子文件 a.jpg
    // （mock 层不真正执行 SQL，但通过断言 SQL 文本 + 参数来验证行为）
    allMock.mockResolvedValueOnce([{ id: 10, filepath: '/pics/a.jpg' }]);

    const { deleteGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await deleteGallery(7);

    expect(result.success).toBe(true);

    // 关键断言 1：SELECT images 的 SQL 必须包含 "NOT LIKE" 排除子树
    const selectImagesCalls = allMock.mock.calls.filter(c => /SELECT\s+id,\s+filepath\s+FROM\s+images/i.test(String(c[1])));
    expect(selectImagesCalls.length).toBeGreaterThanOrEqual(1);
    const selectSql = String(selectImagesCalls[0][1]);
    expect(selectSql).toMatch(/NOT LIKE/i);

    // 关键断言 2：DELETE images WHERE id IN (...) 的 id 列表只包含直接子文件
    const deleteImagesCalls = runMock.mock.calls.filter(c => /DELETE FROM images WHERE id IN/i.test(String(c[1])));
    expect(deleteImagesCalls.length).toBe(1);
    const deleteParams = deleteImagesCalls[0][2] as any[];
    expect(deleteParams).toEqual([10]);

    // 关键断言 3：UPDATE booru_posts 的 SQL 也应包含 NOT LIKE（与 images 同步）
    const updateBooruCalls = runMock.mock.calls.filter(c =>
      /UPDATE booru_posts[\s\S]*downloaded = 0[\s\S]*localPath = NULL/i.test(String(c[1]))
    );
    expect(updateBooruCalls.length).toBe(1);
    const updateSql = String(updateBooruCalls[0][1]);
    expect(updateSql).toMatch(/NOT LIKE/i);
  });

  /**
   * bug12 I2：recursive=1 图集保持整棵子树清理（不能回归成只删直接子文件）
   */
  it('recursive=1 图集应删除整棵子树（含子目录）', async () => {
    getMock.mockResolvedValueOnce({ id: 8, folderPath: '/pics-r', recursive: 1 });
    allMock.mockResolvedValueOnce([
      { id: 20, filepath: '/pics-r/a.jpg' },
      { id: 21, filepath: '/pics-r/sub/b.jpg' },
    ]);

    const { deleteGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await deleteGallery(8);

    expect(result.success).toBe(true);

    // 关键断言：递归分支 SELECT 不应包含 NOT LIKE
    const selectImagesCalls = allMock.mock.calls.filter(c => /SELECT\s+id,\s+filepath\s+FROM\s+images/i.test(String(c[1])));
    expect(selectImagesCalls.length).toBeGreaterThanOrEqual(1);
    const selectSql = String(selectImagesCalls[0][1]);
    expect(selectSql).not.toMatch(/NOT LIKE/i);

    // DELETE images 应覆盖两张图（子目录也应被删）
    const deleteImagesCalls = runMock.mock.calls.filter(c => /DELETE FROM images WHERE id IN/i.test(String(c[1])));
    expect(deleteImagesCalls.length).toBe(1);
    const deleteParams = deleteImagesCalls[0][2] as any[];
    expect(new Set(deleteParams)).toEqual(new Set([20, 21]));

    // UPDATE booru_posts 的 SQL 也不应有 NOT LIKE
    const updateBooruCalls = runMock.mock.calls.filter(c =>
      /UPDATE booru_posts[\s\S]*downloaded = 0[\s\S]*localPath = NULL/i.test(String(c[1]))
    );
    expect(updateBooruCalls.length).toBe(1);
    const updateSql = String(updateBooruCalls[0][1]);
    expect(updateSql).not.toMatch(/NOT LIKE/i);
  });

  /**
   * bug12 I1：事务内任一 DB 写抛错 → 整体通过 runInTransaction 传出 →
   * 外层 catch 捕获 → 返回 success:false 并带 error。
   *
   * 单测里 mock 的 runInTransaction 不会真 BEGIN/COMMIT/ROLLBACK，
   * 所以这里仅断言"错误会被透传并转成 success:false"。真正的 ROLLBACK
   * 由 database.runInTransaction 的集成测试守卫（已在其他用例中覆盖）。
   */
  it('事务内 UPDATE booru_posts 抛错应被外层捕获，返回 success:false', async () => {
    getMock.mockResolvedValueOnce({ id: 5, folderPath: '/y', recursive: 0 });
    allMock.mockResolvedValueOnce([{ id: 20, filepath: '/y/a.jpg' }]);

    // 让 UPDATE booru_posts 那一步抛错
    runMock.mockImplementation(async (_db: any, sql: string) => {
      if (/UPDATE booru_posts/i.test(sql)) {
        throw new Error('simulated booru_posts update failure');
      }
    });

    const { deleteGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await deleteGallery(5);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/booru_posts update failure/);

    // 先于 UPDATE 的语句应已调用过（DELETE image_tags / images / invalid_images）
    const sqls = runMock.mock.calls.map(c => String(c[1]));
    expect(sqls.some(s => /DELETE FROM image_tags/i.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM images WHERE id IN/i.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM invalid_images/i.test(s))).toBe(true);

    // 失败点之后的语句不应再执行：不应出现 DELETE galleries / INSERT OR REPLACE ignored
    expect(sqls.some(s => /DELETE FROM galleries WHERE id/i.test(s))).toBe(false);
    expect(sqls.some(s => /INSERT OR REPLACE INTO gallery_ignored_folders/i.test(s))).toBe(false);
  });
});
