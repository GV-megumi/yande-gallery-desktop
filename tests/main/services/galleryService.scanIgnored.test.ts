import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

/**
 * bug12 — 扫描器忽略名单生效守卫
 *
 * 核心：在 scanSubfoldersAndCreateGalleries 中，若某子目录的归一化路径命中
 * gallery_ignored_folders，必须跳过（不 createGallery、不 scanAndImportFolder）。
 */

const getMock = vi.fn();
const runMock = vi.fn();
const allMock = vi.fn();
const readdirMock = vi.fn();
const accessMock = vi.fn();
const scanAndImportMock = vi.fn();

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
  all: (...args: any[]) => allMock(...args),
}));

// 归一化路径的 mock：使用 path.sep，和实际 normalizePath 行为一致
vi.mock('../../../src/main/utils/path.js', () => ({
  normalizePath: (p: string) => {
    // 用系统原生 path.normalize 再去掉末尾分隔符
    let n = path.normalize(p);
    if (n.length > 1 && (n.endsWith('/') || n.endsWith('\\'))) n = n.slice(0, -1);
    return n;
  },
}));

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: (...args: any[]) => scanAndImportMock(...args),
}));

// fs/promises 动态 import 在 galleryService 里每次调用都会取同一个 mock
vi.mock('fs/promises', () => ({
  default: {
    readdir: (...args: any[]) => readdirMock(...args),
    access: (...args: any[]) => accessMock(...args),
  },
  readdir: (...args: any[]) => readdirMock(...args),
  access: (...args: any[]) => accessMock(...args),
}));

describe('galleryService.scanSubfoldersAndCreateGalleries — 忽略名单', () => {
  beforeEach(() => {
    getMock.mockReset();
    runMock.mockReset();
    allMock.mockReset();
    readdirMock.mockReset();
    accessMock.mockReset();
    scanAndImportMock.mockReset();

    accessMock.mockResolvedValue(undefined);
    scanAndImportMock.mockResolvedValue({ success: true, data: { imported: 0, skipped: 0 } });
    runMock.mockResolvedValue(undefined);
  });

  it('命中忽略名单的子目录不应被创建为 gallery', async () => {
    const root = path.join('C:', 'root');
    const blocked = path.join(root, 'blocked');
    const allowed = path.join(root, 'allowed');

    // allMock 调用顺序：existingGalleries / existingNames / ignoredPaths
    allMock
      .mockResolvedValueOnce([])                              // existingGalleries
      .mockResolvedValueOnce([])                              // existingNames
      .mockResolvedValueOnce([{ folderPath: blocked }]);      // ignoredPaths

    // readdir：root 下两个子目录 + 两个子目录再 readdir（递归）都返回空
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === root) {
        return [
          { name: 'blocked', isDirectory: () => true, isFile: () => false },
          { name: 'allowed', isDirectory: () => true, isFile: () => false },
        ];
      }
      if (dir === allowed) {
        // allowed 目录下有一张图
        return [{ name: 'a.jpg', isDirectory: () => false, isFile: () => true }];
      }
      // blocked 目录不应被 readdir（因为被忽略 + continue）
      if (dir === blocked) {
        throw new Error(`forbidden: blocked dir should not be read: ${dir}`);
      }
      return [];
    });

    // createGallery 会触发 get(SELECT id FROM galleries WHERE folderPath) + run(INSERT)
    // 以及 get(last_insert_rowid)；都要 mock
    getMock.mockImplementation(async (_db: any, sql: string) => {
      if (/WHERE folderPath = \?/.test(sql)) return undefined; // 不存在
      if (/last_insert_rowid/.test(sql)) return { id: 1 };
      return undefined;
    });

    const { scanSubfoldersAndCreateGalleries } = await import(
      '../../../src/main/services/galleryService.js'
    );
    const result = await scanSubfoldersAndCreateGalleries(root);

    expect(result.success).toBe(true);
    // allowed 应被创建为 gallery（1 个 created），blocked 应被跳过
    expect(result.data?.created).toBe(1);
    // 确认 readdir 被 root 调过（进入循环），allowed 被读过（因为 allowed 包含图被认为是图集），
    // 但 blocked 没被 readdir（被 continue 拦下）
    const dirsRead = readdirMock.mock.calls.map(c => c[0]);
    expect(dirsRead).toContain(root);
    expect(dirsRead).not.toContain(blocked);
  });
});
