import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * bug12 — gallery_ignored_folders CRUD 测试
 *
 * 约束：
 * - 使用 vi.mock 隔离数据库层，仅验证 SQL 形态 + 参数传递；
 * - normalizePath 的真实行为在 Windows 会产生反斜杠，测试里用纯函数 mock
 *   以稳定跨平台断言。
 */

const getMock = vi.fn();
const runMock = vi.fn();
const allMock = vi.fn();

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
  all: (...args: any[]) => allMock(...args),
}));

vi.mock('../../../src/main/utils/path.js', () => ({
  // 简化的 normalizePath：统一为正斜杠 + 去除末尾分隔符
  normalizePath: (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, ''),
}));

// imageService.scanAndImportFolder 会在导入 galleryService 时被间接引用，
// 但本测试只调用 CRUD 函数，保留默认 mock 即可。
vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(async () => ({ success: true, data: { imported: 0, skipped: 0 } })),
}));

describe('galleryService — 忽略文件夹 CRUD', () => {
  beforeEach(() => {
    getMock.mockReset();
    runMock.mockReset();
    allMock.mockReset();
  });

  it('addIgnoredFolder 应归一化路径并用 INSERT OR REPLACE 写入', async () => {
    runMock.mockResolvedValueOnce(undefined);
    const { addIgnoredFolder } = await import('../../../src/main/services/galleryService.js');
    const result = await addIgnoredFolder('D:\\pics\\', 'deleted');

    expect(result.success).toBe(true);
    expect(runMock).toHaveBeenCalledTimes(1);

    const call = runMock.mock.calls[0];
    const sql = String(call[1]);
    const params = call[2] as any[];

    expect(sql).toMatch(/INSERT OR REPLACE INTO gallery_ignored_folders/i);
    // 参数顺序：[folderPath, note, folderPath(COALESCE子查询), createdAtFallback, updatedAt]
    expect(params[0]).toBe('D:/pics');
    expect(params[1]).toBe('deleted');
    expect(params[2]).toBe('D:/pics');
  });

  it('addIgnoredFolder 未传 note 时应存 null', async () => {
    runMock.mockResolvedValueOnce(undefined);
    const { addIgnoredFolder } = await import('../../../src/main/services/galleryService.js');
    await addIgnoredFolder('/tmp/foo');

    const params = runMock.mock.calls[0][2] as any[];
    expect(params[1]).toBeNull();
  });

  it('listIgnoredFolders 应执行 SELECT 并返回 DB 行', async () => {
    const rows = [
      {
        id: 1,
        folderPath: 'D:/pics',
        note: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    allMock.mockResolvedValueOnce(rows);
    const { listIgnoredFolders } = await import('../../../src/main/services/galleryService.js');
    const result = await listIgnoredFolders();

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].folderPath).toBe('D:/pics');

    const sql = String(allMock.mock.calls[0][1]);
    expect(sql).toMatch(/SELECT[\s\S]*FROM gallery_ignored_folders/i);
    expect(sql).toMatch(/ORDER BY createdAt DESC/i);
  });

  it('updateIgnoredFolder 应更新 note + updatedAt', async () => {
    runMock.mockResolvedValueOnce(undefined);
    const { updateIgnoredFolder } = await import('../../../src/main/services/galleryService.js');
    const result = await updateIgnoredFolder(5, { note: '新备注' });

    expect(result.success).toBe(true);
    const sql = String(runMock.mock.calls[0][1]);
    const params = runMock.mock.calls[0][2] as any[];
    expect(sql).toMatch(/UPDATE gallery_ignored_folders/i);
    expect(sql).toMatch(/SET note = \?, updatedAt = \?/i);
    expect(params[0]).toBe('新备注');
    expect(params[2]).toBe(5);
  });

  it('removeIgnoredFolder 应执行 DELETE WHERE id', async () => {
    runMock.mockResolvedValueOnce(undefined);
    const { removeIgnoredFolder } = await import('../../../src/main/services/galleryService.js');
    const result = await removeIgnoredFolder(42);

    expect(result.success).toBe(true);
    const sql = String(runMock.mock.calls[0][1]);
    const params = runMock.mock.calls[0][2] as any[];
    expect(sql).toMatch(/DELETE FROM gallery_ignored_folders WHERE id = \?/i);
    expect(params[0]).toBe(42);
  });

  it('addIgnoredFolder 在 DB 抛错时应返回 success:false + error', async () => {
    runMock.mockRejectedValueOnce(new Error('db fail'));
    const { addIgnoredFolder } = await import('../../../src/main/services/galleryService.js');
    const result = await addIgnoredFolder('/tmp/x');
    expect(result.success).toBe(false);
    expect(result.error).toBe('db fail');
  });
});
