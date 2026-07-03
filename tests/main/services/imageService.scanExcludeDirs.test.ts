import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';

/**
 * 修复轮 U05 — scanAndImportFolder/scanDirectory 的 excludeDirs 整棵剪枝。
 *
 * 黑名单（gallery_ignored_folders）中位于扫描根内部的目录由 galleryService 转成
 * excludeDirs 传入：递归扫描命中排除目录（或其后代）即整棵跳过——不深入 readdir、
 * 其文件不参与导入。否则「删除图集自动拉黑」的子树会在父级重扫时整棵复活。
 *
 * mock 手法与 imageService.appEvent.test.ts 一致：mock fs/promises 构造目录树，
 * mock database/thumbnail/config/事件，验证遍历与导入行为。
 */

const getDatabase = vi.fn();
const all = vi.fn();
const run = vi.fn();
const get = vi.fn();
const runInTransaction = vi.fn();
const readdir = vi.fn();
const stat = vi.fn();
const enqueueThumbnailGeneration = vi.fn();
const deleteThumbnail = vi.fn();
const getConfig = vi.fn();
const emitBuiltRendererAppEvent = vi.fn();

vi.mock('fs/promises', () => ({
  default: {
    readdir,
    stat,
  },
  readdir,
  stat,
}));

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase,
  all,
  run,
  get,
  runInTransaction,
}));

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  deletePreview: vi.fn(async () => ({ success: true })),
  cancelThumbnailGeneration: vi.fn(),
  enqueueThumbnailGeneration,
  deleteThumbnail,
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig,
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent,
}));

/** 构造 readdir withFileTypes 目录项 */
function dirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  };
}

describe('imageService.scanAndImportFolder excludeDirs 整棵剪枝', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getDatabase.mockResolvedValue({});
    all.mockResolvedValue([]);
    run.mockResolvedValue(undefined);
    get.mockResolvedValue({ id: 101 });
    runInTransaction.mockImplementation(async (_db, callback) => callback());
    getConfig.mockReturnValue({ app: { autoScan: false } });
    stat.mockResolvedValue({
      size: 1234,
      birthtime: new Date('2026-04-24T01:00:00.000Z'),
      mtime: new Date('2026-04-24T02:00:00.000Z'),
    });
  });

  it('命中排除目录即整棵剪枝：不深入 readdir、其文件不导入', async () => {
    const root = path.join('M:', 'top', 'R');
    const keepDir = path.join(root, 'keep');
    const blackDir = path.join(root, 'C');
    readdir.mockImplementation(async (p: string) => {
      if (p === root) return [dirent('keep', true), dirent('C', true), dirent('a.jpg', false)];
      if (p === keepDir) return [dirent('k.jpg', false)];
      // 被剪枝的目录不应被读到；若被读到说明剪枝失效
      if (p === blackDir) return [dirent('b.jpg', false)];
      return [];
    });

    const { scanAndImportFolder } = await import('../../../src/main/services/imageService.js');
    const result = await scanAndImportFolder(root, ['.jpg'], true, [blackDir]);

    // importedIds：mock get 恒返 { id: 101 }，两次导入均记 101
    expect(result).toEqual({ success: true, data: { imported: 2, skipped: 0, importedIds: [101, 101] } });
    // 排除目录未被深入遍历
    expect(readdir).not.toHaveBeenCalledWith(blackDir, expect.anything());
    // 导入的 INSERT 不含黑名单子树文件
    const insertedPaths = run.mock.calls
      .filter((c) => typeof c[1] === 'string' && c[1].includes('INSERT INTO images'))
      .map((c) => c[2][1]);
    expect(insertedPaths).toContain(path.join(root, 'a.jpg'));
    expect(insertedPaths).toContain(path.join(keepDir, 'k.jpg'));
    expect(insertedPaths).not.toContain(path.join(blackDir, 'b.jpg'));
  });

  it('排除目录嵌套多层时同样在其所在层被剪枝', async () => {
    const root = path.join('M:', 'top', 'R');
    const midDir = path.join(root, 'B');
    const blackDir = path.join(midDir, 'C');
    readdir.mockImplementation(async (p: string) => {
      if (p === root) return [dirent('B', true)];
      if (p === midDir) return [dirent('C', true), dirent('m.jpg', false)];
      if (p === blackDir) return [dirent('x.jpg', false)];
      return [];
    });

    const { scanAndImportFolder } = await import('../../../src/main/services/imageService.js');
    const result = await scanAndImportFolder(root, ['.jpg'], true, [blackDir]);

    expect(result).toEqual({ success: true, data: { imported: 1, skipped: 0, importedIds: [101] } });
    expect(readdir).not.toHaveBeenCalledWith(blackDir, expect.anything());
    const insertedPaths = run.mock.calls
      .filter((c) => typeof c[1] === 'string' && c[1].includes('INSERT INTO images'))
      .map((c) => c[2][1]);
    expect(insertedPaths).toEqual([path.join(midDir, 'm.jpg')]);
  });

  it('不传 excludeDirs 时行为不变（全部导入）', async () => {
    const root = path.join('M:', 'top', 'R');
    const subDir = path.join(root, 'C');
    readdir.mockImplementation(async (p: string) => {
      if (p === root) return [dirent('C', true)];
      if (p === subDir) return [dirent('b.jpg', false)];
      return [];
    });

    const { scanAndImportFolder } = await import('../../../src/main/services/imageService.js');
    const result = await scanAndImportFolder(root, ['.jpg'], true);

    expect(result).toEqual({ success: true, data: { imported: 1, skipped: 0, importedIds: [101] } });
    const insertedPaths = run.mock.calls
      .filter((c) => typeof c[1] === 'string' && c[1].includes('INSERT INTO images'))
      .map((c) => c[2][1]);
    expect(insertedPaths).toEqual([path.join(subDir, 'b.jpg')]);
  });
});
